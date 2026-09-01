const ADD_ROBOT_DRAFT_KEY_PREFIX = "rpa-monitoring:add-robot-draft";
const EMPTY_ADD_ROBOT_DRAFT = Object.freeze({
  robotName: "",
  powerAutomateEnvironmentId: "",
  machineName: "",
  machineIp: "",
  robotType: "CLOUD_DESKTOP",
  accountName: "",
  anydeskId: "",
  cloudFlowId: "",
  cloudFlowName: "",
  cloudFlowUrl: "",
  desktopFlowId: "",
  desktopFlowName: "",
  desktopFlowUrl: "",
});

function routeFromLocation() {
  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (error) {
        return segment;
      }
    });
  if (segments[0] === "robots" && segments[1]) {
    return { view: "detail", robotCode: segments[1] };
  }
  if (segments[0] === "robots") {
    return { view: "robots", robotCode: "" };
  }
  if (segments[0] === "machines") {
    return { view: "machines", robotCode: "" };
  }
  if (segments[0] === "history") {
    return { view: "history", robotCode: "" };
  }
  return { view: "overview", robotCode: "" };
}

const initialRoute = routeFromLocation();

function loadAddRobotDraft(storageKey) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    return Object.fromEntries(
      Object.entries(EMPTY_ADD_ROBOT_DRAFT).map(([field, defaultValue]) => {
        const savedValue = field === "accountName"
          ? saved.accountName ?? saved.accountLabel
          : saved[field];
        return [field, savedValue === undefined ? defaultValue : String(savedValue)];
      }),
    );
  } catch (error) {
    return { ...EMPTY_ADD_ROBOT_DRAFT };
  }
}

const state = {
  currentUser: null,
  data: {
    robots: [],
    robotRuns: [],
    runEvents: [],
    machines: [],
  },
  history: {
    runs: [],
    total: 0,
    limit: 200,
    search: "",
    status: "ALL",
    date: "",
    loading: false,
    loaded: false,
    requestId: 0,
    debounceTimer: null,
  },
  filters: {
    environmentId: "ALL",
    status: "ALL",
    machine: "ALL",
    robot: "",
    date: "",
  },
  machineFilters: {
    search: "",
    status: "ALL",
  },
  addRobotDraft: { ...EMPTY_ADD_ROBOT_DRAFT },
  addRobotOpen: false,
  powerAutomateEditorRobotId: "",
  view: initialRoute.view,
  routeRobotCode: initialRoute.robotCode,
  detailReturnView: "overview",
  selectedRobotId: "",
  lastUpdated: null,
  refreshTimer: null,
  machineOfflineSeconds: 180,
  robotDetail: {
    robotId: "",
    documents: [],
    suggestions: [],
    loading: false,
    error: "",
    uploading: false,
    documentType: "PROCESS_DIAGRAM",
    suggestionDraft: "",
    requestId: 0,
  },
};

const statusMeta = {
  RUNNING: { label: "Running", className: "status-running" },
  SUCCESS: { label: "Success", className: "status-success" },
  FAILED: { label: "Failed", className: "status-failed" },
  QUEUED: { label: "Queued", className: "status-queued" },
  CANCELLED: { label: "Cancelled", className: "status-cancelled" },
  TIMEOUT: { label: "Timeout", className: "status-timeout" },
  UNKNOWN: { label: "Unknown", className: "status-unknown" },
  STALE_RUNNING: { label: "Stale Running", className: "status-stale_running" },
  ONLINE: { label: "Online", className: "status-online" },
  OFFLINE: { label: "Offline", className: "status-offline" },
  NOT_CONNECTED: { label: "Not Connected", className: "status-not_connected" },
  DISABLED: { label: "Turned Off", className: "status-disabled" },
};

const icons = {
  add: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" focusable="false"><path d="m15 18-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" focusable="false"><path d="M20 6 9 17l-5-5"/></svg>',
  external: '<svg viewBox="0 0 24 24" focusable="false"><path d="M14 3h7v7m0-7-9 9"/><path d="M20 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5"/></svg>',
  filter: '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 5h16M7 12h10M10 19h4"/></svg>',
  play: '<svg viewBox="0 0 24 24" focusable="false"><path d="M8 5v14l11-7-11-7Z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" focusable="false"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/></svg>',
  robot: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 8V4m-5 8h10M7 16h10M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><path d="M9 12h.01M15 12h.01"/></svg>',
  machine: '<svg viewBox="0 0 24 24" focusable="false"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  x: '<svg viewBox="0 0 24 24" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  file: '<svg viewBox="0 0 24 24" focusable="false"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
  upload: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 16V4m-5 5 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
};

const app = document.querySelector("#app");
const apiDot = document.querySelector("#apiDot");
const apiStatus = document.querySelector("#apiStatus");
const lastUpdated = document.querySelector("#lastUpdated");
const pageTitle = document.querySelector("#pageTitle");
const pageSubtitle = document.querySelector("#pageSubtitle");
const toast = document.querySelector("#toast");
const accountAvatar = document.querySelector("#accountAvatar");
const accountName = document.querySelector("#accountName");
const accountRole = document.querySelector("#accountRole");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function robotNameSlug(name) {
  return String(name || "robot")
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "robot";
}

function robotDetailPath(robot) {
  return `/robots/${encodeURIComponent(robot.robotCode)}/${encodeURIComponent(robotNameSlug(robot.robotName))}`;
}

function pathForView(view) {
  if (view === "robots") {
    return "/robots";
  }
  if (view === "history") {
    return "/history";
  }
  if (view === "machines") {
    return "/machines";
  }
  return "/";
}

function updateBrowserUrl(pathname, replace = false, routeState = {}) {
  const method = replace ? "replaceState" : "pushState";
  window.history[method](routeState, "", pathname);
}

function syncRobotSelectionFromRoute({ canonicalize = false } = {}) {
  if (state.view !== "detail") {
    state.routeRobotCode = "";
    return null;
  }
  const robot = state.data.robots.find((item) => item.robotCode === state.routeRobotCode) || null;
  state.selectedRobotId = robot?.robotId || "";
  if (robot && canonicalize && window.location.pathname !== robotDetailPath(robot)) {
    updateBrowserUrl(robotDetailPath(robot), true, window.history.state || {});
  }
  return robot;
}

function navigateToView(view, { replace = false } = {}) {
  state.addRobotOpen = false;
  state.powerAutomateEditorRobotId = "";
  document.body.classList.remove("modal-open");
  state.view = view;
  state.routeRobotCode = "";
  updateBrowserUrl(pathForView(view), replace, { view });
  render();
}

function navigateToRobot(robot, { replace = false } = {}) {
  state.addRobotOpen = false;
  state.powerAutomateEditorRobotId = "";
  document.body.classList.remove("modal-open");
  state.view = "detail";
  state.routeRobotCode = robot.robotCode;
  state.selectedRobotId = robot.robotId;
  updateBrowserUrl(robotDetailPath(robot), replace, {
    detailReturnView: state.detailReturnView || "overview",
  });
  render();
}

function persistAddRobotDraft() {
  try {
    window.localStorage.setItem(addRobotDraftStorageKey(), JSON.stringify(state.addRobotDraft));
  } catch (error) {
    // The in-memory draft still protects the form during dashboard refreshes.
  }
}

function updateAddRobotDraft(field, value) {
  if (!Object.hasOwn(EMPTY_ADD_ROBOT_DRAFT, field)) {
    return;
  }
  state.addRobotDraft[field] = String(value);
  persistAddRobotDraft();
}

function resetAddRobotDraft() {
  state.addRobotDraft = { ...EMPTY_ADD_ROBOT_DRAFT };
  try {
    window.localStorage.removeItem(addRobotDraftStorageKey());
  } catch (error) {
    // The draft is already reset in memory.
  }
}

function addRobotDraftStorageKey() {
  return `${ADD_ROBOT_DRAFT_KEY_PREFIX}:${state.currentUser?.userId || "anonymous"}`;
}

