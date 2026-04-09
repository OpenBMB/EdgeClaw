import { randomBytes } from "node:crypto";
import { serializeBudgetConstraints } from "../budget/registry.js";
import type { AlwaysOnTask, TaskSource, TaskSourceInput } from "../core/types.js";

function generateId(): string {
  return randomBytes(8).toString("hex");
}

export type UserCommandSourceMetadata = {
  mode?: "create" | "plan";
  prompt?: string;
  planId?: string;
  originConversationKey?: string;
  originSessionKey?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
      mode: parsed.mode === "create" || parsed.mode === "plan" ? parsed.mode : undefined,
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : undefined,
      planId: typeof parsed.planId === "string" ? parsed.planId : undefined,
      originConversationKey:
        typeof parsed.originConversationKey === "string" ? parsed.originConversationKey : undefined,
      originSessionKey:
        typeof parsed.originSessionKey === "string" ? parsed.originSessionKey : undefined,
    };
  } catch {
    return undefined;
  }
}

export class UserCommandTaskSource implements TaskSource {
  readonly type = "user-command";

  createTask(input: TaskSourceInput): AlwaysOnTask {
    return {
      id: generateId(),
      title: input.title,
      status: "queued",
      sourceType: this.type,
      sourceMetadata: input.sourceMetadata,
      budgetConstraints: serializeBudgetConstraints(input.budgetConstraints),
      budgetUsage: JSON.stringify({ loopsUsed: 0, costUsedUsd: 0 }),
      createdAt: Date.now(),
      runCount: 0,
    };
  }
}
