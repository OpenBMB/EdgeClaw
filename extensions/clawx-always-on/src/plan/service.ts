import { randomBytes } from "node:crypto";
import type { PluginCommandContext, OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnConfig } from "../core/config.js";
import { createAlwaysOnTaskFromUserInput } from "../core/task-factory.js";
import { buildAlwaysOnCommandNote, type AlwaysOnToolSupport } from "../core/tool-compat.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import {
  resolvePlanConversationKeyFromCommand,
  resolvePlanConversationKeyFromHook,
} from "./conversation-key.js";
import { runAlwaysOnPlanner } from "./planner.js";
import type { AlwaysOnPlan, AlwaysOnPlanTurn } from "./types.js";

const MAX_PLAN_CLARIFICATION_ROUNDS = 3;

type PlanHookEvent = {
  content: string;
};

type PlanHookContext = {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  sessionKey?: string;
};

function generatePlanId(): string {
  return randomBytes(8).toString("hex");
}

function parsePlanTurns(raw: string): AlwaysOnPlanTurn[] {
  return JSON.parse(raw) as AlwaysOnPlanTurn[];
}

export class AlwaysOnPlanService {
  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    private readonly config: AlwaysOnConfig,
    private readonly toolSupport: AlwaysOnToolSupport,
  ) {}

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
      const text = await this.advancePlan(plan);
      return { text };
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

    const trimmedContent = event.content.trim();
    if (!trimmedContent) {
      return {
        handled: true,
        text: "Please reply with plain text so I can keep refining the always-on task.",
      };
    }

    try {
      if (ctx.sessionKey && !activePlan.originSessionKey) {
        this.store.updatePlan(activePlan.id, {
          originSessionKey: ctx.sessionKey,
          updatedAt: Date.now(),
        });
      }

      const updatedPlan = this.store.appendPlanTurn(activePlan.id, {
        role: "user",
        content: trimmedContent,
        timestamp: Date.now(),
      });
      if (!updatedPlan) {
        throw new Error("failed to persist the planning turn");
      }

      return {
        handled: true,
        text: await this.advancePlan(updatedPlan, ctx.sessionKey),
      };
    } catch (error) {
      return {
        handled: true,
        text: this.failPlan(activePlan.id, error),
      };
    }
  }

  private async advancePlan(plan: AlwaysOnPlan, originSessionKey?: string): Promise<string> {
    const turns = parsePlanTurns(plan.turnsJson);
    const mustFinalize = plan.roundCount >= MAX_PLAN_CLARIFICATION_ROUNDS;
    const decision = await runAlwaysOnPlanner({
      api: this.api,
      initialPrompt: plan.initialPrompt,
      turns,
      clarificationRoundsUsed: plan.roundCount,
      clarificationRoundsRemaining: Math.max(MAX_PLAN_CLARIFICATION_ROUNDS - plan.roundCount, 0),
      mustFinalize,
    });

    if (decision.action === "ask") {
      if (mustFinalize) {
        throw new Error("planner requested more clarification after reaching the round limit");
      }
      const now = Date.now();
      const reply = this.decoratePlannerQuestion(plan, decision.assistantReply);
      this.store.appendPlanTurn(plan.id, {
        role: "assistant",
        content: reply,
        timestamp: now,
      });
      this.store.updatePlan(plan.id, {
        roundCount: plan.roundCount + 1,
        originSessionKey: originSessionKey ?? plan.originSessionKey ?? null,
        updatedAt: now,
      });
      return reply;
    }

    const task = createAlwaysOnTaskFromUserInput({
      input: {
        title: decision.taskTitle,
        prompt: decision.taskPrompt,
        metadata: {
          mode: "plan",
          planId: plan.id,
          originConversationKey: plan.conversationKey,
          originSessionKey,
        },
      },
      store: this.store,
      logger: this.logger,
      config: this.config,
    });
    const now = Date.now();
    this.store.updatePlan(plan.id, {
      status: "completed",
      originSessionKey: originSessionKey ?? plan.originSessionKey ?? null,
      finalPrompt: decision.taskPrompt,
      createdTaskId: task.id,
      updatedAt: now,
      completedAt: now,
    });
    return this.buildPlanCompletionText(task.id, task.title, decision.assumptions);
  }

  private decoratePlannerQuestion(plan: AlwaysOnPlan, assistantReply: string): string {
    if (plan.roundCount === 0) {
      return (
        "I’ll refine this into a better always-on task before creating it.\n\n" + assistantReply
      );
    }
    return assistantReply;
  }

  private buildPlanCompletionText(
    taskId: string,
    taskTitle: string,
    assumptions: string[],
  ): string {
    const commandNote = buildAlwaysOnCommandNote(this.toolSupport);
    const lines = [
      `Task **${taskId}** created from the planning flow and queued for background execution.`,
      `> ${taskTitle}`,
      "",
      `Budget: ${this.config.defaultMaxLoops} loops, $${this.config.defaultMaxCostUsd} max cost.`,
      `The worker runs up to ${this.config.maxConcurrentTasks} task(s) at once and will start this task when a slot is available.`,
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
