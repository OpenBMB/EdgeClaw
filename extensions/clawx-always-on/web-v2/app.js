const ROUTE_BASE = "/plugins/clawx-always-on";
const REFRESH_INTERVAL_MS = 5000;
const MOBILE_CHROME_TRANSITION_MS = 300;
const DEFAULT_LOG_LIMIT = 80;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "clawx-always-on.sidebar-collapsed";
const COMPOSE_MODE_STORAGE_KEY = "clawx-always-on.compose-mode";
const PLANNER_PLAN_STORAGE_KEY = "clawx-always-on.planner-plan-id";
const TOPBAR_TITLES = {
  overview: "ClawX Always-On",
  compose: "Compose",
  tasks: "Tasks",
  activity: "Activity",
  config: "Config",
};
const STATUS_ORDER = [
  "all",
  "active",
  "launching",
  "queued",
  "suspended",
  "completed",
  "failed",
  "cancelled",
  "pending",
];
const STATUS_LABELS = {
  all: "All",
  active: "Active",
  launching: "Launching",
  queued: "Queued",
  suspended: "Suspended",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  pending: "Pending",
};
const TAB_ORDER = ["overview", "compose", "tasks", "activity", "config"];
const ACTIVE_TASK_STATUSES = new Set(["active", "launching"]);
const REVIEW_TASK_STATUSES = new Set(["suspended", "failed"]);
const CLOSED_TASK_STATUSES = new Set(["completed", "cancelled"]);

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function readStorageValue(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key, value) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage persistence failures
  }
}

