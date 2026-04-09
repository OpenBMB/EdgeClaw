import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "../../api.js";

export type DreamCandidate = {
  taskTitle: string;
  taskPrompt: string;
  rationale: string;
  parentTaskIds: string[];
};

export type DreamPlannerResult = {
  summary: string;
  candidates: DreamCandidate[];
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

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function parseCandidate(value: unknown): DreamCandidate | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const taskTitle = typeof value.taskTitle === "string" ? value.taskTitle.trim() : "";
  const taskPrompt = typeof value.taskPrompt === "string" ? value.taskPrompt.trim() : "";
  const rationale = typeof value.rationale === "string" ? value.rationale.trim() : "";
  if (!taskTitle || !taskPrompt || !rationale) {
    return undefined;
  }
  return {
    taskTitle,
    taskPrompt,
    rationale,
    parentTaskIds: parseStringArray(value.parentTaskIds),
  };
}

export function parseDreamPlannerResult(raw: string): DreamPlannerResult {
  const parsed = JSON.parse(stripCodeFences(raw)) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("dream planner returned invalid payload");
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const candidates = Array.isArray(parsed.candidates)
    ? parsed.candidates
        .map((candidate) => parseCandidate(candidate))
        .filter((candidate): candidate is DreamCandidate => Boolean(candidate))
    : [];
  if (!summary) {
    throw new Error("dream planner returned an empty summary");
  }
  return { summary, candidates };
}

function buildDreamPrompt(params: {
  maxCandidates: number;
  sourceLanguageHint?: string;
  context: string;
}): string {
  const system = [
    "You derive high-signal always-on background task candidates for OpenClaw.",
    "Return ONLY valid JSON. Do not wrap the JSON in markdown fences. Do not call tools.",
  ].join(" ");
  const task = [
    `Review the provided context and propose at most ${params.maxCandidates} new always-on task candidates.`,
    "Only propose tasks that are meaningfully distinct from existing active, queued, suspended, completed, or pending tasks.",
    "Prefer monitoring, follow-up, synthesis, or reminder tasks that benefit from background execution.",
    "Do not propose duplicates, near-duplicates, or tasks that should obviously stay in the foreground chat.",
    "The output must be in the same language as the source context unless the context strongly indicates otherwise.",
    'Return exactly: {"summary":"...","candidates":[{"taskTitle":"...","taskPrompt":"...","rationale":"...","parentTaskIds":["task-1"]}]}',
    "summary should briefly explain why these candidates are worth surfacing now.",
    "taskPrompt must be self-contained so a background sub-agent can execute it later.",
  ].join(" ");
  return `${system}\n\nTASK:\n${task}\n\nLANGUAGE_HINT:\n${
    params.sourceLanguageHint ?? "same as source context"
  }\n\nCONTEXT:\n${params.context}\n`;
}

async function callDreamPlanner(params: {
  api: OpenClawPluginApi;
  prompt: string;
  provider?: string;
  model?: string;
}): Promise<string> {
  let tempDir: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "clawx-always-on-dream-"));
    const sessionId = `always-on-dream-${Date.now()}`;
    const sessionFile = path.join(tempDir, "session.jsonl");
    const result = await params.api.runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir: params.api.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: params.api.config,
      prompt: params.prompt,
      timeoutMs: 30_000,
      runId: `${sessionId}-run`,
      provider: params.provider,
      model: params.model,
      disableTools: true,
    });
    const text = collectText((result as { payloads?: unknown }).payloads);
    if (!text) {
      throw new Error("dream planner returned empty output");
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

export async function runDreamPlanningStep(params: {
  api: OpenClawPluginApi;
  context: string;
  maxCandidates: number;
  provider?: string;
  model?: string;
  sourceLanguageHint?: string;
}): Promise<DreamPlannerResult> {
  const prompt = buildDreamPrompt({
    context: params.context,
    maxCandidates: params.maxCandidates,
    sourceLanguageHint: params.sourceLanguageHint,
  });
  const raw = await callDreamPlanner({
    api: params.api,
    prompt,
    provider: params.provider,
    model: params.model,
  });
  return parseDreamPlannerResult(raw);
}
