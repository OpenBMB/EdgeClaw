const ROUTE_BASE = "/plugins/clawx-always-on";
const REFRESH_INTERVAL_MS = 5000;
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
  refreshing: false,
  action: null,
};

const elements = {
  createForm: document.querySelector("#create-form"),
  titleInput: document.querySelector("#task-title"),
  loopsInput: document.querySelector("#max-loops"),
  costInput: document.querySelector("#max-cost"),
  refreshButton: document.querySelector("#refresh-button"),
  statGrid: document.querySelector("#stat-grid"),
  filterStrip: document.querySelector("#filter-strip"),
  taskList: document.querySelector("#task-list"),
  detailActions: document.querySelector("#detail-actions"),
  taskDetail: document.querySelector("#task-detail"),
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

function renderStats() {
  if (!elements.statGrid) {
    return;
  }

  if (!state.stats) {
    elements.statGrid.innerHTML = `
      <article class="stat-card">
        <p class="stat-card__label">Loading</p>
        <p class="stat-card__value">-</p>
        <p class="stat-card__meta">Connecting to the always-on dashboard.</p>
      </article>
    `;
    return;
  }

  const runningCount = state.stats.runningTasks?.length ?? 0;
  const queuedCount = state.stats.countsByStatus?.queued ?? 0;
  const suspendedCount = state.stats.countsByStatus?.suspended ?? 0;

  const cards = [
    {
      label: "Total tasks",
      value: state.stats.totalTasks,
      meta: `${queuedCount} queued, ${suspendedCount} suspended`,
    },
    {
      label: "Running now",
      value: runningCount,
      meta: `${state.stats.maxConcurrentTasks} concurrent slots available`,
    },
    {
      label: "Default loops",
      value: state.stats.defaultMaxLoops,
      meta: "Per task run budget",
    },
    {
      label: "Default spend",
      value: formatCurrency(state.stats.defaultMaxCostUsd),
      meta: `${state.stats.logRetentionDays} day log retention`,
    },
  ];

  elements.statGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <p class="stat-card__label">${escapeHtml(card.label)}</p>
          <p class="stat-card__value">${escapeHtml(card.value)}</p>
          <p class="stat-card__meta">${escapeHtml(card.meta)}</p>
        </article>
      `,
    )
    .join("");
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
    elements.taskList.innerHTML = `
      <div class="empty-state">
        <div>
          <h4 class="empty-state__title">No tasks in this view</h4>
          <p class="empty-state__copy">
            Queue a new background task or switch filters to inspect another status bucket.
          </p>
        </div>
      </div>
    `;
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
              <h4 class="task-card__title">${escapeHtml(task.title)}</h4>
              <span class="status-pill" data-status="${escapeHtml(task.status)}">
                ${escapeHtml(STATUS_LABELS[task.status] ?? task.status)}
              </span>
            </div>
            <p class="task-card__summary">${escapeHtml(summary)}</p>
          </div>
          <div class="task-meta">
            <div class="task-meta__row">
              <span class="task-meta__label">Task ID</span>
              <p class="task-meta__value">${escapeHtml(task.id)}</p>
            </div>
            <div class="task-meta__row">
              <span class="task-meta__label">Budget</span>
              <p class="task-meta__value">
                ${escapeHtml(loopBudget?.label ?? "No loop cap")} | ${escapeHtml(costBudget?.label ?? "No cost cap")}
              </p>
            </div>
            <div class="task-meta__row">
              <span class="task-meta__label">Updated</span>
              <p class="task-meta__value">${escapeHtml(formatDateTime(task.completedAt || task.startedAt || task.createdAt))}</p>
            </div>
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

  const buttons = [];
  if (state.selectedTask.status === "suspended") {
    buttons.push(`
      <button
        class="button button--primary"
        type="button"
        data-action="resume"
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
        data-action="cancel"
        ${state.action === "cancel" ? "disabled" : ""}
      >
        ${state.action === "cancel" ? "Cancelling..." : "Cancel"}
      </button>
    `);
  }

  elements.detailActions.innerHTML = buttons.join("");
}

function renderDetail() {
  if (!elements.taskDetail) {
    return;
  }

  if (!state.selectedTask) {
    elements.taskDetail.innerHTML = `
      <div class="empty-state">
        <div>
          <h4 class="empty-state__title">Select a task</h4>
          <p class="empty-state__copy">
            Pick any task from the browser to inspect its budget usage, progress summary, and logs.
          </p>
        </div>
      </div>
    `;
    renderDetailActions();
    return;
  }

  const progressSection = state.selectedTask.progressSummary
    ? `
        <section class="surface-card">
          <h4>Latest progress</h4>
          <pre>${escapeHtml(state.selectedTask.progressSummary)}</pre>
        </section>
      `
    : "";

  const resultSection = state.selectedTask.resultSummary
    ? `
        <section class="surface-card">
          <h4>Result summary</h4>
          <pre>${escapeHtml(state.selectedTask.resultSummary)}</pre>
        </section>
      `
    : "";

  const logsSection =
    state.logs.length > 0
      ? state.logs
          .map((entry) => {
            const metadata =
              entry.metadata && Object.keys(entry.metadata).length > 0
                ? `<pre>${escapeHtml(JSON.stringify(entry.metadata, null, 2))}</pre>`
                : "";
            return `
              <article class="log-entry">
                <div class="log-entry__meta">
                  <span>${escapeHtml(formatDateTime(entry.timestamp))}</span>
                  <span class="log-entry__level">${escapeHtml(entry.level)}</span>
                </div>
                <p class="log-entry__message">${escapeHtml(entry.message)}</p>
                ${metadata}
              </article>
            `;
          })
          .join("")
      : `
          <div class="empty-state">
            <div>
              <h4 class="empty-state__title">No logs yet</h4>
              <p class="empty-state__copy">
                Logs will appear here after the worker or lifecycle hooks write new entries.
              </p>
            </div>
          </div>
        `;

  elements.taskDetail.innerHTML = `
    <section class="detail-header">
      <div class="task-card__topline">
        <h3 class="detail-header__title">${escapeHtml(state.selectedTask.title)}</h3>
        <span class="status-pill" data-status="${escapeHtml(state.selectedTask.status)}">
          ${escapeHtml(STATUS_LABELS[state.selectedTask.status] ?? state.selectedTask.status)}
        </span>
      </div>
      <p class="muted-copy">
        ${escapeHtml(
          state.selectedTask.sessionKey
            ? `Session ${state.selectedTask.sessionKey}`
            : "Session key will appear after the worker launches the task.",
        )}
      </p>
    </section>

    <section class="budget-grid">
      ${state.selectedTask.budgetConstraints
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
        .join("")}
      <article class="budget-card">
        <p class="budget-card__label">Run count</p>
        <p class="budget-card__value">${escapeHtml(String(state.selectedTask.runCount))}</p>
        <p class="budget-card__hint" data-ok="true">
          ${escapeHtml(formatCurrency(state.selectedTask.budgetUsage.costUsedUsd, true))} total spend tracked
        </p>
      </article>
    </section>

    <section class="task-meta">
      ${renderMetaRow("Task ID", state.selectedTask.id)}
      ${renderMetaRow("Source", state.selectedTask.sourceType)}
      ${renderMetaRow("Created", formatDateTime(state.selectedTask.createdAt))}
      ${renderMetaRow("Started", formatDateTime(state.selectedTask.startedAt))}
      ${renderMetaRow("Suspended", formatDateTime(state.selectedTask.suspendedAt))}
      ${renderMetaRow("Completed", formatDateTime(state.selectedTask.completedAt))}
      ${renderMetaRow("Loops used", String(state.selectedTask.budgetUsage.loopsUsed ?? 0))}
      ${renderMetaRow("Cost used", formatCurrency(state.selectedTask.budgetUsage.costUsedUsd, true))}
    </section>

    ${progressSection}
    ${resultSection}

    <section class="surface-card">
      <h4>Recent logs</h4>
      <div class="log-list">${logsSection}</div>
    </section>
  `;

  renderDetailActions();
}

function renderMetaRow(label, value) {
  return `
    <div class="task-meta__row">
      <span class="task-meta__label">${escapeHtml(label)}</span>
      <p class="task-meta__value">${escapeHtml(value)}</p>
    </div>
  `;
}

async function loadTaskDetail(taskId, { silent = false } = {}) {
  if (!taskId) {
    state.selectedTask = null;
    state.logs = [];
    renderDetail();
    return;
  }

  try {
    const [taskPayload, logPayload] = await Promise.all([
      fetchJson(`/api/tasks/${encodeURIComponent(taskId)}`),
      fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/logs?limit=80`),
    ]);

    state.selectedTaskId = taskId;
    state.selectedTask = taskPayload.task;
    state.logs = logPayload.logs ?? [];
    renderTaskList();
    renderDetail();
  } catch (error) {
    if (!silent) {
      setBanner(error instanceof Error ? error.message : String(error), "error");
    }
  }
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
    }

    if (!state.selectedTaskId && state.tasks.length > 0) {
      state.selectedTaskId = state.tasks[0].id;
    }

    renderStats();
    renderFilters();
    renderTaskList();

    if (state.selectedTaskId) {
      await loadTaskDetail(state.selectedTaskId, { silent: true });
    } else {
      state.selectedTask = null;
      state.logs = [];
      renderDetail();
    }

    if (!silent) {
      setBanner("Dashboard refreshed.", "info");
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
  if (!elements.titleInput || !elements.loopsInput || !elements.costInput) {
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

function registerEvents() {
  elements.createForm?.addEventListener("submit", (event) => {
    void handleCreate(event);
  });

  elements.refreshButton?.addEventListener("click", () => {
    void loadDashboard();
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
    renderFilters();
    renderTaskList();
  });

  elements.taskList?.addEventListener("click", (event) => {
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

    state.selectedTaskId = taskId;
    renderTaskList();
    void loadTaskDetail(taskId, { silent: true });
  });

  elements.detailActions?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (!action) {
      return;
    }

    void handleDetailAction(action);
  });
}

function startPolling() {
  window.setInterval(() => {
    void loadDashboard({ silent: true });
  }, REFRESH_INTERVAL_MS);
}

registerEvents();
renderStats();
renderFilters();
renderTaskList();
renderDetail();
void loadDashboard({ silent: true });
startPolling();
