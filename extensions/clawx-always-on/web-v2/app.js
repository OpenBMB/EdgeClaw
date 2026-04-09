const ROUTE_BASE = "/plugins/clawx-always-on";
const REFRESH_INTERVAL_MS = 5000;
const DEFAULT_LOG_LIMIT = 80;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "clawx-always-on.sidebar-collapsed";
const PLANNER_PLAN_STORAGE_KEY = "clawx-always-on.planner-plan-id";
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
const TAB_ORDER = ["overview", "create", "planner", "tasks", "activity"];
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
  sidebarCollapsed: readStorageValue(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true",
  sidebarOpen: false,
  planner: null,
  plannerLoading: false,
  plannerAction: null,
  plannerPromptDraft: "",
  plannerAnswerDraft: "",
};

const elements = {
  createForm: document.querySelector("#create-form"),
  titleInput: document.querySelector("#task-title"),
  loopsInput: document.querySelector("#max-loops"),
  costInput: document.querySelector("#max-cost"),
  refreshButton: document.querySelector("#refresh-button"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarNav: document.querySelector("#sidebar-nav"),
  sidebarOverlay: document.querySelector("#sidebar-overlay"),
  topbarSummary: document.querySelector("#topbar-summary"),
  appFrame: document.querySelector(".app-frame"),
  overviewSummary: document.querySelector("#overview-summary"),
  overviewRunning: document.querySelector("#overview-running"),
  overviewQueue: document.querySelector("#overview-queue"),
  filterStrip: document.querySelector("#filter-strip"),
  taskList: document.querySelector("#task-list"),
  detailActions: document.querySelector("#detail-actions"),
  taskDetail: document.querySelector("#task-detail"),
  activityTaskList: document.querySelector("#activity-task-list"),
  activityTitle: document.querySelector("#activity-title"),
  activitySubtitle: document.querySelector("#activity-subtitle"),
  activityPill: document.querySelector("#activity-pill"),
  activityStream: document.querySelector("#activity-stream"),
  statusBanner: document.querySelector("#status-banner"),
  plannerToolbar: document.querySelector("#planner-toolbar"),
  plannerContent: document.querySelector("#planner-content"),
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
  for (const status of ["active", "launching", "queued", "suspended"]) {
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
  elements.sidebarOverlay.hidden = !(mobile && state.sidebarOpen);
  document.body.classList.toggle("body--locked", mobile && state.sidebarOpen);

  elements.sidebarToggle.setAttribute(
    "aria-expanded",
    String(mobile ? state.sidebarOpen : !state.sidebarCollapsed),
  );
  elements.sidebarToggle.textContent = mobile
    ? state.sidebarOpen
      ? "Close Navigation"
      : "Open Navigation"
    : state.sidebarCollapsed
      ? "Expand Navigation"
      : "Collapse Navigation";
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
    elements.refreshButton.textContent = state.refreshing ? "Refreshing..." : "Refresh";
  }

  if (elements.createForm) {
    const disabled = state.action === "create";
    for (const field of Array.from(elements.createForm.elements)) {
      field.disabled = disabled;
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

function renderTextBlock(text) {
  return `
    <div class="text-block">
      ${escapeHtml(text || "").replaceAll("\n", "<br />")}
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

function renderTopbarSummary() {
  if (!elements.topbarSummary) {
    return;
  }

  if (!state.stats) {
    elements.topbarSummary.innerHTML = `
      <span class="topbar__metric"><strong>&ndash;</strong>loading</span>
    `;
    return;
  }

  const activeCount = state.tasks.filter((task) => ACTIVE_TASK_STATUSES.has(task.status)).length;
  const metrics = [
    { value: activeCount, label: "active" },
    { value: state.stats.countsByStatus?.queued ?? 0, label: "queued" },
    { value: state.stats.maxConcurrentTasks ?? 0, label: "slots" },
  ];

  elements.topbarSummary.innerHTML = metrics
    .map(
      (metric) => `
        <span class="topbar__metric">
          <strong>${escapeHtml(String(metric.value))}</strong>
          ${escapeHtml(metric.label)}
        </span>
      `,
    )
    .join("");
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
        <h3 class="signal-card__title">No task is holding a worker slot.</h3>
        <p class="signal-card__meta">Queued work will appear here once the worker launches or resumes it.</p>
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
      "Waiting for a worker slot or the next scheduler handoff.",
      state.tasks.filter((task) => task.status === "queued").slice(0, 4),
    ),
    renderQueueSection(
      "Needs review",
      "Suspended or failed tasks that likely need resume or investigation.",
      state.tasks.filter((task) => REVIEW_TASK_STATUSES.has(task.status)).slice(0, 4),
    ),
    renderQueueSection(
      "Recently closed",
      "Completed or cancelled work from the latest task activity.",
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

function renderPlannerToolbar() {
  if (!elements.plannerToolbar) {
    return;
  }

  if (state.plannerLoading && !state.planner) {
    elements.plannerToolbar.innerHTML = `
      <span class="planner-toolbar__note">Loading...</span>
    `;
    return;
  }

  if (!state.planner) {
    elements.plannerToolbar.innerHTML = "";
    return;
  }

  const buttons = [renderStatusPill(state.planner.status)];

  if (state.planner.status === "active") {
    buttons.push(`
      <button
        class="button button--secondary"
        type="button"
        data-ui-action="cancel-planner"
        ${state.plannerAction === "cancel" ? "disabled" : ""}
      >
        ${state.plannerAction === "cancel" ? "Cancelling..." : "Cancel Planning"}
      </button>
    `);
  } else {
    buttons.push(`
      <button class="button button--secondary" type="button" data-ui-action="reset-planner">
        Start Another Plan
      </button>
    `);
  }

  elements.plannerToolbar.innerHTML = `
    <div class="planner-toolbar__group">
      ${buttons.join("")}
    </div>
  `;
}

function renderPlanner() {
  if (!elements.plannerContent) {
    return;
  }

  const plan = state.planner;
  const plannerBusy = Boolean(state.plannerLoading || state.plannerAction);

  if (state.plannerLoading && !plan) {
    elements.plannerContent.innerHTML = `
      <div class="planner-stack">
        <section class="surface-card">
          <div class="surface-card__header">
            <h3>Restoring planner session</h3>
          </div>
          <p class="hint-copy">Loading your last planner state from the dashboard session.</p>
        </section>
      </div>
    `;
    return;
  }

  if (!plan) {
    elements.plannerContent.innerHTML = `
      <div class="planner-stack">
        <section class="surface-card">
          <div class="surface-card__header">
            <h3>Start a planning session</h3>
          </div>
          <p class="hint-copy">
            Describe the outcome you want. The planner will ask a short clarification round before it
            creates the background task.
          </p>
          <form id="planner-start-form" class="form-stack planner-form">
            <label class="field">
              <span class="field__label">Goal description</span>
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
      </div>
    `;
    return;
  }

  const transcript = `
    <section class="surface-card">
      <div class="surface-card__header">
        <h3>Planner transcript</h3>
      </div>
      <div class="planner-turns">
        ${plan.turns.map(renderPlannerTurn).join("")}
      </div>
    </section>
  `;

  if (plan.status === "active") {
    const defaultPlan = plan.defaultPlan
      ? `
          <section class="surface-card surface-card--muted">
            <div class="surface-card__header">
              <h3>Default plan preview</h3>
            </div>
            <p class="planner-preview__title">${escapeHtml(plan.defaultPlan.taskTitle)}</p>
            <p class="hint-copy">${escapeHtml(plan.defaultPlan.taskPrompt)}</p>
          </section>
        `
      : "";

    elements.plannerContent.innerHTML = `
      <div class="planner-stack">
        ${transcript}
        ${defaultPlan}
        <section class="surface-card">
          <div class="surface-card__header">
            <h3>Answer the clarification round</h3>
          </div>
          <p class="hint-copy">
            Reply with option letters, plain language, or a mix of both. The final task will be created
            from your answer.
          </p>
          ${renderPlannerQuestions(plan.pendingQuestions)}
          <form id="planner-answer-form" class="form-stack planner-form">
            <label class="field">
              <span class="field__label">Your answer</span>
              <textarea
                id="planner-answer"
                rows="4"
                placeholder="Example: A for the first question, B for the second, and please focus on public web sources."
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
      </div>
    `;
    return;
  }

  if (plan.status === "completed") {
    elements.plannerContent.innerHTML = `
      <div class="planner-stack">
        <section class="surface-card planner-result-card" data-status="completed">
          <div class="surface-card__header">
            <h3>Task queued from planner</h3>
            ${renderStatusPill("completed")}
          </div>
          <p class="hint-copy">
            Task <span class="mono">${escapeHtml(plan.createdTaskId ?? "")}</span> was created and queued
            for background execution.
          </p>
          <div class="planner-result-actions">
            <button class="button button--primary" type="button" data-ui-action="open-created-task">
              Open in Tasks
            </button>
            <button class="button button--secondary" type="button" data-ui-action="reset-planner">
              Start Another Plan
            </button>
          </div>
        </section>
        ${transcript}
      </div>
    `;
    return;
  }

  if (plan.status === "cancelled") {
    elements.plannerContent.innerHTML = `
      <div class="planner-stack">
        <section class="surface-card planner-result-card" data-status="cancelled">
          <div class="surface-card__header">
            <h3>Planning session cancelled</h3>
            ${renderStatusPill("cancelled")}
          </div>
          <p class="hint-copy">
            The current planner session was cancelled before task creation. Start a new plan whenever
            you are ready.
          </p>
          <div class="planner-result-actions">
            <button class="button button--secondary" type="button" data-ui-action="reset-planner">
              Start Another Plan
            </button>
          </div>
        </section>
        ${transcript}
      </div>
    `;
    return;
  }

  elements.plannerContent.innerHTML = `
    <div class="planner-stack">
      <section class="surface-card planner-result-card" data-status="failed">
        <div class="surface-card__header">
          <h3>Planning session failed</h3>
          ${renderStatusPill("failed")}
        </div>
        <p class="hint-copy">${escapeHtml(plan.failureReason || "The planner did not complete successfully.")}</p>
        <div class="planner-result-actions">
          <button class="button button--secondary" type="button" data-ui-action="reset-planner">
            Start Another Plan
          </button>
        </div>
      </section>
      ${transcript}
    </div>
  `;
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

      return `
        <button
          class="task-card"
          type="button"
          data-task-id="${escapeHtml(task.id)}"
          data-selected="${String(state.selectedTaskId === task.id)}"
        >
          <div class="task-card__header">
            <div class="task-card__topline">
              <h3 class="task-card__title">${escapeHtml(task.title)}</h3>
              ${renderStatusPill(task.status)}
            </div>
            <p class="task-card__summary">${escapeHtml(summary)}</p>
          </div>
          <div class="task-meta">
            ${renderMetaRow("Task ID", task.id, true)}
            ${renderMetaRow(
              "Budget",
              `${loopBudget?.label ?? "No loop cap"} \u00b7 ${costBudget?.label ?? "No cost cap"}`,
            )}
            ${renderMetaRow("Updated", formatDateTime(getTaskUpdatedAt(task)))}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderDetailActions() {
  if (!elements.detailActions) {
    return;
  }

  if (!state.selectedTask) {
    elements.detailActions.innerHTML = "";
    return;
  }

  const buttons = [
    `
      <button class="button button--secondary" type="button" data-ui-action="open-activity">
        Open Activity
      </button>
    `,
  ];

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

  elements.detailActions.innerHTML = buttons.join("");
}

function renderTextSection(title, content) {
  return `
    <section class="surface-card">
      <div class="surface-card__header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${renderTextBlock(content)}
    </section>
  `;
}

function renderTaskDetail() {
  if (!elements.taskDetail) {
    return;
  }

  if (!state.selectedTask) {
    elements.taskDetail.innerHTML = renderEmptyState(
      "Select a task",
      "Pick any task from the browser to inspect its budgets, checkpoints, and current state.",
    );
    renderDetailActions();
    return;
  }

  const task = state.selectedTask;
  const budgetCards =
    task.budgetConstraints.length > 0
      ? task.budgetConstraints
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
          .join("")
      : `
          <article class="budget-card">
            <p class="budget-card__label">Constraints</p>
            <p class="budget-card__value">Using default policy</p>
            <p class="budget-card__hint" data-ok="true">No task-specific overrides were supplied.</p>
          </article>
        `;

  const summaryText =
    task.progressSummary ||
    task.resultSummary ||
    "No narrative summary is available yet. Use the Activity tab for lifecycle events and logs.";
  const progressSection = task.progressSummary
    ? renderTextSection("Latest progress", task.progressSummary)
    : "";
  const resultSection =
    task.resultSummary && task.resultSummary !== task.progressSummary
      ? renderTextSection("Result summary", task.resultSummary)
      : "";

  elements.taskDetail.innerHTML = `
    <section class="detail-header">
      <div class="task-card__topline">
        <h3 class="detail-header__title">${escapeHtml(task.title)}</h3>
        ${renderStatusPill(task.status)}
      </div>
      <p class="muted-copy">
        ${escapeHtml(
          task.sessionKey
            ? `Session ${task.sessionKey}`
            : "A session key will appear after the worker launches the task.",
        )}
      </p>
    </section>

    <section class="detail-callout">
      <p>Detailed lifecycle logs and metadata are separated into the Activity tab.</p>
      <button class="button button--secondary" type="button" data-ui-action="open-activity">
        Open Activity
      </button>
    </section>

    <section class="budget-grid">
      ${budgetCards}
      <article class="budget-card">
        <p class="budget-card__label">Run count</p>
        <p class="budget-card__value">${escapeHtml(String(task.runCount))}</p>
        <p class="budget-card__hint" data-ok="true">
          ${escapeHtml(formatCurrency(task.budgetUsage.costUsedUsd, true))} tracked spend
        </p>
      </article>
    </section>

    ${renderTextSection("Current summary", summaryText)}
    ${progressSection}
    ${resultSection}

    <section class="task-meta">
      ${renderMetaRow("Task ID", task.id, true)}
      ${renderMetaRow("Source", task.sourceType)}
      ${renderMetaRow("Created", formatDateTime(task.createdAt))}
      ${renderMetaRow("Started", formatDateTime(task.startedAt))}
      ${renderMetaRow("Suspended", formatDateTime(task.suspendedAt))}
      ${renderMetaRow("Completed", formatDateTime(task.completedAt))}
      ${renderMetaRow("Loops used", String(task.budgetUsage.loopsUsed ?? 0))}
      ${renderMetaRow("Cost used", formatCurrency(task.budgetUsage.costUsedUsd, true))}
    </section>
  `;

  renderDetailActions();
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
    elements.activitySubtitle.textContent = "Select a task to inspect its background event stream.";
    elements.activityPill.innerHTML = "";
    elements.activityStream.innerHTML = renderEmptyState(
      "No task selected",
      "Choose a task from the left rail or open one from the task browser to inspect its logs.",
      state.tasks.length > 0 ? "open-tasks" : "open-overview",
    );
    return;
  }

  elements.activityTitle.textContent = truncate(state.selectedTask.title, 72);
  elements.activitySubtitle.textContent = `${state.logs.length} recent event${state.logs.length === 1 ? "" : "s"} loaded for task ${state.selectedTask.id}.`;
  elements.activityPill.innerHTML = renderStatusPill(state.selectedTask.status);

  if (state.logs.length === 0) {
    elements.activityStream.innerHTML = renderEmptyState(
      "No activity yet",
      "This task has not emitted any recent log entries. Check back after the worker reports progress.",
    );
    return;
  }

  elements.activityStream.innerHTML = state.logs.map(renderActivityEvent).join("");
}

function render() {
  updateControls();
  renderChrome();
  renderTabs();
  renderTopbarSummary();
  renderOverview();
  renderPlannerToolbar();
  renderPlanner();
  renderFilters();
  renderTaskList();
  renderTaskDetail();
  renderActivityTaskList();
  renderActivityStream();
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
  if (!elements.titleInput || !elements.loopsInput || !elements.costInput || !elements.createForm) {
    return;
  }

  const title = elements.titleInput.value.trim();
  if (!title) {
    setBanner("Task prompt is required.", "error");
    return;
  }

  const payload = { title };
  if (elements.loopsInput.value.trim()) {
    payload.maxLoops = Number(elements.loopsInput.value);
  }
  if (elements.costInput.value.trim()) {
    payload.maxCostUsd = Number(elements.costInput.value);
  }

  state.action = "create";
  updateControls();

  try {
    const result = await fetchJson("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    elements.createForm.reset();
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
  renderDetailActions();

  try {
    const result = await fetchJson(
      `/api/tasks/${encodeURIComponent(state.selectedTaskId)}/${action}`,
      {
        method: "POST",
      },
    );

    state.selectedTaskId = result.task.id;
    setBanner(action === "resume" ? "Task re-queued." : "Task cancelled.", "success");
    await loadDashboard({ silent: true });
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), "error");
  } finally {
    state.action = null;
    renderDetailActions();
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
      setActiveTab("create");
      return;
    case "open-overview":
      setActiveTab("overview");
      return;
    case "open-planner":
      setActiveTab("planner");
      return;
    case "open-created-task":
      if (state.planner?.createdTaskId) {
        state.activeFilter = "all";
        await selectTask(state.planner.createdTaskId, { tab: "tasks", silent: true });
      }
      return;
    case "reset-planner":
      resetPlanner();
      setActiveTab("planner");
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
    }
  });

  document.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) {
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
