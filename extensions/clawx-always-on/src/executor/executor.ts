import { ALWAYS_ON_LANE, taskIdempotencyKey, taskSessionKey } from "../core/constants.js";
import type { AlwaysOnToolSupport } from "../core/tool-compat.js";
import { buildAlwaysOnExecutionInstructions } from "../core/tool-compat.js";
import type { AlwaysOnTask } from "../core/types.js";
import { parseUserCommandSourceMetadata } from "../source/user-command-source.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";

type SubagentApi = {
  run: (params: {
    sessionKey: string;
    message: string;
    lane?: string;
    deliver?: boolean;
    idempotencyKey?: string;
  }) => Promise<{ runId: string }>;
};

export class SubagentExecutor {
  constructor(
    private readonly subagent: SubagentApi,
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    private readonly toolSupport: AlwaysOnToolSupport = { explicitToolsAvailable: true },
  ) {}

  async launch(task: AlwaysOnTask): Promise<string> {
    const sessionKey = taskSessionKey(task.id);
    const nextRunCount = task.runCount + 1;
    const idempotencyKey = taskIdempotencyKey(task.id, nextRunCount);
    const now = Date.now();

    this.store.updateTask(task.id, {
      status: "launching",
      sessionKey,
      startedAt: task.startedAt ?? now,
      runCount: nextRunCount,
    });

    const message = this.buildTaskMessage(task);

    const { runId } = await this.subagent.run({
      sessionKey,
      message,
      lane: ALWAYS_ON_LANE,
      deliver: false,
      idempotencyKey,
    });

    this.store.updateTask(task.id, {
      status: "active",
    });

    this.logger.info(task.id, `Subagent launched`, { runId, sessionKey, runCount: nextRunCount });
    return runId;
  }

  private buildTaskMessage(task: AlwaysOnTask): string {
    const sourceMetadata = parseUserCommandSourceMetadata(task.sourceMetadata);
    const taskPrompt = sourceMetadata?.prompt?.trim() || task.title;
    const parts: string[] = [`## Always-On Task`, `**Title:** ${task.title}`];

    if (task.runCount > 0 && task.progressSummary) {
      parts.push("", `## Previous Progress (run #${task.runCount})`, task.progressSummary);
    }

    parts.push(
      "",
      "## Task Prompt",
      taskPrompt,
      "",
      "Execute this task.",
      ...buildAlwaysOnExecutionInstructions(this.toolSupport),
    );

    return parts.join("\n");
  }
}
