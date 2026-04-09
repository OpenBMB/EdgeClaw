import { ALWAYS_ON_LANE, taskIdempotencyKey, taskSessionKey } from "../core/constants.js";
import type { AlwaysOnToolSupport } from "../core/tool-compat.js";
import { buildAlwaysOnExecutionInstructions } from "../core/tool-compat.js";
import { summarizeTranscriptMessages } from "../core/transcript-summary.js";
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
    provider?: string;
    model?: string;
  }) => Promise<{ runId: string }>;
  getSessionMessages?: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<unknown[] | { messages?: unknown[] }>;
};

export class SubagentExecutor {
  constructor(
    private readonly subagent: SubagentApi,
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    private readonly toolSupport: AlwaysOnToolSupport = { explicitToolsAvailable: true },
  ) {}

  async launch(task: AlwaysOnTask): Promise<string> {
    const sessionKey = task.sessionKey ?? taskSessionKey(task.id);
    const nextRunCount = task.runCount + 1;
    const idempotencyKey = taskIdempotencyKey(task.id, nextRunCount);
    const now = Date.now();

    this.store.updateTask(task.id, {
      status: "launching",
      sessionKey,
      startedAt: task.startedAt ?? now,
      runCount: nextRunCount,
    });

    this.store.createTaskRun({
      taskId: task.id,
      runOrdinal: nextRunCount,
      sessionKey,
      provider: task.provider,
      model: task.model,
      status: "launching",
      startedAt: now,
      createdAt: now,
    });

    const transcriptSummary = await this.loadResumeTranscriptSummary(task, sessionKey);
    const message = this.buildTaskMessage(task, {
      nextRunCount,
      transcriptSummary,
    });

    try {
      const { runId } = await this.subagent.run({
        sessionKey,
        message,
        lane: ALWAYS_ON_LANE,
        deliver: false,
        idempotencyKey,
        provider: task.provider,
        model: task.model,
      });

      this.store.updateTaskRun(task.id, nextRunCount, {
        runId,
        status: "active",
      });
      this.store.updateTask(task.id, {
        status: "active",
      });

      this.logger.info(task.id, `Subagent launched`, {
        runId,
        sessionKey,
        runCount: nextRunCount,
        provider: task.provider,
        model: task.model,
      });
      return runId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.store.updateTaskRun(task.id, nextRunCount, {
        status: "failed",
        error: errorMessage,
        endedAt: Date.now(),
      });
      throw error;
    }
  }

  private async loadResumeTranscriptSummary(
    task: AlwaysOnTask,
    sessionKey: string,
  ): Promise<string | undefined> {
    if (task.runCount <= 0 || !this.subagent.getSessionMessages) {
      return undefined;
    }

    try {
      const response = await this.subagent.getSessionMessages({
        sessionKey,
        limit: 20,
      });
      const messages = Array.isArray(response) ? response : response.messages;
      return summarizeTranscriptMessages(Array.isArray(messages) ? messages : [], 8);
    } catch (error) {
      this.logger.debug?.(task.id, "Failed to load prior session messages", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private buildTaskMessage(
    task: AlwaysOnTask,
    opts: {
      nextRunCount: number;
      transcriptSummary?: string;
    },
  ): string {
    const sourceMetadata = parseUserCommandSourceMetadata(task.sourceMetadata);
    const taskPrompt = sourceMetadata?.prompt?.trim() || task.title;
    const parts: string[] = [`## Always-On Task`, `**Title:** ${task.title}`];

    if (sourceMetadata?.rationale) {
      parts.push("", "## Why This Task Exists", sourceMetadata.rationale);
    }

    if (opts.nextRunCount > 1 && task.progressSummary) {
      parts.push("", `## Previous Progress (run #${task.runCount})`, task.progressSummary);
    }

    if (opts.nextRunCount > 1 && opts.transcriptSummary) {
      parts.push("", "## Transcript Context From Prior Runs", opts.transcriptSummary);
    }

    parts.push(
      "",
      "## Task Prompt",
      taskPrompt,
      "",
      `Execution profile: provider=${task.provider ?? "default"}, model=${task.model ?? "default"}, budgetAction=${task.budgetExceededAction}.`,
      "Execute this task.",
      ...buildAlwaysOnExecutionInstructions(this.toolSupport),
    );

    return parts.join("\n");
  }
}