function apiFetch(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login?reason=session&next=${encodeURIComponent(next)}`);
      throw new Error("Session expired.");
    }
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  });
}

function canAdmin() {
  return state.currentUser?.role === "ADMIN";
}

function canOperate() {
  return ["ADMIN", "OPERATOR"].includes(state.currentUser?.role);
}

function userInitials() {
  const value = state.currentUser?.displayName || state.currentUser?.username || "U";
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

async function loadCurrentUser() {
  const payload = await apiFetch("/api/auth/me");
  state.currentUser = payload.user;
  state.addRobotDraft = loadAddRobotDraft(addRobotDraftStorageKey());
}

async function loadData({ silent = false } = {}) {
  if (!silent) {
    app.innerHTML = '<div class="loading">Loading dashboard data...</div>';
  }

  try {
    const payload = await apiFetch("/api/dashboard");
    state.data = {
      robots: payload.robots || [],
      robotRuns: payload.robotRuns || [],
      runEvents: payload.runEvents || [],
      machines: payload.machines || [],
    };
    state.machineOfflineSeconds = Number(payload.machineOfflineSeconds) || 180;
    state.lastUpdated = new Date(payload.generatedAt || Date.now());
    syncRobotSelectionFromRoute({ canonicalize: true });
    if (state.view !== "detail" && !state.selectedRobotId && state.data.robots.length > 0) {
      state.selectedRobotId = state.data.robots[0].robotId;
    }
    setApiState(true);
    if (!(silent && (state.addRobotOpen || state.powerAutomateEditorRobotId))) {
      render();
    }
  } catch (error) {
    setApiState(false);
    if (state.addRobotOpen) {
      showToast(error.message, "error");
    } else {
      app.innerHTML = renderEmptyState("Dashboard API is not available.", error.message);
    }
  }
}

function historyDateRange(dateValue) {
  if (!dateValue) {
    return {};
  }
  const startedFrom = new Date(`${dateValue}T00:00:00`);
  const startedTo = new Date(startedFrom);
  startedTo.setDate(startedTo.getDate() + 1);
  return {
    startedFrom: startedFrom.toISOString(),
    startedTo: startedTo.toISOString(),
  };
}

async function loadHistory({ silent = false } = {}) {
  const requestId = state.history.requestId + 1;
  state.history.requestId = requestId;
  state.history.loading = true;
  if (!silent && state.view === "history") {
    render();
  }

  const params = new URLSearchParams({ limit: String(state.history.limit) });
  if (state.history.search.trim()) {
    params.set("search", state.history.search.trim());
  }
  if (state.history.status !== "ALL") {
    params.set("status", state.history.status);
  }
  const dateRange = historyDateRange(state.history.date);
  if (dateRange.startedFrom) {
    params.set("startedFrom", dateRange.startedFrom);
    params.set("startedTo", dateRange.startedTo);
  }

  try {
    const payload = await apiFetch(`/api/history?${params}`);
    if (requestId !== state.history.requestId) {
      return;
    }
    state.history.runs = payload.runs || [];
    state.history.total = Number(payload.total || 0);
    state.history.limit = Number(payload.limit || state.history.limit);
    state.history.loaded = true;
    state.lastUpdated = new Date(payload.generatedAt || Date.now());
    setApiState(true);
  } catch (error) {
    if (requestId !== state.history.requestId) {
      return;
    }
    setApiState(false);
    showToast(error.message, "error");
  } finally {
    if (requestId === state.history.requestId) {
      state.history.loading = false;
      if (state.view === "history") {
        const activeFilter = document.activeElement?.dataset.historyFilter || "";
        const selectionStart = document.activeElement?.selectionStart;
        render();
        if (activeFilter) {
          window.requestAnimationFrame(() => {
            const filter = document.querySelector(`[data-history-filter="${activeFilter}"]`);
            filter?.focus();
            if (typeof selectionStart === "number" && filter?.setSelectionRange) {
              filter.setSelectionRange(selectionStart, selectionStart);
            }
          });
        }
      }
    }
  }
}

function setApiState(isOnline) {
  apiDot.classList.toggle("is-online", isOnline);
  apiDot.classList.toggle("is-offline", !isOnline);
  apiStatus.textContent = isOnline ? "Online" : "Offline";
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2800);
}

function latestRunMap() {
  const map = new Map();
  for (const run of state.data.robotRuns) {
    const current = map.get(run.robotId);
    if (!current || new Date(run.startedAt).getTime() > new Date(current.startedAt).getTime()) {
      map.set(run.robotId, run);
    }
  }
  return map;
}

function rows() {
  const latest = latestRunMap();
  return state.data.robots.map((robot) => {
    const latestRun = latest.get(robot.robotId) || null;
    const displayStatus = getDisplayStatus(robot, latestRun);
    return { robot, latestRun, displayStatus };
  });
}

function getDisplayStatus(robot, run) {
  if (!robot.isActive) {
    return "DISABLED";
  }
  if (!run) {
    return "UNKNOWN";
  }
  if (run.status === "RUNNING" && isStaleRunning(robot, run)) {
    return "STALE_RUNNING";
  }
  return run.status || "UNKNOWN";
}

function isStaleRunning(robot, run) {
  if (!run || run.status !== "RUNNING" || !run.startedAt) {
    return false;
  }
  const maxMinutes = Number(robot.maxExpectedRunMinutes || 0);
  if (!maxMinutes) {
    return false;
  }
  const elapsedMs = Date.now() - new Date(run.startedAt).getTime();
  return elapsedMs > maxMinutes * 60 * 1000;
}

function filteredRows({ includeInactive = false } = {}) {
  const query = state.filters.robot.trim().toLowerCase();
  return rows().filter(({ robot, latestRun, displayStatus }) => {
    if (!includeInactive && !robot.isActive) {
      return false;
    }
    if (
      state.filters.environmentId !== "ALL" &&
      robot.powerAutomateEnvironmentId !== state.filters.environmentId
    ) {
      return false;
    }
    if (state.filters.machine !== "ALL" && robot.machineName !== state.filters.machine) {
      return false;
    }
    if (state.filters.status !== "ALL" && displayStatus !== state.filters.status) {
      return false;
    }
    if (state.filters.date && localDateValue(latestRun?.startedAt) !== state.filters.date) {
      return false;
    }
    if (query) {
      const haystack = [
        robot.robotName,
        robot.accountName,
        robot.machineName,
        robot.machineIp,
        robot.anydeskId,
        robot.cloudFlowName,
        robot.desktopFlowName,
        robot.powerAutomateEnvironmentId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

function kpis(filtered) {
  return {
    total: filtered.length,
    running: filtered.filter((row) => row.latestRun?.status === "RUNNING").length,
    success: filtered.filter((row) => row.latestRun?.status === "SUCCESS").length,
    failed: filtered.filter((row) => row.latestRun?.status === "FAILED").length,
    stale: filtered.filter((row) => row.displayStatus === "STALE_RUNNING").length,
  };
}

function render() {
  // Every re-render replaces the DOM. Without this the 30 second refresh would
  // pull the caret out of the suggestion box while someone is still typing.
  const draft = document.querySelector("[data-suggestion-draft]");
  const caret = draft && document.activeElement === draft ? draft.selectionStart : null;
  renderView();
  if (caret === null) {
    return;
  }
  const restored = document.querySelector("[data-suggestion-draft]");
  if (restored) {
    restored.focus();
    restored.setSelectionRange(caret, caret);
  }
}

function renderView() {
  updateChrome();
  updateNav();

  if (state.view === "robots") {
    app.innerHTML = renderRobotsView();
    return;
  }
  if (state.view === "history") {
    app.innerHTML = renderHistoryView();
    return;
  }
  if (state.view === "machines") {
    app.innerHTML = renderMachinesView();
    return;
  }
  if (state.view === "detail") {
    ensureRobotDetailPanels();
    app.innerHTML = renderDetailView();
    return;
  }
  app.innerHTML = renderOverview();
}

function updateChrome() {
  const selectedRobot = state.data.robots.find((robot) => robot.robotId === state.selectedRobotId);
  const titles = {
    overview: ["RPA Monitoring", "Latest robot run status from PostgreSQL."],
    robots: ["Robots", "Master robot inventory with last run status."],
    machines: ["Machines", "Live machine availability and robot workload."],
    detail: [selectedRobot?.robotName || "Robot Detail", "Robot master data and latest run information."],
    history: ["Run History", "Robot execution records from PostgreSQL."],
  };
  const [title, subtitle] = titles[state.view] || titles.overview;
  pageTitle.textContent = title;
  document.title = `${title} | RPA Monitoring`;
  pageSubtitle.textContent = subtitle;
  lastUpdated.textContent = state.lastUpdated ? `Updated ${formatDateTime(state.lastUpdated)}` : "Not loaded";
  accountAvatar.textContent = userInitials();
  accountName.textContent = state.currentUser?.displayName || state.currentUser?.username || "User";
  accountRole.textContent = state.currentUser?.role || "VIEWER";
}

function updateNav() {
  const activeView = state.view === "detail" ? "robots" : state.view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === activeView);
  });
}

function renderOverview() {
  const filtered = filteredRows();
  const metric = kpis(filtered);
  return `
    <div class="dashboard-stack">
      <section class="kpi-grid" aria-label="Dashboard KPI">
        ${renderTotalRobotsKpi(metric.total)}
        ${renderKpi("Running", metric.running, "Latest run is RUNNING", "status-running")}
        ${renderKpi("Success", metric.success, "Latest run is SUCCESS", "status-success")}
        ${renderKpi("Failed", metric.failed, "Latest run is FAILED", "status-failed")}
        ${renderKpi("Stale", metric.stale, "Running beyond expected time", "status-stale_running")}
      </section>

      ${renderFilters()}

      <section class="data-panel">
          <div class="panel-heading">
            <div>
              <h2>Overview</h2>
              <p>${filtered.length} robot records</p>
            </div>
            <button class="secondary-button" type="button" data-action="refresh">${icons.refresh}<span>Refresh</span></button>
          </div>
          ${renderRobotTable(filtered)}
      </section>
    </div>
    ${state.addRobotOpen ? renderAddRobotModal() : ""}
  `;
}

function renderRobotsView() {
  const filtered = filteredRows({ includeInactive: true });
  return `
    <div class="dashboard-stack">
      ${renderFilters()}
      <section class="data-panel">
        <div class="panel-heading">
          <div>
            <h2>Robot Inventory</h2>
            <p>${filtered.length} registered robots</p>
          </div>
          <button class="secondary-button" type="button" data-action="clear-filters">${icons.filter}<span>Clear Filters</span></button>
        </div>
        ${renderRobotTable(filtered, { inventory: true })}
      </section>
    </div>
  `;
}

function filteredMachines() {
  const query = state.machineFilters.search.trim().toLowerCase();
  return state.data.machines.filter((machine) => {
    if (state.machineFilters.status !== "ALL" && machine.status !== state.machineFilters.status) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      machine.machineName,
      machine.machineIp,
      machine.anydeskId,
      ...(machine.robotNames || []),
      ...(machine.runningRobotNames || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function offlineThresholdLabel() {
  const seconds = Number(state.machineOfflineSeconds) || 180;
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

function formatHeartbeatAge(machine) {
  if (!machine.lastHeartbeatAt) {
    return "Never reported";
  }
  const seconds = Number(machine.heartbeatAgeSeconds);
  if (!Number.isFinite(seconds)) {
    return "";
  }
  if (seconds < 60) {
    return `${Math.max(seconds, 0)} sec ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }
  return `${Math.floor(hours / 24)} days ago`;
}

