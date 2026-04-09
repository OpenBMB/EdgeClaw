const ROUTE_BASE = "/plugins/clawx-always-on";
const REFRESH_INTERVAL_MS = 5000;
const DEFAULT_LOG_LIMIT = 80;
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
const TAB_ORDER = ["overview", "tasks", "activity"];
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
};

const elements = {
  createForm: document.querySelector("#create-form"),
  titleInput: document.querySelector("#task-title"),
  loopsInput: document.querySelector("#max-loops"),
  costInput: document.querySelector("#max-cost"),
  refreshButton: document.querySelector("#refresh-button"),
  topbarSummary: document.querySelector("#topbar-summary"),
  tabNav: document.querySelector("#tab-nav"),
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

function setBanner(message, variant = "info") {
  if (!elements.statusBanner) {
    return;
  }

  if (!message) {
    elements.statusBanner.hidden = true;
    elements.statusBanner.textContent = "";
    delete elements.statusBanner.dataset.variant;
    return;
  }

  elements.statusBanner.hidden = false;
  elements.statusBanner.dataset.variant = variant;
  elements.statusBanner.textContent = message;
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
  renderTabs();
}

function renderTabs() {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const isActive = button.dataset.tab === state.activeTab;
    button.setAttribute("aria-selected", String(isActive));
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
  renderTabs();
  renderTopbarSummary();
  renderOverview();
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

function handleUiAction(action) {
  switch (action) {
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
    case "open-overview":
      setActiveTab("overview");
      return;
    case "open-tasks":
      setActiveTab("tasks");
      return;
    default:
      return;
  }
}

function registerEvents() {
  elements.createForm?.addEventListener("submit", (event) => {
    void handleCreate(event);
  });

  elements.refreshButton?.addEventListener("click", () => {
    void loadDashboard();
  });

  elements.tabNav?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-tab]");
    if (!button) {
      return;
    }

    const tab = button.dataset.tab;
    if (!tab) {
      return;
    }

    setActiveTab(tab);
  });

  elements.filterStrip?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

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
  });

  for (const container of [
    elements.taskList,
    elements.overviewQueue,
    elements.overviewRunning,
    elements.activityTaskList,
  ]) {
    container?.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest("[data-task-id]");
      if (!button) {
        return;
      }

      const taskId = button.dataset.taskId;
      if (!taskId) {
        return;
      }

      void selectTask(taskId, { tab: button.dataset.openTab ?? null, silent: true });
    });
  }

  for (const container of [elements.detailActions, elements.taskDetail, elements.activityStream]) {
    container?.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const uiButton = event.target.closest("[data-ui-action]");
      if (uiButton?.dataset.uiAction) {
        handleUiAction(uiButton.dataset.uiAction);
        return;
      }

      const taskButton = event.target.closest("[data-task-action]");
      if (taskButton?.dataset.taskAction) {
        void handleDetailAction(taskButton.dataset.taskAction);
      }
    });
  }
}

function startPolling() {
  window.setInterval(() => {
    void loadDashboard({ silent: true });
  }, REFRESH_INTERVAL_MS);
}

registerEvents();
render();
void loadDashboard({ silent: true });
startPolling();
