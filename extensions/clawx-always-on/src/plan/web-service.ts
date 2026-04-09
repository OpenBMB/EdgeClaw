import { randomBytes } from "node:crypto";
import type { OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnConfig } from "../core/config.js";
import { createAlwaysOnTaskFromUserInput } from "../core/task-factory.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";
import {
  runClarificationStep,
  runFinalizationStep,
  type PlanDefaultPlan,
  type PlanQuestion,
} from "./planner.js";
import type { AlwaysOnPlan, AlwaysOnPlanTurn } from "./types.js";

type ClarificationMetadata = {
  questions: PlanQuestion[];
  defaultPlan: PlanDefaultPlan;
};

export type DashboardPlanSnapshot = {
  id: string;
  status: AlwaysOnPlan["status"];
  initialPrompt: string;
  roundCount: number;
  turns: AlwaysOnPlanTurn[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  createdTaskId?: string;
  failureReason?: string;
  pendingQuestions?: PlanQuestion[];
  defaultPlan?: PlanDefaultPlan;
};

export type DashboardPlanStartResult = {
  plan: DashboardPlanSnapshot;
};

export type DashboardPlanAnswerResult = {
  plan: DashboardPlanSnapshot;
  task?: {
    id: string;
    title: string;
  };
};

export class WebPlanRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "WebPlanRequestError";
  }
}

function generatePlanId(): string {
  return randomBytes(8).toString("hex");
}

function parsePlanTurns(raw: string): AlwaysOnPlanTurn[] {
  return JSON.parse(raw) as AlwaysOnPlanTurn[];
}

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

function formatQuestionsText(questions: PlanQuestion[]): string {
  const lines: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    lines.push(`${i + 1}. ${question.text}`);
    for (const option of question.options) {
      lines.push(option);
    }
    lines.push("");
  }
  lines.push("Reply with option letters, or provide custom answers in plain text.");
  return lines.join("\n");
}

function buildWebPlanConversationKey(planId: string): string {
  return `always-on:web:${planId}`;
}

export class AlwaysOnWebPlanService {
  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly store: TaskStore,
    private readonly logger: TaskLogger,
    private readonly config: AlwaysOnConfig,
  ) {}

  async startPlan(prompt: string): Promise<DashboardPlanStartResult> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new WebPlanRequestError(400, "Plan prompt is required");
    }

    const now = Date.now();
    const planId = generatePlanId();
    const plan: AlwaysOnPlan = {
      id: planId,
      conversationKey: buildWebPlanConversationKey(planId),
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
      const reply = [
        "I will help refine this into a stronger always-on task.",
        "",
        formatQuestionsText(decision.questions),
      ].join("\n");
      const metadata = serializeClarificationMetadata({
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
        finalPrompt: metadata,
        updatedAt: Date.now(),
      });
      return { plan: this.requireSnapshot(plan.id) };
    } catch (error) {
      this.failPlan(plan.id, error);
      return { plan: this.requireSnapshot(plan.id) };
    }
  }

  getPlan(planId: string): DashboardPlanSnapshot {
    const plan = this.store.getPlan(planId);
    if (!plan) {
      throw new WebPlanRequestError(404, `Plan ${planId} not found`);
    }
    return this.buildSnapshot(plan);
  }

  async answerPlan(planId: string, answer: string): Promise<DashboardPlanAnswerResult> {
    const plan = this.requirePlan(planId);
    if (plan.status !== "active" || plan.roundCount !== 1) {
      throw new WebPlanRequestError(409, "Only active plans waiting for an answer can continue");
    }

    const trimmedAnswer = answer.trim();
    if (!trimmedAnswer) {
      throw new WebPlanRequestError(400, "Plan answer is required");
    }

    this.store.appendPlanTurn(plan.id, {
      role: "user",
      content: trimmedAnswer,
      timestamp: Date.now(),
    });

    const clarificationMeta = parseClarificationMetadata(plan.finalPrompt);
    if (!clarificationMeta) {
      throw new WebPlanRequestError(409, "Plan is missing clarification state");
    }

    try {
      const decision = await runFinalizationStep({
        api: this.api,
        initialPrompt: plan.initialPrompt,
        questions: clarificationMeta.questions,
        userAnswer: trimmedAnswer,
      });
      const task = createAlwaysOnTaskFromUserInput({
        input: {
          title: decision.taskTitle,
          prompt: decision.taskPrompt,
          metadata: {
            mode: "plan",
            planId: plan.id,
            originConversationKey: plan.conversationKey,
          },
        },
        store: this.store,
        logger: this.logger,
        config: this.config,
      });
      const now = Date.now();
      this.store.updatePlan(plan.id, {
        status: "completed",
        finalPrompt: decision.taskPrompt,
        createdTaskId: task.id,
        updatedAt: now,
        completedAt: now,
      });
      return {
        plan: this.requireSnapshot(plan.id),
        task: {
          id: task.id,
          title: task.title,
        },
      };
    } catch (error) {
      this.failPlan(plan.id, error);
      return {
        plan: this.requireSnapshot(plan.id),
      };
    }
  }

  cancelPlan(planId: string): DashboardPlanSnapshot {
    const plan = this.requirePlan(planId);
    if (plan.status !== "active") {
      throw new WebPlanRequestError(409, `Plan is already ${plan.status}`);
    }
    const now = Date.now();
    this.store.updatePlan(plan.id, {
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
    });
    return this.requireSnapshot(plan.id);
  }

  private buildSnapshot(plan: AlwaysOnPlan): DashboardPlanSnapshot {
    const snapshot: DashboardPlanSnapshot = {
      id: plan.id,
      status: plan.status,
      initialPrompt: plan.initialPrompt,
      roundCount: plan.roundCount,
      turns: parsePlanTurns(plan.turnsJson),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      completedAt: plan.completedAt,
      createdTaskId: plan.createdTaskId,
      failureReason: plan.failureReason,
    };
    if (plan.status === "active" && plan.roundCount === 1) {
      const metadata = parseClarificationMetadata(plan.finalPrompt);
      if (metadata) {
        snapshot.pendingQuestions = metadata.questions;
        snapshot.defaultPlan = metadata.defaultPlan;
      }
    }
    return snapshot;
  }

  private requirePlan(planId: string): AlwaysOnPlan {
    const plan = this.store.getPlan(planId);
    if (!plan) {
      throw new WebPlanRequestError(404, `Plan ${planId} not found`);
    }
    return plan;
  }

  private requireSnapshot(planId: string): DashboardPlanSnapshot {
    return this.buildSnapshot(this.requirePlan(planId));
  }

  private failPlan(planId: string, error: unknown): void {
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
    this.logger.warn(`plan:${planId}`, `Web planning flow failed: ${message}`);
  }
}
