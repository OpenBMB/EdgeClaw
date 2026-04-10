import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { deserializeBudgetConstraints } from "./budget/registry.js";
import {
  AlwaysOnConfigController,
  AlwaysOnConfigControllerError,
} from "./core/config-controller.js";
import type { AlwaysOnConfig } from "./core/config.js";
import { PLUGIN_ID } from "./core/constants.js";
import { createAlwaysOnTaskFromUserInput } from "./core/task-factory.js";
import type {
  AlwaysOnTask,
  BudgetConstraint,
  BudgetUsage,
  TaskLogEntry,
  TaskStatus,
} from "./core/types.js";
import { WebPlanRequestError, type AlwaysOnWebPlanService } from "./plan/web-service.js";
import type { PluginLoggerSink } from "./storage/logger.js";
import type { TaskLogger } from "./storage/logger.js";
import type { TaskStore } from "./storage/store.js";

const DASHBOARD_BASE_PATH = `/plugins/${PLUGIN_ID}`;
const DEFAULT_LOG_LIMIT = 80;
const MAX_LOG_LIMIT = 200;
const LOOP_LIMIT_RANGE = { min: 1, max: 1000 };
const COST_LIMIT_RANGE = { min: 0.01, max: 100 };
const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join("; ");

const TASK_STATUSES = [
  "pending",
  "queued",
  "launching",
  "active",
  "suspended",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly TaskStatus[];

const ASSET_NAMES = new Set(["index.html", "app.js", "styles.css"]);
const V2_PREFIX = "/v2";
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

type DashboardTask = Omit<AlwaysOnTask, "budgetConstraints" | "budgetUsage"> & {
  budgetConstraints: Array<{
    kind: string;
    label: string;
    ok: boolean;
    reason?: string;
    limit?: number;
    limitUsd?: number;
    used: number;
  }>;
  budgetUsage: BudgetUsage;
};

type DashboardLogEntry = Omit<TaskLogEntry, "metadata"> & {
  metadata?: Record<string, unknown>;
};

export function createAlwaysOnHttpHandler(params: {
  store: TaskStore;
  logger: TaskLogger;
  getConfig: () => AlwaysOnConfig;
  configController: AlwaysOnConfigController;
  planService?: AlwaysOnWebPlanService;
  pluginLogger?: PluginLoggerSink;
}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const parsed = parseRequestUrl(req.url);
    if (!parsed) {
      return false;
    }

    if (parsed.pathname === DASHBOARD_BASE_PATH) {
      respondRedirect(res, `${DASHBOARD_BASE_PATH}/`);
      return true;
    }

    if (!parsed.pathname.startsWith(DASHBOARD_BASE_PATH)) {
      return false;
    }

    const relativePath = parseRelativePath(parsed.pathname);
    if (!relativePath) {
      return false;
    }

    if (relativePath === V2_PREFIX) {
      respondRedirect(res, `${DASHBOARD_BASE_PATH}${V2_PREFIX}/`);
      return true;
    }

    if (relativePath.startsWith(`${V2_PREFIX}/`)) {
      const v2Relative = relativePath.slice(V2_PREFIX.length);
      if (v2Relative === "/" || isStaticAssetPath(v2Relative)) {
        return await handleStatic(v2Relative, req, res, params.pluginLogger, "v2");
      }
      respondJson(res, 404, { error: "Not found" });
      return true;
    }

    if (relativePath === "/" || isStaticAssetPath(relativePath)) {
      return await handleStatic(relativePath, req, res, params.pluginLogger);
    }

    if (relativePath.startsWith("/api/")) {
      return await handleApi(relativePath, parsed, req, res, {
        store: params.store,
        logger: params.logger,
        getConfig: params.getConfig,
        configController: params.configController,
        planService: params.planService,
      });
    }

    respondJson(res, 404, { error: "Not found" });
    return true;
  };
}

