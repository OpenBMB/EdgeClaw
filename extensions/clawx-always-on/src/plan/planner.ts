import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnPlanTurn } from "./types.js";

export type PlanQuestion = {
  id: string;
  text: string;
  options: string[];
};

export type PlanDefaultPlan = {
  taskTitle: string;
  taskPrompt: string;
  assumptions: string[];
};

export type PlannerDecision =
  | {
      action: "ask";
      questions: PlanQuestion[];
      defaultPlan: PlanDefaultPlan;
    }
  | {
      action: "create";
      taskTitle: string;
      taskPrompt: string;
      assumptions: string[];
    };

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (match) {
    return (match[1] ?? "").trim();
  }
  return trimmed;
}

function collectText(payloads: unknown): string {
  if (!Array.isArray(payloads)) return "";
  return payloads
    .filter((payload): payload is { text?: string; isError?: boolean } =>
      Boolean(payload && typeof payload === "object"),
    )
    .filter((payload) => !payload.isError && typeof payload.text === "string")
    .map((payload) => payload.text ?? "")
    .join("\n")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseQuestions(raw: unknown): PlanQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .filter(
      (q) =>
        typeof q.id === "string" &&
        typeof q.text === "string" &&
        Array.isArray(q.options) &&
        q.options.length >= 2,
    )
    .map((q) => ({
      id: String(q.id),
      text: String(q.text),
      options: (q.options as unknown[]).filter((o): o is string => typeof o === "string"),
    }));
}