const state = {
  stats: null,
  tasks: [],
  selectedTaskId: null,
  selectedTask: null,
  logs: [],
  activeFilter: "all",
  activeTab: "overview",
  refreshing: false,
  action: null,
  createTitleDraft: "",
  createMaxLoopsDraft: "",
  createMaxCostDraft: "",
  sidebarCollapsed: readStorageValue(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true",
  sidebarOpen: false,
  composeMode: readStorageValue(COMPOSE_MODE_STORAGE_KEY) === "plan" ? "plan" : "direct",
  planner: null,
  plannerLoading: false,
  plannerAction: null,
  plannerPromptDraft: "",
  plannerAnswerDraft: "",
  config: null,
  configLoading: false,
  configSaving: false,
};

const elements = {
  refreshButton: document.querySelector("#refresh-button"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarNav: document.querySelector("#sidebar-nav"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  topbarTitle: document.querySelector("#topbar-title"),
  appFrame: document.querySelector(".app-frame"),
  overviewSummary: document.querySelector("#overview-summary"),
  overviewRunning: document.querySelector("#overview-running"),
  overviewQueue: document.querySelector("#overview-queue"),
  composeModeSwitch: document.querySelector("#compose-mode-switch"),
  composeThread: document.querySelector("#compose-thread"),
  composeComposer: document.querySelector("#compose-composer"),
  composeDefaults: document.querySelector("#compose-defaults"),
  filterStrip: document.querySelector("#filter-strip"),
  taskList: document.querySelector("#task-list"),
  activityTaskList: document.querySelector("#activity-task-list"),
  activityTitle: document.querySelector("#activity-title"),
  activitySubtitle: document.querySelector("#activity-subtitle"),
  activityPill: document.querySelector("#activity-pill"),
  activityDetail: document.querySelector("#activity-detail"),
  activityStream: document.querySelector("#activity-stream"),
  configContent: document.querySelector("#config-content"),
  statusBanner: document.querySelector("#status-banner"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(text, maxLength = 140) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "Not available";
  }

  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "Not available";
  }
}

function formatCurrency(value, compact = false) {
  const formatter = compact ? compactCurrencyFormatter : currencyFormatter;
  return formatter.format(Number.isFinite(value) ? value : 0);
}

function getTaskUpdatedAt(task) {
  return task.completedAt || task.suspendedAt || task.startedAt || task.createdAt;
}

function pickDefaultTaskId(tasks) {
  for (const status of ["active", "launching", "queued", "pending", "suspended"]) {
    const match = tasks.find((task) => task.status === status);
    if (match) {
      return match.id;
    }
  }

  return tasks[0]?.id ?? null;
}

function humanizeKey(key) {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (character) => character.toUpperCase());
}

function normalizeLogLevel(level) {
  const normalized = String(level ?? "info").toLowerCase();
  if (normalized.includes("error")) {
    return "error";
  }
  if (normalized.includes("warn")) {
    return "warn";
  }
  if (normalized.includes("debug") || normalized.includes("trace")) {
    return "debug";
  }
  return "info";
}

function isSimpleMetadataValue(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function formatMetadataValue(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    return truncate(value.map((item) => formatMetadataValue(item)).join(", "), 180);
  }

  if (typeof value === "object") {
    return truncate(JSON.stringify(value), 180);
  }

  return String(value);
}

function shouldUseMono(value) {
  return typeof value === "string" && /[:/_-]/.test(value);
}

const BANNER_DURATION_MS = { info: 3000, success: 3000, error: 6000 };
let bannerTimerId = 0;
let sidebarOverlayTimerId = 0;

function setBanner(message, variant = "info") {
  if (!elements.statusBanner) {
    return;
  }

  clearTimeout(bannerTimerId);

  if (!message) {
    elements.statusBanner.classList.add("status-banner--fading");
    bannerTimerId = window.setTimeout(() => {
      elements.statusBanner.hidden = true;
      elements.statusBanner.textContent = "";
      elements.statusBanner.classList.remove("status-banner--fading");
      delete elements.statusBanner.dataset.variant;
    }, 300);
    return;
  }

  elements.statusBanner.classList.remove("status-banner--fading");
  elements.statusBanner.hidden = false;
  elements.statusBanner.dataset.variant = variant;
  elements.statusBanner.textContent = message;

  const duration = BANNER_DURATION_MS[variant] ?? 3000;
  bannerTimerId = window.setTimeout(() => setBanner(null), duration);
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function showSidebarOverlay() {
  if (!elements.sidebarOverlay) {
    return;
  }

  window.clearTimeout(sidebarOverlayTimerId);
  elements.sidebarOverlay.hidden = false;
  window.requestAnimationFrame(() => {
    if (elements.sidebarOverlay && state.sidebarOpen && isMobileViewport()) {
      elements.sidebarOverlay.dataset.visible = "true";
    }
  });
}

function hideSidebarOverlay({ immediate = false } = {}) {
  if (!elements.sidebarOverlay) {
    return;
  }

  window.clearTimeout(sidebarOverlayTimerId);
  elements.sidebarOverlay.dataset.visible = "false";

  if (immediate || elements.sidebarOverlay.hidden) {
    elements.sidebarOverlay.hidden = true;
    return;
  }

  sidebarOverlayTimerId = window.setTimeout(() => {
    if (elements.sidebarOverlay && (!state.sidebarOpen || !isMobileViewport())) {
      elements.sidebarOverlay.hidden = true;
    }
  }, MOBILE_CHROME_TRANSITION_MS);
}

function syncPlannerStorage(plan) {
  writeStorageValue(PLANNER_PLAN_STORAGE_KEY, plan?.id ?? null);
}

function renderChrome() {
  if (!elements.appFrame || !elements.sidebarToggle || !elements.sidebarOverlay) {
    return;
  }

  const mobile = isMobileViewport();
  elements.appFrame.dataset.sidebarCollapsed = String(!mobile && state.sidebarCollapsed);
  elements.appFrame.dataset.sidebarOpen = String(mobile && state.sidebarOpen);
  if (mobile && state.sidebarOpen) {
    showSidebarOverlay();
  } else {
    hideSidebarOverlay({ immediate: !mobile });
  }
  document.body.classList.toggle("body--locked", mobile && state.sidebarOpen);

  const expanded = mobile ? state.sidebarOpen : !state.sidebarCollapsed;
  const label = expanded ? "Collapse navigation" : "Expand navigation";
  elements.sidebarToggle.setAttribute("aria-expanded", String(expanded));
  elements.sidebarToggle.setAttribute("aria-label", label);
  elements.sidebarToggle.title = label;

  if (elements.topbarTitle) {
    elements.topbarTitle.textContent = TOPBAR_TITLES[state.activeTab] ?? "ClawX Always-On";
  }
}

function toggleSidebar() {
  if (isMobileViewport()) {
    state.sidebarOpen = !state.sidebarOpen;
    renderChrome();
    return;
  }

  state.sidebarCollapsed = !state.sidebarCollapsed;
  writeStorageValue(SIDEBAR_COLLAPSED_STORAGE_KEY, state.sidebarCollapsed ? "true" : "false");
  renderChrome();
}

async function fetchJson(path, options = {}) {
  const requestOptions = { ...options };
  const headers = new Headers(requestOptions.headers ?? {});

  if (requestOptions.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  requestOptions.headers = headers;
  const response = await fetch(`${ROUTE_BASE}${path}`, requestOptions);
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload ? payload.error : raw;
    throw new Error(message || `Request failed (${response.status})`);
  }

  return payload;
}

function getFilterCount(status) {
  if (!state.stats) {
    return 0;
  }

  if (status === "all") {
    return state.stats.totalTasks ?? 0;
  }

  return state.stats.countsByStatus?.[status] ?? 0;
}

function getVisibleTasks() {
  if (state.activeFilter === "all") {
    return state.tasks;
  }

  return state.tasks.filter((task) => task.status === state.activeFilter);
}

function updateControls() {
  if (elements.refreshButton) {
    elements.refreshButton.disabled = state.refreshing;
    elements.refreshButton.classList.toggle("button--spinning", state.refreshing);
    elements.refreshButton.setAttribute("aria-busy", String(state.refreshing));
  }

  const createForm = document.querySelector("#create-form");
  if (createForm instanceof HTMLFormElement) {
    const disabled = state.action === "create";
    for (const field of Array.from(createForm.elements)) {
      field.disabled = disabled;
    }
  }

  const configForm = document.querySelector("#config-form");
  if (configForm instanceof HTMLFormElement) {
    for (const field of Array.from(configForm.elements)) {
      field.disabled = state.configSaving;
    }
  }
}

function setActiveTab(tab) {
  if (!TAB_ORDER.includes(tab)) {
    return;
  }

  state.activeTab = tab;
  if (isMobileViewport()) {
    state.sidebarOpen = false;
  }
  render();
  if (tab === "config" && !state.config && !state.configLoading) {
    void loadConfigSnapshot({ silent: true });
  }
}

function renderTabs() {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const isActive = button.dataset.tab === state.activeTab;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }

  for (const panel of document.querySelectorAll("[data-tab-panel]")) {
    panel.hidden = panel.dataset.tabPanel !== state.activeTab;
  }
}

function renderStatusPill(status, label = STATUS_LABELS[status] ?? status) {
  return `
    <span class="status-pill" data-status="${escapeHtml(status)}">
      ${escapeHtml(label)}
    </span>
  `;
}

function renderEmptyState(title, copy, action = null) {
  const actionLabels = {
    "open-activity": "Open Activity",
    "open-overview": "Open Overview",
    "open-tasks": "Open Tasks",
  };
  const actionMarkup = action
    ? `
        <button class="button button--secondary empty-state__action" type="button" data-ui-action="${escapeHtml(action)}">
          ${escapeHtml(actionLabels[action] ?? "Continue")}
        </button>
      `
    : "";

  return `
    <div class="empty-state">
      <div>
        <h3 class="empty-state__title">${escapeHtml(title)}</h3>
        <p class="empty-state__copy">${escapeHtml(copy)}</p>
        ${actionMarkup}
      </div>
    </div>
  `;
}

function renderMetaRow(label, value, mono = false) {
  return `
    <div class="task-meta__row">
      <span class="task-meta__label">${escapeHtml(label)}</span>
      <p class="task-meta__value${mono ? " mono" : ""}">${escapeHtml(value)}</p>
    </div>
  `;
}

function renderOverviewSummary() {
  if (!elements.overviewSummary) {
    return;
  }

  if (!state.stats) {
    elements.overviewSummary.innerHTML = `
      <article class="summary-card">
        <p class="summary-card__label">Loading</p>
        <p class="summary-card__value">&ndash;</p>
        <p class="summary-card__meta">Connecting to the always-on console.</p>
      </article>
    `;
    return;
  }

  const cards = [
    {
      label: "Total tasks",
      value: state.stats.totalTasks ?? 0,
      meta: `${state.stats.countsByStatus?.queued ?? 0} queued`,
    },
    {
      label: "Active now",
      value: state.tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length,
      meta: `${state.stats.maxConcurrentTasks ?? 0} slots available`,
    },
    {
      label: "Default loops",
      value: state.stats.defaultMaxLoops ?? 0,
      meta: "Per task budget",
    },
    {
      label: "Default spend",
      value: formatCurrency(state.stats.defaultMaxCostUsd),
      meta: `${state.stats.logRetentionDays ?? 0} day log retention`,
    },
  ];

  elements.overviewSummary.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <p class="summary-card__label">${escapeHtml(card.label)}</p>
          <p class="summary-card__value">${escapeHtml(String(card.value))}</p>
          <p class="summary-card__meta">${escapeHtml(card.meta)}</p>
        </article>
      `,
    )
    .join("");
}

function renderRunningSignal(task) {
  return `
    <button class="signal-card" type="button" data-task-id="${escapeHtml(task.id)}" data-open-tab="tasks">
      <div class="signal-card__header">
        <h3 class="signal-card__title">${escapeHtml(task.title)}</h3>
        ${renderStatusPill(task.status)}
      </div>
      <p class="signal-card__meta">
        ${escapeHtml(truncate(task.progressSummary || task.resultSummary || "Worker is processing this task.", 120))}
      </p>
    </button>
  `;
}

function renderOverviewRunning() {
  if (!elements.overviewRunning) {
    return;
  }

  const activeTasks = state.tasks
    .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
    .slice(0, 4);
  if (activeTasks.length === 0) {
    elements.overviewRunning.innerHTML = `
      <article class="signal-card signal-card--empty">
        <h3 class="signal-card__title">No active tasks.</h3>
        <p class="signal-card__meta">Worker slots are free.</p>
      </article>
    `;
    return;
  }

  elements.overviewRunning.innerHTML = activeTasks.map(renderRunningSignal).join("");
}

function renderQueueItem(task) {
  return `
    <button class="queue-item" type="button" data-task-id="${escapeHtml(task.id)}" data-open-tab="tasks">
      <div class="queue-item__topline">
        <h3 class="queue-item__title">${escapeHtml(task.title)}</h3>
        ${renderStatusPill(task.status)}
      </div>
      <p class="queue-item__meta">${escapeHtml(formatDateTime(getTaskUpdatedAt(task)))}</p>
    </button>
  `;
}

function renderQueueSection(title, copy, tasks) {
  const content =
    tasks.length > 0
      ? `<div class="queue-section__list">${tasks.map(renderQueueItem).join("")}</div>`
      : `
          <div class="empty-state queue-section__empty">
            <div>
              <h3 class="empty-state__title">Nothing here</h3>
              <p class="empty-state__copy">${escapeHtml(copy)}</p>
            </div>
          </div>
        `;

  return `
    <section class="queue-section">
      <div class="queue-section__header">
        <h3 class="queue-section__title">${escapeHtml(title)}</h3>
        <p class="queue-section__copy">${escapeHtml(copy)}</p>
      </div>
      ${content}
    </section>
  `;
}

function renderOverviewQueue() {
  if (!elements.overviewQueue) {
    return;
  }

  elements.overviewQueue.innerHTML = [
    renderQueueSection(
      "Queued",
      "Waiting for a slot.",
      state.tasks.filter((task) => task.status === "queued").slice(0, 4),
    ),
    renderQueueSection(
      "Pending",
      "Created but intentionally waiting for an explicit start command or dashboard action.",
      state.tasks.filter((task) => task.status === "pending").slice(0, 4),
    ),
    renderQueueSection(
      "Needs review",
      "Suspended or failed.",
      state.tasks.filter((task) => REVIEW_TASK_STATUSES.has(task.status)).slice(0, 4),
    ),
    renderQueueSection(
      "Recently closed",
      "Completed or cancelled.",
      state.tasks.filter((task) => CLOSED_TASK_STATUSES.has(task.status)).slice(0, 4),
    ),
  ].join("");
}

function renderOverview() {
  renderOverviewSummary();
  renderOverviewRunning();
  renderOverviewQueue();
}

function renderPlannerTurn(turn) {
  const roleLabel = turn.role === "user" ? "You" : "Planner";
  return `
    <article class="planner-turn" data-role="${escapeHtml(turn.role)}">
      <div class="planner-turn__header">
        <span class="planner-turn__role">${escapeHtml(roleLabel)}</span>
        <time class="planner-turn__time">${escapeHtml(formatDateTime(turn.timestamp))}</time>
      </div>
      <div class="planner-turn__body">
        ${escapeHtml(turn.content || "").replaceAll("\n", "<br />")}
      </div>
    </article>
  `;
}

function renderPlannerQuestions(questions = []) {
  if (questions.length === 0) {
    return "";
  }

  return `
    <section class="planner-question-list">
      ${questions
        .map(
          (question, index) => `
            <article class="planner-question">
              <h3 class="planner-question__title">${escapeHtml(`${index + 1}. ${question.text}`)}</h3>
              <ul class="planner-question__options">
                ${question.options
                  .map(
                    (option) => `
                      <li class="planner-question__option">${escapeHtml(option)}</li>
                    `,
                  )
                  .join("")}
              </ul>
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function setComposeMode(mode) {
  if (mode !== "direct" && mode !== "plan") {
    return;
  }
  state.composeMode = mode;
  writeStorageValue(COMPOSE_MODE_STORAGE_KEY, mode);
  render();
}

function renderComposeModeSwitch() {
  if (!elements.composeModeSwitch) {
    return;
  }

  elements.composeModeSwitch.innerHTML = ["direct", "plan"]
    .map(
      (mode) => `
        <button
          class="mode-switch__button"
          type="button"
          data-compose-mode="${mode}"
          data-active="${String(state.composeMode === mode)}"
        >
          ${escapeHtml(mode === "direct" ? "Direct" : "Plan")}
        </button>
      `,
    )
    .join("");
}

function renderComposeDefaults() {
  if (!elements.composeDefaults) {
    return;
  }

  if (!state.stats) {
    elements.composeDefaults.innerHTML = renderEmptyState("Loading", "Fetching current defaults.");
    return;
  }

  const activeCount = state.tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length;
  elements.composeDefaults.innerHTML = `
    <div class="compose-defaults__stack">
      <section class="surface-card">
        <div class="surface-card__header">
          <h3>Budget</h3>
        </div>
        <dl class="detail-grid">
          <div class="detail-grid__item">
            <dt class="detail-grid__term">Loops</dt>
            <dd class="detail-grid__value">${escapeHtml(String(state.stats.defaultMaxLoops ?? 0))}</dd>
          </div>
          <div class="detail-grid__item">
            <dt class="detail-grid__term">Cost</dt>
            <dd class="detail-grid__value">${escapeHtml(formatCurrency(state.stats.defaultMaxCostUsd))}</dd>
          </div>
        </dl>
      </section>
      <section class="surface-card">
        <div class="surface-card__header">
          <h3>Worker</h3>
        </div>
        <dl class="detail-grid">
          <div class="detail-grid__item">
            <dt class="detail-grid__term">Slots</dt>
            <dd class="detail-grid__value">${escapeHtml(String(state.stats.maxConcurrentTasks ?? 0))}</dd>
          </div>
          <div class="detail-grid__item">
            <dt class="detail-grid__term">Active</dt>
            <dd class="detail-grid__value">${escapeHtml(String(activeCount))}</dd>
          </div>
          <div class="detail-grid__item">
            <dt class="detail-grid__term">Retention</dt>
            <dd class="detail-grid__value">${escapeHtml(String(state.stats.logRetentionDays ?? 0))} days</dd>
          </div>
        </dl>
      </section>
    </div>
  `;
}

function renderDirectThread() {
  return `
    <section class="surface-card surface-card--muted">
      <div class="surface-card__header">
        <h3>Queue a focused task</h3>
      </div>
      <div class="compose-pill-row">
        ${renderStatusPill("queued", "Queue")}
        ${renderStatusPill("completed", "Defaults")}
      </div>
    </section>
  `;
}

function renderDirectComposer() {
  const loopsPlaceholder = state.stats?.defaultMaxLoops ? String(state.stats.defaultMaxLoops) : "";
  const costPlaceholder =
    typeof state.stats?.defaultMaxCostUsd === "number"
      ? state.stats.defaultMaxCostUsd.toFixed(2)
      : "";

  return `
    <form id="create-form" class="form-stack">
      <label class="field">
        <span class="field__label">Task prompt</span>
        <textarea
          id="task-title"
          name="title"
          rows="5"
          placeholder="Research the top regressions in yesterday's build and summarize likely fixes."
          required
        >${escapeHtml(state.createTitleDraft)}</textarea>
      </label>

      <div class="field-grid">
        <label class="field">
          <span class="field__label">Max loops</span>
          <input
            id="max-loops"
            name="maxLoops"
            type="number"
            min="1"
            max="1000"
            step="1"
            placeholder="${escapeHtml(loopsPlaceholder)}"
            value="${escapeHtml(state.createMaxLoopsDraft)}"
          />
        </label>
        <label class="field">
          <span class="field__label">Max cost (USD)</span>
          <input
            id="max-cost"
            name="maxCostUsd"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            placeholder="${escapeHtml(costPlaceholder)}"
            value="${escapeHtml(state.createMaxCostDraft)}"
          />
        </label>
      </div>

      <div class="form-actions">
        <button class="button button--primary" type="submit" ${state.action === "create" ? "disabled" : ""}>
          ${state.action === "create" ? "Queueing..." : "Queue Task"}
        </button>
        <p class="helper-text">Leave limits blank to use the current defaults.</p>
      </div>
    </form>
  `;
}

function renderPlannerResultCard(plan) {
  if (plan.status === "completed") {
    return `
      <section class="surface-card planner-result-card" data-status="completed">
        <div class="surface-card__header">
          <h3>Task queued</h3>
          ${renderStatusPill("completed")}
        </div>
        <div class="planner-result-actions">
          <button class="button button--primary" type="button" data-ui-action="open-created-task">
            Open in Tasks
          </button>
          <button class="button button--secondary" type="button" data-ui-action="reset-planner">
            Start Another Plan
          </button>
        </div>
      </section>
    `;
  }

  if (plan.status === "cancelled") {
    return `
      <section class="surface-card planner-result-card" data-status="cancelled">
        <div class="surface-card__header">
          <h3>Planning cancelled</h3>
          ${renderStatusPill("cancelled")}
        </div>
        <div class="planner-result-actions">
          <button class="button button--secondary" type="button" data-ui-action="reset-planner">
            Start Another Plan
          </button>
        </div>
      </section>
    `;
  }

  if (plan.status === "failed") {
    return `
      <section class="surface-card planner-result-card" data-status="failed">
        <div class="surface-card__header">
          <h3>Planning failed</h3>
          ${renderStatusPill("failed")}
        </div>
        <p class="hint-copy">${escapeHtml(plan.failureReason || "The planner did not complete successfully.")}</p>
        <div class="planner-result-actions">
          <button class="button button--secondary" type="button" data-ui-action="reset-planner">
            Start Another Plan
          </button>
        </div>
      </section>
    `;
  }

  return "";
}

function renderPlannerThread() {
  const plan = state.planner;

  if (state.plannerLoading && !plan) {
    return `
      <section class="surface-card">
        <div class="surface-card__header">
          <h3>Restoring plan</h3>
        </div>
      </section>
    `;
  }

  if (!plan) {
    return `
      <section class="surface-card surface-card--muted">
        <div class="surface-card__header">
          <h3>Start with a goal</h3>
        </div>
      </section>
    `;
  }

  const preview =
    plan.status === "active" && plan.defaultPlan
      ? `
          <section class="surface-card surface-card--muted">
            <div class="surface-card__header">
              <h3>Preview</h3>
            </div>
            <p class="planner-preview__title">${escapeHtml(plan.defaultPlan.taskTitle)}</p>
            <p class="hint-copy">${escapeHtml(plan.defaultPlan.taskPrompt)}</p>
          </section>
        `
      : "";

  const controls =
    plan.status === "active"
      ? `
          <button
            class="button button--secondary"
            type="button"
            data-ui-action="cancel-planner"
            ${state.plannerAction === "cancel" ? "disabled" : ""}
          >
            ${state.plannerAction === "cancel" ? "Cancelling..." : "Cancel"}
          </button>
        `
      : "";

  return `
    <div class="planner-stack">
      ${renderPlannerResultCard(plan)}
      <section class="surface-card">
        <div class="surface-card__header">
          <h3>Thread</h3>
          <div class="planner-thread__controls">
            ${renderStatusPill(plan.status)}
            ${controls}
          </div>
        </div>
        <div class="planner-turns">
          ${plan.turns.map(renderPlannerTurn).join("")}
        </div>
      </section>
      ${preview}
    </div>
  `;
}

function renderPlannerComposer() {
  const plan = state.planner;
  const plannerBusy = Boolean(state.plannerLoading || state.plannerAction);

  if (!plan) {
    return `
      <section class="surface-card">
        <form id="planner-start-form" class="form-stack planner-form">
          <label class="field">
            <span class="field__label">Goal</span>
            <textarea
              id="planner-prompt"
              rows="5"
              placeholder="Audit the auth middleware for rate-limit gaps and propose fixes with tests."
            >${escapeHtml(state.plannerPromptDraft)}</textarea>
          </label>
          <div class="form-actions">
            <button class="button button--primary" type="submit" ${plannerBusy ? "disabled" : ""}>
              ${state.plannerAction === "start" ? "Starting..." : "Start Planning"}
            </button>
          </div>
        </form>
      </section>
    `;
  }

  if (plan.status === "active") {
    return `
      <section class="surface-card">
        ${renderPlannerQuestions(plan.pendingQuestions)}
        <form id="planner-answer-form" class="form-stack planner-form">
          <label class="field">
            <span class="field__label">Answer</span>
            <textarea
              id="planner-answer"
              rows="4"
              placeholder="Example: A for the first question, and focus on public web sources."
              ${plannerBusy ? "disabled" : ""}
            >${escapeHtml(state.plannerAnswerDraft)}</textarea>
          </label>
          <div class="form-actions">
            <button class="button button--primary" type="submit" ${plannerBusy ? "disabled" : ""}>
              ${state.plannerAction === "answer" ? "Creating Task..." : "Create Task"}
            </button>
          </div>
        </form>
      </section>
    `;
  }

  return `
    <section class="surface-card surface-card--muted">
      <div class="planner-result-actions">
        ${
          plan.createdTaskId
            ? `
                <button class="button button--primary" type="button" data-ui-action="open-created-task">
                  Open in Tasks
                </button>
              `
            : ""
        }
        <button class="button button--secondary" type="button" data-ui-action="reset-planner">
          Start Another Plan
        </button>
      </div>
    </section>
  `;
}

function renderCompose() {
  renderComposeModeSwitch();
  renderComposeDefaults();

  if (!elements.composeThread || !elements.composeComposer) {
    return;
  }

  if (state.composeMode === "plan") {
    elements.composeThread.innerHTML = renderPlannerThread();
    elements.composeComposer.innerHTML = renderPlannerComposer();
    return;
  }

  elements.composeThread.innerHTML = renderDirectThread();
  elements.composeComposer.innerHTML = renderDirectComposer();
}

function renderFilters() {
  if (!elements.filterStrip) {
    return;
  }

  elements.filterStrip.innerHTML = STATUS_ORDER.map((status) => {
    const count = getFilterCount(status);
    return `
      <button
        class="filter-pill"
        type="button"
        data-filter="${status}"
        data-active="${String(state.activeFilter === status)}"
      >
        ${escapeHtml(`${STATUS_LABELS[status]} (${count})`)}
      </button>
    `;
  }).join("");
}

function renderTaskList() {
  if (!elements.taskList) {
    return;
  }

  const tasks = getVisibleTasks();
  if (tasks.length === 0) {
    elements.taskList.innerHTML = renderEmptyState(
      "No tasks in this view",
      "Switch filters or queue a new task from Overview to populate this list.",
      "open-overview",
    );
    return;
  }

  elements.taskList.innerHTML = tasks
    .map((task) => {
      const summary = truncate(task.progressSummary || task.resultSummary || task.title, 120);
      const loopBudget = task.budgetConstraints.find(
        (constraint) => constraint.kind === "max-loops",
      );
      const costBudget = task.budgetConstraints.find(
        (constraint) => constraint.kind === "max-cost-usd",
      );
      const budgetLabel = `${loopBudget?.label ?? "No loop cap"} · ${costBudget?.label ?? "No cost cap"}`;

      return `
        <button
          class="task-row"
          type="button"
          data-task-id="${escapeHtml(task.id)}"
          data-selected="${String(state.selectedTaskId === task.id)}"
        >
          <div class="task-row__main">
            <div class="task-row__topline">
              <h3 class="task-row__title">${escapeHtml(task.title)}</h3>
              ${renderStatusPill(task.status)}
            </div>
            <p class="task-row__summary">${escapeHtml(summary)}</p>
          </div>
          <div class="task-row__meta">
            <span class="task-row__budget">${escapeHtml(budgetLabel)}</span>
            <time class="task-row__updated">${escapeHtml(formatDateTime(getTaskUpdatedAt(task)))}</time>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderTaskActionButtons({ includeOpenActivity = false } = {}) {
  if (!state.selectedTask) {
    return "";
  }

  const buttons = [];

  if (includeOpenActivity) {
    buttons.push(`
      <button class="button button--secondary" type="button" data-ui-action="open-activity">
        Open Activity
      </button>
    `);
  }

  if (state.selectedTask.status === "pending") {
    buttons.push(`
      <button
        class="button button--primary"
        type="button"
        data-task-action="start"
        ${state.action === "start" ? "disabled" : ""}
      >
        ${state.action === "start" ? "Queueing..." : "Start"}
      </button>
    `);
  }

  if (state.selectedTask.status === "suspended") {
    buttons.push(`
      <button
        class="button button--primary"
        type="button"
        data-task-action="resume"
        ${state.action === "resume" ? "disabled" : ""}
      >
        ${state.action === "resume" ? "Re-queueing..." : "Resume"}
      </button>
    `);
  }

  if (!["completed", "cancelled"].includes(state.selectedTask.status)) {
    buttons.push(`
      <button
        class="button button--danger"
        type="button"
        data-task-action="cancel"
        ${state.action === "cancel" ? "disabled" : ""}
      >
        ${state.action === "cancel" ? "Cancelling..." : "Cancel"}
      </button>
    `);
  }

  return buttons.join("");
}

function renderBudgetCards(task) {
  if (task.budgetConstraints.length > 0) {
    return task.budgetConstraints
      .map(
        (constraint) => `
          <article class="budget-card">
            <p class="budget-card__label">${escapeHtml(constraint.kind)}</p>
            <p class="budget-card__value">${escapeHtml(constraint.label)}</p>
            <p class="budget-card__hint" data-ok="${String(constraint.ok)}">
              ${escapeHtml(constraint.reason || "Within limits")}
            </p>
          </article>
        `,
      )
      .join("");
  }

  return `
    <article class="budget-card">
      <p class="budget-card__label">Constraints</p>
      <p class="budget-card__value">Using default policy</p>
      <p class="budget-card__hint" data-ok="true">No task-specific overrides were supplied.</p>
    </article>
  `;
}

function renderActivityDetail() {
  if (!elements.activityDetail) {
    return;
  }

  if (!state.selectedTask) {
    elements.activityDetail.innerHTML = "";
    return;
  }

  const task = state.selectedTask;
  const actionButtons = renderTaskActionButtons();
  const actionsMarkup = actionButtons
    ? `<div class="detail-actions activity-summary__actions">${actionButtons}</div>`
    : "";
  const sessionCopy = task.sessionKey
    ? `Session ${task.sessionKey}`
    : "A session key will appear after the worker launches the task.";

  elements.activityDetail.innerHTML = `
    <section class="activity-summary">
      <div class="activity-summary__header">
        <div class="activity-summary__copy">
          <p class="eyebrow">Task snapshot</p>
          <p class="muted-copy">${escapeHtml(sessionCopy)}</p>
        </div>
        ${actionsMarkup}
      </div>

      <section class="budget-grid">
        ${renderBudgetCards(task)}
        <article class="budget-card">
          <p class="budget-card__label">Run count</p>
          <p class="budget-card__value">${escapeHtml(String(task.runCount))}</p>
          <p class="budget-card__hint" data-ok="true">
            ${escapeHtml(formatCurrency(task.budgetUsage.costUsedUsd, true))} tracked spend
          </p>
        </article>
      </section>

      <section class="task-meta task-meta--dense">
        ${renderMetaRow("Task ID", task.id, true)}
        ${renderMetaRow("Source", task.sourceType)}
        ${renderMetaRow("Session", task.sessionKey || "Waiting for launch", Boolean(task.sessionKey))}
        ${renderMetaRow("Created", formatDateTime(task.createdAt))}
        ${renderMetaRow("Started", formatDateTime(task.startedAt))}
        ${renderMetaRow("Suspended", formatDateTime(task.suspendedAt))}
        ${renderMetaRow("Completed", formatDateTime(task.completedAt))}
        ${renderMetaRow("Loops used", String(task.budgetUsage.loopsUsed ?? 0))}
        ${renderMetaRow("Cost used", formatCurrency(task.budgetUsage.costUsedUsd, true))}
      </section>
    </section>
  `;
}

function renderActivityTaskList() {
  if (!elements.activityTaskList) {
    return;
  }

  if (state.tasks.length === 0) {
    elements.activityTaskList.innerHTML = renderEmptyState(
      "No tasks yet",
      "Queue a task first, then return here to inspect its event stream.",
      "open-overview",
    );
    return;
  }

  elements.activityTaskList.innerHTML = state.tasks
    .slice(0, 12)
    .map(
      (task) => `
        <button
          class="activity-task-button"
          type="button"
          data-task-id="${escapeHtml(task.id)}"
          data-selected="${String(state.selectedTaskId === task.id)}"
        >
          <div class="activity-task-button__topline">
            <h3 class="activity-task-button__title">${escapeHtml(task.title)}</h3>
            ${renderStatusPill(task.status)}
          </div>
          <p class="activity-task-button__meta">
            ${escapeHtml(truncate(task.progressSummary || task.resultSummary || formatDateTime(getTaskUpdatedAt(task)), 120))}
          </p>
        </button>
      `,
    )
    .join("");
}

function renderLogMetadata(metadata) {
  const entries = Object.entries(metadata ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return "";
  }

  const grid = entries
    .map(
      ([key, value]) => `
        <div class="detail-grid__item">
          <dt class="detail-grid__term">${escapeHtml(humanizeKey(key))}</dt>
          <dd class="detail-grid__value${shouldUseMono(value) ? " mono" : ""}">
            ${escapeHtml(formatMetadataValue(value))}
          </dd>
        </div>
      `,
    )
    .join("");

  if (entries.length <= 3 && entries.every(([, value]) => isSimpleMetadataValue(value))) {
    return `
      <div class="activity-event__details">
        <dl class="detail-grid">${grid}</dl>
      </div>
    `;
  }

  return `
    <details class="activity-event__disclosure">
      <summary>View ${escapeHtml(String(entries.length))} event fields</summary>
      <dl class="detail-grid">${grid}</dl>
    </details>
  `;
}

function renderActivityEvent(entry) {
  return `
    <article class="activity-event">
      <div class="activity-event__stamp">
        <time class="activity-event__timestamp">${escapeHtml(formatDateTime(entry.timestamp))}</time>
        <span class="activity-event__stamp-note">${escapeHtml(state.selectedTask?.id ?? "")}</span>
      </div>
      <div class="activity-event__body">
        <div class="activity-event__header">
          <span class="level-pill" data-level="${escapeHtml(normalizeLogLevel(entry.level))}">
            ${escapeHtml(entry.level)}
          </span>
        </div>
        <p class="activity-event__message">${escapeHtml(entry.message)}</p>
        ${renderLogMetadata(entry.metadata)}
      </div>
    </article>
  `;
}

function renderActivitySummaryCard(label, content, variant) {
  return `
    <article class="activity-event activity-event--summary" data-variant="${escapeHtml(variant)}">
      <div class="activity-event__stamp">
        <span class="activity-event__timestamp">${escapeHtml(label)}</span>
        <span class="activity-event__stamp-note">summary</span>
      </div>
      <div class="activity-event__body">
        <p class="activity-event__message">${escapeHtml(content)}</p>
      </div>
    </article>
  `;
}

function renderActivityStream() {
  if (
    !elements.activityStream ||
    !elements.activityTitle ||
    !elements.activitySubtitle ||
    !elements.activityPill
  ) {
    return;
  }

  if (!state.selectedTask) {
    elements.activityTitle.textContent = "Recent events";
    elements.activitySubtitle.textContent =
      "Select a task to inspect its details and event stream.";
    elements.activityPill.innerHTML = "";
    elements.activityStream.innerHTML = renderEmptyState(
      "No task selected",
      "Choose a task from the list to review its budget, metadata, and recent events.",
      state.tasks.length > 0 ? "open-tasks" : "open-overview",
    );
    return;
  }

  elements.activityTitle.textContent = truncate(state.selectedTask.title, 72);
  elements.activitySubtitle.textContent = state.selectedTask.sessionKey
    ? `Session ${state.selectedTask.sessionKey} · ${state.logs.length} event${state.logs.length === 1 ? "" : "s"} loaded.`
    : `${state.logs.length} event${state.logs.length === 1 ? "" : "s"} loaded.`;
  elements.activityPill.innerHTML = renderStatusPill(state.selectedTask.status);

  const highlights = [];
  if (state.selectedTask.progressSummary) {
    highlights.push(
      renderActivitySummaryCard("Current summary", state.selectedTask.progressSummary, "progress"),
    );
  }
  if (
    state.selectedTask.resultSummary &&
    state.selectedTask.resultSummary !== state.selectedTask.progressSummary
  ) {
    highlights.push(
      renderActivitySummaryCard("Result summary", state.selectedTask.resultSummary, "result"),
    );
  }

  const logStream =
    state.logs.length > 0
      ? state.logs.map(renderActivityEvent).join("")
      : renderEmptyState("No logs yet", "This task has not emitted recent log entries.");

  elements.activityStream.innerHTML = `
    ${highlights.length > 0 ? `<div class="activity-highlights">${highlights.join("")}</div>` : ""}
    <div class="activity-log-stream">${logStream}</div>
  `;
}

function formatConfigDisplayValue(value, field) {
  if (value === undefined || value === null || value === "") {
    return field.placeholder || "default path";
  }
  if (field.key === "defaultMaxCostUsd" && typeof value === "number") {
    return formatCurrency(value);
  }
  return String(value);
}

function renderConfigField(field, snapshot) {
  const savedValue = snapshot.values?.[field.key];
  const effectiveValue = snapshot.effectiveValues?.[field.key];
  const defaultValue = snapshot.defaults?.[field.key];
  const restartPending = snapshot.pendingRestartFields?.includes(field.key);

  const notes = [
    field.help,
    `Default: ${formatConfigDisplayValue(defaultValue, field)}`,
    field.restartRequired ? "Saved value applies after restart." : null,
    restartPending
      ? `Runtime still uses: ${formatConfigDisplayValue(effectiveValue, field)}`
      : null,
  ]
    .filter(Boolean)
    .map(
      (note) => `
        <p class="config-field__note">${escapeHtml(note)}</p>
      `,
    )
    .join("");

  const badge = field.restartRequired
    ? `<span class="config-field__badge">Restart</span>`
    : `<span class="config-field__badge config-field__badge--live">Live</span>`;

  const control =
    field.input === "select"
      ? `
          <select id="config-${field.key}" name="${field.key}">
            ${field.options
              .map(
                (option) => `
                  <option value="${escapeHtml(option)}" ${savedValue === option ? "selected" : ""}>
                    ${escapeHtml(option)}
                  </option>
                `,
              )
              .join("")}
          </select>
        `
      : `
          <input
            id="config-${field.key}"
            name="${field.key}"
            type="${field.input === "number" ? "number" : "text"}"
            ${
              field.input === "number"
                ? `min="${field.minimum}" max="${field.maximum}" step="${field.step}"`
                : ""
            }
            ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ""}
            value="${escapeHtml(savedValue ?? "")}"
          />
        `;

  return `
    <div class="config-field" data-pending-restart="${String(restartPending)}">
      <label class="field" for="config-${field.key}">
        <span class="field__label">
          ${escapeHtml(field.label)}
          ${badge}
        </span>
        ${control}
      </label>
      <div class="config-field__notes">
        ${notes}
      </div>
    </div>
  `;
}

function renderConfig() {
  if (!elements.configContent) {
    return;
  }

  if (state.configLoading && !state.config) {
    elements.configContent.innerHTML = renderEmptyState("Loading", "Fetching config.");
    return;
  }

  if (!state.config) {
    elements.configContent.innerHTML = renderEmptyState(
      "No config loaded",
      "Reload to fetch config.",
    );
    return;
  }

  const restartNotice =
    state.config.pendingRestartFields?.length > 0
      ? `
          <section class="surface-card surface-card--muted config-notice">
            <div class="surface-card__header">
              <h3>Pending restart</h3>
            </div>
            <p class="hint-copy">
              ${escapeHtml(state.config.pendingRestartFields.join(", "))} will apply next start.
            </p>
          </section>
        `
      : "";

  elements.configContent.innerHTML = `
    <form id="config-form" class="config-stack">
      ${restartNotice}
      ${state.config.fields.map((field) => renderConfigField(field, state.config)).join("")}
      <div class="form-actions">
        <button class="button button--primary" type="submit" ${state.configSaving ? "disabled" : ""}>
          ${state.configSaving ? "Saving..." : "Save Changes"}
        </button>
        <button class="button button--secondary" type="button" data-ui-action="reload-config">
          Reload
        </button>
      </div>
    </form>
  `;
}

function render() {
  updateControls();
  renderChrome();
  renderTabs();
  renderOverview();
  renderCompose();
  renderFilters();
  renderTaskList();
  renderActivityTaskList();
  renderActivityDetail();
  renderActivityStream();
  renderConfig();
}

async function loadTaskDetail(taskId, { silent = false } = {}) {
  if (!taskId) {
    state.selectedTask = null;
    state.logs = [];
    render();
    return;
  }

  try {
    const [taskPayload, logPayload] = await Promise.all([
      fetchJson(`/api/tasks/${encodeURIComponent(taskId)}`),
      fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/logs?limit=${DEFAULT_LOG_LIMIT}`),
    ]);

    state.selectedTaskId = taskId;
    state.selectedTask = taskPayload.task;
    state.logs = logPayload.logs ?? [];
    render();
  } catch (error) {
    if (!silent) {
      setBanner(error instanceof Error ? error.message : String(error), "error");
    }
  }
}

async function selectTask(taskId, { tab = null, silent = true } = {}) {
  if (!taskId) {
    return;
  }

  state.selectedTaskId = taskId;
  state.selectedTask = state.tasks.find((task) => task.id === taskId) ?? null;
  state.logs = [];
  if (tab) {
    setActiveTab(tab);
  }

  render();
  await loadTaskDetail(taskId, { silent });
}

async function loadDashboard({ silent = false } = {}) {
  if (state.refreshing) {
    return;
  }

  state.refreshing = true;
  updateControls();

  try {
    const [statsPayload, tasksPayload] = await Promise.all([
      fetchJson("/api/status"),
      fetchJson("/api/tasks"),
    ]);

    state.stats = statsPayload;
    state.tasks = tasksPayload.tasks ?? [];

    if (state.selectedTaskId && !state.tasks.some((task) => task.id === state.selectedTaskId)) {
      state.selectedTaskId = null;
      state.selectedTask = null;
      state.logs = [];
    }

    if (!state.selectedTaskId) {
      const visibleTasks = getVisibleTasks();
      state.selectedTaskId = pickDefaultTaskId(
        visibleTasks.length > 0 ? visibleTasks : state.tasks,
      );
    }

    if (state.selectedTaskId) {
      state.selectedTask =
        state.tasks.find((task) => task.id === state.selectedTaskId) ?? state.selectedTask;
    }

    render();

    if (state.selectedTaskId) {
      await loadTaskDetail(state.selectedTaskId, { silent: true });
    }

    if (!silent) {
      setBanner("Console refreshed.", "info");
    }
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.refreshing = false;
    updateControls();
  }
}

async function loadConfigSnapshot({ silent = false } = {}) {
  state.configLoading = true;
  render();

  try {
    state.config = await fetchJson("/api/config");
    if (!silent) {
      setBanner("Config reloaded.", "info");
    }
  } catch (error) {
    if (!silent) {
      setBanner(error instanceof Error ? error.message : String(error), "error");
    }
  } finally {
    state.configLoading = false;
    render();
  }
}

async function handleConfigSave(event) {
  event.preventDefault();

  if (!(event.target instanceof HTMLFormElement) || !state.config) {
    return;
  }

  const formData = new FormData(event.target);
  const payload = Object.fromEntries(
    state.config.fields.map((field) => [field.key, String(formData.get(field.key) ?? "")]),
  );

  state.configSaving = true;
  updateControls();

  try {
    state.config = await fetchJson("/api/config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await loadDashboard({ silent: true });
    setBanner(
      state.config.pendingRestartFields?.length > 0
        ? "Config saved. Some changes need restart."
        : "Config saved.",
      "success",
    );
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.configSaving = false;
    updateControls();
    render();
  }
}

function setPlannerState(plan) {
  state.planner = plan;
  if (plan) {
    state.plannerPromptDraft = plan.initialPrompt ?? state.plannerPromptDraft;
  }
  syncPlannerStorage(plan);
  render();
}

async function restorePlannerSession() {
  const planId = readStorageValue(PLANNER_PLAN_STORAGE_KEY);
  if (!planId) {
    return;
  }

  state.plannerLoading = true;
  render();

  try {
    const payload = await fetchJson(`/api/plan/${encodeURIComponent(planId)}`);
    setPlannerState(payload.plan ?? null);
  } catch (error) {
    setPlannerState(null);
    if (error instanceof Error && !error.message.includes("not found")) {
      setBanner(error.message, "error");
    }
  } finally {
    state.plannerLoading = false;
    render();
  }
}

function resetPlanner({ preservePrompt = true } = {}) {
  const nextPrompt = preservePrompt
    ? (state.planner?.initialPrompt ?? state.plannerPromptDraft)
    : "";
  state.planner = null;
  state.plannerLoading = false;
  state.plannerAction = null;
  state.plannerAnswerDraft = "";
  state.plannerPromptDraft = nextPrompt;
  syncPlannerStorage(null);
  render();
}

async function handlePlannerStart(event) {
  event.preventDefault();

  const prompt = state.plannerPromptDraft.trim();
  if (!prompt) {
    setBanner("Goal description is required.", "error");
    return;
  }

  state.plannerAction = "start";
  render();

  try {
    const result = await fetchJson("/api/plan/start", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    state.plannerAnswerDraft = "";
    setPlannerState(result.plan ?? null);
    if (result.plan?.status === "failed") {
      setBanner(result.plan.failureReason || "Planning failed to start.", "error");
    } else {
      setBanner("Planner session started.", "success");
    }
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.plannerAction = null;
    render();
  }
}

async function handlePlannerAnswer(event) {
  event.preventDefault();

  if (!state.planner?.id) {
    setBanner("No active planner session was found.", "error");
    return;
  }

  const answer = state.plannerAnswerDraft.trim();
  if (!answer) {
    setBanner("Planner answer is required.", "error");
    return;
  }

  state.plannerAction = "answer";
  render();

  try {
    const result = await fetchJson(`/api/plan/${encodeURIComponent(state.planner.id)}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
    state.plannerAnswerDraft = "";
    setPlannerState(result.plan ?? null);

    if (result.task?.id) {
      state.activeFilter = "all";
      setBanner(`Queued task ${result.task.id} from planner.`, "success");
      await loadDashboard({ silent: true });
      await selectTask(result.task.id, { tab: "tasks", silent: true });
      return;
    }

    setBanner(result.plan?.failureReason || "Planning failed.", "error");
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.plannerAction = null;
    render();
  }
}

async function handlePlannerCancel() {
  if (!state.planner?.id) {
    return;
  }

  state.plannerAction = "cancel";
  render();

  try {
    const result = await fetchJson(`/api/plan/${encodeURIComponent(state.planner.id)}/cancel`, {
      method: "POST",
    });
    setPlannerState(result.plan ?? null);
    setBanner("Planner session cancelled.", "success");
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.plannerAction = null;
    render();
  }
}

async function handleCreate(event) {
  event.preventDefault();
  if (!(event.target instanceof HTMLFormElement)) {
    return;
  }

  const title = state.createTitleDraft.trim();
  if (!title) {
    setBanner("Task prompt is required.", "error");
    return;
  }

  const payload = { title };
  if (state.createMaxLoopsDraft.trim()) {
    payload.maxLoops = Number(state.createMaxLoopsDraft);
  }
  if (state.createMaxCostDraft.trim()) {
    payload.maxCostUsd = Number(state.createMaxCostDraft);
  }

  state.action = "create";
  updateControls();

  try {
    const result = await fetchJson("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.createTitleDraft = "";
    state.createMaxLoopsDraft = "";
    state.createMaxCostDraft = "";
    state.selectedTaskId = result.task.id;
    state.activeFilter = "all";
    setActiveTab("tasks");
    setBanner(`Queued task ${result.task.id}.`, "success");
    await loadDashboard({ silent: true });
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.action = null;
    updateControls();
  }
}

async function handleDetailAction(action) {
  if (!state.selectedTaskId) {
    return;
  }

  state.action = action;
  render();

  try {
    const result = await fetchJson(
      `/api/tasks/${encodeURIComponent(state.selectedTaskId)}/${action}`,
      {
        method: "POST",
      },
    );

    state.selectedTaskId = result.task.id;
    const message =
      action === "resume"
        ? "Task re-queued."
        : action === "start"
          ? "Pending task moved into the queue."
          : "Task cancelled.";
    setBanner(message, "success");
    await loadDashboard({ silent: true });
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.action = null;
    render();
  }
}

async function handleUiAction(action) {
  switch (action) {
    case "cancel-planner":
      await handlePlannerCancel();
      return;
    case "open-activity": {
      if (!state.selectedTaskId && state.tasks.length > 0) {
        const taskId = pickDefaultTaskId(state.tasks);
        if (taskId) {
          void selectTask(taskId, { tab: "activity", silent: true });
          return;
        }
      }
      setActiveTab("activity");
      return;
    }
    case "open-create":
      setComposeMode("direct");
      setActiveTab("compose");
      return;
    case "open-overview":
      setActiveTab("overview");
      return;
    case "open-planner":
      setComposeMode("plan");
      setActiveTab("compose");
      return;
    case "open-config":
      setActiveTab("config");
      return;
    case "reload-config":
      await loadConfigSnapshot();
      return;
    case "open-created-task":
      if (state.planner?.createdTaskId) {
        state.activeFilter = "all";
        await selectTask(state.planner.createdTaskId, { tab: "tasks", silent: true });
      }
      return;
    case "reset-planner":
      resetPlanner();
      setComposeMode("plan");
      setActiveTab("compose");
      return;
    case "open-tasks":
      setActiveTab("tasks");
      return;
    default:
      return;
  }
}

function registerEvents() {
  elements.refreshButton?.addEventListener("click", () => {
    void loadDashboard();
  });

  elements.sidebarToggle?.addEventListener("click", () => {
    toggleSidebar();
  });

  elements.sidebarOverlay?.addEventListener("click", () => {
    state.sidebarOpen = false;
    renderChrome();
  });

  document.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement)) {
      return;
    }

    if (event.target.id === "create-form") {
      void handleCreate(event);
      return;
    }
    if (event.target.id === "planner-start-form") {
      void handlePlannerStart(event);
      return;
    }
    if (event.target.id === "planner-answer-form") {
      void handlePlannerAnswer(event);
      return;
    }
    if (event.target.id === "config-form") {
      void handleConfigSave(event);
    }
  });

  document.addEventListener("input", (event) => {
    if (
      !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    ) {
      return;
    }

    if (event.target.id === "task-title") {
      state.createTitleDraft = event.target.value;
      return;
    }

    if (event.target.id === "max-loops") {
      state.createMaxLoopsDraft = event.target.value;
      return;
    }

    if (event.target.id === "max-cost") {
      state.createMaxCostDraft = event.target.value;
      return;
    }

    if (event.target.id === "planner-prompt") {
      state.plannerPromptDraft = event.target.value;
      return;
    }

    if (event.target.id === "planner-answer") {
      state.plannerAnswerDraft = event.target.value;
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const tabButton = event.target.closest("[data-tab]");
    if (tabButton?.dataset.tab) {
      setActiveTab(tabButton.dataset.tab);
      return;
    }

    const modeButton = event.target.closest("[data-compose-mode]");
    if (modeButton?.dataset.composeMode) {
      setComposeMode(modeButton.dataset.composeMode);
      return;
    }

    const button = event.target.closest("[data-filter]");
    if (button) {
      state.activeFilter = button.dataset.filter ?? "all";
      const visibleTasks = getVisibleTasks();
      if (visibleTasks.length === 0) {
        state.selectedTaskId = null;
        state.selectedTask = null;
        state.logs = [];
        render();
        return;
      }

      if (!visibleTasks.some((task) => task.id === state.selectedTaskId)) {
        void selectTask(visibleTasks[0].id, { silent: true });
        return;
      }

      render();
      return;
    }

    const taskButton = event.target.closest("[data-task-id]");
    if (taskButton?.dataset.taskId) {
      void selectTask(taskButton.dataset.taskId, {
        tab: taskButton.dataset.openTab ?? null,
        silent: true,
      });
      return;
    }

    const uiButton = event.target.closest("[data-ui-action]");
    if (uiButton?.dataset.uiAction) {
      void handleUiAction(uiButton.dataset.uiAction);
      return;
    }

    const taskActionButton = event.target.closest("[data-task-action]");
    if (taskActionButton?.dataset.taskAction) {
      void handleDetailAction(taskActionButton.dataset.taskAction);
    }
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport()) {
      state.sidebarOpen = false;
    }
    renderChrome();
  });
}

function startPolling() {
  window.setInterval(() => {
    void loadDashboard({ silent: true });
  }, REFRESH_INTERVAL_MS);
}

registerEvents();
render();
void Promise.all([loadDashboard({ silent: true }), restorePlannerSession()]);
startPolling();