async function handleStatic(
  relativePath: string,
  req: IncomingMessage,
  res: ServerResponse,
  pluginLogger?: PluginLoggerSink,
  variant?: "v2",
): Promise<boolean> {
  const method = normalizeMethod(req.method);
  if (method !== "GET" && method !== "HEAD") {
    respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, HEAD" });
    return true;
  }

  const assetName = relativePath === "/" ? "index.html" : relativePath.slice(1);
  const assetPath = variant === "v2" ? resolveV2AssetPath(assetName) : resolveAssetPath(assetName);
  if (!assetPath) {
    respondJson(res, 404, { error: "Asset not found" });
    return true;
  }

  try {
    const body = await readFile(assetPath);
    const contentType = CONTENT_TYPES[extname(assetName)] ?? "text/plain; charset=utf-8";
    setSharedHeaders(res, contentType);
    if (assetName === "index.html") {
      res.setHeader("content-security-policy", HTML_CONTENT_SECURITY_POLICY);
    }
    res.statusCode = 200;
    if (method === "HEAD") {
      res.end();
    } else {
      res.end(body);
    }
    return true;
  } catch (error) {
    pluginLogger?.warn?.(
      `[${PLUGIN_ID}] Failed to serve dashboard asset ${assetName}: ${String(error)}`,
    );
    respondJson(res, 500, { error: "Failed to load dashboard asset" });
    return true;
  }
}

