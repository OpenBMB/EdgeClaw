export type TaskStatus =
  | "pending"
  | "queued"
  | "launching"
  | "active"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type BudgetExceededAction = "warn" | "terminate";

export type AlwaysOnTask = {
  id: string;
  title: string;
  status: TaskStatus;
  sourceType: string;
  sourceMetadata?: string;
  provider?: string;
  model?: string;
  budgetExceededAction: BudgetExceededAction;
  deliverySessionKey?: string;

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

export type TaskRunStatus =
  | "launching"
  | "active"
  | "completed"
  | "suspended"
  | "failed"
  | "cancelled";

export type AlwaysOnTaskRun = {
  id: number;
  taskId: string;
  runOrdinal: number;
  runId?: string;
  sessionKey: string;
  provider?: string;
  model?: string;
  status: TaskRunStatus;
  error?: string;
  budgetUsageSnapshot?: string;
  startedAt: number;
  endedAt?: number;
  createdAt: number;
};

export type TaskCheckpointKind = "progress" | "completion" | "system";

export type AlwaysOnTaskCheckpoint = {
  id: number;
  taskId: string;
  runOrdinal: number;
  kind: TaskCheckpointKind;
  content: string;
  metadata?: string;
  createdAt: number;
};

export type DreamRunStatus = "running" | "completed" | "failed";
export type DreamRunTrigger = "manual" | "scheduled";

export type AlwaysOnDreamRun = {
  id: string;
  status: DreamRunStatus;
  trigger: DreamRunTrigger;
  sourceSessionKey?: string;
  sourceConversationKey?: string;
  summary?: string;
  createdTaskIdsJson: string;
  failureReason?: string;
  createdAt: number;
  completedAt?: number;
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
  status: TaskStatus;
  provider?: string;
  model?: string;
  budgetExceededAction: BudgetExceededAction;
  deliverySessionKey?: string;
  budgetConstraints: BudgetConstraint[];
  sourceMetadata?: string;
};

export type TaskUpdatePatch = {
  status?: TaskStatus;
  provider?: string | null;
  model?: string | null;
  budgetExceededAction?: BudgetExceededAction;
  deliverySessionKey?: string | null;
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
  sourceType?: string;
};

export type TaskRunUpdatePatch = {
  runId?: string | null;
  status?: TaskRunStatus;
  error?: string | null;
  budgetUsageSnapshot?: string | null;
  endedAt?: number | null;
};

export type DreamRunUpdatePatch = {
  status?: DreamRunStatus;
  summary?: string | null;
  createdTaskIdsJson?: string;
  failureReason?: string | null;
  completedAt?: number | null;
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
