export type TaskStatus =
  | "pending"
  | "queued"
  | "launching"
  | "active"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type AlwaysOnTask = {
  id: string;
  title: string;
  status: TaskStatus;
  sourceType: string;
  sourceMetadata?: string;

  budgetConstraints: string;
  budgetUsage: string;

  sessionKey?: string;

  progressSummary?: string;
  resultSummary?: string;

  createdAt: number;
  startedAt?: number;
  suspendedAt?: number;
  completedAt?: number;
  runCount: number;
};

export type BudgetUsage = {
  loopsUsed: number;
  costUsedUsd: number;
  [key: string]: unknown;
};

export type BudgetCheckResult = { ok: true } | { ok: false; reason: string };

export interface BudgetConstraint {
  readonly kind: string;
  serialize(): Record<string, unknown>;
  check(usage: BudgetUsage): BudgetCheckResult;
}

export interface TaskSource {
  readonly type: string;
  createTask(input: TaskSourceInput): AlwaysOnTask;
}

export type TaskSourceInput = {
  title: string;
  budgetConstraints: BudgetConstraint[];
  sourceMetadata?: string;
};

export type TaskUpdatePatch = {
  status?: TaskStatus;
  sessionKey?: string | null;
  progressSummary?: string | null;
  resultSummary?: string | null;
  budgetUsage?: string;
  startedAt?: number | null;
  suspendedAt?: number | null;
  completedAt?: number | null;
  runCount?: number;
};

export type TaskFilter = {
  status?: TaskStatus;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

export type TaskLogEntry = {
  id: number;
  taskId: string;
  level: LogLevel;
  message: string;
  metadata?: string;
  timestamp: number;
};
