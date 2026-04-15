import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ClearMemoryResult,
  type CaseTraceRecord,
  type DashboardDiagnostics,
  type DashboardOverview,
  type DashboardStatus,
  type DreamTraceRecord,
  type DreamRunResult,
  type HeartbeatStats,
  type IndexTraceRecord,
  type IndexingSettings,
  type MemoryFileRecord,
  type MemoryManifestEntry,
  MemoryRepository,
  MemoryBundleValidationError,
  type ManagedWorkspaceFileState,
  type ProjectMetaRecord,
  ReasoningRetriever,
  TMP_PROJECT_ID,
  type MemoryImportableBundle,
  type MemoryExportBundle,
  type MemoryActionRequest,
  type MemoryActionResult,
  type MemoryImportResult,
  type MemoryUiSnapshot,
} from "./core/index.js";
import { DEFAULT_OPENCLAW_CONFIG_PATH_HINT } from "./state-paths.js";

interface UiLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

interface UiRuntimeOverview {
  runtimeIssues: string[];
  managedWorkspaceFiles: ManagedWorkspaceFileState[];
  startupRepairMessage?: string;
}

export interface UiServerOptions {
  host: string;
  port: number;
  prefix: string;
}

export interface UiServerControls {
  getSettings: () => IndexingSettings;
  saveSettings: (partial: Partial<IndexingSettings>) => IndexingSettings;
  runIndexNow: () => Promise<HeartbeatStats>;
  runDreamNow: () => Promise<DreamRunResult>;
  runMemoryAction: (input: MemoryActionRequest) => Promise<MemoryActionResult>;
  clearMemoryNow: () => Promise<ClearMemoryResult> | ClearMemoryResult;
  exportMemoryBundle: () => MemoryExportBundle;
  importMemoryBundle: (bundle: MemoryImportableBundle) => Promise<MemoryImportResult>;
  getRuntimeOverview: () => UiRuntimeOverview;
  getStartupRepairSnapshot: (limit: number) => MemoryUiSnapshot | undefined;
  listCaseTraces: (limit: number) => CaseTraceRecord[];
  getCaseTrace: (caseId: string) => CaseTraceRecord | undefined;
  listIndexTraces: (limit: number) => IndexTraceRecord[];
  getIndexTrace: (indexTraceId: string) => IndexTraceRecord | undefined;
  listDreamTraces: (limit: number) => DreamTraceRecord[];
  getDreamTrace: (dreamTraceId: string) => DreamTraceRecord | undefined;
}

interface UiProjectGroup {
  projectId: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
  updatedAt: string;
  projectEntries: MemoryManifestEntry[];
  feedbackEntries: MemoryManifestEntry[];
  deprecatedProjectEntries: MemoryManifestEntry[];
  deprecatedFeedbackEntries: MemoryManifestEntry[];
  projectCount: number;
  feedbackCount: number;
}

interface UiTmpSnapshot {
  manifestPath: string;
  manifestContent: string;
  totalFiles: number;
  totalProjects: number;
  totalFeedback: number;
  projectEntries: MemoryFileRecord[];
  feedbackEntries: MemoryFileRecord[];
  deprecatedProjectEntries: MemoryFileRecord[];
  deprecatedFeedbackEntries: MemoryFileRecord[];
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const CURRENT_DIR = fileURLToPath(new URL(".", import.meta.url));
const UI_ASSET_DIRS = [
  join(CURRENT_DIR, "ui"),
  join(CURRENT_DIR, "../ui-source"),
];
function withSlashPrefix(prefix: string): string {
  if (!prefix.startsWith("/")) return `/${prefix}`;
  return prefix;
}

function getAssetContent(assetName: string): Buffer | undefined {
  for (const assetDir of UI_ASSET_DIRS) {
    try {
      return readFileSync(join(assetDir, assetName));
    } catch {
      continue;
    }
  }
  return undefined;
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

function sendNotFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Not found" }));
}

function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.statusCode = 405;
  res.setHeader("Allow", allow);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Method not allowed" }));
}

function sendRedirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function sendError(res: ServerResponse, message: string): void {
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: message }));
}

function sendBadRequest(res: ServerResponse, message: string): void {
  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: message }));
}

function sendJsonDownload(res: ServerResponse, body: unknown, filename: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.end(JSON.stringify(body, null, 2));
}

function buildExportFilename(exportedAt: string): string {
  const safe = exportedAt.replace(/[^\dTZ-]/g, "-").replace(/-+/g, "-");
  return `clawxmemory-memory-${safe || "export"}.json`;
}

function parseLimit(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, parsed));
}

function parseMemoryKind(value: string | null): "user" | "feedback" | "project" | "all" {
  if (value === "user" || value === "feedback" || value === "project") return value;
  return "all";
}

function parsePath(pathname: string, prefix: string): string {
  if (!pathname.startsWith(prefix)) return "";
  const raw = pathname.slice(prefix.length);
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function latestUpdatedAt(meta: ProjectMetaRecord, entries: MemoryManifestEntry[]): string {
  return [meta.updatedAt, ...entries.map((entry) => entry.updatedAt)]
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] || "";
}

function buildProjectGroups(repository: MemoryRepository, options: {
  query?: string;
  limit?: number;
  offset?: number;
} = {}): UiProjectGroup[] {
  const store = repository.getFileMemoryStore();
  const query = normalizeSearchText(options.query || "");
  const groups = store.listProjectMetas().map((meta) => {
    const entries = repository.listMemoryEntries({
      scope: "project",
      projectId: meta.projectId,
      limit: 500,
      includeDeprecated: true,
    });
    const activeEntries = entries.filter((entry) => !entry.deprecated);
    const deprecatedEntries = entries.filter((entry) => entry.deprecated);
    const projectEntries = activeEntries.filter((entry) => entry.type === "project");
    const feedbackEntries = activeEntries.filter((entry) => entry.type === "feedback");
    const deprecatedProjectEntries = deprecatedEntries.filter((entry) => entry.type === "project");
    const deprecatedFeedbackEntries = deprecatedEntries.filter((entry) => entry.type === "feedback");
    return {
      projectId: meta.projectId,
      projectName: meta.projectName,
      description: meta.description,
      aliases: [...meta.aliases],
      status: meta.status,
      updatedAt: latestUpdatedAt(meta, activeEntries),
      projectEntries,
      feedbackEntries,
      deprecatedProjectEntries,
      deprecatedFeedbackEntries,
      projectCount: projectEntries.length,
      feedbackCount: feedbackEntries.length,
    } satisfies UiProjectGroup;
  });

  const visibleGroups = groups.filter((group) => (group.projectCount + group.feedbackCount) > 0);
  const filtered = !query
    ? visibleGroups
    : visibleGroups.filter((group) => normalizeSearchText([
      group.projectName,
      group.description,
      ...group.aliases,
      ...group.projectEntries.flatMap((entry) => [entry.name, entry.description, entry.relativePath]),
      ...group.feedbackEntries.flatMap((entry) => [entry.name, entry.description, entry.relativePath]),
    ].join(" ")).includes(query));

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  return filtered
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(offset, offset + limit);
}

