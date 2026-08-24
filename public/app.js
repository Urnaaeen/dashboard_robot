const state = {
  data: {
    robots: [],
    robotRuns: [],
    runEvents: [],
  },
  filters: {
    environmentId: "ALL",
    status: "ALL",
    machine: "ALL",
    robot: "",
    date: "",
  },
  logger: {
    robotId: "",
    errorCode: "ERR_FILE_LOCKED",
    errorStep: "Open Excel",
    errorMessage: "Excel file is locked.",
  },
  addRobotOpen: false,
  view: "overview",
  selectedRobotId: "",
  lastUpdated: null,
  refreshTimer: null,
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
  x: '<svg viewBox="0 0 24 24" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

const app = document.querySelector("#app");
const apiDot = document.querySelector("#apiDot");
const apiStatus = document.querySelector("#apiStatus");
const lastUpdated = document.querySelector("#lastUpdated");
const pageTitle = document.querySelector("#pageTitle");
const pageSubtitle = document.querySelector("#pageSubtitle");
const toast = document.querySelector("#toast");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    if (!response.ok) {
      throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
  });
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
    };
    state.lastUpdated = new Date(payload.generatedAt || Date.now());
    if (!state.selectedRobotId && state.data.robots.length > 0) {
      state.selectedRobotId = state.data.robots[0].robotId;
    }
    if (!state.logger.robotId && state.data.robots.length > 0) {
      state.logger.robotId = state.selectedRobotId;
    }
    setApiState(true);
    render();
  } catch (error) {
    setApiState(false);
    app.innerHTML = renderEmptyState("Dashboard API is not available.", error.message);
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

function filteredRows() {
  const query = state.filters.robot.trim().toLowerCase();
  return rows().filter(({ robot, latestRun, displayStatus }) => {
    if (!robot.isActive) {
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
    if (state.filters.status !== "ALL") {
      if (state.filters.status === "STALE_RUNNING") {
        if (displayStatus !== "STALE_RUNNING") {
          return false;
        }
      } else if ((latestRun?.status || "UNKNOWN") !== state.filters.status) {
        return false;
      }
    }
    if (state.filters.date && localDateValue(latestRun?.startedAt) !== state.filters.date) {
      return false;
    }
    if (query) {
      const haystack = [
        robot.robotName,
        robot.robotCode,
        robot.accountLabel,
        robot.machineName,
        robot.machineIp,
        robot.anydeskId,
        robot.anydeskAlias,
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
  updateChrome();
  updateNav();

  if (state.view === "robots") {
    app.innerHTML = renderRobotsView();
    return;
  }
  if (state.view === "detail") {
    app.innerHTML = renderDetailView();
    return;
  }
  app.innerHTML = renderOverview();
}

function updateChrome() {
  const titles = {
    overview: ["RPA Monitoring", "Latest robot run status from PostgreSQL."],
    robots: ["Robots", "Master robot inventory with last run status."],
    detail: ["Robot Detail", "Robot master data and latest run information."],
  };
  const [title, subtitle] = titles[state.view] || titles.overview;
  pageTitle.textContent = title;
  pageSubtitle.textContent = subtitle;
  lastUpdated.textContent = state.lastUpdated ? `Updated ${formatDateTime(state.lastUpdated)}` : "Not loaded";
}

function updateNav() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
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
  const filtered = filteredRows();
  return `
    <div class="dashboard-stack">
      ${renderFilters()}
      <section class="data-panel">
        <div class="panel-heading">
          <div>
            <h2>Robot Inventory</h2>
            <p>${filtered.length} active robots</p>
          </div>
          <button class="secondary-button" type="button" data-action="clear-filters">${icons.filter}<span>Clear Filters</span></button>
        </div>
        ${renderRobotTable(filtered, { inventory: true })}
      </section>
    </div>
  `;
}

function renderDetailView() {
  const allRows = rows();
  let selected = allRows.find((row) => row.robot.robotId === state.selectedRobotId);
  if (!selected && allRows.length > 0) {
    selected = allRows[0];
    state.selectedRobotId = selected.robot.robotId;
  }
  if (!selected) {
    return renderEmptyState("No robot registered.", "Create or import robot inventory records.");
  }

  const { robot, latestRun, displayStatus } = selected;
  const runEvents = state.data.runEvents
    .filter((event) => event.robotRunId === latestRun?.robotRunId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return `
    <div class="detail-layout">
      <section class="detail-panel">
        <div class="detail-hero">
          <button class="ghost-button" type="button" data-action="back">${icons.back}<span>Back</span></button>
          <div class="detail-title-row">
            <div>
              <h2>${escapeHtml(robot.robotName)}</h2>
              <p class="muted">${escapeHtml(robot.powerAutomateEnvironmentId || "No environment ID")} · ${escapeHtml(robot.machineName)}</p>
            </div>
            ${renderStatusBadge(displayStatus)}
          </div>
          <div class="detail-actions">
            <a class="primary-button" href="${escapeHtml(robot.powerAutomateUrl || "#")}" target="_blank" rel="noreferrer">
              ${icons.external}<span>Open Power Automate</span>
            </a>
            <button class="secondary-button" type="button" data-action="logger-start" data-robot-id="${escapeHtml(robot.robotId)}">${icons.play}<span>Start</span></button>
            <button class="secondary-button" type="button" data-action="logger-success" data-robot-id="${escapeHtml(robot.robotId)}">${icons.check}<span>Success</span></button>
            <button class="danger-button" type="button" data-action="logger-failed" data-robot-id="${escapeHtml(robot.robotId)}">${icons.x}<span>Failed</span></button>
          </div>
        </div>

        <div class="fact-grid">
          ${renderFact("Environment ID", robot.powerAutomateEnvironmentId)}
          ${renderFact("Machine", robot.machineName)}
          ${renderFact("Machine IP", robot.machineIp)}
          ${renderFact("Account Label", robot.accountLabel)}
          ${renderFact("AnyDesk ID", robot.anydeskId)}
          ${renderFact("AnyDesk Alias", robot.anydeskAlias)}
          ${renderFact("Robot Type", robot.robotType)}
          ${renderFact("Robot Code", robot.robotCode)}
          ${renderFact("Cloud Flow", robot.cloudFlowName || "-")}
          ${renderFact("Desktop Flow", robot.desktopFlowName || "-")}
          ${renderFact("Max Expected", `${robot.maxExpectedRunMinutes || 0} min`)}
        </div>

        <div class="run-summary">
          <h3>Latest Run</h3>
          ${renderRunCard(latestRun, robot)}
          <h3>Run Events</h3>
          ${renderEventList(runEvents)}
        </div>
      </section>

      <aside class="side-stack">
        ${renderRobotPicker()}
        ${renderLoggerPanel(robot.robotId)}
      </aside>
    </div>
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
  return `
    <article class="kpi-card">
      <div class="kpi-label">
        <span>Total Robots</span>
        <button class="primary-button kpi-add-button" type="button" data-action="add-robot-open">
          ${icons.add}<span>Add Robot</span>
        </button>
      </div>
      <div class="kpi-value">${Number(value).toLocaleString()}</div>
      <div class="kpi-note">Active robots in current filter</div>
    </article>
  `;
}

function renderAddRobotModal() {
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
            <div class="field">
              <label for="newRobotCode">Robot Code</label>
              <input id="newRobotCode" name="robotCode" required maxlength="100" pattern="[A-Za-z0-9_-]+" autocomplete="off" placeholder="ITZONE_RECEIPT" />
            </div>
            <div class="field">
              <label for="newRobotName">Robot Name</label>
              <input id="newRobotName" name="robotName" required maxlength="255" autocomplete="off" placeholder="ITZONE Receipt Bot" />
            </div>
            <div class="field field-full">
              <label for="newRobotEnvironment">Power Automate Environment ID</label>
              <input id="newRobotEnvironment" name="powerAutomateEnvironmentId" required maxlength="200" autocomplete="off" placeholder="Default-xxxxxxxx" />
            </div>
            <div class="field">
              <label for="newRobotMachine">Machine Name</label>
              <input id="newRobotMachine" name="machineName" required maxlength="150" autocomplete="off" placeholder="BOT-PC-02" />
            </div>
            <div class="field">
              <label for="newRobotMachineIp">Machine IP</label>
              <input id="newRobotMachineIp" name="machineIp" maxlength="100" autocomplete="off" placeholder="10.0.0.22" />
            </div>
            <div class="field">
              <label for="newRobotType">Robot Type</label>
              <select id="newRobotType" name="robotType">
                <option value="CLOUD_DESKTOP">Cloud + Desktop</option>
                <option value="CLOUD_ONLY">Cloud only</option>
                <option value="DESKTOP_ONLY">Desktop only</option>
              </select>
            </div>
            <div class="field">
              <label for="newRobotAccount">Account Label</label>
              <input id="newRobotAccount" name="accountLabel" maxlength="150" autocomplete="off" placeholder="Robot Account 02" />
            </div>
            <div class="field">
              <label for="newRobotMaxRun">Max Expected Run</label>
              <input id="newRobotMaxRun" name="maxExpectedRunMinutes" type="number" min="1" max="1440" value="60" required />
            </div>
            <div class="field">
              <label for="newRobotAnyDeskId">AnyDesk ID</label>
              <input id="newRobotAnyDeskId" name="anydeskId" maxlength="100" autocomplete="off" placeholder="123 456 789" />
            </div>
            <div class="field field-full">
              <label for="newRobotAnyDeskAlias">AnyDesk Alias</label>
              <input id="newRobotAnyDeskAlias" name="anydeskAlias" maxlength="200" autocomplete="off" placeholder="itzone-receipt-bot" />
            </div>
            <div class="field">
              <label for="newRobotCloudFlowId">Cloud Flow ID</label>
              <input id="newRobotCloudFlowId" name="cloudFlowId" maxlength="200" autocomplete="off" placeholder="xxxxxxxx" />
            </div>
            <div class="field">
              <label for="newRobotCloudFlow">Cloud Flow Name</label>
              <input id="newRobotCloudFlow" name="cloudFlowName" maxlength="255" autocomplete="off" placeholder="ITZONE Receipt Main Flow" />
            </div>
            <div class="field">
              <label for="newRobotDesktopFlowId">Desktop Flow ID</label>
              <input id="newRobotDesktopFlowId" name="desktopFlowId" maxlength="200" autocomplete="off" placeholder="xxxxxxxx" />
            </div>
            <div class="field">
              <label for="newRobotDesktopFlow">Desktop Flow Name</label>
              <input id="newRobotDesktopFlow" name="desktopFlowName" maxlength="255" autocomplete="off" placeholder="ITZONE Receipt PAD" />
            </div>
          </div>
          <div class="modal-actions">
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
  const statuses = ["RUNNING", "SUCCESS", "FAILED", "QUEUED", "CANCELLED", "TIMEOUT", "UNKNOWN", "STALE_RUNNING"];

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
    ? "<th>Robot</th><th>Env</th><th>Type</th><th>Machine</th><th>Max</th><th>Status</th><th>Last Run</th><th></th>"
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
  return `
    <tr>
      <td>
        <div class="robot-name">
          <button class="link-button" type="button" data-action="detail" data-robot-id="${escapeHtml(robot.robotId)}">${escapeHtml(robot.robotName)}</button>
          <span>${escapeHtml(robot.accountLabel || robot.robotCode)}</span>
        </div>
      </td>
      <td>${escapeHtml(robot.powerAutomateEnvironmentId || "-")}</td>
      <td>${escapeHtml(robot.machineName)}</td>
      <td>${renderStatusBadge(displayStatus)}</td>
      <td>${formatDateTime(latestRun?.startedAt)}</td>
      <td>${formatDuration(latestRun, robot)}</td>
      <td class="truncate" title="${escapeHtml(latestRun?.errorMessage || "")}">${escapeHtml(latestRun?.errorMessage || "-")}</td>
      <td>
        <div class="table-actions">
          <button class="icon-button" type="button" data-action="detail" data-robot-id="${escapeHtml(robot.robotId)}" title="Open robot detail" aria-label="Open robot detail">${icons.robot}</button>
          <a class="icon-button" href="${escapeHtml(robot.powerAutomateUrl || "#")}" target="_blank" rel="noreferrer" title="Open Power Automate" aria-label="Open Power Automate">${icons.external}</a>
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
          <span>${escapeHtml(robot.robotCode)}</span>
        </div>
      </td>
      <td>${escapeHtml(robot.powerAutomateEnvironmentId || "-")}</td>
      <td>${escapeHtml(robot.robotType)}</td>
      <td>${escapeHtml(robot.machineName)}</td>
      <td>${escapeHtml(robot.maxExpectedRunMinutes || 0)} min</td>
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

function renderRobotPicker() {
  const allRows = rows().sort((a, b) => a.robot.robotName.localeCompare(b.robot.robotName));
  return `
    <section class="side-panel">
      <div class="panel-heading">
        <div>
          <h2>Robot</h2>
          <p>Detail target</p>
        </div>
      </div>
      <div class="panel-body">
        <div class="field">
          <label for="detailRobotPicker">Robot</label>
          <select id="detailRobotPicker" data-action="pick-robot">
            ${allRows
              .map(({ robot }) => `<option value="${escapeHtml(robot.robotId)}" ${selected(robot.robotId, state.selectedRobotId)}>${escapeHtml(robot.robotName)}</option>`)
              .join("")}
          </select>
        </div>
      </div>
    </section>
  `;
}

function renderLoggerPanel(forRobotId = "") {
  const targetRobotId = forRobotId || state.logger.robotId || state.selectedRobotId;
  const robotOptions = state.data.robots
    .slice()
    .sort((a, b) => a.robotName.localeCompare(b.robotName))
    .map((robot) => `<option value="${escapeHtml(robot.robotId)}" ${selected(robot.robotId, targetRobotId)}>${escapeHtml(robot.robotName)}</option>`)
    .join("");

  return `
    <section class="side-panel">
      <div class="panel-heading">
        <div>
          <h2>Robot Logging</h2>
          <p>START, SUCCESS, FAILED</p>
        </div>
      </div>
      <div class="panel-body">
        <div class="logger-form">
          <div class="field">
            <label for="loggerRobot">Robot</label>
            <select id="loggerRobot" data-logger="robotId" ${forRobotId ? "disabled" : ""}>
              ${robotOptions}
            </select>
          </div>
          <div class="logger-actions">
            <button class="primary-button" type="button" data-action="logger-start" data-robot-id="${escapeHtml(targetRobotId)}" title="Create RUNNING run">${icons.play}<span>Start</span></button>
            <button class="secondary-button" type="button" data-action="logger-success" data-robot-id="${escapeHtml(targetRobotId)}" title="Update latest run to SUCCESS">${icons.check}<span>Success</span></button>
            <button class="danger-button" type="button" data-action="logger-failed" data-robot-id="${escapeHtml(targetRobotId)}" title="Update latest run to FAILED">${icons.x}<span>Failed</span></button>
          </div>
          <div class="field">
            <label for="loggerErrorCode">Error Code</label>
            <input id="loggerErrorCode" data-logger="errorCode" value="${escapeHtml(state.logger.errorCode)}" />
          </div>
          <div class="field">
            <label for="loggerErrorStep">Error Step</label>
            <input id="loggerErrorStep" data-logger="errorStep" value="${escapeHtml(state.logger.errorStep)}" />
          </div>
          <div class="field">
            <label for="loggerErrorMessage">Error Message</label>
            <textarea id="loggerErrorMessage" data-logger="errorMessage">${escapeHtml(state.logger.errorMessage)}</textarea>
          </div>
        </div>
      </div>
    </section>
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
        ${renderFact("Duration", formatDuration(run, robot))}
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
              <span>${escapeHtml(formatDateTime(event.createdAt))} · ${escapeHtml(event.eventType)}</span>
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

function formatDuration(run, robot) {
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

function latestRunForRobot(robotId) {
  return latestRunMap().get(robotId) || null;
}

async function handleLoggerAction(action, robotId) {
  const targetRobotId = robotId || state.logger.robotId || state.selectedRobotId;
  if (!targetRobotId) {
    showToast("Select a robot first.", "error");
    return;
  }

  try {
    if (action === "logger-start") {
      await apiFetch("/api/logger/start", {
        method: "POST",
        body: JSON.stringify({ robotId: targetRobotId }),
      });
      showToast("RUNNING record created.");
    }

    if (action === "logger-success") {
      const run = latestRunForRobot(targetRobotId);
      if (!run) {
        throw new Error("No run record found for this robot.");
      }
      await apiFetch("/api/logger/success", {
        method: "POST",
        body: JSON.stringify({ robotRunId: run.robotRunId }),
      });
      showToast("Run updated to SUCCESS.");
    }

    if (action === "logger-failed") {
      const run = latestRunForRobot(targetRobotId);
      if (!run) {
        throw new Error("No run record found for this robot.");
      }
      await apiFetch("/api/logger/failed", {
        method: "POST",
        body: JSON.stringify({
          robotRunId: run.robotRunId,
          errorCode: state.logger.errorCode || "ERR_UNKNOWN",
          errorStep: state.logger.errorStep || "Unknown Step",
          errorMessage: state.logger.errorMessage || "Robot failed.",
        }),
      });
      showToast("Run updated to FAILED.");
    }

    state.selectedRobotId = targetRobotId;
    state.logger.robotId = targetRobotId;
    await loadData({ silent: true });
  } catch (error) {
    showToast(error.message, "error");
  }
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

function setAddRobotModal(isOpen) {
  state.addRobotOpen = isOpen;
  document.body.classList.toggle("modal-open", isOpen);
  render();
  if (isOpen) {
    window.requestAnimationFrame(() => document.querySelector("#newRobotCode")?.focus());
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
        robotCode: String(formData.get("robotCode") || "").trim(),
        robotName: String(formData.get("robotName") || "").trim(),
        powerAutomateEnvironmentId: String(
          formData.get("powerAutomateEnvironmentId") || "",
        ).trim(),
        machineName: String(formData.get("machineName") || "").trim(),
        machineIp: String(formData.get("machineIp") || "").trim(),
        robotType: String(formData.get("robotType") || "CLOUD_DESKTOP"),
        accountLabel: String(formData.get("accountLabel") || "").trim(),
        anydeskId: String(formData.get("anydeskId") || "").trim(),
        anydeskAlias: String(formData.get("anydeskAlias") || "").trim(),
        maxExpectedRunMinutes: Number(formData.get("maxExpectedRunMinutes") || 60),
        cloudFlowId: String(formData.get("cloudFlowId") || "").trim(),
        cloudFlowName: String(formData.get("cloudFlowName") || "").trim(),
        desktopFlowId: String(formData.get("desktopFlowId") || "").trim(),
        desktopFlowName: String(formData.get("desktopFlowName") || "").trim(),
        isActive: true,
      }),
    });

    state.addRobotOpen = false;
    document.body.classList.remove("modal-open");
    state.selectedRobotId = payload.robot.robotId;
    state.logger.robotId = payload.robot.robotId;
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

  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    const action = actionTarget.dataset.action;
    const robotId = actionTarget.dataset.robotId || "";

    if (action === "refresh") {
      await loadData({ silent: true });
      showToast("Dashboard refreshed.");
      return;
    }

    if (action === "clear-filters") {
      clearFilters();
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

    if (action === "detail") {
      state.selectedRobotId = robotId;
      state.logger.robotId = robotId;
      state.view = "detail";
      render();
      return;
    }

    if (action === "back") {
      state.view = "overview";
      render();
      return;
    }

    if (["logger-start", "logger-success", "logger-failed"].includes(action)) {
      await handleLoggerAction(action, robotId);
      return;
    }
  }

  const viewTarget = event.target.closest("[data-view]");
  if (viewTarget) {
    state.addRobotOpen = false;
    document.body.classList.remove("modal-open");
    state.view = viewTarget.dataset.view;
    render();
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-form="add-robot"]');
  if (!form) {
    return;
  }
  event.preventDefault();
  await handleAddRobotSubmit(form);
});

document.addEventListener("change", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.filters[filter.dataset.filter] = filter.value;
    render();
    return;
  }

  const logger = event.target.closest("[data-logger]");
  if (logger) {
    state.logger[logger.dataset.logger] = logger.value;
    return;
  }

  const picker = event.target.closest('[data-action="pick-robot"]');
  if (picker) {
    state.selectedRobotId = picker.value;
    state.logger.robotId = picker.value;
    render();
  }
});

document.addEventListener("input", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.filters[filter.dataset.filter] = filter.value;
    render();
    return;
  }

  const logger = event.target.closest("[data-logger]");
  if (logger) {
    state.logger[logger.dataset.logger] = logger.value;
  }
});

window.addEventListener("keydown", async (event) => {
  if (event.key === "Escape" && state.addRobotOpen) {
    setAddRobotModal(false);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
    event.preventDefault();
    await loadData({ silent: true });
    showToast("Dashboard refreshed.");
  }
});

loadData();
state.refreshTimer = window.setInterval(() => {
  loadData({ silent: true });
}, 30000);
