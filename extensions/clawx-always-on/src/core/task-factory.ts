import { MaxCostUsdBudget } from "../budget/max-cost-usd.js";
import { MaxLoopsBudget } from "../budget/max-loops.js";
import {
  type UserCommandSourceMetadata,
  UserCommandTaskSource,
  serializeUserCommandSourceMetadata,
} from "../source/user-command-source.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import type { AlwaysOnConfig } from "./config.js";
import type { AlwaysOnTask } from "./types.js";

export type CreateAlwaysOnTaskInput = {
  title: string;
  prompt?: string;
  metadata?: UserCommandSourceMetadata;
};

export function createAlwaysOnTaskFromUserInput(params: {
  input: CreateAlwaysOnTaskInput;
  store: TaskStore;
  logger: TaskLogger;
  config: AlwaysOnConfig;
}): AlwaysOnTask {
  const source = new UserCommandTaskSource();
  const constraints = [
    new MaxLoopsBudget(params.config.defaultMaxLoops),
    new MaxCostUsdBudget(params.config.defaultMaxCostUsd),
  ];

  const metadata = buildTaskMetadata(params.input);
  const task = source.createTask({
    title: params.input.title,
    budgetConstraints: constraints,
    sourceMetadata: serializeUserCommandSourceMetadata(metadata),
  });
  params.store.createTask(task);
  params.logger.info(task.id, `Task created: ${params.input.title}`);
  params.logger.info(task.id, "Task queued for background launch");
  return task;
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
