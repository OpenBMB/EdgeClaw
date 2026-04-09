import { randomBytes } from "node:crypto";
import { serializeBudgetConstraints } from "../budget/registry.js";
import type { AlwaysOnTask, TaskSource, TaskSourceInput } from "../core/types.js";

function generateId(): string {
  return randomBytes(8).toString("hex");
}

export type UserCommandSourceMetadata = {
  mode?: "create" | "plan" | "dream";
  prompt?: string;
  planId?: string;
  dreamRunId?: string;
  rationale?: string;
  originConversationKey?: string;
  originSessionKey?: string;
  parentTaskIds?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  return parsed.length > 0 ? parsed : undefined;
}

export function serializeUserCommandSourceMetadata(
  metadata: UserCommandSourceMetadata | undefined,
): string | undefined {
  if (!metadata) return undefined;
  return JSON.stringify(metadata);
}

export function parseUserCommandSourceMetadata(
  raw?: string,
): UserCommandSourceMetadata | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return undefined;
    return {
      mode:
        parsed.mode === "create" || parsed.mode === "plan" || parsed.mode === "dream"
          ? parsed.mode
          : undefined,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : undefined,
      planId: typeof parsed.planId === "string" ? parsed.planId : undefined,
      dreamRunId: typeof parsed.dreamRunId === "string" ? parsed.dreamRunId : undefined,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      originConversationKey:
        typeof parsed.originConversationKey === "string" ? parsed.originConversationKey : undefined,
      originSessionKey:
        typeof parsed.originSessionKey === "string" ? parsed.originSessionKey : undefined,
      parentTaskIds: parseStringArray(parsed.parentTaskIds),
    };
  } catch {
    return undefined;
  }
}

export function createTaskFromSourceInput(type: string, input: TaskSourceInput): AlwaysOnTask {
  return {
    id: generateId(),
    title: input.title,
    status: input.status,
    sourceType: type,
    sourceMetadata: input.sourceMetadata,
    provider: input.provider,
    model: input.model,
    budgetExceededAction: input.budgetExceededAction,
    deliverySessionKey: input.deliverySessionKey,
    budgetConstraints: serializeBudgetConstraints(input.budgetConstraints),
    budgetUsage: JSON.stringify({ loopsUsed: 0, costUsedUsd: 0 }),
    createdAt: Date.now(),
    runCount: 0,
  };
}

export class UserCommandTaskSource implements TaskSource {
  readonly type = "user-command";

  createTask(input: TaskSourceInput): AlwaysOnTask {
    return createTaskFromSourceInput(this.type, input);
  }
}