function machineWarning(machine) {
  const runningCount = Number(machine.runningRunCount || 0);
  if (runningCount > 0 && machine.status !== "ONLINE") {
    const suffix = runningCount === 1 ? "run is" : "runs are";
    return `${runningCount} ${suffix} still RUNNING while the machine is not reporting`;
  }
  return "";
}

function renderRunningCell(machine) {
  const runningCount = Number(machine.runningRunCount || 0);
  if (!runningCount) {
    return '<span class="muted">-</span>';
  }
  const staleCount = Number(machine.staleRunningCount || 0);
  const names = (machine.runningRobotNames || []).join(", ");
  const label = runningCount === 1 ? "1 running" : `${runningCount} running`;
  const note = staleCount
    ? `${staleCount === 1 ? "1 run has" : `${staleCount} runs have`} passed the expected duration`
    : "";
  return `
    <div class="running-cell">
      <span class="running-marker ${staleCount ? "is-stale" : ""}">
        <span class="running-dot" aria-hidden="true"></span>
        <span>${escapeHtml(label)}</span>
      </span>
      <span class="running-names" title="${escapeHtml(names)}">${escapeHtml(names)}</span>
      ${note ? `<span class="running-note">${escapeHtml(note)}</span>` : ""}
    </div>
  `;
}

function renderMachinesView() {
  const machines = filteredMachines();
  const metrics = {
    total: machines.length,
    running: machines.filter((machine) => machine.status === "RUNNING").length,
    online: machines.filter((machine) => machine.status === "ONLINE").length,
    withRuns: machines.filter((machine) => Number(machine.runningRunCount || 0) > 0).length,
    offline: machines.filter((machine) => machine.status === "OFFLINE").length,
    notConnected: machines.filter((machine) => machine.status === "NOT_CONNECTED").length,
  };
  return `
    <div class="dashboard-stack">
      <section class="kpi-grid machine-kpi-grid" aria-label="Machine KPI">
        ${renderKpi("Machines", metrics.total, "Active machine records", "status-unknown")}
        ${renderKpi("Online", metrics.online, `Heartbeat within ${offlineThresholdLabel()}`, "status-online")}
        ${renderKpi("Running", metrics.withRuns, "Machines with an active robot run", "status-running")}
        ${renderKpi("Offline", metrics.offline, `Heartbeat stopped for more than ${offlineThresholdLabel()}`, "status-offline")}
        ${renderKpi("Not Connected", metrics.notConnected, "Heartbeat agent has not reported yet", "status-not_connected")}
      </section>
      ${renderMachineFilters()}
      <section class="data-panel">
        <div class="panel-heading">
          <div>
            <h2>Machine Status</h2>
            <p>${machines.length} machine records</p>
          </div>
          <button class="secondary-button" type="button" data-action="refresh">${icons.refresh}<span>Refresh</span></button>
        </div>
        ${renderMachineTable(machines)}
      </section>
    </div>
  `;
}

function renderMachineFilters() {
  return `
    <section class="filter-band" aria-label="Machine filters">
      <div class="machine-filter-grid">
        <div class="field">
          <label for="machineSearch">Search</label>
          <input id="machineSearch" data-machine-filter="search" type="search" value="${escapeHtml(state.machineFilters.search)}" placeholder="Machine, IP, AnyDesk ID, robot" autocomplete="off" />
        </div>
        <div class="field">
          <label for="machineStatus">Status</label>
          <select id="machineStatus" data-machine-filter="status">
            <option value="ALL">All statuses</option>
            ${["ONLINE", "OFFLINE", "NOT_CONNECTED"].map((status) => `<option value="${status}" ${selected(status, state.machineFilters.status)}>${statusMeta[status].label}</option>`).join("")}
          </select>
        </div>
        <button class="ghost-button" type="button" data-action="clear-machine-filters">${icons.filter}<span>Clear</span></button>
      </div>
    </section>
  `;
}

