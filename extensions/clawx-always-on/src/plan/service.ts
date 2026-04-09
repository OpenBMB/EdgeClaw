import { randomBytes } from "node:crypto";
import type { PluginCommandContext, OpenClawPluginApi } from "../../api.js";
import {
  resolveConfigSource,
  type AlwaysOnConfig,
  type AlwaysOnConfigSource,
} from "../core/config.js";
import { createAlwaysOnTaskFromUserInput } from "../core/task-factory.js";
import { buildAlwaysOnCommandNote, type AlwaysOnToolSupport } from "../core/tool-compat.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import {
  resolvePlanConversationKeyFromCommand,
  resolvePlanConversationKeyFromHook,
} from "./conversation-key.js";
import {
  runClarificationStep,
  runFinalizationStep,
  type PlanQuestion,
  type PlanDefaultPlan,
} from "./planner.js";
import type { AlwaysOnPlan, AlwaysOnPlanTurn } from "./types.js";

type PlanHookEvent = {
  content: string;
};

type PlanHookContext = {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
  senderId?: string;
};

function generatePlanId(): string {
  return randomBytes(8).toString("hex");
}

function parsePlanTurns(raw: string): AlwaysOnPlanTurn[] {
  return JSON.parse(raw) as AlwaysOnPlanTurn[];
}

function formatQuestionsText(questions: PlanQuestion[]): string {
  const lines: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    lines.push(`**${i + 1}. ${q.text}**`);
    for (const opt of q.options) {
      lines.push(opt);
    }
    lines.push("");
  }
  lines.push('直接回复选项字母（如 "A, B"），或输入自定义内容。');
  return lines.join("\n");
}

type ClarificationMetadata = {
  questions: PlanQuestion[];
  defaultPlan: PlanDefaultPlan;
};

function serializeClarificationMetadata(meta: ClarificationMetadata): string {
  return JSON.stringify(meta);
}

function parseClarificationMetadata(raw: string | undefined): ClarificationMetadata | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ClarificationMetadata;
  } catch {
    return undefined;
  }
}

