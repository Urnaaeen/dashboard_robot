const http = require("http");
const fs = require("fs");
const path = require("path");
const auth = require("./auth");
const database = require("./database");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");
const SESSION_COOKIE_NAME = "rpa_session";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
const SESSION_TTL_SECONDS = Math.round(SESSION_TTL_HOURS * 60 * 60);
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === undefined
    ? process.env.NODE_ENV === "production"
    : process.env.COOKIE_SECURE === "true";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();
let dummyPasswordHashPromise;

if (!Number.isFinite(SESSION_TTL_HOURS) || SESSION_TTL_HOURS <= 0 || SESSION_TTL_HOURS > 168) {
  throw new Error("SESSION_TTL_HOURS must be between 0 and 168.");
}

const STATUS = new Set([
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "CANCELLED",
  "TIMEOUT",
  "UNKNOWN",
]);
const EVENT_TYPE = new Set(["INFO", "WARNING", "ERROR"]);
const LOGGER_ROLES = new Set(["ADMIN", "OPERATOR"]);
const ADMIN_ONLY = new Set(["ADMIN"]);
const CONTRIBUTOR_ROLES = new Set(["ADMIN", "OPERATOR"]);
const DOCUMENT_TYPES = new Set([
  "PROCESS_DIAGRAM",
  "SUPPORT_GUIDE",
  "SPECIFICATION",
  "OTHER",
]);

// Uploads are classified by file extension rather than by the Content-Type the
// browser claims. The client value is unreliable across browsers and, more
// importantly, it is attacker controlled; deriving the type here means a stored
// file can only ever be served back as something from this list. SVG and HTML
// are deliberately absent because both can carry script.
const DOCUMENT_EXTENSIONS = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".txt", "text/plain"],
  [".md", "text/plain"],
  [".csv", "text/csv"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".vsd", "application/vnd.visio"],
  [".vsdx", "application/vnd.ms-visio.drawing"],
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

function nowIso() {
  return new Date().toISOString();
}

