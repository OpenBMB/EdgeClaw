import { MaxCostUsdBudget } from "../budget/max-cost-usd.js";
import { MaxLoopsBudget } from "../budget/max-loops.js";
import { DreamTaskSource } from "../source/dream-task-source.js";
import {
  type UserCommandSourceMetadata,
  UserCommandTaskSource,
  serializeUserCommandSourceMetadata,
} from "../source/user-command-source.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import type { AlwaysOnConfig } from "./config.js";
import type { AlwaysOnTask, BudgetExceededAction, TaskSource, TaskStatus } from "./types.js";

export type CreateAlwaysOnTaskInput = {
  title: string;
  prompt?: string;
  metadata?: UserCommandSourceMetadata;
  sourceType?: "user-command" | "dream";
  initialStatus?: TaskStatus;
  provider?: string;
  model?: string;
  budgetExceededAction?: BudgetExceededAction;
  deliverySessionKey?: string;
  maxLoops?: number;
  maxCostUsd?: number;
};

export function createAlwaysOnTaskFromUserInput(params: {
  input: CreateAlwaysOnTaskInput;
  store: TaskStore;
  logger: TaskLogger;
  config: AlwaysOnConfig;
}): AlwaysOnTask {
  const source = resolveTaskSource(params.input.sourceType);
  const constraints = [
    new MaxLoopsBudget(params.input.maxLoops ?? params.config.defaultMaxLoops),
    new MaxCostUsdBudget(params.input.maxCostUsd ?? params.config.defaultMaxCostUsd),
  ];

  const metadata = buildTaskMetadata(params.input);
  const task = source.createTask({
    title: params.input.title,
    status: params.input.initialStatus ?? "queued",
    provider: params.input.provider ?? params.config.defaultProvider,
    model: params.input.model ?? params.config.defaultModel,
    budgetExceededAction:
      params.input.budgetExceededAction ?? params.config.defaultBudgetExceededAction,
    deliverySessionKey: params.input.deliverySessionKey,
    budgetConstraints: constraints,
    sourceMetadata: serializeUserCommandSourceMetadata(metadata),
  });
  params.store.createTask(task);
  params.logger.info(task.id, `Task created: ${params.input.title}`);
  params.logger.info(
    task.id,
    task.status === "pending"
      ? "Task created and left pending for manual start"
      : "Task queued for background launch",
  );
  return task;
}

function resolveTaskSource(sourceType: CreateAlwaysOnTaskInput["sourceType"]): TaskSource {
  if (sourceType === "dream") {
    return new DreamTaskSource();
  }
  return new UserCommandTaskSource();
}

function buildTaskMetadata(input: CreateAlwaysOnTaskInput): UserCommandSourceMetadata | undefined {
  const trimmedPrompt = input.prompt?.trim();
  const metadata: UserCommandSourceMetadata = {
    ...input.metadata,
  };

  if (trimmedPrompt && trimmedPrompt !== input.title.trim()) {
    metadata.prompt = trimmedPrompt;
  }

  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined;
}
