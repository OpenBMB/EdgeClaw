import type { OpenClawPluginApi } from "../../api.js";
import { deserializeBudgetConstraints } from "../budget/registry.js";
import { isAlwaysOnSession } from "../core/constants.js";
import {
  buildAlwaysOnExecutionInstructions,
  resolveAlwaysOnToolSupport,
  type AlwaysOnToolSupport,
} from "../core/tool-compat.js";
import type { AlwaysOnTask, BudgetUsage } from "../core/types.js";
import type { TaskStore } from "../storage/store.js";

type ToolConfigContext = {
  config?: unknown;
  runtimeConfig?: unknown;
};

type ToolConfigLike = {
  tools?: {
    profile?: unknown;
    alsoAllow?: unknown;
  };
};

function readConstraintNumber(constraint: unknown, key: "limit" | "limitUsd"): number | undefined {
  if (!constraint || typeof constraint !== "object") {
    return undefined;
  }
  const value = (constraint as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

export function registerPromptHook(
  api: OpenClawPluginApi,
  store: TaskStore,
  defaultToolSupport: AlwaysOnToolSupport = { explicitToolsAvailable: true },
): void {
  api.on("before_prompt_build", (_event, ctx) => {
    if (!isAlwaysOnSession(ctx.sessionKey)) return;

    const task = store.getTaskBySessionKey(ctx.sessionKey!);
    if (!task || task.status !== "active") return;

    const configContext = ctx as ToolConfigContext;
    const configForTools = configContext.runtimeConfig ?? configContext.config ?? api.config;
    const toolSupport = configForTools
      ? resolveAlwaysOnToolSupport(configForTools as ToolConfigLike)
      : defaultToolSupport;
    const prompt = buildAlwaysOnPrompt(task, toolSupport);
    return { prependContext: prompt };
  });
}

function buildAlwaysOnPrompt(task: AlwaysOnTask, toolSupport: AlwaysOnToolSupport): string {
  const usage = JSON.parse(task.budgetUsage) as BudgetUsage;
  const constraints = deserializeBudgetConstraints(task.budgetConstraints);

  const parts: string[] = [
    `You are executing an always-on background task.`,
    ``,
    `**Task:** ${task.title}`,
    `**Task ID:** ${task.id}`,
    `**Run #:** ${task.runCount}`,
  ];

  if (task.runCount > 1 && task.progressSummary) {
    parts.push("", "## Previous Progress", task.progressSummary);
  }

  parts.push("", "## Budget Status");
  for (const c of constraints) {
    const result = c.check(usage);
    if (result.ok) {
      if (c.kind === "max-loops") {
        parts.push(`- Loops: ${usage.loopsUsed}/${readConstraintNumber(c, "limit") ?? "?"}`);
      } else if (c.kind === "max-cost-usd") {
        parts.push(
          `- Cost: $${usage.costUsedUsd.toFixed(4)}/$${readConstraintNumber(c, "limitUsd") ?? "?"}`,
        );
      }
    } else {
      parts.push(`- **${result.reason}**`);
    }
  }

  parts.push("", "## Instructions");
  for (const line of buildAlwaysOnExecutionInstructions(toolSupport)) {
    parts.push(`- ${line}`);
  }
  parts.push(
    "- Work efficiently within the budget constraints.",
    "- If you cannot complete the task within budget, leave a clear final summary so it can be resumed.",
  );

  return parts.join("\n");
}
