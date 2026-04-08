import { randomBytes } from "node:crypto";
import { serializeBudgetConstraints } from "../budget/registry.js";
import type { AlwaysOnTask, TaskSource, TaskSourceInput } from "../core/types.js";

function generateId(): string {
  return randomBytes(8).toString("hex");
}

export class UserCommandTaskSource implements TaskSource {
  readonly type = "user-command";

  createTask(input: TaskSourceInput): AlwaysOnTask {
    return {
      id: generateId(),
      title: input.title,
      status: "queued",
      sourceType: this.type,
      budgetConstraints: serializeBudgetConstraints(input.budgetConstraints),
      budgetUsage: JSON.stringify({ loopsUsed: 0, costUsedUsd: 0 }),
      createdAt: Date.now(),
      runCount: 0,
    };
  }
}
