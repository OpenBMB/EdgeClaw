import { Type } from "@sinclair/typebox";
import type { AnyAgentTool, OpenClawPluginToolContext } from "../../api.js";
import { isAlwaysOnSession } from "../core/constants.js";
import { COMPLETE_TOOL_NAME } from "../core/constants.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";

const CompleteSchema = Type.Object({
  result: Type.String({
    description: "Final result summary of the completed task",
  }),
});

export function createCompleteToolFactory(
  store: TaskStore,
  logger: TaskLogger,
): (ctx: OpenClawPluginToolContext) => AnyAgentTool | null {
  return (ctx) => {
    if (!isAlwaysOnSession(ctx.sessionKey)) return null;

    return {
      name: COMPLETE_TOOL_NAME,
      label: "Complete Task",
      description: "Mark the current always-on task as completed with a final result summary.",
      parameters: CompleteSchema,
      execute: async (_toolCallId, args) => {
        const params = args as Record<string, unknown>;
        const result = typeof params.result === "string" ? params.result : "";

        const task = store.getTaskBySessionKey(ctx.sessionKey!);
        if (!task) {
          return {
            content: [
              { type: "text" as const, text: "Error: no active task found for this session." },
            ],
            details: { status: "missing-task" as const },
          };
        }

        store.updateTask(task.id, {
          status: "completed",
          resultSummary: result,
          completedAt: Date.now(),
        });
        store.appendTaskCheckpoint({
          taskId: task.id,
          runOrdinal: task.runCount,
          kind: "completion",
          content: result,
          createdAt: Date.now(),
        });
        store.updateTaskRun(task.id, task.runCount, {
          status: "completed",
          endedAt: Date.now(),
          budgetUsageSnapshot: task.budgetUsage,
        });
        logger.info(task.id, "Task completed", { resultLength: result.length });

        return {
          content: [{ type: "text" as const, text: "Task marked as completed." }],
          details: { status: "completed" as const, resultLength: result.length },
        };
      },
    };
  };
}