async function handleApi(
  relativePath: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    store: TaskStore;
    logger: TaskLogger;
    getConfig: () => AlwaysOnConfig;
    configController: AlwaysOnConfigController;
    planService?: AlwaysOnWebPlanService;
  },
): Promise<boolean> {
  const method = normalizeMethod(req.method);

  if (relativePath === "/api/status") {
    if (method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
      return true;
    }
    respondJson(res, 200, buildDashboardOverview(params.store, params.getConfig()));
    return true;
  }

  if (relativePath === "/api/config") {
    if (method === "GET") {
      respondJson(res, 200, params.configController.getSnapshot());
      return true;
    }

    if (method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        respondJson(res, 400, {
          error: error instanceof Error ? error.message : "Invalid JSON body",
        });
        return true;
      }

      try {
        const snapshot = await params.configController.update(body);
        respondJson(res, 200, snapshot);
      } catch (error) {
        respondConfigError(res, error);
      }
      return true;
    }

    respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
    return true;
  }

  if (relativePath === "/api/plan/start") {
    if (method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return true;
    }

    if (!params.planService) {
      respondJson(res, 503, { error: "Plan API is unavailable" });
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      respondJson(res, 400, {
        error: error instanceof Error ? error.message : "Invalid JSON body",
      });
      return true;
    }

    try {
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const result = await params.planService.startPlan(prompt);
      respondJson(res, 201, result);
    } catch (error) {
      respondPlanError(res, error);
    }
    return true;
  }

  const planAnswerMatch = relativePath.match(/^\/api\/plan\/([^/]+)\/answer$/);
  if (planAnswerMatch) {
    if (method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return true;
    }

    if (!params.planService) {
      respondJson(res, 503, { error: "Plan API is unavailable" });
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      respondJson(res, 400, {
        error: error instanceof Error ? error.message : "Invalid JSON body",
      });
      return true;
    }

    try {
      const planId = decodeURIComponent(planAnswerMatch[1]);
      const answer = typeof body.answer === "string" ? body.answer : "";
      const result = await params.planService.answerPlan(planId, answer);
      respondJson(res, 200, result);
    } catch (error) {
      respondPlanError(res, error);
    }
    return true;
  }

  const planCancelMatch = relativePath.match(/^\/api\/plan\/([^/]+)\/cancel$/);
  if (planCancelMatch) {
    if (method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return true;
    }

    if (!params.planService) {
      respondJson(res, 503, { error: "Plan API is unavailable" });
      return true;
    }

    try {
      const planId = decodeURIComponent(planCancelMatch[1]);
      const plan = params.planService.cancelPlan(planId);
      respondJson(res, 200, { plan });
    } catch (error) {
      respondPlanError(res, error);
    }
    return true;
  }

  const planDetailMatch = relativePath.match(/^\/api\/plan\/([^/]+)$/);
  if (planDetailMatch) {
    if (method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
      return true;
    }

    if (!params.planService) {
      respondJson(res, 503, { error: "Plan API is unavailable" });
      return true;
    }

    try {
      const planId = decodeURIComponent(planDetailMatch[1]);
      const plan = params.planService.getPlan(planId);
      respondJson(res, 200, { plan });
    } catch (error) {
      respondPlanError(res, error);
    }
    return true;
  }

  if (relativePath === "/api/tasks") {
    if (method === "GET") {
      const rawStatus = url.searchParams.get("status");
      if (rawStatus && !isTaskStatus(rawStatus)) {
        respondJson(res, 400, { error: `Unknown task status: ${rawStatus}` });
        return true;
      }

      const filter = rawStatus && isTaskStatus(rawStatus) ? { status: rawStatus } : undefined;
      const tasks = params.store.listTasks(filter).map((task) => serializeTask(task));
      respondJson(res, 200, { tasks });
      return true;
    }

    if (method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        respondJson(res, 400, {
          error: error instanceof Error ? error.message : "Invalid JSON body",
        });
        return true;
      }

      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        respondJson(res, 400, { error: "Task title is required" });
        return true;
      }

      try {
        const currentConfig = params.getConfig();
        const maxLoops =
          parseOptionalInteger(
            body.maxLoops,
            "maxLoops",
            LOOP_LIMIT_RANGE.min,
            LOOP_LIMIT_RANGE.max,
          ) ?? currentConfig.defaultMaxLoops;
        const maxCostUsd =
          parseOptionalNumber(
            body.maxCostUsd,
            "maxCostUsd",
            COST_LIMIT_RANGE.min,
            COST_LIMIT_RANGE.max,
          ) ?? currentConfig.defaultMaxCostUsd;
        const provider = parseOptionalString(body.provider);
        const model = parseOptionalString(body.model);
        const budgetExceededAction = parseBudgetExceededAction(body.budgetExceededAction);

        const task = createAlwaysOnTaskFromUserInput({
          input: {
            title,
            maxLoops,
            maxCostUsd,
            provider,
            model,
            budgetExceededAction,
            metadata: {
              mode: "create",
            },
          },
          store: params.store,
          logger: params.logger,
          config: currentConfig,
        });
        params.logger.info(task.id, `Task created from dashboard: ${title}`);

        respondJson(res, 201, { task: serializeTask(task) });
      } catch (error) {
        respondJson(res, 400, {
          error: error instanceof Error ? error.message : "Invalid task payload",
        });
      }
      return true;
    }

    respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET, POST" });
    return true;
  }

  const detailMatch = relativePath.match(/^\/api\/tasks\/([^/]+)$/);
  if (detailMatch) {
    if (method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
      return true;
    }

    const taskId = decodeURIComponent(detailMatch[1]);
    const task = params.store.getTask(taskId);
    if (!task) {
      respondJson(res, 404, { error: `Task ${taskId} not found` });
      return true;
    }

    respondJson(res, 200, { task: serializeTask(task) });
    return true;
  }

  const logsMatch = relativePath.match(/^\/api\/tasks\/([^/]+)\/logs$/);
  if (logsMatch) {
    if (method !== "GET") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
      return true;
    }

    const taskId = decodeURIComponent(logsMatch[1]);
    const task = params.store.getTask(taskId);
    if (!task) {
      respondJson(res, 404, { error: `Task ${taskId} not found` });
      return true;
    }

    const limit = parseOptionalInteger(url.searchParams.get("limit"), "limit", 1, MAX_LOG_LIMIT);
    const logs = params.logger
      .getLogs(taskId, limit ?? DEFAULT_LOG_LIMIT)
      .map((entry) => serializeLogEntry(entry));
    respondJson(res, 200, { logs });
    return true;
  }

  const resumeMatch = relativePath.match(/^\/api\/tasks\/([^/]+)\/resume$/);
  if (resumeMatch) {
    if (method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return true;
    }

    const taskId = decodeURIComponent(resumeMatch[1]);
    const task = params.store.getTask(taskId);
    if (!task) {
      respondJson(res, 404, { error: `Task ${taskId} not found` });
      return true;
    }

    if (task.status !== "suspended" && task.status !== "failed") {
      respondJson(res, 409, {
        error: "Only suspended or failed tasks can be resumed",
        task: serializeTask(task),
      });
      return true;
    }

    params.store.updateTask(task.id, {
      status: "queued",
      suspendedAt: null,
    });
    params.logger.info(task.id, "Task re-queued for background launch from dashboard");

    respondJson(res, 200, { task: serializeTask(requireTask(params.store, task.id)) });
    return true;
  }

  const startMatch = relativePath.match(/^\/api\/tasks\/([^/]+)\/start$/);
  if (startMatch) {
    if (method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return true;
    }

    const taskId = decodeURIComponent(startMatch[1]);
    const task = params.store.getTask(taskId);
    if (!task) {
      respondJson(res, 404, { error: `Task ${taskId} not found` });
      return true;
    }

    if (task.status !== "pending") {
      respondJson(res, 409, {
        error: "Only pending tasks can be started",
        task: serializeTask(task),
      });
      return true;
    }

    params.store.startPendingTask(task.id);
    params.logger.info(task.id, "Pending task started from dashboard");
    respondJson(res, 200, { task: serializeTask(requireTask(params.store, task.id)) });
    return true;
  }

  const cancelMatch = relativePath.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
  if (cancelMatch) {
    if (method !== "POST") {
      respondJson(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
      return true;
    }

    const taskId = decodeURIComponent(cancelMatch[1]);
    const task = params.store.getTask(taskId);
    if (!task) {
      respondJson(res, 404, { error: `Task ${taskId} not found` });
      return true;
    }

    if (task.status === "completed" || task.status === "cancelled") {
      respondJson(res, 409, { error: `Task is already ${task.status}`, task: serializeTask(task) });
      return true;
    }

    params.store.updateTask(taskId, { status: "cancelled" });
    params.logger.info(taskId, "Task cancelled from dashboard");

    respondJson(res, 200, { task: serializeTask(requireTask(params.store, taskId)) });
    return true;
  }

  respondJson(res, 404, { error: "Not found" });
  return true;
}

