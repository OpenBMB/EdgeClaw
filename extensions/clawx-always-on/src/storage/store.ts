import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalAlwaysOnSessionKey } from "../core/constants.js";
import type {
  AlwaysOnDreamRun,
  AlwaysOnTask,
  AlwaysOnTaskCheckpoint,
  AlwaysOnTaskRun,
  BudgetUsage,
  DreamRunUpdatePatch,
  TaskCheckpointKind,
  TaskFilter,
  TaskRunStatus,
  TaskRunUpdatePatch,
  TaskUpdatePatch,
} from "../core/types.js";
import type { AlwaysOnPlan, AlwaysOnPlanTurn, AlwaysOnPlanUpdatePatch } from "../plan/types.js";

function parseBudgetUsage(raw: string): BudgetUsage {
  return JSON.parse(raw) as BudgetUsage;
}

function parsePlanTurns(raw: string): AlwaysOnPlanTurn[] {
  return JSON.parse(raw) as AlwaysOnPlanTurn[];
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

    if (version < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS always_on_plans (
          id              TEXT PRIMARY KEY,
          conversationKey TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'active',
          initialPrompt   TEXT NOT NULL,
          turnsJson       TEXT NOT NULL DEFAULT '[]',
          roundCount      INTEGER NOT NULL DEFAULT 0,
          originSessionKey TEXT,
          finalPrompt     TEXT,
          createdTaskId   TEXT,
          failureReason   TEXT,
          createdAt       INTEGER NOT NULL,
          updatedAt       INTEGER NOT NULL,
          completedAt     INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_plans_status ON always_on_plans(status);
        CREATE INDEX IF NOT EXISTS idx_plans_conversation ON always_on_plans(conversationKey);
        CREATE INDEX IF NOT EXISTS idx_plans_origin_session ON always_on_plans(originSessionKey);
      `);
      this.setSchemaVersion(2);
    }

    if (version < 3) {
      this.db.exec(`
        ALTER TABLE always_on_tasks ADD COLUMN provider TEXT;
        ALTER TABLE always_on_tasks ADD COLUMN model TEXT;
        ALTER TABLE always_on_tasks ADD COLUMN budgetExceededAction TEXT NOT NULL DEFAULT 'warn';
        ALTER TABLE always_on_tasks ADD COLUMN deliverySessionKey TEXT;

        CREATE TABLE IF NOT EXISTS always_on_task_runs (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          taskId              TEXT NOT NULL,
          runOrdinal          INTEGER NOT NULL,
          runId               TEXT,
          sessionKey          TEXT NOT NULL,
          provider            TEXT,
          model               TEXT,
          status              TEXT NOT NULL,
          error               TEXT,
          budgetUsageSnapshot TEXT,
          startedAt           INTEGER NOT NULL,
          endedAt             INTEGER,
          createdAt           INTEGER NOT NULL,
          UNIQUE(taskId, runOrdinal)
        );
        CREATE INDEX IF NOT EXISTS idx_task_runs_task ON always_on_task_runs(taskId);
        CREATE INDEX IF NOT EXISTS idx_task_runs_session ON always_on_task_runs(sessionKey);

        CREATE TABLE IF NOT EXISTS always_on_task_checkpoints (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          taskId     TEXT NOT NULL,
          runOrdinal INTEGER NOT NULL,
          kind       TEXT NOT NULL,
          content    TEXT NOT NULL,
          metadata   TEXT,
          createdAt  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_task_checkpoints_task ON always_on_task_checkpoints(taskId);
        CREATE INDEX IF NOT EXISTS idx_task_checkpoints_run ON always_on_task_checkpoints(taskId, runOrdinal);

        CREATE TABLE IF NOT EXISTS always_on_dream_runs (
          id                   TEXT PRIMARY KEY,
          status               TEXT NOT NULL,
          trigger              TEXT NOT NULL,
          sourceSessionKey     TEXT,
          sourceConversationKey TEXT,
          summary              TEXT,
          createdTaskIdsJson   TEXT NOT NULL DEFAULT '[]',
          failureReason        TEXT,
          createdAt            INTEGER NOT NULL,
          completedAt          INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_dream_runs_created_at ON always_on_dream_runs(createdAt);
      `);
      this.setSchemaVersion(3);
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
        (id, title, status, sourceType, sourceMetadata, provider, model, budgetExceededAction, deliverySessionKey,
         budgetConstraints, budgetUsage, sessionKey,
         progressSummary, resultSummary,
         createdAt, startedAt, suspendedAt, completedAt, runCount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        task.id,
        task.title,
        task.status,
        task.sourceType,
        task.sourceMetadata ?? null,
        task.provider ?? null,
        task.model ?? null,
        task.budgetExceededAction,
        task.deliverySessionKey ?? null,
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
      .prepare(`
        SELECT * FROM always_on_tasks
        WHERE status IN ('suspended', 'failed')
        ORDER BY COALESCE(suspendedAt, createdAt) DESC
      `)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  startPendingTask(id: string): boolean {
    const result = this.db
      .prepare("UPDATE always_on_tasks SET status = 'queued' WHERE id = ? AND status = 'pending'")
      .run(id) as { changes?: number };
    return result.changes === 1;
  }

  listTasks(filter?: TaskFilter): AlwaysOnTask[] {
    const where: string[] = [];
    const values: string[] = [];
    if (filter?.status) {
      where.push("status = ?");
      values.push(filter.status);
    }
    if (filter?.sourceType) {
      where.push("sourceType = ?");
      values.push(filter.sourceType);
    }
    const sql =
      `SELECT * FROM always_on_tasks` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY createdAt DESC`;
    const rows = this.db.prepare(sql).all(...values) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  createTaskRun(run: Omit<AlwaysOnTaskRun, "id">): number {
    const result = this.db
      .prepare(`
        INSERT INTO always_on_task_runs
          (taskId, runOrdinal, runId, sessionKey, provider, model, status, error,
           budgetUsageSnapshot, startedAt, endedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.taskId,
        run.runOrdinal,
        run.runId ?? null,
        run.sessionKey,
        run.provider ?? null,
        run.model ?? null,
        run.status,
        run.error ?? null,
        run.budgetUsageSnapshot ?? null,
        run.startedAt,
        run.endedAt ?? null,
        run.createdAt,
      ) as { lastInsertRowid?: number | bigint };
    return Number(result.lastInsertRowid ?? 0);
  }

  updateTaskRun(taskId: string, runOrdinal: number, patch: TaskRunUpdatePatch): void {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }
    if (sets.length === 0) return;
    values.push(taskId, runOrdinal);
    this.db
      .prepare(
        `UPDATE always_on_task_runs SET ${sets.join(", ")} WHERE taskId = ? AND runOrdinal = ?`,
      )
      .run(...values);
  }

  getLatestTaskRun(taskId: string): AlwaysOnTaskRun | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM always_on_task_runs WHERE taskId = ? ORDER BY runOrdinal DESC, id DESC LIMIT 1",
      )
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? this.rowToTaskRun(row) : undefined;
  }

  listTaskRuns(taskId: string, limit = 20): AlwaysOnTaskRun[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM always_on_task_runs WHERE taskId = ? ORDER BY runOrdinal DESC, id DESC LIMIT ?",
      )
      .all(taskId, limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTaskRun(row));
  }

  appendTaskCheckpoint(params: Omit<AlwaysOnTaskCheckpoint, "id">): number {
    const result = this.db
      .prepare(`
        INSERT INTO always_on_task_checkpoints
          (taskId, runOrdinal, kind, content, metadata, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        params.taskId,
        params.runOrdinal,
        params.kind,
        params.content,
        params.metadata ?? null,
        params.createdAt,
      ) as { lastInsertRowid?: number | bigint };
    return Number(result.lastInsertRowid ?? 0);
  }

  listTaskCheckpoints(taskId: string, limit = 20): AlwaysOnTaskCheckpoint[] {
    const rows = this.db
      .prepare("SELECT * FROM always_on_task_checkpoints WHERE taskId = ? ORDER BY id DESC LIMIT ?")
      .all(taskId, limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTaskCheckpoint(row));
  }

  createDreamRun(run: AlwaysOnDreamRun): void {
    this.db
      .prepare(`
        INSERT INTO always_on_dream_runs
          (id, status, trigger, sourceSessionKey, sourceConversationKey, summary,
           createdTaskIdsJson, failureReason, createdAt, completedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.status,
        run.trigger,
        run.sourceSessionKey ?? null,
        run.sourceConversationKey ?? null,
        run.summary ?? null,
        run.createdTaskIdsJson,
        run.failureReason ?? null,
        run.createdAt,
        run.completedAt ?? null,
      );
  }

  getDreamRun(id: string): AlwaysOnDreamRun | undefined {
    const row = this.db.prepare("SELECT * FROM always_on_dream_runs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToDreamRun(row) : undefined;
  }

  listDreamRuns(limit = 20): AlwaysOnDreamRun[] {
    const rows = this.db
      .prepare("SELECT * FROM always_on_dream_runs ORDER BY createdAt DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToDreamRun(row));
  }

  updateDreamRun(id: string, patch: DreamRunUpdatePatch): void {
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
    this.db
      .prepare(`UPDATE always_on_dream_runs SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  latestDreamRunForSession(sourceSessionKey: string): AlwaysOnDreamRun | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM always_on_dream_runs WHERE sourceSessionKey = ? ORDER BY createdAt DESC LIMIT 1",
      )
      .get(sourceSessionKey) as Record<string, unknown> | undefined;
    return row ? this.rowToDreamRun(row) : undefined;
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

  createPlan(plan: AlwaysOnPlan): void {
    this.db
      .prepare(`
      INSERT INTO always_on_plans
        (id, conversationKey, status, initialPrompt, turnsJson, roundCount,
         originSessionKey, finalPrompt, createdTaskId, failureReason,
         createdAt, updatedAt, completedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        plan.id,
        plan.conversationKey,
        plan.status,
        plan.initialPrompt,
        plan.turnsJson,
        plan.roundCount,
        plan.originSessionKey ?? null,
        plan.finalPrompt ?? null,
        plan.createdTaskId ?? null,
        plan.failureReason ?? null,
        plan.createdAt,
        plan.updatedAt,
        plan.completedAt ?? null,
      );
  }

  getPlan(id: string): AlwaysOnPlan | undefined {
    const row = this.db.prepare("SELECT * FROM always_on_plans WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToPlan(row) : undefined;
  }

  getActivePlanByConversationKey(conversationKey: string): AlwaysOnPlan | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM always_on_plans WHERE conversationKey = ? AND status = 'active' ORDER BY updatedAt DESC LIMIT 1",
      )
      .get(conversationKey) as Record<string, unknown> | undefined;
    return row ? this.rowToPlan(row) : undefined;
  }

  getActivePlanBySessionKey(sessionKey: string): AlwaysOnPlan | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM always_on_plans WHERE originSessionKey = ? AND status = 'active' ORDER BY updatedAt DESC LIMIT 1",
      )
      .get(sessionKey) as Record<string, unknown> | undefined;
    return row ? this.rowToPlan(row) : undefined;
  }

  updatePlan(id: string, patch: AlwaysOnPlanUpdatePatch): void {
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
    this.db.prepare(`UPDATE always_on_plans SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  appendPlanTurn(id: string, turn: AlwaysOnPlanTurn): AlwaysOnPlan | undefined {
    const row = this.db.prepare("SELECT turnsJson FROM always_on_plans WHERE id = ?").get(id) as
      | { turnsJson?: unknown }
      | undefined;
    if (!row || typeof row.turnsJson !== "string") {
      return undefined;
    }

    const turns = parsePlanTurns(row.turnsJson);
    turns.push(turn);
    this.updatePlan(id, {
      turnsJson: JSON.stringify(turns),
      updatedAt: turn.timestamp,
    });
    return this.getPlan(id);
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
      provider: (row.provider as string) ?? undefined,
      model: (row.model as string) ?? undefined,
      budgetExceededAction:
        (row.budgetExceededAction as AlwaysOnTask["budgetExceededAction"]) ?? "warn",
      deliverySessionKey: (row.deliverySessionKey as string) ?? undefined,
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

  private rowToTaskRun(row: Record<string, unknown>): AlwaysOnTaskRun {
    return {
      id: row.id as number,
      taskId: row.taskId as string,
      runOrdinal: row.runOrdinal as number,
      runId: (row.runId as string) ?? undefined,
      sessionKey: row.sessionKey as string,
      provider: (row.provider as string) ?? undefined,
      model: (row.model as string) ?? undefined,
      status: row.status as TaskRunStatus,
      error: (row.error as string) ?? undefined,
      budgetUsageSnapshot: (row.budgetUsageSnapshot as string) ?? undefined,
      startedAt: row.startedAt as number,
      endedAt: (row.endedAt as number) ?? undefined,
      createdAt: row.createdAt as number,
    };
  }

  private rowToTaskCheckpoint(row: Record<string, unknown>): AlwaysOnTaskCheckpoint {
    return {
      id: row.id as number,
      taskId: row.taskId as string,
      runOrdinal: row.runOrdinal as number,
      kind: row.kind as TaskCheckpointKind,
      content: row.content as string,
      metadata: (row.metadata as string) ?? undefined,
      createdAt: row.createdAt as number,
    };
  }

  private rowToPlan(row: Record<string, unknown>): AlwaysOnPlan {
    return {
      id: row.id as string,
      conversationKey: row.conversationKey as string,
      status: row.status as AlwaysOnPlan["status"],
      initialPrompt: row.initialPrompt as string,
      turnsJson: row.turnsJson as string,
      roundCount: row.roundCount as number,
      originSessionKey: (row.originSessionKey as string) ?? undefined,
      finalPrompt: (row.finalPrompt as string) ?? undefined,
      createdTaskId: (row.createdTaskId as string) ?? undefined,
      failureReason: (row.failureReason as string) ?? undefined,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      completedAt: (row.completedAt as number) ?? undefined,
    };
  }

  private rowToDreamRun(row: Record<string, unknown>): AlwaysOnDreamRun {
    return {
      id: row.id as string,
      status: row.status as AlwaysOnDreamRun["status"],
      trigger: row.trigger as AlwaysOnDreamRun["trigger"],
      sourceSessionKey: (row.sourceSessionKey as string) ?? undefined,
      sourceConversationKey: (row.sourceConversationKey as string) ?? undefined,
      summary: (row.summary as string) ?? undefined,
      createdTaskIdsJson: row.createdTaskIdsJson as string,
      failureReason: (row.failureReason as string) ?? undefined,
      createdAt: row.createdAt as number,
      completedAt: (row.completedAt as number) ?? undefined,
    };
  }
}
