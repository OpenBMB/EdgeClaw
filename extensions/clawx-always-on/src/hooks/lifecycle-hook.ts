import type { OpenClawPluginApi } from "../../api.js";
import { deserializeBudgetConstraints } from "../budget/registry.js";
import { isAlwaysOnSession } from "../core/constants.js";
import type { BudgetUsage } from "../core/types.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import { deriveTaskOutcomeFromMessages } from "./task-finalization.js";

const BUDGET_TRACKED_STATUSES = new Set(["active", "completed", "suspended"]);

function parseBudgetUsage(raw: string): BudgetUsage {
  return JSON.parse(raw) as BudgetUsage;
}

function isAssistantMessage(message: unknown): boolean {
  return Boolean(
    message && typeof message === "object" && (message as { role?: unknown }).role === "assistant",
  );
}

function getBudgetExceededReason(
  task: { budgetConstraints: string },
  usage: BudgetUsage,
): string | undefined {
  const constraints = deserializeBudgetConstraints(task.budgetConstraints);
  const exceeded = constraints.find((constraint) => !constraint.check(usage).ok);
  if (!exceeded) {
    return undefined;
  }
  const result = exceeded.check(usage);
  return result.ok ? undefined : result.reason;
}

export function registerLifecycleHooks(
  api: OpenClawPluginApi,
  store: TaskStore,
  logger: TaskLogger,
): void {
  api.on("before_message_write", (event, ctx) => {
    if (!isAlwaysOnSession(ctx.sessionKey)) return;
    if (!isAssistantMessage(event.message)) return;

    const task = store.getTaskBySessionKey(ctx.sessionKey!);
    if (!task || task.status !== "active") return;

    const usage = store.updateBudgetUsage(task.id, (currentUsage) => {
      currentUsage.loopsUsed =
        typeof currentUsage.loopsUsed === "number" ? currentUsage.loopsUsed + 1 : 1;
    });
    if (!usage) return;

    const exceededReason = getBudgetExceededReason(task, usage);
    if (exceededReason) {
      logger.warn(task.id, `Budget constraint exceeded: ${exceededReason}`);
    }
  });

  api.on("llm_output", (event, ctx) => {
    if (!isAlwaysOnSession(ctx.sessionKey)) return;

    const task = store.getTaskBySessionKey(ctx.sessionKey!);
    if (!task || !BUDGET_TRACKED_STATUSES.has(task.status)) return;
    if (!event.usage) return;

    const usage = store.updateBudgetUsage(task.id, (currentUsage) => {
      const inputTokens = event.usage?.input ?? 0;
      const outputTokens = event.usage?.output ?? 0;
      const currentCostUsd =
        typeof currentUsage.costUsedUsd === "number" ? currentUsage.costUsedUsd : 0;
      // Rough estimate: $3/M input, $15/M output (conservative ballpark)
      currentUsage.costUsedUsd = currentCostUsd + (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    });
    if (!usage) return;

    const exceededReason = getBudgetExceededReason(task, usage);
    if (exceededReason) {
      logger.warn(task.id, `Budget constraint exceeded: ${exceededReason}`);
    }
  });

  api.on("agent_end", (event, ctx) => {
    if (!isAlwaysOnSession(ctx.sessionKey)) return;

    const task = store.getTaskBySessionKey(ctx.sessionKey!);
    if (!task || task.status !== "active") return;

    const eventRecord = event as {
      error?: unknown;
      messages?: unknown;
      success?: unknown;
    };
    const eventMessages = Array.isArray(eventRecord.messages) ? eventRecord.messages : [];
    const derivedOutcome = deriveTaskOutcomeFromMessages(eventMessages);
    const succeeded = eventRecord.success === true;

    if (succeeded && derivedOutcome?.status === "completed") {
      store.updateTask(task.id, {
        status: "completed",
        resultSummary: derivedOutcome.summary,
        completedAt: Date.now(),
        suspendedAt: null,
      });
      logger.info(task.id, "Task completed from final assistant reply", {
        summaryLength: derivedOutcome.summary.length,
      });
      return;
    }

    if (derivedOutcome?.status === "suspended") {
      store.updateTask(task.id, {
        status: "suspended",
        progressSummary: derivedOutcome.summary,
        suspendedAt: Date.now(),
      });
      logger.info(task.id, "Task suspended: final assistant reply requested resume", {
        summaryLength: derivedOutcome.summary.length,
      });
      return;
    }

    store.updateTask(task.id, {
      status: "suspended",
      progressSummary: derivedOutcome?.summary ?? task.progressSummary ?? null,
      suspendedAt: Date.now(),
    });

    const usage = parseBudgetUsage(task.budgetUsage);
    const exceededReason = getBudgetExceededReason(task, usage);
    const runtimeError =
      typeof eventRecord.error === "string" && eventRecord.error.trim()
        ? eventRecord.error.trim()
        : undefined;
    const reason =
      exceededReason ??
      runtimeError ??
      (succeeded
        ? "agent run ended without explicit completion or a usable final summary"
        : "agent run ended unsuccessfully");
    logger.info(task.id, `Task suspended: ${reason}`);
  });
}