function buildDashboardOverview(store: TaskStore, config: AlwaysOnConfig) {
  const tasks = store.listTasks();
  const runningTasks = store.listRunningTasks().map((task) => serializeTask(task));
  const countsByStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;

  for (const task of tasks) {
    countsByStatus[task.status] += 1;
  }

  return {
    totalTasks: tasks.length,
    countsByStatus,
    maxConcurrentTasks: config.maxConcurrentTasks,
    defaultMaxLoops: config.defaultMaxLoops,
    defaultMaxCostUsd: config.defaultMaxCostUsd,
    defaultBudgetExceededAction: config.defaultBudgetExceededAction,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    dreamEnabled: config.dreamEnabled,
    dreamIntervalMinutes: config.dreamIntervalMinutes,
    logRetentionDays: config.logRetentionDays,
    runningTasks,
  };
}

function serializeTask(task: AlwaysOnTask): DashboardTask {
  const usage = parseBudgetUsage(task.budgetUsage);
  const budgetConstraints = deserializeBudgetConstraints(task.budgetConstraints).map((constraint) =>
    serializeBudgetConstraint(constraint, usage),
  );

  return {
    ...task,
    budgetUsage: usage,
    budgetConstraints,
  };
}

function serializeBudgetConstraint(constraint: BudgetConstraint, usage: BudgetUsage) {
  const result = constraint.check(usage);

  if (constraint.kind === "max-loops") {
    const limit =
      "limit" in constraint && typeof constraint.limit === "number" ? constraint.limit : undefined;
    return {
      kind: constraint.kind,
      label: limit ? `${usage.loopsUsed}/${limit} loops` : `${usage.loopsUsed} loops`,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      limit,
      used: usage.loopsUsed,
    };
  }

  if (constraint.kind === "max-cost-usd") {
    const limitUsd =
      "limitUsd" in constraint && typeof constraint.limitUsd === "number"
        ? constraint.limitUsd
        : undefined;
    return {
      kind: constraint.kind,
      label: limitUsd
        ? `$${usage.costUsedUsd.toFixed(4)}/$${limitUsd.toFixed(2)}`
        : `$${usage.costUsedUsd.toFixed(4)}`,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      limitUsd,
      used: usage.costUsedUsd,
    };
  }

  return {
    kind: constraint.kind,
    label: result.ok ? "Within limits" : result.reason,
    ok: result.ok,
    reason: result.ok ? undefined : result.reason,
    used: 0,
  };
}