export class AlwaysOnPlanService {
  private readonly getConfig: () => AlwaysOnConfig;

  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    config: AlwaysOnConfigSource,
    private readonly toolSupport: AlwaysOnToolSupport,
  ) {
    this.getConfig = resolveConfigSource(config);
  }

  async startPlan(ctx: PluginCommandContext, prompt: string): Promise<{ text: string }> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return { text: "Usage: `/always-on plan <task description>`" };
    }

    const conversationKey = resolvePlanConversationKeyFromCommand(ctx);
    if (!conversationKey) {
      return {
        text: "Planning mode is unavailable in this conversation because the plugin could not resolve a stable conversation identity.",
      };
    }

    const existingPlan = this.store.getActivePlanByConversationKey(conversationKey);
    if (existingPlan) {
      return {
        text: "An `/always-on plan` flow is already in progress here. Reply in plain text to continue, or run `/always-on plan cancel` to stop it.",
      };
    }

    const now = Date.now();
    const plan: AlwaysOnPlan = {
      id: generatePlanId(),
      conversationKey,
      status: "active",
      initialPrompt: trimmedPrompt,
      turnsJson: JSON.stringify([{ role: "user", content: trimmedPrompt, timestamp: now }]),
      roundCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.store.createPlan(plan);

    try {
      const decision = await runClarificationStep({
        api: this.api,
        initialPrompt: trimmedPrompt,
      });

      const questionsText = formatQuestionsText(decision.questions);
      const reply =
        "我会帮你把这个想法打磨成一条更好的后台任务。先回答几个问题：\n\n" + questionsText;

      const clarificationMeta = serializeClarificationMetadata({
        questions: decision.questions,
        defaultPlan: decision.defaultPlan,
      });

      this.store.appendPlanTurn(plan.id, {
        role: "assistant",
        content: reply,
        timestamp: Date.now(),
      });
      this.store.updatePlan(plan.id, {
        roundCount: 1,
        finalPrompt: clarificationMeta,
        updatedAt: Date.now(),
      });

      return { text: reply };
    } catch (error) {
      return { text: this.failPlan(plan.id, error) };
    }
  }

  cancelPlan(ctx: PluginCommandContext): { text: string } {
    const conversationKey = resolvePlanConversationKeyFromCommand(ctx);
    if (!conversationKey) {
      return { text: "No active `/always-on plan` flow was found for this conversation." };
    }

    const activePlan = this.store.getActivePlanByConversationKey(conversationKey);
    if (!activePlan) {
      return { text: "No active `/always-on plan` flow is running here." };
    }

    const now = Date.now();
    this.store.updatePlan(activePlan.id, {
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
    });
    return { text: "Cancelled the active `/always-on plan` flow." };
  }

  async handleBeforeDispatch(
    event: PlanHookEvent,
    ctx: PlanHookContext,
  ): Promise<{ handled: true; text: string } | void> {
    const activePlan =
      (ctx.sessionKey ? this.store.getActivePlanBySessionKey(ctx.sessionKey) : undefined) ??
      (() => {
        const conversationKey = resolvePlanConversationKeyFromHook(ctx);
        return conversationKey
          ? this.store.getActivePlanByConversationKey(conversationKey)
          : undefined;
      })();
    if (!activePlan) {
      return;
    }

    if (activePlan.roundCount !== 1) {
      return;
    }

    const trimmedContent = event.content.trim();
    if (!trimmedContent) {
      return {
        handled: true,
        text: "请回复选项字母或自定义内容，以完成任务规划。",
      };
    }

    try {
      if (ctx.sessionKey && !activePlan.originSessionKey) {
        this.store.updatePlan(activePlan.id, {
          originSessionKey: ctx.sessionKey,
          updatedAt: Date.now(),
        });
      }

      this.store.appendPlanTurn(activePlan.id, {
        role: "user",
        content: trimmedContent,
        timestamp: Date.now(),
      });

      const clarificationMeta = parseClarificationMetadata(activePlan.finalPrompt);
      if (!clarificationMeta) {
        throw new Error("plan is missing clarification metadata");
      }

      const decision = await runFinalizationStep({
        api: this.api,
        initialPrompt: activePlan.initialPrompt,
        questions: clarificationMeta.questions,
        userAnswer: trimmedContent,
      });

      const originSessionKey = ctx.sessionKey ?? activePlan.originSessionKey;
      const task = createAlwaysOnTaskFromUserInput({
        input: {
          title: decision.taskTitle,
          prompt: decision.taskPrompt,
          deliverySessionKey: originSessionKey,
          metadata: {
            mode: "plan",
            planId: activePlan.id,
            originConversationKey: activePlan.conversationKey,
            originSessionKey,
          },
        },
        store: this.store,
        logger: this.logger,
        config: this.getConfig(),
      });

      const now = Date.now();
      this.store.updatePlan(activePlan.id, {
        status: "completed",
        originSessionKey: originSessionKey ?? null,
        finalPrompt: decision.taskPrompt,
        createdTaskId: task.id,
        updatedAt: now,
        completedAt: now,
      });

      return {
        handled: true,
        text: this.buildPlanCompletionText(task.id, task.title, decision.assumptions),
      };
    } catch (error) {
      return {
        handled: true,
        text: this.failPlan(activePlan.id, error),
      };
    }
  }

  private buildPlanCompletionText(
    taskId: string,
    taskTitle: string,
    assumptions: string[],
  ): string {
    const commandNote = buildAlwaysOnCommandNote(this.toolSupport);
    const config = this.getConfig();
    const lines = [
      `Task **${taskId}** created from the planning flow and queued for background execution.`,
      `> ${taskTitle}`,
      "",
      `Budget: ${config.defaultMaxLoops} loops, $${config.defaultMaxCostUsd} max cost.`,
      `The worker runs up to ${config.maxConcurrentTasks} task(s) at once and will start this task when a slot is available.`,
      "Planning mode is complete. Your main session is not affected — keep chatting normally.",
    ];
    if (assumptions.length > 0) {
      lines.push("", "### Assumptions", ...assumptions.map((item) => `- ${item}`));
    }
    if (commandNote) {
      lines.push("", commandNote);
    }
    return lines.join("\n");
  }

  private failPlan(planId: string, error: unknown): string {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "unknown planning failure";
    const now = Date.now();
    this.store.updatePlan(planId, {
      status: "failed",
      failureReason: message,
      updatedAt: now,
      completedAt: now,
    });
    this.logger.warn(`plan:${planId}`, `Planning flow failed: ${message}`);
    return `The \`/always-on plan\` flow failed: ${message}. You can try again with a refined prompt.`;
  }
}