function buildTmpSnapshot(repository: MemoryRepository, options: {
  query?: string;
  limit?: number;
  offset?: number;
} = {}): UiTmpSnapshot {
  const store = repository.getFileMemoryStore();
  const manifestEntries = repository.listMemoryEntries({
    scope: "project",
    projectId: TMP_PROJECT_ID,
    includeTmp: true,
    includeDeprecated: true,
    limit: 1000,
  });
  const records = repository.getMemoryRecordsByIds(
    manifestEntries.map((entry) => entry.relativePath),
    5000,
  ) as MemoryFileRecord[];
  const query = normalizeSearchText(options.query || "");
  const filtered = !query
    ? records
    : records.filter((record) => normalizeSearchText([
      record.name,
      record.description,
      record.relativePath,
      record.preview,
      record.sourceSessionKey ?? "",
    ].join(" ")).includes(query));
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));
  const page = filtered
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(offset, offset + limit);
  const activeFiltered = filtered.filter((record) => !record.deprecated);
  const manifestPath = join(store.getRootDir(), "projects", TMP_PROJECT_ID, "MEMORY.md");
  return {
    manifestPath: `projects/${TMP_PROJECT_ID}/MEMORY.md`,
    manifestContent: (() => {
      try {
        return readFileSync(manifestPath, "utf-8");
      } catch {
        return "";
      }
    })(),
    totalFiles: activeFiltered.length,
    totalProjects: activeFiltered.filter((record) => record.type === "project").length,
    totalFeedback: activeFiltered.filter((record) => record.type === "feedback").length,
    projectEntries: page.filter((record) => record.type === "project" && !record.deprecated),
    feedbackEntries: page.filter((record) => record.type === "feedback" && !record.deprecated),
    deprecatedProjectEntries: page.filter((record) => record.type === "project" && record.deprecated),
    deprecatedFeedbackEntries: page.filter((record) => record.type === "feedback" && record.deprecated),
  };
}

