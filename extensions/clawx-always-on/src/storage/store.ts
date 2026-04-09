import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalAlwaysOnSessionKey } from "../core/constants.js";
import type { AlwaysOnTask, BudgetUsage, TaskFilter, TaskUpdatePatch } from "../core/types.js";

function parseBudgetUsage(raw: string): BudgetUsage {
  return JSON.parse(raw) as BudgetUsage;
}

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA temp_store = MEMORY;");
  return db;
}

export class TaskStore {
  constructor(readonly db: DatabaseSync) {
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const version = this.getSchemaVersion();

    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS always_on_tasks (
          id                TEXT PRIMARY KEY,
          title             TEXT NOT NULL,
          status            TEXT NOT NULL DEFAULT 'pending',
          sourceType        TEXT NOT NULL,
          sourceMetadata    TEXT,
          budgetConstraints TEXT NOT NULL DEFAULT '[]',
          budgetUsage       TEXT NOT NULL DEFAULT '{}',
          sessionKey        TEXT,
          progressSummary   TEXT,
          resultSummary     TEXT,
          createdAt         INTEGER NOT NULL,
          startedAt         INTEGER,
          suspendedAt       INTEGER,
          completedAt       INTEGER,
          runCount          INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON always_on_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_session ON always_on_tasks(sessionKey);
      `);
      this.setSchemaVersion(1);
    }
  }

  private getSchemaVersion(): number {
    const stmt = this.db.prepare("SELECT value FROM kv_meta WHERE key = 'schema_version'");
    const row = stmt.get() as { value: string } | undefined;
    return row ? Number.parseInt(row.value, 10) : 0;
  }

  private setSchemaVersion(v: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO kv_meta (key, value) VALUES ('schema_version', ?)")
      .run(String(v));
  }

  createTask(task: AlwaysOnTask): void {
    this.db
      .prepare(`
      INSERT INTO always_on_tasks
        (id, title, status, sourceType, sourceMetadata,
         budgetConstraints, budgetUsage, sessionKey,
         progressSummary, resultSummary,
         createdAt, startedAt, suspendedAt, completedAt, runCount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        task.id,
        task.title,
        task.status,
        task.sourceType,
        task.sourceMetadata ?? null,
        task.budgetConstraints,
        task.budgetUsage,
        task.sessionKey ?? null,
        task.progressSummary ?? null,
        task.resultSummary ?? null,
        task.createdAt,
        task.startedAt ?? null,
        task.suspendedAt ?? null,
        task.completedAt ?? null,
        task.runCount,
      );
  }

  getTask(id: string): AlwaysOnTask | undefined {
    const row = this.db.prepare("SELECT * FROM always_on_tasks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  getTaskBySessionKey(sessionKey: string): AlwaysOnTask | undefined {
    const canonicalSessionKey = canonicalAlwaysOnSessionKey(sessionKey);
    if (!canonicalSessionKey) return undefined;

    const row = this.db
      .prepare("SELECT * FROM always_on_tasks WHERE sessionKey = ?")
      .get(canonicalSessionKey) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  updateBudgetUsage(id: string, updater: (usage: BudgetUsage) => void): BudgetUsage | undefined {
    const row = this.db.prepare("SELECT budgetUsage FROM always_on_tasks WHERE id = ?").get(id) as
      | { budgetUsage?: unknown }
      | undefined;
    if (!row || typeof row.budgetUsage !== "string") {
      return undefined;
    }

    const usage = parseBudgetUsage(row.budgetUsage);
    updater(usage);
    this.db
      .prepare("UPDATE always_on_tasks SET budgetUsage = ? WHERE id = ?")
      .run(JSON.stringify(usage), id);
    return usage;
  }

  getActiveTask(): AlwaysOnTask | undefined {
    const row = this.db
      .prepare("SELECT * FROM always_on_tasks WHERE status = 'active' LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  countRunningTasks(): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM always_on_tasks
        WHERE status IN ('launching', 'active')
      `)
      .get() as { count?: unknown } | undefined;
    return typeof row?.count === "number" ? row.count : Number(row?.count ?? 0);
  }

  listRunningTasks(): AlwaysOnTask[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM always_on_tasks
        WHERE status IN ('launching', 'active')
        ORDER BY CASE status
          WHEN 'active' THEN 0
          WHEN 'launching' THEN 1
          ELSE 2
        END, createdAt ASC
      `)
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  getInFlightTask(): AlwaysOnTask | undefined {
    const row = this.db
      .prepare(`
        SELECT * FROM always_on_tasks
        WHERE status IN ('queued', 'launching', 'active')
        ORDER BY CASE status
          WHEN 'active' THEN 0
          WHEN 'launching' THEN 1
          ELSE 2
        END, createdAt ASC
        LIMIT 1
      `)
      .get() as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  getQueuedTasks(limit = 10): AlwaysOnTask[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM always_on_tasks WHERE status = 'queued' ORDER BY createdAt ASC LIMIT ?",
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  claimQueuedTask(id: string): boolean {
    const result = this.db
      .prepare("UPDATE always_on_tasks SET status = 'launching' WHERE id = ? AND status = 'queued'")
      .run(id) as { changes?: number };
    return result.changes === 1;
  }

  getResumableTasks(): AlwaysOnTask[] {
    const rows = this.db
      .prepare("SELECT * FROM always_on_tasks WHERE status = 'suspended' ORDER BY suspendedAt DESC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  listTasks(filter?: TaskFilter): AlwaysOnTask[] {
    if (filter?.status) {
      const rows = this.db
        .prepare("SELECT * FROM always_on_tasks WHERE status = ? ORDER BY createdAt DESC")
        .all(filter.status) as Record<string, unknown>[];
      return rows.map((r) => this.rowToTask(r));
    }
    const rows = this.db
      .prepare("SELECT * FROM always_on_tasks ORDER BY createdAt DESC")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  updateTask(id: string, patch: TaskUpdatePatch): void {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }

    if (sets.length === 0) return;

    values.push(id);
    this.db.prepare(`UPDATE always_on_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  close(): void {
    this.db.close();
  }

  private rowToTask(row: Record<string, unknown>): AlwaysOnTask {
    return {
      id: row.id as string,
      title: row.title as string,
      status: row.status as AlwaysOnTask["status"],
      sourceType: row.sourceType as string,
      sourceMetadata: (row.sourceMetadata as string) ?? undefined,
      budgetConstraints: row.budgetConstraints as string,
      budgetUsage: row.budgetUsage as string,
      sessionKey: (row.sessionKey as string) ?? undefined,
      progressSummary: (row.progressSummary as string) ?? undefined,
      resultSummary: (row.resultSummary as string) ?? undefined,
      createdAt: row.createdAt as number,
      startedAt: (row.startedAt as number) ?? undefined,
      suspendedAt: (row.suspendedAt as number) ?? undefined,
      completedAt: (row.completedAt as number) ?? undefined,
      runCount: row.runCount as number,
    };
  }
}
