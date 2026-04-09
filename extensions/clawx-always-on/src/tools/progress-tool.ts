import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginToolContext } from "../../api.js";
import { isAlwaysOnSession } from "../core/constants.js";
import { PROGRESS_TOOL_NAME } from "../core/constants.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";

const ProgressSchema = Type.Object({
  summary: Type.String({
    description: "Markdown-formatted progress summary of work completed so far",
  }),
});

export function createProgressToolFactory(
  store: TaskStore,
  logger: TaskLogger,
): (ctx: OpenClawPluginToolContext) => AnyAgentTool | null {
  return (ctx) => {
    if (!isAlwaysOnSession(ctx.sessionKey)) return null;

    return {
      name: PROGRESS_TOOL_NAME,
      label: "Save Progress",
      description:
        "Save a progress summary for the current always-on task. " +
        "Call this periodically to ensure work is not lost if the task is suspended.",
      parameters: ProgressSchema,
      execute: async (_toolCallId, args) => {
        const params = args as Record<string, unknown>;
        const summary = typeof params.summary === "string" ? params.summary : "";

        const task = store.getTaskBySessionKey(ctx.sessionKey!);
        if (!task) {
          return {
            content: [
              { type: "text" as const, text: "Error: no active task found for this session." },
            ],
            details: { status: "missing-task" as const },
          };
        }

        store.updateTask(task.id, { progressSummary: summary });
        store.appendTaskCheckpoint({
          taskId: task.id,
          runOrdinal: task.runCount,
          kind: "progress",
          content: summary,
          createdAt: Date.now(),
        });
        logger.info(task.id, "Progress saved", { summaryLength: summary.length });

        return {
          content: [{ type: "text" as const, text: "Progress saved successfully." }],
          details: { status: "saved" as const, summaryLength: summary.length },
        };
      },
    };
  };
}