function mergeOverview(
  base: DashboardOverview,
  runtime: UiRuntimeOverview,
): DashboardOverview {
  const issues = Array.isArray(runtime.runtimeIssues)
    ? runtime.runtimeIssues
      .map((issue) => (typeof issue === "string" ? issue.trim() : ""))
      .filter(Boolean)
    : [];
  const conflictingFiles = Array.isArray(runtime.managedWorkspaceFiles)
    ? runtime.managedWorkspaceFiles
      .filter((file) => file?.status === "conflict" && typeof file.name === "string" && file.name.trim())
      .map((file) => ({
        name: file.name,
        ...(typeof file.conflictPath === "string" && file.conflictPath.trim()
          ? { conflictPath: file.conflictPath.trim() }
          : {}),
      }))
    : [];
  const startupRepairMessage = typeof runtime.startupRepairMessage === "string" && runtime.startupRepairMessage.trim()
    ? runtime.startupRepairMessage.trim()
    : undefined;
  const diagnostics: DashboardDiagnostics | null = conflictingFiles.length || issues.length || startupRepairMessage
    ? {
        issues,
        conflictingFiles,
        ...(startupRepairMessage ? { startupRepairMessage } : {}),
      }
    : null;
  const dashboardStatus: DashboardStatus = conflictingFiles.length
    ? "conflict"
    : diagnostics
      ? "warning"
      : "healthy";
  const dashboardWarning = conflictingFiles.length
    ? `Detected ${conflictingFiles.length} workspace boundary conflict${conflictingFiles.length === 1 ? "" : "s"}: ${conflictingFiles.map((file) => file.name).join(", ")}`
    : issues[0] || startupRepairMessage || null;
  return {
    ...base,
    dashboardStatus,
    dashboardWarning,
    dashboardDiagnostics: diagnostics,
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
}

function buildServerErrorMessage(error: unknown, options: UiServerOptions): string {
  const nodeError = error as (NodeJS.ErrnoException & { port?: unknown }) | undefined;
  if (nodeError?.code === "EADDRINUSE") {
    const port = typeof nodeError.port === "number" ? nodeError.port : options.port;
    return [
      `[clawxmemory] dashboard server failed: port ${port} is already in use (EADDRINUSE).`,
      `Update plugins.entries.openbmb-clawxmemory.config.uiPort in ${DEFAULT_OPENCLAW_CONFIG_PATH_HINT}.`,
      "If you use OPENCLAW_CONFIG_PATH, update that file instead.",
    ].join(" ");
  }
  const message = error instanceof Error ? error.message : String(error);
  return `[clawxmemory] dashboard server failed: ${message}`;
}

export class LocalUiServer {
  private server = createServer((req, res) => {
    void this.handle(req, res);
  });
  private started = false;
  private listening = false;
  private readonly prefix: string;

  constructor(
    private readonly repository: MemoryRepository,
    private readonly retriever: ReasoningRetriever,
    private readonly options: UiServerOptions,
    private readonly controls: UiServerControls,
    private readonly logger: UiLogger,
  ) {
    this.prefix = withSlashPrefix(options.prefix).replace(/\/+$/, "");
    this.server.on("listening", () => {
      this.listening = true;
    });
    this.server.on("close", () => {
      this.listening = false;
      this.started = false;
    });
    this.server.on("error", (error) => {
      this.listening = false;
      this.started = false;
      this.logger.warn?.(buildServerErrorMessage(error, this.options));
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.server.listen(this.options.port, this.options.host, () => {
      this.logger.info?.(
        `[clawxmemory] dashboard ready at http://${this.options.host}:${this.options.port}${this.prefix}/`,
      );
    });
  }

  stop(): void {
    if (!this.started && !this.listening) return;
    this.started = false;
    if (!this.listening) return;
    this.server.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!req.url) return sendNotFound(res);
      const url = new URL(req.url, `http://${this.options.host}:${this.options.port}`);
      if (url.pathname === this.prefix) {
        const redirectUrl = new URL(`${this.prefix}/`, url);
        redirectUrl.search = url.search;
        return sendRedirect(res, redirectUrl.pathname + redirectUrl.search);
      }
      const relativePath = parsePath(url.pathname, this.prefix);
      if (!relativePath) return sendNotFound(res);

      if (relativePath.startsWith("/api/")) {
        return await this.handleApi(relativePath, req, url, res);
      }
      return this.handleStatic(relativePath, res);
    } catch (error) {
      this.logger.warn?.(`[clawxmemory] ui request failed: ${String(error)}`);
      return sendError(res, String(error));
    }
  }

  private async handleApi(
    relativePath: string,
    req: IncomingMessage,
    url: URL,
    res: ServerResponse,
  ): Promise<void> {
    const upperMethod = (req.method ?? "GET").toUpperCase();
    const query = url.searchParams.get("q") ?? "";
    const limit = parseLimit(url.searchParams.get("limit"), 20);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
    const runtimeOverview = (): ReturnType<UiServerControls["getRuntimeOverview"]> => this.controls.getRuntimeOverview();
    const cachedSnapshot = (): MemoryUiSnapshot | undefined => this.controls.getStartupRepairSnapshot(limit);
    const overview = (): DashboardOverview => {
      const runtime = runtimeOverview();
      const cached = cachedSnapshot();
      return mergeOverview(cached?.overview ?? this.repository.getOverview(), runtime);
    };
    if (relativePath === "/api/clear") {
      if (upperMethod !== "POST") return sendMethodNotAllowed(res, "POST");
      return sendJson(res, await this.controls.clearMemoryNow());
    }
    if (relativePath === "/api/export") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      const bundle = this.controls.exportMemoryBundle();
      return sendJsonDownload(res, bundle, buildExportFilename(bundle.exportedAt));
    }
    if (relativePath === "/api/import") {
      if (upperMethod !== "POST") return sendMethodNotAllowed(res, "POST");
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        return sendBadRequest(res, error instanceof Error ? error.message : "Invalid JSON body");
      }
      try {
        return sendJson(res, await this.controls.importMemoryBundle(body as unknown as MemoryImportableBundle));
      } catch (error) {
        if (error instanceof MemoryBundleValidationError) {
          return sendBadRequest(res, error.message);
        }
        throw error;
      }
    }
    if (relativePath === "/api/overview") {
      return sendJson(res, overview());
    }
    if (relativePath === "/api/settings") {
      if (upperMethod === "GET") {
        return sendJson(res, this.controls.getSettings());
      }
      if (upperMethod !== "POST") return sendMethodNotAllowed(res, "GET, POST");
      const body = await readJsonBody(req);
      return sendJson(res, this.controls.saveSettings(body as Partial<IndexingSettings>));
    }
    if (relativePath === "/api/index/run") {
      if (upperMethod !== "POST") return sendMethodNotAllowed(res, "POST");
      return sendJson(res, await this.controls.runIndexNow());
    }
    if (relativePath === "/api/dream/run") {
      if (upperMethod !== "POST") return sendMethodNotAllowed(res, "POST");
      return sendJson(res, await this.controls.runDreamNow());
    }
    if (relativePath === "/api/snapshot") {
      const cached = cachedSnapshot();
      if (cached) {
        return sendJson(res, {
          ...cached,
          overview: mergeOverview(cached.overview, runtimeOverview()),
          settings: this.controls.getSettings(),
        });
      }
      return sendJson(res, {
        ...this.repository.getUiSnapshot(limit),
        overview: overview(),
        settings: this.controls.getSettings(),
      });
    }
    if (relativePath === "/api/memory/list") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      const kind = parseMemoryKind(url.searchParams.get("kind"));
      const projectId = url.searchParams.get("projectId")?.trim() ?? "";
      return sendJson(
        res,
        this.repository.listMemoryEntries({
          ...(kind !== "all" ? { kinds: [kind] } : {}),
          ...(query ? { query } : {}),
          ...(projectId ? { projectId } : {}),
          limit,
          offset,
        }),
      );
    }
    if (relativePath === "/api/memory/get") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      const ids = (url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      if (ids.length === 0) return sendBadRequest(res, "ids query parameter is required");
      return sendJson(res, this.repository.getMemoryRecordsByIds(ids, 5000));
    }
    if (relativePath === "/api/memory/actions") {
      if (upperMethod !== "POST") return sendMethodNotAllowed(res, "POST");
      const body = await readJsonBody(req);
      const action = typeof body.action === "string" ? body.action.trim() : "";
      if (
        action !== "edit_project_meta"
        && action !== "edit_entry"
        && action !== "delete_entries"
        && action !== "deprecate_entries"
        && action !== "restore_entries"
        && action !== "archive_tmp"
      ) {
        return sendBadRequest(res, "Unsupported memory action");
      }
      try {
        if (action === "edit_project_meta") {
          const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
          const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
          const description = typeof body.description === "string" ? body.description.trim() : "";
          const status = typeof body.status === "string" ? body.status.trim() : "";
          const aliases = Array.isArray(body.aliases)
            ? body.aliases.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
            : [];
          if (!projectId || !projectName || !description || !status) {
            return sendBadRequest(res, "projectId, projectName, description, and status are required");
          }
          return sendJson(res, await this.controls.runMemoryAction({ action, projectId, projectName, description, aliases, status }));
        }
        if (action === "edit_entry") {
          const id = typeof body.id === "string" ? body.id.trim() : "";
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const description = typeof body.description === "string" ? body.description.trim() : "";
          if (!id || !name) return sendBadRequest(res, "id and name are required");
          const rawFields = typeof body.fields === "object" && body.fields !== null ? body.fields as Record<string, unknown> : {};
          const stringFields = ["stage", "rule", "why", "howToApply"] as const;
          const listFields = ["decisions", "constraints", "nextSteps", "blockers", "timeline", "notes"] as const;
          const fields: Record<string, unknown> = {};
          for (const key of stringFields) {
            const value = typeof rawFields[key] === "string" ? rawFields[key].trim() : "";
            if (value) fields[key] = value;
          }
          for (const key of listFields) {
            const value = Array.isArray(rawFields[key])
              ? rawFields[key].filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
              : [];
            if (value.length) fields[key] = value;
          }
          return sendJson(res, await this.controls.runMemoryAction({
            action,
            id,
            name,
            description,
            ...(Object.keys(fields).length ? { fields } : {}),
          }));
        }
        if (action === "archive_tmp") {
          const ids = Array.isArray(body.ids) ? body.ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
          const targetProjectId = typeof body.targetProjectId === "string" ? body.targetProjectId.trim() : "";
          const newProjectName = typeof body.newProjectName === "string" ? body.newProjectName.trim() : "";
          if (!ids.length) return sendBadRequest(res, "ids are required");
          if (!targetProjectId && !newProjectName) {
            return sendBadRequest(res, "archive_tmp requires targetProjectId or newProjectName");
          }
          return sendJson(res, await this.controls.runMemoryAction({
            action,
            ids,
            ...(targetProjectId ? { targetProjectId } : {}),
            ...(newProjectName ? { newProjectName } : {}),
          }));
        }
        const ids = Array.isArray(body.ids) ? body.ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
        if (!ids.length) return sendBadRequest(res, "ids are required");
        return sendJson(res, await this.controls.runMemoryAction({ action, ids }));
      } catch (error) {
        return sendBadRequest(res, error instanceof Error ? error.message : String(error));
      }
    }
    if (relativePath === "/api/memory/user-summary") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      return sendJson(res, this.repository.getFileMemoryStore().getUserSummary());
    }
    if (relativePath === "/api/projects") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      return sendJson(res, buildProjectGroups(this.repository, { query, limit, offset }));
    }
    if (relativePath === "/api/tmp") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      return sendJson(res, buildTmpSnapshot(this.repository, { query, limit, offset }));
    }
    if (relativePath === "/api/cases") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      return sendJson(res, this.controls.listCaseTraces(parseLimit(url.searchParams.get("limit"), 5)));
    }
    if (relativePath.startsWith("/api/cases/")) {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      const caseId = decodeURIComponent(relativePath.slice("/api/cases/".length));
      if (!caseId.trim()) return sendNotFound(res);
      const record = this.controls.getCaseTrace(caseId);
      if (!record) return sendNotFound(res);
      return sendJson(res, record);
    }
    if (relativePath === "/api/index-traces") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      return sendJson(res, this.controls.listIndexTraces(parseLimit(url.searchParams.get("limit"), 12)));
    }
    if (relativePath.startsWith("/api/index-traces/")) {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      const indexTraceId = decodeURIComponent(relativePath.slice("/api/index-traces/".length));
      if (!indexTraceId.trim()) return sendNotFound(res);
      const record = this.controls.getIndexTrace(indexTraceId);
      if (!record) return sendNotFound(res);
      return sendJson(res, record);
    }
    if (relativePath === "/api/dream-traces") {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      return sendJson(res, this.controls.listDreamTraces(parseLimit(url.searchParams.get("limit"), 12)));
    }
    if (relativePath.startsWith("/api/dream-traces/")) {
      if (upperMethod !== "GET") return sendMethodNotAllowed(res, "GET");
      const dreamTraceId = decodeURIComponent(relativePath.slice("/api/dream-traces/".length));
      if (!dreamTraceId.trim()) return sendNotFound(res);
      const record = this.controls.getDreamTrace(dreamTraceId);
      if (!record) return sendNotFound(res);
      return sendJson(res, record);
    }
    return sendNotFound(res);
  }

  private handleStatic(relativePath: string, res: ServerResponse): void {
    const target = relativePath === "/" ? "/index.html" : relativePath;
    const assetName = target.replace(/^\/+/, "");
    const raw = getAssetContent(assetName);
    if (!raw) return sendNotFound(res);

    const ext = assetName.includes(".") ? assetName.slice(assetName.lastIndexOf(".")) : ".html";
    const contentType = CONTENT_TYPES[ext] ?? "text/plain; charset=utf-8";
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.end(raw);
  }
}
