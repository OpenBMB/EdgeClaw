import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OpenClawPluginApi, PluginCommandContext } from "../../api.js";
import { resolveConfigSource, type AlwaysOnConfigSource } from "../core/config.js";
import { createAlwaysOnTaskFromUserInput } from "../core/task-factory.js";
import { summarizeTranscriptMessages } from "../core/transcript-summary.js";
import type { AlwaysOnDreamRun, AlwaysOnTask } from "../core/types.js";
import {
  resolveCommandPeer,
  resolvePlanConversationKeyFromCommand,
} from "../plan/conversation-key.js";
import { parseUserCommandSourceMetadata } from "../source/user-command-source.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import { runDreamPlanningStep } from "./planner.js";

type TriggerDreamParams = {
  trigger: "manual" | "scheduled";
  sourceSessionKey?: string;
  sourceConversationKey?: string;
  agentId?: string;
};

type TriggerDreamResult = {
  dreamRun: AlwaysOnDreamRun;
  summary: string;
  createdTasks: AlwaysOnTask[];
};

function generateDreamRunId(): string {
  return randomBytes(8).toString("hex");
}

function truncateText(value: string, maxChars = 1500): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

function extractLatestKnownSession(tasks: AlwaysOnTask[]): string | undefined {
  for (const task of tasks) {
    if (task.deliverySessionKey) {
      return task.deliverySessionKey;
    }
    const metadata = parseUserCommandSourceMetadata(task.sourceMetadata);
    if (metadata?.originSessionKey) {
      return metadata.originSessionKey;
    }
  }
  return undefined;
}

function buildTaskDigest(tasks: AlwaysOnTask[]): string {
  if (tasks.length === 0) {
    return "No always-on tasks exist yet.";
  }
  return tasks
    .slice(0, 20)
    .map((task) => {
      const summary = task.progressSummary ?? task.resultSummary;
      const detail = summary ? ` | ${truncateText(summary, 140)}` : "";
      return `- [${task.status}] ${task.id}: ${task.title}${detail}`;
    })
    .join("\n");
}

function buildDreamReply(summary: string, tasks: AlwaysOnTask[]): string {
  const lines = ["## Always-On Dream", summary];
  if (tasks.length === 0) {
    lines.push("", "No new pending candidates were created this time.");
    return lines.join("\n");
  }
  lines.push("", "### New Pending Tasks");
  for (const task of tasks) {
    const metadata = parseUserCommandSourceMetadata(task.sourceMetadata);
    lines.push(`- **${task.id}** — ${task.title}`);
    if (metadata?.rationale) {
      lines.push(`  Why: ${metadata.rationale}`);
    }
    lines.push(`  Start: \`/always-on start ${task.id}\``);
  }
  lines.push("", "These tasks were created as **pending** and will not run until you start them.");
  return lines.join("\n");
}

