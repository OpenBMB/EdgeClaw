import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type CaseTraceRecord,
  type DashboardOverview,
  type DreamPipelineStatus,
  type DreamTraceRecord,
  type IndexTraceRecord,
  type IndexingSettings,
  type L0SessionRecord,
  MEMORY_EXPORT_FORMAT_VERSION,
  type MemoryExportBundle,
  type MemoryEntryEditFields,
  type MemoryFileRecord,
  type MemoryImportResult,
  type MemoryImportableBundle,
  type MemoryManifestEntry,
  type MemoryMessage,
  type MemorySnapshotFileRecord,
  type MemoryTransferCounts,
  type MemoryUiSnapshot,
} from "../types.js";
import { FileMemoryStore } from "../file-memory.js";
import { nowIso } from "../utils/id.js";

type DbRow = Record<string, unknown>;

const INDEXING_SETTINGS_STATE_KEY = "indexingSettings" as const;
const LAST_INDEXED_AT_STATE_KEY = "lastIndexedAt" as const;
const LAST_DREAM_AT_STATE_KEY = "lastDreamAt" as const;
const LAST_DREAM_STATUS_STATE_KEY = "lastDreamStatus" as const;
const LAST_DREAM_SUMMARY_STATE_KEY = "lastDreamSummary" as const;
const RECENT_CASE_TRACES_STATE_KEY = "recentCaseTraces" as const;
const RECENT_INDEX_TRACES_STATE_KEY = "recentIndexTraces" as const;
const RECENT_DREAM_TRACES_STATE_KEY = "recentDreamTraces" as const;

export class MemoryBundleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryBundleValidationError";
  }
}

export interface ClearMemoryResult {
  cleared: {
    l0Sessions: number;
    pipelineState: number;
    memoryFiles: number;
    projectMetas: number;
  };
  clearedAt: string;
}

export interface RepairMemoryResult {
  inspected: number;
  updated: number;
  removed: number;
  rebuilt: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeMessages(value: unknown): MemoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      ...(typeof item.msgId === "string" && item.msgId.trim() ? { msgId: item.msgId } : {}),
      role: typeof item.role === "string" && item.role.trim() ? item.role : "user",
      content: typeof item.content === "string" ? item.content : "",
    }));
}

function normalizeL0Row(row: DbRow): L0SessionRecord {
  return {
    l0IndexId: String(row.l0_index_id),
    sessionKey: String(row.session_key),
    timestamp: String(row.timestamp),
    messages: normalizeMessages(parseJson(String(row.messages_json ?? "[]"), [])),
    source: String(row.source ?? ""),
    indexed: Boolean(row.indexed),
    createdAt: String(row.created_at),
  };
}

function sanitizeTraceArray<T extends object>(
  value: unknown,
  key: keyof T & string,
  sortKey: keyof T & string,
): T[] {
  if (!Array.isArray(value)) return [];
  const sorted = value
    .filter((item): item is T => {
      if (!isRecord(item)) return false;
      const keyed = item as Record<string, unknown>;
      return typeof keyed[key] === "string" && typeof keyed[sortKey] === "string";
    })
    .sort((left, right) => {
      const rightValue = (right as Record<string, unknown>)[sortKey];
      const leftValue = (left as Record<string, unknown>)[sortKey];
      return String(rightValue).localeCompare(String(leftValue));
    });
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of sorted) {
    const id = String((item as Record<string, unknown>)[key]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(item);
  }
  return next;
}