function renderMachineTable(machines) {
  if (!machines.length) {
    return renderEmptyState("No machines found.", "Change the filters or send a machine heartbeat.");
  }
  return `
    <div class="table-wrap">
      <table class="machine-table">
        <thead>
          <tr>
            <th>Machine</th>
            <th>Status</th>
            <th>Robots</th>
            <th>Running Robot</th>
            <th>Last Heartbeat</th>
            <th>AnyDesk ID</th>
          </tr>
        </thead>
        <tbody>${machines.map(renderMachineRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderMachineRow(machine) {
  const robotNames = (machine.robotNames || []).join(", ") || "No robots assigned";
  const warning = machineWarning(machine);
  return `
    <tr>
      <td>
        <div class="robot-name">
          <strong>${escapeHtml(machine.machineName)}</strong>
          <span>${escapeHtml(machine.machineIp || "No IP address")}</span>
        </div>
      </td>
      <td>
        ${renderStatusBadge(machine.status)}
        ${warning ? `<div class="machine-warning" title="${escapeHtml(warning)}">${escapeHtml(warning)}</div>` : ""}
      </td>
      <td>
        <div class="robot-name">
          <strong>${Number(machine.robotCount || 0).toLocaleString()}</strong>
          <span title="${escapeHtml(robotNames)}">${escapeHtml(robotNames)}</span>
        </div>
      </td>
      <td>${renderRunningCell(machine)}</td>
      <td>
        <div class="robot-name">
          <strong>${formatDateTime(machine.lastHeartbeatAt)}</strong>
          <span>${escapeHtml(formatHeartbeatAge(machine))}</span>
        </div>
      </td>
      <td>${escapeHtml(machine.anydeskId || "-")}</td>
    </tr>
  `;
}

function renderHistoryView() {
  const visibleCount = state.history.runs.length;
  const countLabel = state.history.loading
    ? "Searching..."
    : `${visibleCount} of ${state.history.total} records`;
  return `
    <div class="dashboard-stack">
      ${renderHistoryFilters()}
      <section class="data-panel" aria-busy="${state.history.loading}">
        <div class="panel-heading">
          <div>
            <h2>Run History</h2>
            <p>${escapeHtml(countLabel)}</p>
          </div>
          <button class="secondary-button" type="button" data-action="refresh">${icons.refresh}<span>Refresh</span></button>
        </div>
        ${state.history.loading && !state.history.loaded
          ? '<div class="loading">Loading run history...</div>'
          : renderHistoryTable(state.history.runs)}
      </section>
    </div>
  `;
}

function renderHistoryFilters() {
  const statuses = ["RUNNING", "SUCCESS", "FAILED", "QUEUED", "CANCELLED", "TIMEOUT", "UNKNOWN"];
  return `
    <section class="filter-band" aria-label="Run history search">
      <div class="history-filter-grid">
        <div class="field history-search-field">
          <label for="historySearch">Search</label>
          <input
            id="historySearch"
            data-history-filter="search"
            type="search"
            value="${escapeHtml(state.history.search)}"
            placeholder="Robot, run ID, machine, error"
            autocomplete="off"
          />
        </div>
        <div class="field">
          <label for="historyStatus">Status</label>
          <select id="historyStatus" data-history-filter="status">
            <option value="ALL">All statuses</option>
            ${statuses
              .map((status) => `<option value="${status}" ${selected(status, state.history.status)}>${escapeHtml(statusMeta[status]?.label || status)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="historyDate">Started date</label>
          <input id="historyDate" data-history-filter="date" type="date" value="${escapeHtml(state.history.date)}" />
        </div>
        <button class="ghost-button" type="button" data-action="clear-history-filters">${icons.filter}<span>Clear</span></button>
      </div>
    </section>
  `;
}

function renderHistoryTable(historyRuns) {
  if (!historyRuns.length) {
    return renderEmptyState("No run history found.", "Change the search filters or start a robot run.");
  }

  return `
    <div class="table-wrap">
      <table class="history-table">
        <thead>
          <tr>
            <th>Robot / Run</th>
            <th>Status</th>
            <th>Started</th>
            <th>Ended</th>
            <th>Duration</th>
            <th>Machine</th>
            <th>Error</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${historyRuns.map(renderHistoryRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderHistoryRow(run) {
  // A finished run keeps the status it finished with. Turning the robot off later
  // does not rewrite what happened, so history never uses the robot current state.
  const displayStatus = run.status || "UNKNOWN";
  const errorText = [run.errorCode, run.errorMessage].filter(Boolean).join(" - ") || "-";
  return `
    <tr>
      <td>
        <div class="robot-name">
          <button class="link-button" type="button" data-action="detail" data-robot-id="${escapeHtml(run.robotId)}">${escapeHtml(run.robotName)}</button>
          <span>${escapeHtml(run.robotRunId)}</span>
        </div>
      </td>
      <td>${renderStatusBadge(displayStatus)}</td>
      <td>${formatDateTime(run.startedAt)}</td>
      <td>${formatDateTime(run.endedAt)}</td>
      <td>${formatDuration(run)}</td>
      <td>${escapeHtml(run.machineName || "-")}</td>
      <td class="truncate" title="${escapeHtml(errorText)}">${escapeHtml(errorText)}</td>
      <td>
        <button class="icon-button" type="button" data-action="detail" data-robot-id="${escapeHtml(run.robotId)}" title="Open robot detail" aria-label="Open robot detail">${icons.robot}</button>
      </td>
    </tr>
  `;
}

function renderDetailView() {
  const allRows = rows();
  const selected = allRows.find((row) => row.robot.robotId === state.selectedRobotId);
  if (!selected) {
    return renderEmptyState("Robot not found.", "Choose an available robot from Overview, Robots, or History.");
  }

  const { robot, latestRun, displayStatus } = selected;
  const runEvents = state.data.runEvents
    .filter((event) => event.robotRunId === latestRun?.robotRunId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const cloudUrl = getCloudFlowUrl(robot);
  const desktopUrl = getDesktopFlowUrl(robot);
  const cloudLaunchUrl = getPowerAutomateLaunchUrl(robot, cloudUrl);
  const desktopLaunchUrl = getPowerAutomateLaunchUrl(robot, desktopUrl);

  return `
    <div class="detail-layout">
      <section class="detail-panel">
        <div class="detail-hero">
          <button class="ghost-button" type="button" data-action="back">${icons.back}<span>Back</span></button>
          <div class="detail-title-row">
            <div>
              <h2>${escapeHtml(robot.robotName)}</h2>
              <p class="muted">${escapeHtml(robot.powerAutomateEnvironmentId || "No environment ID")} &middot; ${escapeHtml(robot.machineName)}</p>
            </div>
            <div class="detail-status-stack">
              ${renderStatusBadge(displayStatus)}
              ${renderRobotActiveToggle(robot)}
            </div>
          </div>
          <div class="detail-actions">
            ${cloudUrl ? `<a class="primary-button" href="${escapeHtml(cloudLaunchUrl)}" ${externalLinkAttributes(cloudLaunchUrl)}>${icons.external}<span>Open Cloud Flow</span></a>` : ""}
            ${desktopUrl ? `<a class="secondary-button" href="${escapeHtml(desktopLaunchUrl)}" ${externalLinkAttributes(desktopLaunchUrl)}>${icons.external}<span>Open Desktop Flow</span></a>` : ""}
            ${canAdmin() ? `<button class="secondary-button" type="button" data-action="edit-power-automate" data-robot-id="${escapeHtml(robot.robotId)}">Edit Power Automate</button>` : ""}
            ${robot.accountName ? `<span class="account-chip">${escapeHtml(robot.accountName)}</span>` : ""}
          </div>
        </div>

        <div class="fact-grid">
          ${renderFact("Environment ID", robot.powerAutomateEnvironmentId)}
          ${renderFact("Machine", robot.machineName)}
          ${renderFact("Machine IP", robot.machineIp)}
          ${renderFact("Account Name", robot.accountName)}
          ${renderFact("AnyDesk ID", robot.anydeskId)}
          ${renderFact("Robot Type", robot.robotType)}
          ${renderFact("Cloud Flow", robot.cloudFlowName || "-")}
          ${renderFact("Desktop Flow", robot.desktopFlowName || "-")}
        </div>

        <div class="run-summary">
          <h3>Latest Run</h3>
          ${renderRunCard(latestRun, robot)}
          <h3>Run Events</h3>
          ${renderEventList(runEvents)}
        </div>
      </section>
      ${renderRobotSidePanels()}
    </div>
    ${state.powerAutomateEditorRobotId ? renderPowerAutomateModal(robot) : ""}
  `;
}

const DOCUMENT_TYPE_LABELS = {
  PROCESS_DIAGRAM: "Process diagram",
  SUPPORT_GUIDE: "Support guide",
  SPECIFICATION: "Specification",
  OTHER: "Other",
};

function ensureRobotDetailPanels() {
  const robotId = state.selectedRobotId;
  if (!robotId || state.robotDetail.robotId === robotId) {
    return;
  }
  state.robotDetail = {
    ...state.robotDetail,
    robotId,
    documents: [],
    suggestions: [],
    loading: true,
    error: "",
  };
  loadRobotDetailPanels(robotId);
}

async function loadRobotDetailPanels(robotId, { silent = false } = {}) {
  const requestId = state.robotDetail.requestId + 1;
  state.robotDetail.requestId = requestId;
  if (!silent) {
    state.robotDetail.loading = true;
  }
  try {
    const [documentPayload, suggestionPayload] = await Promise.all([
      apiFetch(`/api/robots/${encodeURIComponent(robotId)}/documents`),
      apiFetch(`/api/robots/${encodeURIComponent(robotId)}/suggestions`),
    ]);
    // A slower earlier request must not overwrite a newer robot's panels.
    if (state.robotDetail.requestId !== requestId || state.selectedRobotId !== robotId) {
      return;
    }
    state.robotDetail.documents = documentPayload.documents || [];
    state.robotDetail.suggestions = suggestionPayload.suggestions || [];
    state.robotDetail.error = "";
  } catch (error) {
    if (state.robotDetail.requestId !== requestId) {
      return;
    }
    state.robotDetail.error = error.message;
  } finally {
    if (state.robotDetail.requestId === requestId) {
      state.robotDetail.loading = false;
      if (state.view === "detail") {
        render();
      }
    }
  }
}

async function uploadRobotDocument(file) {
  const robotId = state.selectedRobotId;
  if (!robotId || !file) {
    return;
  }
  state.robotDetail.uploading = true;
  render();
  try {
    // The file is sent as the raw request body. Multipart parsing would mean a
    // new dependency or a hand written parser, and base64 in JSON would inflate
    // every upload by a third for no benefit.
    const response = await fetch(`/api/robots/${encodeURIComponent(robotId)}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-Document-Type": state.robotDetail.documentType,
      },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/login?reason=session&next=${encodeURIComponent(next)}`);
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || `Upload failed: ${response.status}`);
    }
    showToast(`${file.name} uploaded.`);
    await loadRobotDetailPanels(robotId, { silent: true });
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.robotDetail.uploading = false;
    render();
  }
}

async function deleteRobotDocument(documentId, fileName) {
  if (!window.confirm(`Delete ${fileName}? This cannot be undone.`)) {
    return;
  }
  try {
    await apiFetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
    showToast("File deleted.");
    await loadRobotDetailPanels(state.selectedRobotId, { silent: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function addRobotSuggestion() {
  const title = state.robotDetail.suggestionDraft.trim();
  if (!title) {
    showToast("Write the suggestion first.", "error");
    return;
  }
  try {
    await apiFetch(`/api/robots/${encodeURIComponent(state.selectedRobotId)}/suggestions`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    state.robotDetail.suggestionDraft = "";
    showToast("Suggestion added.");
    await loadRobotDetailPanels(state.selectedRobotId, { silent: true });
    document.querySelector("[data-suggestion-draft]")?.focus();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function setSuggestionDone(suggestionId, isDone) {
  try {
    await apiFetch(`/api/suggestions/${encodeURIComponent(suggestionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ isDone }),
    });
    await loadRobotDetailPanels(state.selectedRobotId, { silent: true });
  } catch (error) {
    showToast(error.message, "error");
    render();
  }
}