function serializeLogEntry(entry: TaskLogEntry): DashboardLogEntry {
  return {
    ...entry,
    metadata: parseMetadata(entry.metadata),
  };
}

function parseBudgetUsage(raw: string): BudgetUsage {
  try {
    const parsed = JSON.parse(raw) as BudgetUsage;
    return {
      ...parsed,
      loopsUsed: typeof parsed.loopsUsed === "number" ? parsed.loopsUsed : 0,
      costUsedUsd: typeof parsed.costUsedUsd === "number" ? parsed.costUsedUsd : 0,
    };
  } catch {
    return { loopsUsed: 0, costUsedUsd: 0 };
  }
}

function parseMetadata(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveAssetPath(assetName: string): string | null {
  if (!ASSET_NAMES.has(assetName)) {
    return null;
  }
  return fileURLToPath(new URL(`../web/${assetName}`, import.meta.url));
}

function resolveV2AssetPath(assetName: string): string | null {
  if (!ASSET_NAMES.has(assetName)) {
    return null;
  }
  return fileURLToPath(new URL(`../web-v2/${assetName}`, import.meta.url));
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? "GET").toUpperCase();
}

function parseRelativePath(pathname: string): string | null {
  if (!pathname.startsWith(DASHBOARD_BASE_PATH)) {
    return null;
  }
  const raw = pathname.slice(DASHBOARD_BASE_PATH.length);
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function isStaticAssetPath(relativePath: string): boolean {
  return ASSET_NAMES.has(relativePath.slice(1));
}

function parseRequestUrl(rawUrl?: string): URL | null {
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl, "http://127.0.0.1");
  } catch {
    return null;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Expected a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function parseOptionalInteger(
  value: unknown,
  fieldName: string,
  minValue: number,
  maxValue: number,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < minValue || parsed > maxValue) {
    throw new Error(`${fieldName} must be an integer between ${minValue} and ${maxValue}`);
  }

  return parsed;
}

function parseOptionalNumber(
  value: unknown,
  fieldName: string,
  minValue: number,
  maxValue: number,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < minValue || parsed > maxValue) {
    throw new Error(`${fieldName} must be a number between ${minValue} and ${maxValue}`);
  }

  return parsed;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseBudgetExceededAction(value: unknown): "warn" | "terminate" | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "warn" || value === "terminate") {
    return value;
  }
  throw new Error("budgetExceededAction must be either 'warn' or 'terminate'");
}

function requireTask(store: TaskStore, taskId: string): AlwaysOnTask {
  const task = store.getTask(taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  return task;
}

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

function respondPlanError(res: ServerResponse, error: unknown): void {
  if (error instanceof WebPlanRequestError) {
    respondJson(res, error.statusCode, { error: error.message });
    return;
  }
  const message =
    error instanceof Error && error.message.trim() ? error.message.trim() : "Plan request failed";
  respondJson(res, 500, { error: message });
}

function respondConfigError(res: ServerResponse, error: unknown): void {
  if (error instanceof AlwaysOnConfigControllerError) {
    respondJson(res, error.statusCode, { error: error.message });
    return;
  }
  const message =
    error instanceof Error && error.message.trim() ? error.message.trim() : "Config request failed";
  respondJson(res, 500, { error: message });
}

function respondRedirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.end();
}

function respondJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  setSharedHeaders(res, "application/json; charset=utf-8");
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      res.setHeader(key, value);
    }
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(body));
}

function setSharedHeaders(res: ServerResponse, contentType: string): void {
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("content-type", contentType);
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
}
