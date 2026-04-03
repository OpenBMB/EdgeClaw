import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".openclaw", "cc-context-engine");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function readState(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function contextInspect(_sessionId?: string) {
  const state = readState();
  if (!state) {
    return {
      status: "no_data",
      message: "Context engine state file not found.",
      stateFile: STATE_FILE,
    };
  }
  return { status: "ok", ...state, stateFile: STATE_FILE };
}

export async function contextBudgetCheck(_sessionId?: string) {
  const state = readState();
  if (!state) {
    return { status: "no_data", message: "No budget data available." };
  }
  const totalTokens = (state.totalTokens as number) ?? 0;
  const tokenBudget = (state.tokenBudget as number) ?? 128_000;
  const usageRatio = totalTokens / tokenBudget;
  const compactThreshold = 0.85;
  const distanceToCompact = Math.max(0, (compactThreshold - usageRatio) * tokenBudget);
  const estimatedRemainingTurns = Math.floor(distanceToCompact / 2000);

  return {
    status: "ok",
    totalTokens,
    tokenBudget,
    usageRatio: Math.round(usageRatio * 1000) / 1000,
    compactThreshold,
    distanceToCompactTokens: Math.round(distanceToCompact),
    estimatedRemainingTurns,
    willCompactSoon: usageRatio > compactThreshold * 0.9,
  };
}

export async function contextForceCompact(sessionId: string, reason?: string) {
  const state = readState();
  const now = new Date().toISOString();
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          ...state,
          lastCompactTime: now,
          lastCompactReason: reason ?? "manual",
          forceCompacted: true,
          updatedAt: now,
        },
        null,
        2,
      ),
    );
  } catch {
    return { status: "error", message: "Failed to write compact state." };
  }
  return {
    status: "ok",
    message: `Context compaction triggered for session ${sessionId}.`,
    sessionId,
    reason: reason ?? "manual",
    compactedAt: now,
  };
}