function parseDefaultPlan(raw: unknown): PlanDefaultPlan | undefined {
  if (!isRecord(raw)) return undefined;
  const taskTitle = typeof raw.taskTitle === "string" ? raw.taskTitle.trim() : "";
  const taskPrompt = typeof raw.taskPrompt === "string" ? raw.taskPrompt.trim() : "";
  if (!taskTitle || !taskPrompt) return undefined;
  const assumptions = Array.isArray(raw.assumptions)
    ? raw.assumptions.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  return { taskTitle, taskPrompt, assumptions };
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export function parsePlannerDecision(raw: string): PlannerDecision {
  const parsed = JSON.parse(stripCodeFences(raw)) as unknown;
  if (!isRecord(parsed) || typeof parsed.action !== "string") {
    throw new Error("planner returned invalid payload");
  }
  if (parsed.action === "ask") {
    const questions = parseQuestions(parsed.questions);
    if (questions.length === 0) {
      throw new Error("planner ask response contained no valid questions");
    }
    const defaultPlan = parseDefaultPlan(parsed.defaultPlan);
    if (!defaultPlan) {
      throw new Error("planner ask response was missing a valid defaultPlan");
    }
    return { action: "ask", questions, defaultPlan };
  }
  if (parsed.action === "create") {
    const taskTitle = typeof parsed.taskTitle === "string" ? parsed.taskTitle.trim() : "";
    const taskPrompt = typeof parsed.taskPrompt === "string" ? parsed.taskPrompt.trim() : "";
    if (!taskTitle || !taskPrompt) {
      throw new Error("planner create response was incomplete");
    }
    return {
      action: "create",
      taskTitle,
      taskPrompt,
      assumptions: parseStringArray(parsed.assumptions),
    };
  }
  throw new Error(`planner returned unsupported action: ${String(parsed.action)}`);
}

function buildClarificationPrompt(initialPrompt: string): string {
  const system = [
    "You plan high-quality always-on background tasks for OpenClaw.",
    "Return ONLY valid JSON. Do not wrap in markdown fences. Do not include commentary outside the JSON. Do not call tools.",
  ].join(" ");
  const task = [
    "Analyze the user's goal and produce 1-3 multiple-choice clarification questions that will help you create a better background task.",
    "Each question MUST have 2-4 short options. The LAST option of each question MUST be a free-form fallback like 'Other (please specify)'.",
    "You MUST also produce a defaultPlan: a reasonable task that would be created if the user skips the questions entirely.",
    'Return exactly: {"action":"ask","questions":[{"id":"q1","text":"...","options":["A. ...","B. ...","C. Other (please specify)"]}],"defaultPlan":{"taskTitle":"...","taskPrompt":"...","assumptions":["..."]}}',
    "Keep questions concise. Write questions and options in the same language as the user's prompt.",
  ].join(" ");
  return `${system}\n\nTASK:\n${task}\n\nUSER_PROMPT:\n${initialPrompt}\n`;
}

function buildFinalizationPrompt(params: {
  initialPrompt: string;
  questions: PlanQuestion[];
  userAnswer: string;
}): string {
  const system = [
    "You plan high-quality always-on background tasks for OpenClaw.",
    "Return ONLY valid JSON. Do not wrap in markdown fences. Do not include commentary outside the JSON. Do not call tools.",
  ].join(" ");
  const task = [
    "Based on the user's original goal, the clarification questions you asked, and the user's answers, create the final background task.",
    "The taskPrompt must be self-contained, optimized from the full context, and suitable for an autonomous background worker.",
    'Return exactly: {"action":"create","taskTitle":"...","taskPrompt":"...","assumptions":["..."]}',
    "taskTitle must be short and human-readable. Write in the same language as the user's prompt.",
  ].join(" ");
  const input = JSON.stringify(
    {
      initialPrompt: params.initialPrompt,
      questions: params.questions,
      userAnswer: params.userAnswer,
    },
    null,
    2,
  );
  return `${system}\n\nTASK:\n${task}\n\nINPUT_JSON:\n${input}\n`;
}

function resolveConfiguredModel(api: OpenClawPluginApi): {
  provider: string | undefined;
  model: string | undefined;
} {
  const defaultsModel = api.config?.agents?.defaults?.model;
  const primary =
    typeof defaultsModel === "string"
      ? defaultsModel.trim()
      : typeof defaultsModel === "object" && defaultsModel !== null && "primary" in defaultsModel
        ? (defaultsModel as { primary?: string }).primary?.trim()
        : undefined;
  return {
    provider: typeof primary === "string" ? primary.split("/")[0] : undefined,
    model: typeof primary === "string" ? primary.split("/").slice(1).join("/") : undefined,
  };
}

async function callPlanner(
  api: OpenClawPluginApi,
  prompt: string,
  overrides?: {
    provider?: string;
    model?: string;
  },
): Promise<string> {
  const configuredModel = resolveConfiguredModel(api);
  const provider = overrides?.provider ?? configuredModel.provider;
  const model = overrides?.model ?? configuredModel.model;
  let tempDir: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "clawx-always-on-plan-"));
    const sessionId = `always-on-plan-${Date.now()}`;
    const sessionFile = path.join(tempDir, "session.jsonl");
    const result = await api.runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir: api.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: api.config,
      prompt,
      timeoutMs: 30_000,
      runId: `${sessionId}-run`,
      provider,
      model,
      disableTools: true,
    });
    const text = collectText((result as { payloads?: unknown }).payloads);
    if (!text) {
      throw new Error("planner returned empty output");
    }
    return text;
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore temp cleanup failures
      }
    }
  }
}

export async function runClarificationStep(params: {
  api: OpenClawPluginApi;
  initialPrompt: string;
  provider?: string;
  model?: string;
}): Promise<PlannerDecision & { action: "ask" }> {
  const prompt = buildClarificationPrompt(params.initialPrompt);
  const raw = await callPlanner(params.api, prompt, {
    provider: params.provider,
    model: params.model,
  });
  const decision = parsePlannerDecision(raw);
  if (decision.action !== "ask") {
    throw new Error("planner did not return an ask decision for the clarification step");
  }
  return decision;
}

export async function runFinalizationStep(params: {
  api: OpenClawPluginApi;
  initialPrompt: string;
  questions: PlanQuestion[];
  userAnswer: string;
  provider?: string;
  model?: string;
}): Promise<PlannerDecision & { action: "create" }> {
  const prompt = buildFinalizationPrompt(params);
  const raw = await callPlanner(params.api, prompt, {
    provider: params.provider,
    model: params.model,
  });
  const decision = parsePlannerDecision(raw);
  if (decision.action !== "create") {
    throw new Error("planner did not return a create decision for the finalization step");
  }
  return decision;
}
