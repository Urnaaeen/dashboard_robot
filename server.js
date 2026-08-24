const http = require("http");
const fs = require("fs");
const path = require("path");
const database = require("./database");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");

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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
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
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function requireFields(payload, fields) {
  const missing = fields.filter(
    (field) => payload[field] === undefined || payload[field] === null || payload[field] === "",
  );
  if (missing.length) {
    const suffix = missing.length === 1 ? "field" : "fields";
    throw Object.assign(new Error(`Missing required ${suffix}: ${missing.join(", ")}`), {
      statusCode: 400,
    });
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return true;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    const status = await database.ping();
    sendJson(res, 200, {
      ok: true,
      database: status.database_name,
      databaseTime: status.database_time,
      generatedAt: nowIso(),
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    const data = await database.getDashboardData();
    sendJson(res, 200, { generatedAt: nowIso(), ...data });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/robots") {
    const payload = await parseBody(req);
    requireFields(payload, [
      "robotCode",
      "robotName",
      "powerAutomateEnvironmentId",
      "machineName",
    ]);
    const robot = await database.upsertRobot(payload);
    sendJson(res, 200, { robot });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/start") {
    const payload = await parseBody(req);
    requireFields(payload, ["robotId"]);
    const robotRun = await database.startRobotRun(payload);
    sendJson(res, 201, { robotRun });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/success") {
    const payload = await parseBody(req);
    requireFields(payload, ["robotRunId"]);
    const robotRun = await database.finishRobotRun(payload, "SUCCESS");
    sendJson(res, 200, { robotRun });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/failed") {
    const payload = await parseBody(req);
    requireFields(payload, ["robotRunId", "errorMessage"]);
    const robotRun = await database.finishRobotRun(payload, "FAILED");
    sendJson(res, 200, { robotRun });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/logger/event") {
    const payload = await parseBody(req);
    requireFields(payload, ["robotRunId", "eventType", "message"]);
    const eventType = String(payload.eventType).toUpperCase();
    if (!EVENT_TYPE.has(eventType)) {
      throw Object.assign(new Error("eventType must be INFO, WARNING, or ERROR."), {
        statusCode: 400,
      });
    }
    const runEvent = await database.createRunEvent({ ...payload, eventType });
    sendJson(res, 201, { runEvent });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/runs/status") {
    const payload = await parseBody(req);
    requireFields(payload, ["robotRunId", "status"]);
    const status = String(payload.status).toUpperCase();
    if (!STATUS.has(status)) {
      throw Object.assign(new Error("Unsupported status value."), { statusCode: 400 });
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
  if (!resolved.startsWith(PUBLIC_DIR)) {
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
          res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
          res.end(fallbackContent);
        });
        return;
      }
      sendText(res, 500, "Server error");
      return;
    }

    const extension = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=60",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, pathname);
      if (!handled) {
        sendJson(res, 404, { error: "API route not found." });
      }
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
    sendJson(res, normalized.statusCode || 500, {
      error: normalized.message || "Unexpected server error.",
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