function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function securityHeaders() {
  return {
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendText(res, statusCode, value) {
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(value);
}

function redirect(res, location) {
  res.writeHead(302, {
    ...securityHeaders(),
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(httpError("Request body is too large.", 413));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(httpError("Request body must be valid JSON.", 400));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(
          httpError(
            `The file exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
            413,
          ),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readUploadFileName(req) {
  const raw = String(req.headers["x-file-name"] || "");
  if (!raw) {
    throw httpError("The X-File-Name header is required.", 400);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (error) {
    throw httpError("X-File-Name must be percent encoded.", 400);
  }
  // Keep the basename only, and drop control characters, so nothing in the name
  // can escape a directory or break a response header.
  const fileName = decoded
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!fileName || fileName === "." || fileName === "..") {
    throw httpError("The file name is not valid.", 400);
  }
  if (fileName.length > 255) {
    throw httpError("The file name cannot exceed 255 characters.", 400);
  }
  return fileName;
}

function resolveDocumentContentType(fileName) {
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  const contentType = DOCUMENT_EXTENSIONS.get(extension);
  if (!contentType) {
    throw httpError(
      `Unsupported file type. Allowed: ${[...DOCUMENT_EXTENSIONS.keys()].join(", ")}`,
      415,
    );
  }
  return contentType;
}

function contentDispositionAttachment(fileName) {
  // Mongolian file names are not Latin-1, so the quoted form gets an ASCII
  // fallback and the real name travels in the RFC 5987 parameter.
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function requireFields(payload, fields) {
  const missing = fields.filter(
    (field) => payload[field] === undefined || payload[field] === null || payload[field] === "",
  );
  if (missing.length) {
    const suffix = missing.length === 1 ? "field" : "fields";
    throw httpError(`Missing required ${suffix}: ${missing.join(", ")}`, 400);
  }
}

function requireRobotCode(payload) {
  requireFields(payload, ["robotCode"]);
  const robotCode = String(payload.robotCode).trim();
  if (!robotCode) {
    throw httpError("robotCode cannot be blank.", 400);
  }
  return robotCode;
}

function requireBoolean(payload, field) {
  requireFields(payload, [field]);
  if (typeof payload[field] !== "boolean") {
    throw httpError(`${field} must be true or false.`, 400);
  }
  return payload[field];
}

function requireUuid(value, field) {
  const normalized = String(value || "").trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(normalized)) {
    throw httpError(`${field} must be a valid UUID.`, 400);
  }
  return normalized;
}

function validatePowerAutomateUrls(payload) {
  for (const field of ["powerAutomateUrl", "cloudFlowUrl", "desktopFlowUrl"]) {
    const value = String(payload[field] || "").trim();
    if (!value) continue;
    if (value.length > 2000) {
      throw httpError(`${field} cannot exceed 2000 characters.`, 400);
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "make.powerautomate.com") {
        throw new Error("unsupported URL");
      }
    } catch (error) {
      throw httpError(`${field} must be an https://make.powerautomate.com URL.`, 400);
    }
  }
}

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch (error) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function sessionCookie(token) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (COOKIE_SECURE) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function expiredSessionCookie() {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (COOKIE_SECURE) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function getClientIp(req) {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) {
      return forwarded.slice(0, 100);
    }
  }
  return String(req.socket.remoteAddress || "unknown").slice(0, 100);
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return;
  }
  try {
    if (new URL(origin).host !== req.headers.host) {
      throw httpError("Cross-origin request is not allowed.", 403);
    }
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw httpError("Invalid Origin header.", 403);
  }
}

function getLoginAttemptState(ipAddress) {
  const now = Date.now();
  const recent = (loginFailures.get(ipAddress) || []).filter(
    (timestamp) => now - timestamp < LOGIN_WINDOW_MS,
  );
  if (recent.length) {
    loginFailures.set(ipAddress, recent);
  } else {
    loginFailures.delete(ipAddress);
  }
  return recent;
}

function recordLoginFailure(ipAddress) {
  loginFailures.set(ipAddress, [...getLoginAttemptState(ipAddress), Date.now()]);
  if (loginFailures.size > 1000) {
    for (const key of loginFailures.keys()) {
      getLoginAttemptState(key);
    }
  }
}

function getDummyPasswordHash() {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = auth.hashPassword("invalid-login-placeholder-password");
  }
  return dummyPasswordHashPromise;
}

async function getSessionUser(req) {
  if (req.sessionChecked) {
    return req.sessionUser;
  }
  req.sessionChecked = true;
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  req.sessionToken = token || "";
  req.sessionUser = token
    ? await database.getUserBySessionTokenHash(auth.hashSessionToken(token))
    : null;
  return req.sessionUser;
}

async function requireSession(req) {
  const user = await getSessionUser(req);
  if (!user) {
    throw httpError("Authentication required.", 401);
  }
  return user;
}

async function requireRole(req, allowedRoles) {
  const user = await requireSession(req);
  if (!allowedRoles.has(user.role)) {
    throw httpError("You do not have permission for this action.", 403);
  }
  return user;
}

async function requireLoggerAccess(req) {
  const user = await getSessionUser(req);
  if (user && LOGGER_ROLES.has(user.role)) {
    return;
  }

  const configuredApiKey = String(process.env.RPA_API_KEY || "");
  const providedApiKey = req.headers["x-rpa-api-key"];
  if (configuredApiKey.length >= 32 && auth.safeEqualText(providedApiKey, configuredApiKey)) {
    return;
  }

  if (user) {
    throw httpError("You do not have permission for this action.", 403);
  }
  throw httpError("Authentication required.", 401);
}

async function handleLogin(req, res) {
  assertSameOrigin(req);
  const ipAddress = getClientIp(req);
  const payload = await parseBody(req);
  requireFields(payload, ["username", "password"]);
  const username = String(payload.username).trim().toLowerCase();
  const password = String(payload.password);
  const loginAttemptKey = `${ipAddress}:${username}`;
  if (getLoginAttemptState(loginAttemptKey).length >= LOGIN_MAX_FAILURES) {
    sendJson(res, 429, {
      error: "Too many sign-in attempts. Try again in 15 minutes.",
    });
    return;
  }
  if (username.length > 100 || password.length > auth.PASSWORD_MAX_LENGTH) {
    recordLoginFailure(loginAttemptKey);
    throw httpError("Invalid username or password.", 401);
  }

  const user = await database.findUserByUsername(username);
  const passwordHash = user?.passwordHash || (await getDummyPasswordHash());
  const passwordMatches = await auth.verifyPassword(password, passwordHash);
  if (!user || !user.isActive || !passwordMatches) {
    recordLoginFailure(loginAttemptKey);
    throw httpError("Invalid username or password.", 401);
  }

  loginFailures.delete(loginAttemptKey);
  const token = auth.createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await database.createUserSession({
    userId: user.userId,
    tokenHash: auth.hashSessionToken(token),
    expiresAt,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    ipAddress,
  });
  delete user.passwordHash;
  sendJson(
    res,
    200,
    { user: { ...user, lastLoginAt: nowIso() }, expiresAt },
    { "Set-Cookie": sessionCookie(token) },
  );
}

async function handleLogout(req, res) {
  assertSameOrigin(req);
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) {
    await database.deleteUserSession(auth.hashSessionToken(token));
  }
  sendJson(res, 200, { ok: true }, { "Set-Cookie": expiredSessionCookie() });
}

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...securityHeaders(), "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    await database.ping();
    sendJson(res, 200, { ok: true, generatedAt: nowIso() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    await handleLogin(req, res);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    await handleLogout(req, res);
    return true;
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    const user = await requireSession(req);
    sendJson(res, 200, { user });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    await requireSession(req);
    const data = await database.getDashboardData();
    sendJson(res, 200, {
      generatedAt: nowIso(),
      machineOfflineSeconds: database.MACHINE_OFFLINE_SECONDS,
      ...data,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/history") {
    await requireSession(req);
    const status = String(searchParams.get("status") || "ALL").toUpperCase();
    if (status !== "ALL" && !STATUS.has(status)) {
      throw httpError("Unsupported status value.", 400);
    }
    const startedFrom = searchParams.get("startedFrom") || "";
    const startedTo = searchParams.get("startedTo") || "";
    if (startedFrom && Number.isNaN(Date.parse(startedFrom))) {
      throw httpError("startedFrom must be a valid date-time.", 400);
    }
    if (startedTo && Number.isNaN(Date.parse(startedTo))) {
      throw httpError("startedTo must be a valid date-time.", 400);
    }
    const history = await database.getRunHistory({
      search: searchParams.get("search") || "",
      status,
      startedFrom,
      startedTo,
      limit: searchParams.get("limit") || 200,
    });
    sendJson(res, 200, { generatedAt: nowIso(), ...history });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/machines") {
    await requireSession(req);
    const machines = await database.getMachines();
    sendJson(res, 200, {
      generatedAt: nowIso(),
      machineOfflineSeconds: database.MACHINE_OFFLINE_SECONDS,
      machines,
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/machines/heartbeat") {
    assertSameOrigin(req);
    await requireLoggerAccess(req);
    const payload = await parseBody(req);
    requireFields(payload, ["machineName"]);
    const machineName = String(payload.machineName).trim();
    if (!machineName || machineName.length > 150) {
      throw httpError("machineName must be between 1 and 150 characters.", 400);
    }
    if (payload.machineIp != null && String(payload.machineIp).trim().length > 100) {
      throw httpError("machineIp cannot exceed 100 characters.", 400);
    }
    if (payload.anydeskId != null && String(payload.anydeskId).trim().length > 100) {
      throw httpError("anydeskId cannot exceed 100 characters.", 400);
    }
    if (
      payload.metadata != null &&
      (typeof payload.metadata !== "object" || Array.isArray(payload.metadata))
    ) {
      throw httpError("metadata must be a JSON object.", 400);
    }
    const machine = await database.recordMachineHeartbeat({ ...payload, machineName });
    sendJson(res, 200, { machine });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/robots") {
    assertSameOrigin(req);
    await requireRole(req, new Set(["ADMIN"]));
    const payload = await parseBody(req);
    requireFields(payload, [
      "robotName",
      "powerAutomateEnvironmentId",
      "machineName",
    ]);
    validatePowerAutomateUrls(payload);
    const robot = await database.createRobot(payload);
    sendJson(res, 200, { robot });
    return true;
  }

  const robotActiveMatch = pathname.match(/^\/api\/robots\/([^/]+)\/active$/);
  if (req.method === "PATCH" && robotActiveMatch) {
    assertSameOrigin(req);
    await requireRole(req, new Set(["ADMIN"]));
    const robotId = requireUuid(robotActiveMatch[1], "robotId");
    const payload = await parseBody(req);
    const isActive = requireBoolean(payload, "isActive");
    const robot = await database.updateRobotActive(robotId, isActive);
    sendJson(res, 200, { robot });
    return true;
  }

  const robotPowerAutomateMatch = pathname.match(/^\/api\/robots\/([^/]+)\/power-automate$/);
  if (req.method === "PATCH" && robotPowerAutomateMatch) {
    assertSameOrigin(req);
    await requireRole(req, new Set(["ADMIN"]));
    const robotId = requireUuid(robotPowerAutomateMatch[1], "robotId");
    const payload = await parseBody(req);
    validatePowerAutomateUrls(payload);
    const robot = await database.updateRobotPowerAutomate(robotId, payload);
    sendJson(res, 200, { robot });
    return true;
  }

  const robotDocumentsMatch = pathname.match(/^\/api\/robots\/([^/]+)\/documents$/);
  if (req.method === "GET" && robotDocumentsMatch) {
    await requireSession(req);
    const robotId = requireUuid(robotDocumentsMatch[1], "robotId");
    const documents = await database.getRobotDocuments(robotId);
    sendJson(res, 200, { generatedAt: nowIso(), documents });
    return true;
  }

  if (req.method === "POST" && robotDocumentsMatch) {
    assertSameOrigin(req);
    const user = await requireRole(req, CONTRIBUTOR_ROLES);
    const robotId = requireUuid(robotDocumentsMatch[1], "robotId");
    const fileName = readUploadFileName(req);
    const contentType = resolveDocumentContentType(fileName);
    const documentType = String(req.headers["x-document-type"] || "OTHER").toUpperCase();
    if (!DOCUMENT_TYPES.has(documentType)) {
      throw httpError(
        `documentType must be one of: ${[...DOCUMENT_TYPES].join(", ")}`,
        400,
      );
    }
    let description = "";
    try {
      description = decodeURIComponent(String(req.headers["x-description"] || "")).slice(0, 1000);
    } catch (error) {
      throw httpError("X-Description must be percent encoded.", 400);
    }
    const content = await readRawBody(req, database.DOCUMENT_MAX_BYTES);
    const document = await database.createRobotDocument({
      robotId,
      documentType,
      fileName,
      contentType,
      description,
      content,
      uploadedBy: user.userId,
      uploadedByName: user.displayName || user.username,
    });
    sendJson(res, 201, { document });
    return true;
  }

  const documentContentMatch = pathname.match(/^\/api\/documents\/([^/]+)\/content$/);
  if (req.method === "GET" && documentContentMatch) {
    await requireSession(req);
    const documentId = requireUuid(documentContentMatch[1], "documentId");
    const document = await database.getRobotDocumentContent(documentId);
    // Always an attachment. Nothing uploaded here is ever rendered in the
    // browser, which keeps a stored file from becoming stored XSS.
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": document.contentType,
      "Content-Length": document.content.length,
      "Content-Disposition": contentDispositionAttachment(document.fileName),
      "Cache-Control": "no-store",
    });
    res.end(document.content);
    return true;
  }

  const documentMatch = pathname.match(/^\/api\/documents\/([^/]+)$/);
  if (req.method === "DELETE" && documentMatch) {
    assertSameOrigin(req);
    await requireRole(req, ADMIN_ONLY);
    const documentId = requireUuid(documentMatch[1], "documentId");
    const document = await database.deleteRobotDocument(documentId);
    sendJson(res, 200, { document });
    return true;
  }

  const robotSuggestionsMatch = pathname.match(/^\/api\/robots\/([^/]+)\/suggestions$/);
  if (req.method === "GET" && robotSuggestionsMatch) {
    await requireSession(req);
    const robotId = requireUuid(robotSuggestionsMatch[1], "robotId");
    const suggestions = await database.getRobotSuggestions(robotId);
    sendJson(res, 200, { generatedAt: nowIso(), suggestions });
    return true;
  }

  if (req.method === "POST" && robotSuggestionsMatch) {
    assertSameOrigin(req);
    const user = await requireRole(req, CONTRIBUTOR_ROLES);
    const robotId = requireUuid(robotSuggestionsMatch[1], "robotId");
    const payload = await parseBody(req);
    requireFields(payload, ["title"]);
    const suggestion = await database.createRobotSuggestion({
      robotId,
      title: String(payload.title).slice(0, 300),
      details: payload.details ? String(payload.details).slice(0, 4000) : null,
      createdBy: user.userId,
      createdByName: user.displayName || user.username,
    });
    sendJson(res, 201, { suggestion });
    return true;
  }

  const suggestionMatch = pathname.match(/^\/api\/suggestions\/([^/]+)$/);
  if (req.method === "PATCH" && suggestionMatch) {
    assertSameOrigin(req);
    const user = await requireRole(req, ADMIN_ONLY);
    const suggestionId = requireUuid(suggestionMatch[1], "suggestionId");
    const payload = await parseBody(req);
    const isDone = requireBoolean(payload, "isDone");
    const suggestion = await database.setRobotSuggestionDone(suggestionId, isDone, {
      userId: user.userId,
      displayName: user.displayName || user.username,
    });
    sendJson(res, 200, { suggestion });
    return true;
  }

  if (req.method === "DELETE" && suggestionMatch) {
    assertSameOrigin(req);
    await requireRole(req, ADMIN_ONLY);
    const suggestionId = requireUuid(suggestionMatch[1], "suggestionId");
    const suggestion = await database.deleteRobotSuggestion(suggestionId);
    sendJson(res, 200, { suggestion });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/start") {
    assertSameOrigin(req);
    await requireLoggerAccess(req);
    const payload = await parseBody(req);
    const robotCode = requireRobotCode(payload);
    const robotRun = await database.startRobotRun({ ...payload, robotCode });
    sendJson(res, 201, { robotRun });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/success") {
    assertSameOrigin(req);
    await requireLoggerAccess(req);
    const payload = await parseBody(req);
    const robotCode = requireRobotCode(payload);
    const robotRun = await database.finishRobotRun({ ...payload, robotCode }, "SUCCESS");
    sendJson(res, 200, { robotRun });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/failed") {
    assertSameOrigin(req);
    await requireLoggerAccess(req);
    const payload = await parseBody(req);
    requireFields(payload, ["errorMessage"]);
    const robotCode = requireRobotCode(payload);
    const robotRun = await database.finishRobotRun({ ...payload, robotCode }, "FAILED");
    sendJson(res, 200, { robotRun });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/event") {
    assertSameOrigin(req);
    await requireLoggerAccess(req);
    const payload = await parseBody(req);
    requireFields(payload, ["robotRunId", "eventType", "message"]);
    const eventType = String(payload.eventType).toUpperCase();
    if (!EVENT_TYPE.has(eventType)) {
      throw httpError("eventType must be INFO, WARNING, or ERROR.", 400);
    }
    const runEvent = await database.createRunEvent({ ...payload, eventType });
    sendJson(res, 201, { runEvent });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/runs/status") {
    assertSameOrigin(req);
    await requireLoggerAccess(req);
    const payload = await parseBody(req);
    requireFields(payload, ["robotRunId", "status"]);
    const status = String(payload.status).toUpperCase();
    if (!STATUS.has(status)) {
      throw httpError("Unsupported status value.", 400);
    }
    const robotRun = await database.updateRunStatus({ ...payload, status });
    sendJson(res, 200, { robotRun });
    return true;
  }

  return false;
}

function serveStatic(res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(resolved, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackContent) => {
          if (fallbackError) {
            sendText(res, 404, "Not found");
            return;
          }
          res.writeHead(200, {
            ...securityHeaders(),
            "Content-Type": MIME_TYPES[".html"],
            "Cache-Control": "no-store",
          });
          res.end(fallbackContent);
        });
        return;
      }
      sendText(res, 500, "Server error");
      return;
    }

    const extension = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=60",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    sendText(res, 400, "Invalid request path");
    return;
  }

  try {
    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, pathname, url.searchParams);
      if (!handled) {
        sendJson(res, 404, { error: "API route not found." });
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method not allowed");
      return;
    }

    if (["/login", "/login.html", "/login.css", "/login.js"].includes(pathname)) {
      if ((pathname === "/login" || pathname === "/login.html") && (await getSessionUser(req))) {
        redirect(res, "/");
        return;
      }
      serveStatic(res, pathname === "/login" ? "/login.html" : pathname);
      return;
    }

    const user = await getSessionUser(req);
    if (!user) {
      const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
      redirect(res, `/login${next}`);
      return;
    }

    if (pathname === "/swagger") {
      serveStatic(res, "/swagger.html");
      return;
    }
    if (pathname === "/swagger.json") {
      serveStatic(res, "/openapi.json");
      return;
    }
    serveStatic(res, pathname);
  } catch (error) {
    const normalized = database.translateDatabaseError(error);
    if (!normalized.statusCode) {
      console.error(error);
    }
    sendJson(res, normalized.statusCode || 500, {
      error: normalized.statusCode ? normalized.message : "Unexpected server error.",
    });
  }
});

async function start() {
  await database.initializeSchema();
  if (process.env.SEED_DATABASE === "true") {
    await database.seedSampleData();
  }
  server.listen(PORT, () => {
    console.log(`RPA Monitoring Dashboard is running at http://localhost:${PORT}`);
  });
}

async function shutdown() {
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch(async (error) => {
  console.error(`Server startup failed: ${error.message}`);
  await database.close();
  process.exitCode = 1;
});