function buildDreamFailureReply(): string {
  return "⚠️ Always-On dream could not generate task candidates right now. Please try again later.";
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    const trimmed = content.trim();
    return trimmed ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function readMemoryContext(workspaceDir: string): Promise<string | undefined> {
  const sections: string[] = [];
  const mainMemory = await readOptionalFile(join(workspaceDir, "MEMORY.md"));
  if (mainMemory) {
    sections.push(`## MEMORY.md\n${truncateText(mainMemory, 1600)}`);
  }

  try {
    const entries = await readdir(join(workspaceDir, "memory"), { withFileTypes: true });
    const recent = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort()
      .slice(-2)
      .reverse();
    for (const name of recent) {
      const content = await readOptionalFile(join(workspaceDir, "memory", name));
      if (content) {
        sections.push(`## memory/${name}\n${truncateText(content, 1000)}`);
      }
    }
  } catch {
    // Ignore missing memory directory.
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export class AlwaysOnDreamService {
  private readonly getConfig: ReturnType<typeof resolveConfigSource>;

  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    config: AlwaysOnConfigSource,
  ) {
    this.getConfig = resolveConfigSource(config);
  }

  async runFromCommand(ctx: PluginCommandContext): Promise<{ text: string }> {
    const peer = resolveCommandPeer(ctx);
    const conversationKey = resolvePlanConversationKeyFromCommand(ctx);
    const route = peer
      ? this.api.runtime.channel.routing.resolveAgentRoute({
          cfg: ctx.config,
          channel: ctx.channel,
          accountId: ctx.accountId,
          peer,
        })
      : undefined;

    try {
      const result = await this.triggerDream({
        trigger: "manual",
        sourceSessionKey: route?.sessionKey,
        sourceConversationKey: conversationKey,
        agentId: route?.agentId,
      });
      return { text: buildDreamReply(result.summary, result.createdTasks) };
    } catch {
      return { text: buildDreamFailureReply() };
    }
  }

  async runScheduled(): Promise<void> {
    const currentConfig = this.getConfig();
    if (!currentConfig.dreamEnabled) {
      return;
    }

    const tasks = this.store.listTasks();
    const sourceSessionKey = extractLatestKnownSession(tasks);
    if (!sourceSessionKey) {
      return;
    }

    const result = await this.triggerDream({
      trigger: "scheduled",
      sourceSessionKey,
    });
    if (result.createdTasks.length > 0) {
      await this.announceScheduledDream(sourceSessionKey, result.summary, result.createdTasks);
    }
  }

  private async triggerDream(params: TriggerDreamParams): Promise<TriggerDreamResult> {
    const currentConfig = this.getConfig();
    const dreamRun: AlwaysOnDreamRun = {
      id: generateDreamRunId(),
      status: "running",
      trigger: params.trigger,
      sourceSessionKey: params.sourceSessionKey,
      sourceConversationKey: params.sourceConversationKey,
      createdTaskIdsJson: "[]",
      createdAt: Date.now(),
    };
    this.store.createDreamRun(dreamRun);

    try {
      const context = await this.buildPlannerContext(params);
      const planning = await runDreamPlanningStep({
        api: this.api,
        context,
        maxCandidates: currentConfig.dreamMaxCandidates,
        provider: currentConfig.dreamProvider ?? currentConfig.defaultProvider,
        model: currentConfig.dreamModel ?? currentConfig.defaultModel,
      });

      const createdTasks = planning.candidates.map((candidate) =>
        createAlwaysOnTaskFromUserInput({
          input: {
            title: candidate.taskTitle,
            prompt: candidate.taskPrompt,
            sourceType: "dream",
            initialStatus: "pending",
            deliverySessionKey: params.sourceSessionKey,
            metadata: {
              mode: "dream",
              dreamRunId: dreamRun.id,
              rationale: candidate.rationale,
              originConversationKey: params.sourceConversationKey,
              originSessionKey: params.sourceSessionKey,
              parentTaskIds: candidate.parentTaskIds,
            },
          },
          store: this.store,
          logger: this.logger,
          config: currentConfig,
        }),
      );

      const completedAt = Date.now();
      this.store.updateDreamRun(dreamRun.id, {
        status: "completed",
        summary: planning.summary,
        createdTaskIdsJson: JSON.stringify(createdTasks.map((task) => task.id)),
        completedAt,
      });
      return {
        dreamRun: {
          ...dreamRun,
          status: "completed",
          summary: planning.summary,
          createdTaskIdsJson: JSON.stringify(createdTasks.map((task) => task.id)),
          completedAt,
        },
        summary: planning.summary,
        createdTasks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateDreamRun(dreamRun.id, {
        status: "failed",
        failureReason: message,
        completedAt: Date.now(),
      });
      this.logger.warn(dreamRun.id, `Dream run failed: ${message}`);
      throw error;
    }
  }

  private async buildPlannerContext(params: TriggerDreamParams): Promise<string> {
    const sections: string[] = [];
    if (params.sourceSessionKey) {
      const transcriptSummary = await this.loadTranscriptSummary(params.sourceSessionKey);
      if (transcriptSummary) {
        sections.push(`## Session Transcript\n${transcriptSummary}`);
      }
    }

    const workspaceDir =
      params.agentId != null
        ? this.api.runtime.agent.resolveAgentWorkspaceDir(this.api.config, params.agentId)
        : (this.api.config?.agents?.defaults?.workspace ?? process.cwd());
    const memoryContext = await readMemoryContext(workspaceDir);
    if (memoryContext) {
      sections.push(memoryContext);
    }

    sections.push(`## Existing Always-On Tasks\n${buildTaskDigest(this.store.listTasks())}`);
    return sections.join("\n\n");
  }

  private async loadTranscriptSummary(sessionKey: string): Promise<string | undefined> {
    const currentConfig = this.getConfig();
    if (!this.api.runtime.subagent.getSessionMessages) {
      return undefined;
    }
    try {
      const response = await this.api.runtime.subagent.getSessionMessages({
        sessionKey,
        limit: currentConfig.dreamContextMessageLimit,
      });
      const messages = Array.isArray(response) ? response : response.messages;
      return summarizeTranscriptMessages(Array.isArray(messages) ? messages : [], 10);
    } catch (error) {
      this.logger.debug?.("dream", "Failed to load transcript context for dream", {
        sessionKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async announceScheduledDream(
    sessionKey: string,
    summary: string,
    tasks: AlwaysOnTask[],
  ): Promise<void> {
    const reply = buildDreamReply(summary, tasks);
    this.api.runtime.system.enqueueSystemEvent(
      [
        "[clawx-always-on] New dream candidates are ready.",
        "Tell the user that these pending always-on tasks were created automatically.",
        "Include the following markdown exactly so they can start tasks with slash commands:",
        "",
        reply,
      ].join("\n"),
      {
        sessionKey,
        trusted: true,
      },
    );
    try {
      await this.api.runtime.system.runHeartbeatOnce({
        reason: "always-on-dream",
        sessionKey,
        heartbeat: { target: "last" },
      });
    } catch (error) {
      this.logger.warn("dream", `Failed to deliver scheduled dream notice: ${String(error)}`);
    }
  }
}
