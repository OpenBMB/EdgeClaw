import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CaseTraceRecord,
  type DashboardOverview,
  type DreamRunResult,
  type HeartbeatStats,
  type IndexingSettings,
  MemoryRepository,
  MemoryBundleValidationError,
  ReasoningRetriever,
  type MemoryExportBundle,
  type MemoryImportResult,
  type MemoryUiSnapshot,
} from "./core/index.js";

interface UiLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
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
  exportMemoryBundle: () => MemoryExportBundle;
  importMemoryBundle: (bundle: MemoryExportBundle) => Promise<MemoryImportResult>;
  getRuntimeOverview: () => Pick<
    DashboardOverview,
    | "queuedSessions"
    | "lastRecallMs"
    | "recallTimeouts"
    | "lastRecallMode"
    | "currentReasoningMode"
    | "lastRecallPath"
    | "lastRecallBudgetLimited"
    | "lastShadowDeepQueued"
    | "lastRecallInjected"
    | "lastRecallEnoughAt"
    | "lastRecallCacheHit"
    | "slotOwner"
    | "dynamicMemoryRuntime"
    | "workspaceBootstrapPresent"
    | "memoryRuntimeHealthy"
    | "runtimeIssues"
    | "startupRepairStatus"
    | "startupRepairMessage"
  >;
  getStartupRepairSnapshot: (limit: number) => MemoryUiSnapshot | undefined;
  listCaseTraces: (limit: number) => CaseTraceRecord[];
  getCaseTrace: (caseId: string) => CaseTraceRecord | undefined;
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
const DEFAULT_OPENCLAW_CONFIG_PATH_HINT = "~/.openclaw/openclaw.json";

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

function parsePath(pathname: string, prefix: string): string {
  if (!pathname.startsWith(prefix)) return "";
  const raw = pathname.slice(prefix.length);
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function mergeOverview(
  base: DashboardOverview,
  runtime: ReturnType<UiServerControls["getRuntimeOverview"]>,
): DashboardOverview {
  return {
    ...base,
    ...runtime,
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
      return sendJson(res, this.repository.clearAllMemoryData());
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
        return sendJson(res, await this.controls.importMemoryBundle(body as unknown as MemoryExportBundle));
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
    if (relativePath === "/api/l2/time") {
      if (!query.trim()) return sendJson(res, this.repository.listRecentL2Time(limit, offset));
      return sendJson(res, this.repository.searchL2TimeIndexes(query, limit));
    }
    if (relativePath === "/api/l2/project") {
      if (!query.trim()) return sendJson(res, this.repository.listRecentL2Projects(limit, offset));
      return sendJson(res, this.repository.searchL2ProjectIndexes(query, limit));
    }
    if (relativePath === "/api/l1") {
      if (!query.trim()) return sendJson(res, this.repository.listRecentL1(limit, offset));
      return sendJson(res, this.repository.searchL1(query, limit));
    }
    if (relativePath === "/api/l0") {
      if (!query.trim()) return sendJson(res, this.repository.listRecentL0(limit, offset));
      return sendJson(res, this.repository.searchL0(query, limit));
    }
    if (relativePath === "/api/l1/byIds") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      return sendJson(res, this.repository.getL1ByIds(ids));
    }
    if (relativePath === "/api/l0/byIds") {
      const ids = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean);
      return sendJson(res, this.repository.getL0ByIds(ids));
    }
    if (relativePath === "/api/profile" || relativePath === "/api/facts") {
      return sendJson(res, this.repository.searchGlobalProfile(query, limit));
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