async function deleteRobotSuggestion(suggestionId) {
  try {
    await apiFetch(`/api/suggestions/${encodeURIComponent(suggestionId)}`, { method: "DELETE" });
    showToast("Suggestion removed.");
    await loadRobotDetailPanels(state.selectedRobotId, { silent: true });
  } catch (error) {
    showToast(error.message, "error");
  }
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(0)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderRobotSidePanels() {
  return `
    <aside class="detail-side">
      ${renderDocumentPanel()}
      ${renderSuggestionPanel()}
    </aside>
  `;
}

function renderDocumentPanel() {
  const documents = state.robotDetail.documents;
  const countLabel = state.robotDetail.loading
    ? "Loading..."
    : `${documents.length} ${documents.length === 1 ? "file" : "files"}`;
  return `
    <section class="data-panel side-panel">
      <div class="panel-heading">
        <div>
          <h2>Documents</h2>
          <p>${escapeHtml(countLabel)}</p>
        </div>
      </div>
      ${canOperate() ? renderDocumentUpload() : ""}
      ${renderDocumentList(documents)}
    </section>
  `;
}

function renderDocumentUpload() {
  const types = ["PROCESS_DIAGRAM", "SUPPORT_GUIDE", "SPECIFICATION", "OTHER"];
  return `
    <div class="upload-row">
      <select data-document-type aria-label="Document type" ${state.robotDetail.uploading ? "disabled" : ""}>
        ${types
          .map(
            (type) =>
              `<option value="${type}" ${selected(type, state.robotDetail.documentType)}>${escapeHtml(DOCUMENT_TYPE_LABELS[type])}</option>`,
          )
          .join("")}
      </select>
      <input type="file" data-document-file hidden />
      <button class="secondary-button" type="button" data-action="pick-document" ${state.robotDetail.uploading ? "disabled" : ""}>
        ${icons.upload}<span>${state.robotDetail.uploading ? "Uploading..." : "Add file"}</span>
      </button>
    </div>
  `;
}

function renderDocumentList(documents) {
  if (state.robotDetail.loading && !documents.length) {
    return '<p class="side-empty">Loading files...</p>';
  }
  if (!documents.length) {
    return '<p class="side-empty">No files yet. Add the process diagram or the support guide.</p>';
  }
  return `<ul class="side-list">${documents.map(renderDocumentRow).join("")}</ul>`;
}

function renderDocumentRow(item) {
  const meta = [
    DOCUMENT_TYPE_LABELS[item.documentType] || item.documentType,
    formatFileSize(item.byteSize),
    item.uploadedByName || "Unknown",
    formatDateTime(item.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
  return `
    <li class="side-item">
      <span class="side-item-icon" aria-hidden="true">${icons.file}</span>
      <div class="side-item-body">
        <a class="side-item-title" href="/api/documents/${encodeURIComponent(item.documentId)}/content" download>${escapeHtml(item.fileName)}</a>
        <span class="side-item-meta">${escapeHtml(meta)}</span>
        ${item.description ? `<span class="side-item-meta">${escapeHtml(item.description)}</span>` : ""}
      </div>
      ${
        canAdmin()
          ? `<button class="icon-button" type="button" data-action="delete-document" data-document-id="${escapeHtml(item.documentId)}" data-file-name="${escapeHtml(item.fileName)}" title="Delete file" aria-label="Delete file">${icons.trash}</button>`
          : ""
      }
    </li>
  `;
}

function renderSuggestionPanel() {
  const suggestions = state.robotDetail.suggestions;
  const openCount = suggestions.filter((item) => !item.isDone).length;
  const countLabel = state.robotDetail.loading
    ? "Loading..."
    : `${openCount} open of ${suggestions.length}`;
  return `
    <section class="data-panel side-panel">
      <div class="panel-heading">
        <div>
          <h2>Suggestions</h2>
          <p>${escapeHtml(countLabel)}</p>
        </div>
      </div>
      ${
        canOperate()
          ? `
      <form class="suggestion-form" data-form="suggestion">
        <textarea data-suggestion-draft rows="2" maxlength="300" placeholder="What should be improved on this robot?">${escapeHtml(state.robotDetail.suggestionDraft)}</textarea>
        <button class="primary-button" type="submit">${icons.add}<span>Add</span></button>
      </form>`
          : ""
      }
      ${renderSuggestionList(suggestions)}
    </section>
  `;
}

function renderSuggestionList(suggestions) {
  if (state.robotDetail.loading && !suggestions.length) {
    return '<p class="side-empty">Loading suggestions...</p>';
  }
  if (!suggestions.length) {
    return '<p class="side-empty">No suggestions yet.</p>';
  }
  return `<ul class="side-list suggestion-list">${suggestions.map(renderSuggestionRow).join("")}</ul>`;
}

function renderSuggestionRow(suggestion) {
  const meta = suggestion.isDone
    ? `Done by ${suggestion.completedByName || "Unknown"} · ${formatDateTime(suggestion.completedAt)}`
    : `${suggestion.createdByName || "Unknown"} · ${formatDateTime(suggestion.createdAt)}`;
  return `
    <li class="side-item suggestion-item ${suggestion.isDone ? "is-done" : ""}">
      <input
        class="suggestion-check"
        type="checkbox"
        data-suggestion-check
        data-suggestion-id="${escapeHtml(suggestion.suggestionId)}"
        ${suggestion.isDone ? "checked" : ""}
        ${canAdmin() ? "" : "disabled"}
        aria-label="Mark as implemented"
      />
      <div class="side-item-body">
        <span class="side-item-title">${escapeHtml(suggestion.title)}</span>
        ${suggestion.details ? `<span class="side-item-meta">${escapeHtml(suggestion.details)}</span>` : ""}
        <span class="side-item-meta">${escapeHtml(meta)}</span>
      </div>
      ${
        canAdmin()
          ? `<button class="icon-button" type="button" data-action="delete-suggestion" data-suggestion-id="${escapeHtml(suggestion.suggestionId)}" title="Remove suggestion" aria-label="Remove suggestion">${icons.trash}</button>`
          : ""
      }
    </li>
  `;
}

function renderKpi(label, value, note, statusClass) {
  return `
    <article class="kpi-card">
      <div class="kpi-label">
        <span>${escapeHtml(label)}</span>
        <span class="status-badge ${statusClass}">${escapeHtml(label.split(" ")[0])}</span>
      </div>
      <div class="kpi-value">${Number(value).toLocaleString()}</div>
      <div class="kpi-note">${escapeHtml(note)}</div>
    </article>
  `;
}

function renderTotalRobotsKpi(value) {
  const action = canAdmin()
    ? `<button class="primary-button kpi-add-button" type="button" data-action="add-robot-open">
        ${icons.add}<span>Add Robot</span>
      </button>`
    : '<span class="status-badge status-unknown">Total</span>';
  return `
    <article class="kpi-card">
      <div class="kpi-label">
        <span>Total Robots</span>
        ${action}
      </div>
      <div class="kpi-value">${Number(value).toLocaleString()}</div>
      <div class="kpi-note">Active robots in current filter</div>
    </article>
  `;
}

function renderAddRobotModal() {
  const draft = state.addRobotDraft;
  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="addRobotTitle">
        <div class="modal-heading">
          <div>
            <h2 id="addRobotTitle">Add Robot</h2>
            <p>Register a robot in the monitoring inventory.</p>
          </div>
          <button class="icon-button" type="button" data-action="add-robot-close" title="Close" aria-label="Close add robot form">${icons.x}</button>
        </div>

        <form data-form="add-robot">
          <div class="modal-body robot-form-grid">
            <div class="field field-full">
              <label for="newRobotName">Robot Name</label>
              <input id="newRobotName" name="robotName" value="${escapeHtml(draft.robotName)}" required maxlength="255" autocomplete="off" placeholder="ITZONE Receipt Bot" />
            </div>
            <div class="field field-full">
              <label for="newRobotEnvironment">Power Automate Environment ID</label>
              <input id="newRobotEnvironment" name="powerAutomateEnvironmentId" value="${escapeHtml(draft.powerAutomateEnvironmentId)}" required maxlength="200" autocomplete="off" placeholder="Default-xxxxxxxx" />
            </div>
            <div class="field field-full">
              <label for="newRobotAnyDeskId">AnyDesk ID</label>
              <input id="newRobotAnyDeskId" name="anydeskId" value="${escapeHtml(draft.anydeskId)}" maxlength="100" autocomplete="off" placeholder="123 456 789" />
            </div>
            <div class="field">
              <label for="newRobotMachine">Machine Name</label>
              <input id="newRobotMachine" name="machineName" value="${escapeHtml(draft.machineName)}" required maxlength="150" autocomplete="off" placeholder="BOT-PC-02" />
            </div>
            <div class="field">
              <label for="newRobotMachineIp">Machine IP</label>
              <input id="newRobotMachineIp" name="machineIp" value="${escapeHtml(draft.machineIp)}" maxlength="100" autocomplete="off" placeholder="10.0.0.22" />
            </div>
            <div class="field">
              <label for="newRobotType">Robot Type</label>
              <select id="newRobotType" name="robotType">
                <option value="CLOUD_DESKTOP" ${selected("CLOUD_DESKTOP", draft.robotType)}>Cloud + Desktop</option>
                <option value="CLOUD_ONLY" ${selected("CLOUD_ONLY", draft.robotType)}>Cloud only</option>
                <option value="DESKTOP_ONLY" ${selected("DESKTOP_ONLY", draft.robotType)}>Desktop only</option>
              </select>
            </div>
            <div class="field">
              <label for="newRobotAccount">Account Name</label>
              <input id="newRobotAccount" name="accountName" value="${escapeHtml(draft.accountName)}" maxlength="150" autocomplete="off" placeholder="Robot Account 02" />
            </div>
            <div class="field">
              <label for="newRobotCloudFlowId">Cloud Flow ID</label>
              <input id="newRobotCloudFlowId" name="cloudFlowId" value="${escapeHtml(draft.cloudFlowId)}" maxlength="200" autocomplete="off" placeholder="xxxxxxxx" />
            </div>
            <div class="field">
              <label for="newRobotCloudFlow">Cloud Flow Name</label>
              <input id="newRobotCloudFlow" name="cloudFlowName" value="${escapeHtml(draft.cloudFlowName)}" maxlength="255" autocomplete="off" placeholder="ITZONE Receipt Main Flow" />
            </div>
            <div class="field field-full">
              <label for="newRobotCloudFlowUrl">Cloud Flow URL</label>
              <input id="newRobotCloudFlowUrl" name="cloudFlowUrl" type="url" value="${escapeHtml(draft.cloudFlowUrl)}" maxlength="2000" autocomplete="off" placeholder="https://make.powerautomate.com/..." />
            </div>
            <div class="field">
              <label for="newRobotDesktopFlowId">Desktop Flow ID</label>
              <input id="newRobotDesktopFlowId" name="desktopFlowId" value="${escapeHtml(draft.desktopFlowId)}" maxlength="200" autocomplete="off" placeholder="xxxxxxxx" />
            </div>
            <div class="field">
              <label for="newRobotDesktopFlow">Desktop Flow Name</label>
              <input id="newRobotDesktopFlow" name="desktopFlowName" value="${escapeHtml(draft.desktopFlowName)}" maxlength="255" autocomplete="off" placeholder="ITZONE Receipt PAD" />
            </div>
            <div class="field field-full">
              <label for="newRobotDesktopFlowUrl">Desktop Flow URL</label>
              <input id="newRobotDesktopFlowUrl" name="desktopFlowUrl" type="url" value="${escapeHtml(draft.desktopFlowUrl)}" maxlength="2000" autocomplete="off" placeholder="https://make.powerautomate.com/..." />
            </div>
          </div>
          <div class="modal-actions">
            <button class="ghost-button" type="button" data-action="add-robot-clear">Clear fields</button>
            <button class="secondary-button" type="button" data-action="add-robot-close">Cancel</button>
            <button class="primary-button" type="submit">${icons.add}<span>Add Robot</span></button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderFilters() {
  const environments = [
    ...new Set(
      state.data.robots
        .map((robot) => robot.powerAutomateEnvironmentId)
        .filter(Boolean),
    ),
  ].sort();
  const machines = [...new Set(state.data.robots.map((robot) => robot.machineName).filter(Boolean))].sort();
  const statuses = ["RUNNING", "SUCCESS", "FAILED", "QUEUED", "CANCELLED", "TIMEOUT", "UNKNOWN", "STALE_RUNNING", "DISABLED"];

  return `
    <section class="filter-band" aria-label="Filters">
      <div class="filter-grid">
        <div class="field">
          <label for="filterEnvironment">Environment</label>
          <select id="filterEnvironment" data-filter="environmentId">
            <option value="ALL">All</option>
            ${environments
              .map((environmentId) => `<option value="${escapeHtml(environmentId)}" ${selected(environmentId, state.filters.environmentId)}>${escapeHtml(environmentId)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field">
          <label for="filterRobot">Robot</label>
          <input id="filterRobot" data-filter="robot" type="search" value="${escapeHtml(state.filters.robot)}" placeholder="Search robots" />
        </div>
        <div class="field">
          <label for="filterMachine">Machine</label>
          <select id="filterMachine" data-filter="machine">
            <option value="ALL">All</option>
            ${machines.map((machine) => `<option value="${escapeHtml(machine)}" ${selected(machine, state.filters.machine)}>${escapeHtml(machine)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="filterStatus">Status</label>
          <select id="filterStatus" data-filter="status">
            <option value="ALL">All</option>
            ${statuses.map((status) => `<option value="${status}" ${selected(status, state.filters.status)}>${escapeHtml(statusMeta[status]?.label || status)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="filterDate">Date</label>
          <input id="filterDate" data-filter="date" type="date" value="${escapeHtml(state.filters.date)}" />
        </div>
        <button class="ghost-button" type="button" data-action="clear-filters">${icons.filter}<span>Clear</span></button>
      </div>
    </section>
  `;
}

function renderRobotTable(tableRows, options = {}) {
  if (tableRows.length === 0) {
    return renderEmptyState("No robots match the current filters.", "Clear the filters or add a robot.");
  }

  const heading = options.inventory
    ? "<th>Robot</th><th>Env</th><th>Type</th><th>Machine</th><th>Status</th><th>Last Run</th><th></th>"
    : "<th>Robot</th><th>Environment</th><th>Machine</th><th>Status</th><th>Last Run</th><th>Duration</th><th>Error</th><th></th>";

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${heading}</tr>
        </thead>
        <tbody>
          ${tableRows.map((row) => (options.inventory ? renderInventoryRow(row) : renderOverviewRow(row))).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOverviewRow({ robot, latestRun, displayStatus }) {
  const cloudUrl = getCloudFlowUrl(robot);
  const cloudLaunchUrl = getPowerAutomateLaunchUrl(robot, cloudUrl);
  return `
    <tr>
      <td>
        <div class="robot-name">
          <button class="link-button" type="button" data-action="detail" data-robot-id="${escapeHtml(robot.robotId)}">${escapeHtml(robot.robotName)}</button>
          <span>${escapeHtml(robot.accountName || "No account name")}</span>
        </div>
      </td>
      <td>${escapeHtml(robot.powerAutomateEnvironmentId || "-")}</td>
      <td>${escapeHtml(robot.machineName)}</td>
      <td>${renderStatusBadge(displayStatus)}</td>
      <td>${formatDateTime(latestRun?.startedAt)}</td>
      <td>${formatDuration(latestRun)}</td>
      <td class="truncate" title="${escapeHtml(latestRun?.errorMessage || "")}">${escapeHtml(latestRun?.errorMessage || "-")}</td>
      <td>
        <div class="table-actions">
          <button class="icon-button" type="button" data-action="detail" data-robot-id="${escapeHtml(robot.robotId)}" title="Open robot detail" aria-label="Open robot detail">${icons.robot}</button>
          ${cloudUrl ? `<a class="icon-button" href="${escapeHtml(cloudLaunchUrl)}" ${externalLinkAttributes(cloudLaunchUrl)} title="Open Cloud Flow" aria-label="Open Cloud Flow">${icons.external}</a>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function renderInventoryRow({ robot, latestRun, displayStatus }) {
  return `
    <tr>
      <td>
        <div class="robot-name">
          <button class="link-button" type="button" data-action="detail" data-robot-id="${escapeHtml(robot.robotId)}">${escapeHtml(robot.robotName)}</button>
          <span>${escapeHtml(robot.accountName || robot.robotType)}</span>
        </div>
      </td>
      <td>${escapeHtml(robot.powerAutomateEnvironmentId || "-")}</td>
      <td>${escapeHtml(robot.robotType)}</td>
      <td>${escapeHtml(robot.machineName)}</td>
      <td>${renderStatusBadge(displayStatus)}</td>
      <td>${formatDateTime(latestRun?.startedAt)}</td>
      <td>
        <div class="table-actions">
          <button class="icon-button" type="button" data-action="detail" data-robot-id="${escapeHtml(robot.robotId)}" title="Open robot detail" aria-label="Open robot detail">${icons.robot}</button>
        </div>
      </td>
    </tr>
  `;
}

function renderStatusBadge(status) {
  const meta = statusMeta[status] || statusMeta.UNKNOWN;
  return `<span class="status-badge ${meta.className}">${escapeHtml(meta.label)}</span>`;
}

function safePowerAutomateUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "make.powerautomate.com"
      ? url.href
      : "";
  } catch (error) {
    return "";
  }
}

function getCloudFlowUrl(robot) {
  const explicitUrl = safePowerAutomateUrl(robot.cloudFlowUrl);
  if (explicitUrl) return explicitUrl;
  if (robot.powerAutomateEnvironmentId && robot.cloudFlowId) {
    return `https://make.powerautomate.com/manage/environments/${encodeURIComponent(robot.powerAutomateEnvironmentId)}/flows/${encodeURIComponent(robot.cloudFlowId)}/details`;
  }
  const legacyUrl = safePowerAutomateUrl(robot.powerAutomateUrl);
  return legacyUrl.includes("/flows/") && !legacyUrl.includes("/uiflows/") ? legacyUrl : "";
}

function getDesktopFlowUrl(robot) {
  const explicitUrl = safePowerAutomateUrl(robot.desktopFlowUrl);
  if (explicitUrl) return explicitUrl;
  if (robot.powerAutomateEnvironmentId && robot.desktopFlowId) {
    return `https://make.powerautomate.com/manage/environments/${encodeURIComponent(robot.powerAutomateEnvironmentId)}/uiflows/${encodeURIComponent(robot.desktopFlowId)}/details`;
  }
  const legacyUrl = safePowerAutomateUrl(robot.powerAutomateUrl);
  return legacyUrl.includes("/uiflows/") ? legacyUrl : "";
}

function getPowerAutomateLaunchUrl(robot, targetUrl) {
  const profileName = String(robot.accountName || "").trim();
  if (!profileName || !targetUrl) return targetUrl;
  return `rpa-power-automate://open?profile=${encodeURIComponent(profileName)}&url=${encodeURIComponent(targetUrl)}`;
}

function externalLinkAttributes(url) {
  return String(url || "").startsWith("rpa-power-automate:")
    ? ""
    : 'target="_blank" rel="noreferrer"';
}

function renderRobotActiveToggle(robot) {
  if (!canAdmin()) return "";
  const label = robot.isActive ? "On" : "Off";
  return `
    <label class="robot-active-toggle">
      <input type="checkbox" data-robot-active data-robot-id="${escapeHtml(robot.robotId)}" ${robot.isActive ? "checked" : ""} aria-label="Turn robot on or off" />
      <span class="toggle-track" aria-hidden="true"><span></span></span>
      <span class="toggle-label">${label}</span>
    </label>
  `;
}

function renderPowerAutomateModal(robot) {
  return `
    <div class="modal-backdrop" data-power-automate-backdrop>
      <section class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="powerAutomateTitle">
        <div class="modal-heading">
          <div>
            <h2 id="powerAutomateTitle">Power Automate</h2>
            <p>${escapeHtml(robot.robotName)}</p>
          </div>
          <button class="icon-button" type="button" data-action="edit-power-automate-close" title="Close" aria-label="Close Power Automate settings">${icons.x}</button>
        </div>
        <form data-form="power-automate" data-robot-id="${escapeHtml(robot.robotId)}">
          <div class="modal-body robot-form-grid">
            <div class="field field-full">
              <label for="editRobotEnvironment">Environment ID</label>
              <input id="editRobotEnvironment" name="powerAutomateEnvironmentId" value="${escapeHtml(robot.powerAutomateEnvironmentId || "")}" maxlength="200" autocomplete="off" />
            </div>
            <div class="field field-full">
              <label for="editRobotAccount">Account Name</label>
              <input id="editRobotAccount" name="accountName" value="${escapeHtml(robot.accountName || "")}" maxlength="150" autocomplete="off" />
            </div>
            <div class="field">
              <label for="editRobotCloudFlowId">Cloud Flow ID</label>
              <input id="editRobotCloudFlowId" name="cloudFlowId" value="${escapeHtml(robot.cloudFlowId || "")}" maxlength="200" autocomplete="off" />
            </div>
            <div class="field">
              <label for="editRobotCloudFlowName">Cloud Flow Name</label>
              <input id="editRobotCloudFlowName" name="cloudFlowName" value="${escapeHtml(robot.cloudFlowName || "")}" maxlength="255" autocomplete="off" />
            </div>
            <div class="field field-full">
              <label for="editRobotCloudFlowUrl">Cloud Flow URL</label>
              <input id="editRobotCloudFlowUrl" name="cloudFlowUrl" type="url" value="${escapeHtml(robot.cloudFlowUrl || getCloudFlowUrl(robot))}" maxlength="2000" autocomplete="off" placeholder="https://make.powerautomate.com/..." />
            </div>
            <div class="field">
              <label for="editRobotDesktopFlowId">Desktop Flow ID</label>
              <input id="editRobotDesktopFlowId" name="desktopFlowId" value="${escapeHtml(robot.desktopFlowId || "")}" maxlength="200" autocomplete="off" />
            </div>
            <div class="field">
              <label for="editRobotDesktopFlowName">Desktop Flow Name</label>
              <input id="editRobotDesktopFlowName" name="desktopFlowName" value="${escapeHtml(robot.desktopFlowName || "")}" maxlength="255" autocomplete="off" />
            </div>
            <div class="field field-full">
              <label for="editRobotDesktopFlowUrl">Desktop Flow URL</label>
              <input id="editRobotDesktopFlowUrl" name="desktopFlowUrl" type="url" value="${escapeHtml(robot.desktopFlowUrl || getDesktopFlowUrl(robot))}" maxlength="2000" autocomplete="off" placeholder="https://make.powerautomate.com/..." />
            </div>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" data-action="edit-power-automate-close">Cancel</button>
            <button class="primary-button" type="submit"><span>Save</span></button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderFact(label, value) {
  return `
    <div class="fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function renderRunCard(run, robot) {
  if (!run) {
    return renderEmptyState("No run record.", "Start a run to create RPA_RobotRun data.");
  }
  const displayStatus = getDisplayStatus(robot, run);
  return `
    <div class="run-card">
      <div class="detail-title-row">
        <strong>${escapeHtml(run.robotRunId)}</strong>
        ${renderStatusBadge(displayStatus)}
      </div>
      <div class="fact-grid">
        ${renderFact("StartedAt", formatDateTime(run.startedAt))}
        ${renderFact("EndedAt", formatDateTime(run.endedAt))}
        ${renderFact("Duration", formatDuration(run))}
        ${renderFact("MachineName", run.machineName)}
        ${renderFact("CloudFlowRunId", run.cloudFlowRunId || "-")}
        ${renderFact("DesktopFlowSessionId", run.desktopFlowSessionId || "-")}
        ${renderFact("ErrorCode", run.errorCode || "-")}
        ${renderFact("ErrorStep", run.errorStep || "-")}
      </div>
      ${run.errorMessage ? `<div class="fact"><span>ErrorMessage</span><strong>${escapeHtml(run.errorMessage)}</strong></div>` : ""}
    </div>
  `;
}

function renderEventList(events) {
  if (!events.length) {
    return renderEmptyState("No events for latest run.", "RPA_RunEvent records will appear here.");
  }
  return `
    <div class="event-list">
      ${events
        .map((event) => {
          const className = event.eventType === "ERROR" ? "event-error" : event.eventType === "WARNING" ? "event-warning" : "";
          return `
            <div class="event-item ${className}">
              <strong>${escapeHtml(event.stepName || event.eventType)}</strong>
              <span>${escapeHtml(formatDateTime(event.createdAt))} &middot; ${escapeHtml(event.eventType)}</span>
              <div>${escapeHtml(event.message)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEmptyState(title, description) {
  return `
    <div class="empty-state">
      ${icons.robot}
      <h3>${escapeHtml(title)}</h3>
      <p class="muted">${escapeHtml(description)}</p>
    </div>
  `;
}

function selected(value, current) {
  return value === current ? "selected" : "";
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function localDateValue(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const timezoneOffset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function formatDuration(run) {
  if (!run) {
    return "-";
  }
  let seconds = run.durationSeconds;
  if (seconds === null || seconds === undefined) {
    if (run.startedAt && ["RUNNING", "QUEUED", "UNKNOWN"].includes(run.status)) {
      seconds = Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000));
    }
  }
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) {
    return "-";
  }
  const numericSeconds = Number(seconds);
  const hours = Math.floor(numericSeconds / 3600);
  const minutes = Math.floor((numericSeconds % 3600) / 60);
  const remainSeconds = numericSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(remainSeconds).padStart(2, "0")}s`;
  }
  return `${remainSeconds}s`;
}

function clearFilters() {
  state.filters = {
    environmentId: "ALL",
    status: "ALL",
    machine: "ALL",
    robot: "",
    date: "",
  };
  render();
}

async function clearHistoryFilters() {
  window.clearTimeout(state.history.debounceTimer);
  state.history.search = "";
  state.history.status = "ALL";
  state.history.date = "";
  await loadHistory();
}

function setAddRobotModal(isOpen) {
  if (isOpen && !canAdmin()) {
    showToast("Only administrators can add robots.", "error");
    return;
  }
  state.addRobotOpen = isOpen;
  document.body.classList.toggle("modal-open", isOpen);
  render();
  if (isOpen) {
    window.requestAnimationFrame(() => document.querySelector("#newRobotName")?.focus());
  }
}

function setPowerAutomateEditor(robotId = "") {
  if (robotId && !canAdmin()) {
    showToast("Only administrators can edit Power Automate settings.", "error");
    return;
  }
  state.powerAutomateEditorRobotId = robotId;
  document.body.classList.toggle("modal-open", Boolean(robotId) || state.addRobotOpen);
  render();
  if (robotId) {
    window.requestAnimationFrame(() => document.querySelector("#editRobotEnvironment")?.focus());
  }
}

async function handleRobotActiveToggle(input) {
  const robot = state.data.robots.find((item) => item.robotId === input.dataset.robotId);
  if (!robot || !canAdmin()) {
    input.checked = Boolean(robot?.isActive);
    showToast("Only administrators can change robot availability.", "error");
    return;
  }

  const isActive = input.checked;
  if (!isActive && !window.confirm(`Turn off ${robot.robotName}? New START requests will be blocked.`)) {
    input.checked = true;
    return;
  }

  input.disabled = true;
  try {
    await apiFetch(`/api/robots/${encodeURIComponent(robot.robotId)}/active`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    });
    await loadData({ silent: true });
    showToast(`${robot.robotName} turned ${isActive ? "on" : "off"}.`);
  } catch (error) {
    input.checked = robot.isActive;
    input.disabled = false;
    showToast(error.message, "error");
  }
}

async function handlePowerAutomateSubmit(form) {
  const robotId = form.dataset.robotId;
  const robot = state.data.robots.find((item) => item.robotId === robotId);
  const formData = new FormData(form);
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Saving...";

  try {
    await apiFetch(`/api/robots/${encodeURIComponent(robotId)}/power-automate`, {
      method: "PATCH",
      body: JSON.stringify({
        powerAutomateEnvironmentId: String(formData.get("powerAutomateEnvironmentId") || "").trim(),
        accountName: String(formData.get("accountName") || "").trim(),
        cloudFlowId: String(formData.get("cloudFlowId") || "").trim(),
        cloudFlowName: String(formData.get("cloudFlowName") || "").trim(),
        cloudFlowUrl: String(formData.get("cloudFlowUrl") || "").trim(),
        desktopFlowId: String(formData.get("desktopFlowId") || "").trim(),
        desktopFlowName: String(formData.get("desktopFlowName") || "").trim(),
        desktopFlowUrl: String(formData.get("desktopFlowUrl") || "").trim(),
      }),
    });
    state.powerAutomateEditorRobotId = "";
    document.body.classList.remove("modal-open");
    await loadData({ silent: true });
    showToast(`${robot?.robotName || "Robot"} Power Automate settings saved.`);
  } catch (error) {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Save";
    showToast(error.message, "error");
  }
}

async function handleAddRobotSubmit(form) {
  const formData = new FormData(form);
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Adding...";

  try {
    const payload = await apiFetch("/api/robots", {
      method: "POST",
      body: JSON.stringify({
        robotName: String(formData.get("robotName") || "").trim(),
        powerAutomateEnvironmentId: String(
          formData.get("powerAutomateEnvironmentId") || "",
        ).trim(),
        machineName: String(formData.get("machineName") || "").trim(),
        machineIp: String(formData.get("machineIp") || "").trim(),
        robotType: String(formData.get("robotType") || "CLOUD_DESKTOP"),
        accountName: String(formData.get("accountName") || "").trim(),
        anydeskId: String(formData.get("anydeskId") || "").trim(),
        cloudFlowId: String(formData.get("cloudFlowId") || "").trim(),
        cloudFlowName: String(formData.get("cloudFlowName") || "").trim(),
        cloudFlowUrl: String(formData.get("cloudFlowUrl") || "").trim(),
        desktopFlowId: String(formData.get("desktopFlowId") || "").trim(),
        desktopFlowName: String(formData.get("desktopFlowName") || "").trim(),
        desktopFlowUrl: String(formData.get("desktopFlowUrl") || "").trim(),
        isActive: true,
      }),
    });

    state.addRobotOpen = false;
    resetAddRobotDraft();
    document.body.classList.remove("modal-open");
    state.selectedRobotId = payload.robot.robotId;
    state.filters = {
      environmentId: "ALL",
      status: "ALL",
      machine: "ALL",
      robot: "",
      date: "",
    };
    await loadData({ silent: true });
    showToast(`${payload.robot.robotName} added.`);
  } catch (error) {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Add Robot";
    showToast(error.message, "error");
  }
}

document.addEventListener("click", async (event) => {
  if (event.target.matches("[data-modal-backdrop]")) {
    setAddRobotModal(false);
    return;
  }
  if (event.target.matches("[data-power-automate-backdrop]")) {
    setPowerAutomateEditor();
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    const action = actionTarget.dataset.action;
    const robotId = actionTarget.dataset.robotId || "";

    if (action === "logout") {
      try {
        await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
      } finally {
        window.location.replace("/login");
      }
      return;
    }

    if (action === "refresh") {
      if (state.view === "history") {
        await loadHistory({ silent: true });
        showToast("History refreshed.");
      } else {
        await loadData({ silent: true });
        showToast("Dashboard refreshed.");
      }
      return;
    }

    if (action === "clear-filters") {
      clearFilters();
      return;
    }

    if (action === "clear-history-filters") {
      await clearHistoryFilters();
      return;
    }

    if (action === "clear-machine-filters") {
      state.machineFilters = { search: "", status: "ALL" };
      render();
      return;
    }

    if (action === "add-robot-open") {
      setAddRobotModal(true);
      return;
    }

    if (action === "add-robot-close") {
      setAddRobotModal(false);
      return;
    }

    if (action === "add-robot-clear") {
      resetAddRobotDraft();
      render();
      window.requestAnimationFrame(() => document.querySelector("#newRobotName")?.focus());
      return;
    }

    if (action === "edit-power-automate") {
      setPowerAutomateEditor(robotId);
      return;
    }

    if (action === "edit-power-automate-close") {
      setPowerAutomateEditor();
      return;
    }

    if (action === "detail") {
      const robot = state.data.robots.find((item) => item.robotId === robotId);
      if (!robot) {
        showToast("Robot not found.", "error");
        return;
      }
      state.detailReturnView = ["history", "robots"].includes(state.view)
        ? state.view
        : "overview";
      navigateToRobot(robot);
      return;
    }

    if (action === "back") {
      if (window.history.state?.detailReturnView) {
        window.history.back();
        return;
      }
      const returnView = state.detailReturnView || "overview";
      navigateToView(returnView, { replace: true });
      if (returnView === "history" && !state.history.loaded) {
        await loadHistory();
      }
      return;
    }

    if (action === "pick-document") {
      document.querySelector("[data-document-file]")?.click();
      return;
    }

    if (action === "delete-document") {
      await deleteRobotDocument(actionTarget.dataset.documentId, actionTarget.dataset.fileName);
      return;
    }

    if (action === "delete-suggestion") {
      await deleteRobotSuggestion(actionTarget.dataset.suggestionId);
      return;
    }
  }

  const viewTarget = event.target.closest("[data-view]");
  if (viewTarget) {
    const view = viewTarget.dataset.view;
    navigateToView(view);
    if (view === "history" && !state.history.loaded) {
      await loadHistory();
    }
  }
});

document.addEventListener("submit", async (event) => {
  const suggestionForm = event.target.closest('[data-form="suggestion"]');
  if (suggestionForm) {
    event.preventDefault();
    await addRobotSuggestion();
    return;
  }

  const addRobotForm = event.target.closest('[data-form="add-robot"]');
  if (addRobotForm) {
    event.preventDefault();
    await handleAddRobotSubmit(addRobotForm);
    return;
  }

  const powerAutomateForm = event.target.closest('[data-form="power-automate"]');
  if (powerAutomateForm) {
    event.preventDefault();
    await handlePowerAutomateSubmit(powerAutomateForm);
  }
});

document.addEventListener("change", async (event) => {
  const documentFile = event.target.closest("[data-document-file]");
  if (documentFile) {
    const file = documentFile.files && documentFile.files[0];
    documentFile.value = "";
    if (file) {
      await uploadRobotDocument(file);
    }
    return;
  }

  const documentType = event.target.closest("[data-document-type]");
  if (documentType) {
    state.robotDetail.documentType = documentType.value;
    return;
  }

  const suggestionCheck = event.target.closest("[data-suggestion-check]");
  if (suggestionCheck) {
    await setSuggestionDone(suggestionCheck.dataset.suggestionId, suggestionCheck.checked);
    return;
  }

  const robotActive = event.target.closest("[data-robot-active]");
  if (robotActive) {
    await handleRobotActiveToggle(robotActive);
    return;
  }

  const addRobotForm = event.target.closest('[data-form="add-robot"]');
  if (addRobotForm && event.target.name) {
    updateAddRobotDraft(event.target.name, event.target.value);
    return;
  }

  const historyFilter = event.target.closest("[data-history-filter]");
  if (historyFilter) {
    state.history[historyFilter.dataset.historyFilter] = historyFilter.value;
    if (historyFilter.dataset.historyFilter !== "search") {
      loadHistory();
    }
    return;
  }

  const machineFilter = event.target.closest("[data-machine-filter]");
  if (machineFilter) {
    state.machineFilters[machineFilter.dataset.machineFilter] = machineFilter.value;
    render();
    return;
  }

  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.filters[filter.dataset.filter] = filter.value;
    render();
    return;
  }

});

document.addEventListener("input", (event) => {
  const addRobotForm = event.target.closest('[data-form="add-robot"]');
  if (addRobotForm && event.target.name) {
    updateAddRobotDraft(event.target.name, event.target.value);
    return;
  }

  const suggestionDraft = event.target.closest("[data-suggestion-draft]");
  if (suggestionDraft) {
    state.robotDetail.suggestionDraft = suggestionDraft.value;
    return;
  }

  const historyFilter = event.target.closest('[data-history-filter="search"]');
  if (historyFilter) {
    state.history.search = historyFilter.value;
    window.clearTimeout(state.history.debounceTimer);
    state.history.debounceTimer = window.setTimeout(() => {
      loadHistory({ silent: true });
    }, 400);
    return;
  }

  const machineFilter = event.target.closest('[data-machine-filter="search"]');
  if (machineFilter) {
    state.machineFilters.search = machineFilter.value;
    render();
    document.querySelector('[data-machine-filter="search"]')?.focus();
    return;
  }

  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.filters[filter.dataset.filter] = filter.value;
    render();
    return;
  }

});

window.addEventListener("keydown", async (event) => {
  if (event.key === "Escape" && state.addRobotOpen) {
    setAddRobotModal(false);
    return;
  }
  if (event.key === "Escape" && state.powerAutomateEditorRobotId) {
    setPowerAutomateEditor();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    if (state.view === "history") {
      await loadHistory({ silent: true });
      showToast("History refreshed.");
    } else {
      await loadData({ silent: true });
      showToast("Dashboard refreshed.");
    }
  }
});

window.addEventListener("popstate", async () => {
  const route = routeFromLocation();
  state.view = route.view;
  state.routeRobotCode = route.robotCode;
  if (route.view === "detail" && window.history.state?.detailReturnView) {
    state.detailReturnView = window.history.state.detailReturnView;
  }
  syncRobotSelectionFromRoute();
  render();
  if (state.view === "history" && !state.history.loaded) {
    await loadHistory();
  }
});

async function initialize() {
  try {
    await loadCurrentUser();
    await loadData();
    if (state.view === "history" && !state.history.loaded) {
      await loadHistory();
    }
    state.refreshTimer = window.setInterval(() => {
      if (state.view === "history") {
        loadHistory({ silent: true });
      } else {
        loadData({ silent: true });
        if (state.view === "detail" && state.selectedRobotId) {
          loadRobotDetailPanels(state.selectedRobotId, { silent: true });
        }
      }
    }, 30000);
  } catch (error) {
    setApiState(false);
    app.innerHTML = renderEmptyState("Dashboard API is not available.", error.message);
  }
}

initialize();