function sanitizeDreamStatus(value: unknown): DreamPipelineStatus | undefined {
  return value === "running" || value === "success" || value === "skipped" || value === "failed"
    ? value
    : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number.parseInt(value, 10)
      : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function sanitizeIndexingSettings(input: unknown, defaults: IndexingSettings): IndexingSettings {
  const record = isRecord(input) ? input : {};
  return {
    reasoningMode: record.reasoningMode === "accuracy_first" ? "accuracy_first" : defaults.reasoningMode,
    autoIndexIntervalMinutes: clampInt(record.autoIndexIntervalMinutes, defaults.autoIndexIntervalMinutes, 0, 10_080),
    autoDreamIntervalMinutes: clampInt(record.autoDreamIntervalMinutes, defaults.autoDreamIntervalMinutes, 0, 10_080),
  };
}

function normalizeSnapshotRelativePath(value: unknown, index: number): string {
  const raw = normalizeString(value).trim().replace(/\\/g, "/");
  if (!raw) {
    throw new MemoryBundleValidationError(`Invalid files[${index}].relativePath`);
  }
  if (isAbsolute(raw)) {
    throw new MemoryBundleValidationError(`Invalid files[${index}].relativePath`);
  }
  const segments = raw.split("/").filter(Boolean);
  if (
    segments.length === 0
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new MemoryBundleValidationError(`Invalid files[${index}].relativePath`);
  }
  return segments.join("/");
}

function normalizeSnapshotFileRecord(value: unknown, index: number): MemorySnapshotFileRecord {
  if (!isRecord(value)) throw new MemoryBundleValidationError(`Invalid files[${index}]`);
  if (typeof value.content !== "string") {
    throw new MemoryBundleValidationError(`Invalid files[${index}].content`);
  }
  return {
    relativePath: normalizeSnapshotRelativePath(value.relativePath, index),
    content: value.content,
  };
}

function normalizeMemoryBundle(value: unknown): MemoryImportableBundle {
  if (!isRecord(value)) throw new MemoryBundleValidationError("Invalid memory bundle");
  const metadata = {
    exportedAt: normalizeString(value.exportedAt).trim() || nowIso(),
    ...(typeof value.lastIndexedAt === "string" && value.lastIndexedAt.trim() ? { lastIndexedAt: value.lastIndexedAt.trim() } : {}),
    ...(typeof value.lastDreamAt === "string" && value.lastDreamAt.trim() ? { lastDreamAt: value.lastDreamAt.trim() } : {}),
    ...(sanitizeDreamStatus(value.lastDreamStatus) ? { lastDreamStatus: sanitizeDreamStatus(value.lastDreamStatus)! } : {}),
    ...(typeof value.lastDreamSummary === "string" && value.lastDreamSummary.trim()
      ? { lastDreamSummary: value.lastDreamSummary.trim() }
      : {}),
    ...(sanitizeTraceArray<CaseTraceRecord>(value.recentCaseTraces, "caseId", "startedAt").length > 0
      ? { recentCaseTraces: sanitizeTraceArray<CaseTraceRecord>(value.recentCaseTraces, "caseId", "startedAt") }
      : {}),
    ...(sanitizeTraceArray<IndexTraceRecord>(value.recentIndexTraces, "indexTraceId", "startedAt").length > 0
      ? { recentIndexTraces: sanitizeTraceArray<IndexTraceRecord>(value.recentIndexTraces, "indexTraceId", "startedAt") }
      : {}),
    ...(sanitizeTraceArray<DreamTraceRecord>(value.recentDreamTraces, "dreamTraceId", "startedAt").length > 0
      ? { recentDreamTraces: sanitizeTraceArray<DreamTraceRecord>(value.recentDreamTraces, "dreamTraceId", "startedAt") }
      : {}),
  };
  if (value.formatVersion === MEMORY_EXPORT_FORMAT_VERSION) {
    if (!Array.isArray(value.files)) {
      throw new MemoryBundleValidationError("Invalid memory snapshot bundle files");
    }
    const files = value.files.map((item, index) => normalizeSnapshotFileRecord(item, index));
    const seenPaths = new Set<string>();
    for (const record of files) {
      if (seenPaths.has(record.relativePath)) {
        throw new MemoryBundleValidationError(`Duplicate imported snapshot file path: ${record.relativePath}`);
      }
      seenPaths.add(record.relativePath);
    }
    return {
      formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
      ...metadata,
      files,
    };
  }
  throw new MemoryBundleValidationError("Unsupported memory bundle formatVersion");
}

function isPathWithinRoot(rootDir: string, targetPath: string): boolean {
  const rel = relative(resolve(rootDir), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function createSiblingTempPath(targetDir: string, label: string): string {
  const parentDir = dirname(targetDir);
  return join(
    parentDir,
    `.${basename(targetDir)}.${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

export class MemoryRepository {
  private readonly db: DatabaseSync;
  private readonly fileMemory: FileMemoryStore;

  constructor(
    dbPath: string,
    options: {
      memoryDir?: string;
    } = {},
  ) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const memoryDir = options.memoryDir ?? join(dirname(dbPath), "memory");
    mkdirSync(memoryDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.fileMemory = new FileMemoryStore(memoryDir);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS l0_sessions (
        l0_index_id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        source TEXT NOT NULL,
        indexed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_l0_sessions_session ON l0_sessions(session_key);
      CREATE INDEX IF NOT EXISTS idx_l0_sessions_pending ON l0_sessions(indexed, timestamp);
      CREATE TABLE IF NOT EXISTS pipeline_state (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.migratePipelineStateTable();
  }

  private migratePipelineStateTable(): void {
    const columns = this.db.prepare("PRAGMA table_info(pipeline_state)").all() as DbRow[];
    const columnNames = new Set(
      columns
        .map((column) => String(column.name ?? "").trim())
        .filter(Boolean),
    );
    if (columnNames.has("state_json") && !columnNames.has("state_value")) return;
    if (!columnNames.has("state_json") && !columnNames.has("state_value")) return;

    const sourceExpr = columnNames.has("state_json")
      ? (columnNames.has("state_value") ? "COALESCE(state_json, state_value)" : "state_json")
      : "state_value";

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
      DROP TABLE IF EXISTS pipeline_state_v2;
      CREATE TABLE pipeline_state_v2 (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO pipeline_state_v2 (state_key, state_json, updated_at)
      SELECT
        state_key,
        ${sourceExpr},
        updated_at
      FROM pipeline_state;
      DROP TABLE pipeline_state;
      ALTER TABLE pipeline_state_v2 RENAME TO pipeline_state;
    `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  getFileMemoryStore(): FileMemoryStore {
    return this.fileMemory;
  }

  private readPipelineState<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT state_json FROM pipeline_state WHERE state_key = ?").get(key) as DbRow | undefined;
    if (!row || typeof row.state_json !== "string") return fallback;
    return parseJson(row.state_json, fallback);
  }

  getPipelineState<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare("SELECT state_json FROM pipeline_state WHERE state_key = ?").get(key) as DbRow | undefined;
    if (!row || typeof row.state_json !== "string") return undefined;
    return parseJson<T | undefined>(row.state_json, undefined);
  }

  setPipelineState(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO pipeline_state (state_key, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), nowIso());
  }

  deletePipelineState(key: string): void {
    this.db.prepare("DELETE FROM pipeline_state WHERE state_key = ?").run(key);
  }

  insertL0Session(record: L0SessionRecord): void {
    const createdAt = record.createdAt || nowIso();
    this.db.prepare(`
      INSERT INTO l0_sessions (
        l0_index_id,
        session_key,
        timestamp,
        messages_json,
        source,
        indexed,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(l0_index_id) DO UPDATE SET
        session_key = excluded.session_key,
        timestamp = excluded.timestamp,
        messages_json = excluded.messages_json,
        source = excluded.source,
        indexed = excluded.indexed,
        created_at = excluded.created_at
    `).run(
      record.l0IndexId,
      record.sessionKey,
      record.timestamp,
      JSON.stringify(record.messages),
      record.source || "openclaw",
      record.indexed ? 1 : 0,
      createdAt,
    );
  }

  listPendingSessionKeys(limit = 50, preferredSessionKeys?: string[]): string[] {
    const normalizedPreferred = Array.isArray(preferredSessionKeys)
      ? preferredSessionKeys.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (normalizedPreferred.length > 0) {
      const placeholders = normalizedPreferred.map(() => "?").join(", ");
      const rows = this.db.prepare(`
        SELECT DISTINCT session_key, MIN(timestamp) AS first_timestamp
        FROM l0_sessions
        WHERE indexed = 0 AND session_key IN (${placeholders})
        GROUP BY session_key
        ORDER BY first_timestamp ASC
      `).all(...normalizedPreferred) as DbRow[];
      return rows.map((row) => String(row.session_key)).slice(0, Math.max(1, limit));
    }
    const rows = this.db.prepare(`
      SELECT DISTINCT session_key, MIN(timestamp) AS first_timestamp
      FROM l0_sessions
      WHERE indexed = 0
      GROUP BY session_key
      ORDER BY first_timestamp ASC
      LIMIT ?
    `).all(Math.max(1, limit)) as DbRow[];
    return rows.map((row) => String(row.session_key));
  }

  listUnindexedL0BySession(sessionKey: string): L0SessionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM l0_sessions
      WHERE session_key = ? AND indexed = 0
      ORDER BY timestamp ASC, created_at ASC
    `).all(sessionKey) as DbRow[];
    return rows.map((row) => normalizeL0Row(row));
  }

  getLatestL0Before(sessionKey: string, timestamp: string, createdAt: string): L0SessionRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM l0_sessions
      WHERE session_key = ?
        AND (timestamp < ? OR (timestamp = ? AND created_at < ?))
      ORDER BY timestamp DESC, created_at DESC
      LIMIT 1
    `).get(sessionKey, timestamp, timestamp, createdAt) as DbRow | undefined;
    return row ? normalizeL0Row(row) : undefined;
  }

  markL0Indexed(ids: string[]): void {
    const uniqueIds = Array.from(new Set(ids.filter((item) => typeof item === "string" && item.trim().length > 0)));
    if (uniqueIds.length === 0) return;
    const placeholders = uniqueIds.map(() => "?").join(", ");
    this.db.prepare(`UPDATE l0_sessions SET indexed = 1 WHERE l0_index_id IN (${placeholders})`).run(...uniqueIds);
  }

  getL0ByIds(ids: string[]): L0SessionRecord[] {
    const uniqueIds = Array.from(new Set(ids.filter((item) => typeof item === "string" && item.trim().length > 0)));
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM l0_sessions
      WHERE l0_index_id IN (${placeholders})
      ORDER BY timestamp DESC, created_at DESC
    `).all(...uniqueIds) as DbRow[];
    return rows.map((row) => normalizeL0Row(row));
  }

  listRecentL0(limit = 20, offset = 0): L0SessionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM l0_sessions
      ORDER BY timestamp DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(Math.max(1, limit), Math.max(0, offset)) as DbRow[];
    return rows.map((row) => normalizeL0Row(row));
  }

  listAllL0(): L0SessionRecord[] {
    const rows = this.db.prepare("SELECT * FROM l0_sessions ORDER BY timestamp ASC, created_at ASC").all() as DbRow[];
    return rows.map((row) => normalizeL0Row(row));
  }

  repairL0Sessions(transform: (record: L0SessionRecord) => MemoryMessage[]): RepairMemoryResult {
    const rows = this.listAllL0();
    let updated = 0;
    let removed = 0;
    for (const row of rows) {
      const nextMessages = transform(row);
      if (nextMessages.length === 0) {
        this.db.prepare("DELETE FROM l0_sessions WHERE l0_index_id = ?").run(row.l0IndexId);
        removed += 1;
        continue;
      }
      if (JSON.stringify(nextMessages) === JSON.stringify(row.messages)) continue;
      this.db.prepare("UPDATE l0_sessions SET messages_json = ?, indexed = 0 WHERE l0_index_id = ?")
        .run(JSON.stringify(nextMessages), row.l0IndexId);
      updated += 1;
    }
    return {
      inspected: rows.length,
      updated,
      removed,
      rebuilt: updated > 0 || removed > 0,
    };
  }

  saveCaseTrace(record: CaseTraceRecord, limit = 30): void {
    const next = sanitizeTraceArray<CaseTraceRecord>(
      [record, ...this.readPipelineState<unknown[]>(RECENT_CASE_TRACES_STATE_KEY, [])],
      "caseId",
      "startedAt",
    ).slice(0, Math.max(1, limit));
    this.setPipelineState(RECENT_CASE_TRACES_STATE_KEY, next);
  }

  listRecentCaseTraces(limit = 30): CaseTraceRecord[] {
    return sanitizeTraceArray<CaseTraceRecord>(
      this.readPipelineState<unknown[]>(RECENT_CASE_TRACES_STATE_KEY, []),
      "caseId",
      "startedAt",
    ).slice(0, Math.max(1, limit));
  }

  getCaseTrace(caseId: string): CaseTraceRecord | undefined {
    return this.listRecentCaseTraces(200).find((item) => item.caseId === caseId);
  }

  saveIndexTrace(record: IndexTraceRecord, limit = 30): void {
    const next = sanitizeTraceArray<IndexTraceRecord>(
      [record, ...this.readPipelineState<unknown[]>(RECENT_INDEX_TRACES_STATE_KEY, [])],
      "indexTraceId",
      "startedAt",
    ).slice(0, Math.max(1, limit));
    this.setPipelineState(RECENT_INDEX_TRACES_STATE_KEY, next);
  }

  listRecentIndexTraces(limit = 30): IndexTraceRecord[] {
    return sanitizeTraceArray<IndexTraceRecord>(
      this.readPipelineState<unknown[]>(RECENT_INDEX_TRACES_STATE_KEY, []),
      "indexTraceId",
      "startedAt",
    ).slice(0, Math.max(1, limit));
  }

  getIndexTrace(indexTraceId: string): IndexTraceRecord | undefined {
    return this.listRecentIndexTraces(200).find((item) => item.indexTraceId === indexTraceId);
  }

  saveDreamTrace(record: DreamTraceRecord, limit = 30): void {
    const next = sanitizeTraceArray<DreamTraceRecord>(
      [record, ...this.readPipelineState<unknown[]>(RECENT_DREAM_TRACES_STATE_KEY, [])],
      "dreamTraceId",
      "startedAt",
    ).slice(0, Math.max(1, limit));
    this.setPipelineState(RECENT_DREAM_TRACES_STATE_KEY, next);
  }

  listRecentDreamTraces(limit = 30): DreamTraceRecord[] {
    return sanitizeTraceArray<DreamTraceRecord>(
      this.readPipelineState<unknown[]>(RECENT_DREAM_TRACES_STATE_KEY, []),
      "dreamTraceId",
      "startedAt",
    ).slice(0, Math.max(1, limit));
  }

  getDreamTrace(dreamTraceId: string): DreamTraceRecord | undefined {
    return this.listRecentDreamTraces(200).find((item) => item.dreamTraceId === dreamTraceId);
  }

  getIndexingSettings(defaults: IndexingSettings): IndexingSettings {
    return sanitizeIndexingSettings(this.getPipelineState(INDEXING_SETTINGS_STATE_KEY), defaults);
  }

  saveIndexingSettings(partial: Partial<IndexingSettings>, defaults: IndexingSettings): IndexingSettings {
    const current = this.getIndexingSettings(defaults);
    const next = sanitizeIndexingSettings({ ...current, ...partial }, defaults);
    this.setPipelineState(INDEXING_SETTINGS_STATE_KEY, next);
    return next;
  }

  private buildTransferCounts(store: FileMemoryStore): MemoryTransferCounts {
    const imported = store.exportBundleRecords({ includeTmp: true });
    return {
      managedFiles: store.exportSnapshotFiles().length,
      memoryFiles: imported.memoryFiles.length,
      project: imported.memoryFiles.filter((item) => item.type === "project" && item.projectId && item.projectId !== "_tmp").length,
      feedback: imported.memoryFiles.filter((item) => item.type === "feedback" && item.projectId && item.projectId !== "_tmp").length,
      user: imported.memoryFiles.filter((item) => item.type === "user").length,
      tmp: imported.memoryFiles.filter((item) => item.projectId === "_tmp").length,
      projectMetas: imported.projectMetas.length,
    };
  }

  private materializeSnapshotBundle(rootDir: string, bundle: MemoryExportBundle): FileMemoryStore {
    mkdirSync(rootDir, { recursive: true });
    for (const record of bundle.files) {
      const absolutePath = resolve(rootDir, record.relativePath);
      if (!isPathWithinRoot(rootDir, absolutePath) || absolutePath === resolve(rootDir)) {
        throw new MemoryBundleValidationError(`Invalid imported snapshot file path: ${record.relativePath}`);
      }
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, record.content, "utf-8");
    }
    const store = new FileMemoryStore(rootDir);
    store.repairManifests();
    return store;
  }

  private stageImportBundle(bundle: MemoryImportableBundle): { stagedRoot: string; counts: MemoryTransferCounts } {
    const liveRoot = this.fileMemory.getRootDir();
    const stagedRoot = createSiblingTempPath(liveRoot, "import");
    mkdirSync(stagedRoot, { recursive: true });
    try {
      const stagedStore = this.materializeSnapshotBundle(stagedRoot, bundle);
      return {
        stagedRoot,
        counts: this.buildTransferCounts(stagedStore),
      };
    } catch (error) {
      rmSync(stagedRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private swapInStagedMemoryRoot(stagedRoot: string): void {
    const liveRoot = this.fileMemory.getRootDir();
    const backupRoot = createSiblingTempPath(liveRoot, "backup");
    let movedLiveRoot = false;
    try {
      if (existsSync(liveRoot)) {
        renameSync(liveRoot, backupRoot);
        movedLiveRoot = true;
      }
      renameSync(stagedRoot, liveRoot);
    } catch (error) {
      if (existsSync(stagedRoot)) {
        rmSync(stagedRoot, { recursive: true, force: true });
      }
      if (movedLiveRoot && !existsSync(liveRoot) && existsSync(backupRoot)) {
        renameSync(backupRoot, liveRoot);
      }
      throw error;
    }
    if (movedLiveRoot && existsSync(backupRoot)) {
      try {
        rmSync(backupRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; the live memory root has already been swapped in.
      }
    }
  }

  private resetImportedRuntimeState(bundle: MemoryImportableBundle): void {
    this.db.exec("DELETE FROM l0_sessions;");
    for (const key of [
      RECENT_CASE_TRACES_STATE_KEY,
      RECENT_INDEX_TRACES_STATE_KEY,
      RECENT_DREAM_TRACES_STATE_KEY,
      LAST_INDEXED_AT_STATE_KEY,
      LAST_DREAM_AT_STATE_KEY,
      LAST_DREAM_STATUS_STATE_KEY,
      LAST_DREAM_SUMMARY_STATE_KEY,
    ]) {
      this.deletePipelineState(key);
    }
    if (bundle.lastIndexedAt) this.setPipelineState(LAST_INDEXED_AT_STATE_KEY, bundle.lastIndexedAt);
    if (bundle.lastDreamAt) this.setPipelineState(LAST_DREAM_AT_STATE_KEY, bundle.lastDreamAt);
    if (bundle.lastDreamStatus) this.setPipelineState(LAST_DREAM_STATUS_STATE_KEY, bundle.lastDreamStatus);
    if (bundle.lastDreamSummary) this.setPipelineState(LAST_DREAM_SUMMARY_STATE_KEY, bundle.lastDreamSummary);
    if (bundle.recentCaseTraces) this.setPipelineState(RECENT_CASE_TRACES_STATE_KEY, bundle.recentCaseTraces);
    if (bundle.recentIndexTraces) this.setPipelineState(RECENT_INDEX_TRACES_STATE_KEY, bundle.recentIndexTraces);
    if (bundle.recentDreamTraces) this.setPipelineState(RECENT_DREAM_TRACES_STATE_KEY, bundle.recentDreamTraces);
  }

  exportMemoryBundle(): MemoryExportBundle {
    return {
      formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
      exportedAt: nowIso(),
      ...(typeof this.getPipelineState<string>(LAST_INDEXED_AT_STATE_KEY) === "string"
        ? { lastIndexedAt: this.getPipelineState<string>(LAST_INDEXED_AT_STATE_KEY)! }
        : {}),
      ...(typeof this.getPipelineState<string>(LAST_DREAM_AT_STATE_KEY) === "string"
        ? { lastDreamAt: this.getPipelineState<string>(LAST_DREAM_AT_STATE_KEY)! }
        : {}),
      ...(sanitizeDreamStatus(this.getPipelineState(LAST_DREAM_STATUS_STATE_KEY))
        ? { lastDreamStatus: sanitizeDreamStatus(this.getPipelineState(LAST_DREAM_STATUS_STATE_KEY))! }
        : {}),
      ...(typeof this.getPipelineState<string>(LAST_DREAM_SUMMARY_STATE_KEY) === "string"
        ? { lastDreamSummary: this.getPipelineState<string>(LAST_DREAM_SUMMARY_STATE_KEY)! }
        : {}),
      ...(this.listRecentCaseTraces(200).length > 0 ? { recentCaseTraces: this.listRecentCaseTraces(200) } : {}),
      ...(this.listRecentIndexTraces(200).length > 0 ? { recentIndexTraces: this.listRecentIndexTraces(200) } : {}),
      ...(this.listRecentDreamTraces(200).length > 0 ? { recentDreamTraces: this.listRecentDreamTraces(200) } : {}),
      files: this.fileMemory.exportSnapshotFiles(),
    };
  }

  importMemoryBundle(bundle: MemoryImportableBundle): MemoryImportResult {
    const normalized = normalizeMemoryBundle(bundle);
    const staged = this.stageImportBundle(normalized);
    this.swapInStagedMemoryRoot(staged.stagedRoot);
    this.resetImportedRuntimeState(normalized);
    return {
      formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
      imported: staged.counts,
      importedAt: nowIso(),
      ...(normalized.lastIndexedAt ? { lastIndexedAt: normalized.lastIndexedAt } : {}),
      ...(normalized.lastDreamAt ? { lastDreamAt: normalized.lastDreamAt } : {}),
      ...(normalized.lastDreamStatus ? { lastDreamStatus: normalized.lastDreamStatus } : {}),
      ...(normalized.lastDreamSummary ? { lastDreamSummary: normalized.lastDreamSummary } : {}),
      ...(normalized.recentCaseTraces ? { recentCaseTraces: normalized.recentCaseTraces } : {}),
      ...(normalized.recentIndexTraces ? { recentIndexTraces: normalized.recentIndexTraces } : {}),
      ...(normalized.recentDreamTraces ? { recentDreamTraces: normalized.recentDreamTraces } : {}),
    };
  }

  getOverview(): DashboardOverview {
    const pendingSessions = Number(
      (this.db.prepare("SELECT COUNT(DISTINCT session_key) AS count FROM l0_sessions WHERE indexed = 0").get() as DbRow | undefined)?.count ?? 0,
    );
    const lastDreamAt = this.getPipelineState<string>(LAST_DREAM_AT_STATE_KEY);
    const fileOverview = this.fileMemory.getOverview(typeof lastDreamAt === "string" ? lastDreamAt : undefined);
    const recentRecallTraceCount = this.listRecentCaseTraces(12).length;
    const recentIndexTraceCount = this.listRecentIndexTraces(30).length;
    const recentDreamTraceCount = this.listRecentDreamTraces(30).length;
    const formalProjectCount = this.fileMemory.listProjectMetas()
      .filter((meta) => this.fileMemory.hasVisibleProjectMemory(meta.projectId))
      .length;
    const userProfileCount = this.fileMemory.listMemoryEntries({
      kinds: ["user"],
      scope: "global",
      limit: 10,
    }).some((entry) => entry.relativePath === "global/User/user-profile.md")
      ? 1
      : 0;
    return {
      pendingSessions,
      formalProjectCount,
      userProfileCount,
      tmpTotalFiles: fileOverview.tmpTotalFiles,
      recentRecallTraceCount,
      recentIndexTraceCount,
      recentDreamTraceCount,
      ...(typeof this.getPipelineState<string>(LAST_INDEXED_AT_STATE_KEY) === "string"
        ? { lastIndexedAt: this.getPipelineState<string>(LAST_INDEXED_AT_STATE_KEY)! }
        : {}),
      ...(typeof lastDreamAt === "string" ? { lastDreamAt } : {}),
      ...(sanitizeDreamStatus(this.getPipelineState(LAST_DREAM_STATUS_STATE_KEY))
        ? { lastDreamStatus: sanitizeDreamStatus(this.getPipelineState(LAST_DREAM_STATUS_STATE_KEY))! }
        : {}),
      ...(typeof this.getPipelineState<string>(LAST_DREAM_SUMMARY_STATE_KEY) === "string"
        ? { lastDreamSummary: this.getPipelineState<string>(LAST_DREAM_SUMMARY_STATE_KEY)! }
        : {}),
    };
  }

  getUiSnapshot(limit = 50): MemoryUiSnapshot {
    return {
      overview: this.getOverview(),
      settings: this.getIndexingSettings({
        reasoningMode: "answer_first",
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
      }),
      recentMemoryFiles: this.fileMemory.listMemoryEntries({ includeTmp: true, limit }),
    };
  }

  listMemoryEntries(options: {
    kinds?: Array<"user" | "feedback" | "project">;
    query?: string;
    limit?: number;
    offset?: number;
    scope?: "global" | "project";
    projectId?: string;
    includeTmp?: boolean;
    includeDeprecated?: boolean;
  } = {}): MemoryManifestEntry[] {
    return this.fileMemory.listMemoryEntries(options);
  }

  countMemoryEntries(options: {
    kinds?: Array<"user" | "feedback" | "project">;
    query?: string;
    scope?: "global" | "project";
    projectId?: string;
    includeTmp?: boolean;
    includeDeprecated?: boolean;
  } = {}): number {
    return this.fileMemory.countMemoryEntries(options);
  }

  getMemoryRecordsByIds(ids: string[], maxLines = 80): MemoryFileRecord[] {
    return this.fileMemory.getMemoryRecordsByIds(ids, maxLines);
  }

  editProjectMeta(input: {
    projectId: string;
    projectName: string;
    description: string;
    aliases?: string[];
    status: string;
  }) {
    return this.fileMemory.editProjectMeta(input);
  }

  editMemoryEntry(input: {
    id: string;
    name: string;
    description: string;
    fields?: MemoryEntryEditFields;
  }) {
    return this.fileMemory.editEntry({
      relativePath: input.id,
      name: input.name,
      description: input.description,
      ...(input.fields ? { fields: input.fields } : {}),
    });
  }

  deleteMemoryEntries(ids: string[]) {
    return this.fileMemory.deleteEntries(ids);
  }

  deprecateMemoryEntries(ids: string[]) {
    return this.fileMemory.markEntriesDeprecated(ids);
  }

  restoreMemoryEntries(ids: string[]) {
    return this.fileMemory.restoreEntries(ids);
  }

  archiveTmpEntries(input: {
    ids: string[];
    targetProjectId?: string;
    newProjectName?: string;
  }) {
    return this.fileMemory.archiveTmpEntries({
      relativePaths: input.ids,
      ...(input.targetProjectId ? { targetProjectId: input.targetProjectId } : {}),
      ...(input.newProjectName ? { newProjectName: input.newProjectName } : {}),
    });
  }

  getSnapshotVersion(): string {
    return this.fileMemory.getSnapshotVersion(this.getPipelineState<string>(LAST_DREAM_AT_STATE_KEY));
  }

  clearAllMemoryData(): ClearMemoryResult {
    const l0Sessions = Number((this.db.prepare("SELECT COUNT(*) AS count FROM l0_sessions").get() as DbRow | undefined)?.count ?? 0);
    const pipelineState = Number((this.db.prepare("SELECT COUNT(*) AS count FROM pipeline_state").get() as DbRow | undefined)?.count ?? 0);
    const before = this.fileMemory.exportBundleRecords({ includeTmp: true });
    this.db.exec(`
      DELETE FROM l0_sessions;
      DELETE FROM pipeline_state;
    `);
    this.fileMemory.clearAllData();
    return {
      cleared: {
        l0Sessions,
        pipelineState,
        memoryFiles: before.memoryFiles.length,
        projectMetas: before.projectMetas.length,
      },
      clearedAt: nowIso(),
    };
  }
}
