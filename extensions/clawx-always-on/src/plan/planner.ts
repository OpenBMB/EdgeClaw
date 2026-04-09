import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "../../api.js";
import type { AlwaysOnPlanTurn } from "./types.js";

export type PlannerDecision =
  | {
      action: "ask";
      assistantReply: string;
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

function parsePlannerDecision(raw: string): PlannerDecision {
  const parsed = JSON.parse(stripCodeFences(raw)) as unknown;
  if (!isRecord(parsed) || typeof parsed.action !== "string") {
    throw new Error("planner returned invalid payload");
  }
  if (parsed.action === "ask") {
    const assistantReply =
      typeof parsed.assistantReply === "string" ? parsed.assistantReply.trim() : "";
    if (!assistantReply) {
      throw new Error("planner ask response was empty");
    }
    return {
      action: "ask",
      assistantReply,
    };
  }
  if (parsed.action === "create") {
    const taskTitle = typeof parsed.taskTitle === "string" ? parsed.taskTitle.trim() : "";
    const taskPrompt = typeof parsed.taskPrompt === "string" ? parsed.taskPrompt.trim() : "";
    if (!taskTitle || !taskPrompt) {
      throw new Error("planner create response was incomplete");
    }
    const assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
    return {
      action: "create",
      taskTitle,
      taskPrompt,
      assumptions,
    };
  }
  throw new Error(`planner returned unsupported action: ${String(parsed.action)}`);
}

function buildPlannerPrompt(params: {
  initialPrompt: string;
  turns: AlwaysOnPlanTurn[];
  clarificationRoundsUsed: number;
  clarificationRoundsRemaining: number;
  mustFinalize: boolean;
}): string {
  const system = [
    "You plan high-quality always-on background tasks for OpenClaw.",
    "Return ONLY valid JSON.",
    "Do not wrap the JSON in markdown fences.",
    "Do not include commentary outside the JSON.",
    "Do not call tools.",
  ].join(" ");
  const task = [
    "Decide whether the task needs clarification or is ready to create.",
    'If more user input is required and mustFinalize is false, return {"action":"ask","assistantReply":"..."} with one concise message that may contain 1-3 short questions.',
    'If the task is ready, or mustFinalize is true, return {"action":"create","taskTitle":"...","taskPrompt":"...","assumptions":["..."]}.',
    "taskTitle must be short and human-readable.",
    "taskPrompt must be self-contained, optimized from the full conversation, and suitable for an autonomous background worker.",
    "Prefer creation over more questions once the goal and key constraints are clear.",
  ].join(" ");
  const input = JSON.stringify(
    {
      initialPrompt: params.initialPrompt,
      turns: params.turns,
      clarificationRoundsUsed: params.clarificationRoundsUsed,
      clarificationRoundsRemaining: params.clarificationRoundsRemaining,
      mustFinalize: params.mustFinalize,
    },
    null,
    2,
  );
  return `${system}\n\nTASK:\n${task}\n\nINPUT_JSON:\n${input}\n`;
}

export async function runAlwaysOnPlanner(params: {
  api: OpenClawPluginApi;
  initialPrompt: string;
  turns: AlwaysOnPlanTurn[];
  clarificationRoundsUsed: number;
  clarificationRoundsRemaining: number;
  mustFinalize: boolean;
}): Promise<PlannerDecision> {
  const prompt = buildPlannerPrompt(params);
  let tempDir: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "clawx-always-on-plan-"));
    const sessionId = `always-on-plan-${Date.now()}`;
    const sessionFile = path.join(tempDir, "session.jsonl");
    const result = await params.api.runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir: params.api.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: params.api.config,
      prompt,
      timeoutMs: 30_000,
      runId: `${sessionId}-run`,
      disableTools: true,
    });
    const text = collectText((result as { payloads?: unknown }).payloads);
    if (!text) {
      throw new Error("planner returned empty output");
    }
    return parsePlannerDecision(text);
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
