/**
 * GuardClaw loop-level detection tracker (in-memory)
 *
 * Tracks highest sensitivity level per session for:
 * - current in-progress agent loop
 * - last completed loop (finalized on llm_output)
 */

import type { SensitivityLevel } from "./types.js";

type LoopStateName = "in_progress" | "completed" | "idle";

type LoopBucket = {
  startedAt: number;
  lastUpdatedAt: number;
  highestLevel: SensitivityLevel;
  eventCount: number;
};

type SessionLoopState = {
  sessionKey: string;
  currentLoop: LoopBucket | null;
  lastCompletedLoop: LoopBucket | null;
  lastActivityAt: number;
};

export type CurrentLoopHighestLevel = {
  sessionKey: string;
  loopState: LoopStateName;
  highestLevel: SensitivityLevel;
  startedAt: number | null;
  lastUpdatedAt: number | null;
  eventCount: number;
};

const sessionStates = new Map<string, SessionLoopState>();

function levelMax(a: SensitivityLevel, b: SensitivityLevel): SensitivityLevel {
  const rank = { S1: 1, S2: 2, S3: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function resolveSessionKey(sessionKey?: string): string {
  return sessionKey?.trim() || "__global__";
}

function getOrCreateSessionState(sessionKey?: string): SessionLoopState {
  const key = resolveSessionKey(sessionKey);
  const existing = sessionStates.get(key);
  if (existing) return existing;
  const next: SessionLoopState = {
    sessionKey: key,
    currentLoop: null,
    lastCompletedLoop: null,
    lastActivityAt: Date.now(),
  };
  sessionStates.set(key, next);
  return next;
}

function pickSessionKey(preferred?: string): string {
  if (preferred?.trim()) return preferred.trim();
  let best: SessionLoopState | null = null;
  for (const state of sessionStates.values()) {
    if (!best || state.lastActivityAt > best.lastActivityAt) {
      best = state;
    }
  }
  return best?.sessionKey ?? "__global__";
}

export function recordLoopDetection(sessionKey: string | undefined, level: SensitivityLevel): void {
  const state = getOrCreateSessionState(sessionKey);
  const now = Date.now();
  if (!state.currentLoop) {
    state.currentLoop = {
      startedAt: now,
      lastUpdatedAt: now,
      highestLevel: level,
      eventCount: 1,
    };
  } else {
    state.currentLoop.highestLevel = levelMax(state.currentLoop.highestLevel, level);
    state.currentLoop.lastUpdatedAt = now;
    state.currentLoop.eventCount += 1;
  }
  state.lastActivityAt = now;
}

export function finalizeLoop(sessionKey: string | undefined, timestamp?: number): void {
  const state = getOrCreateSessionState(sessionKey);
  const now = timestamp ?? Date.now();
  if (state.currentLoop) {
    state.lastCompletedLoop = {
      ...state.currentLoop,
      lastUpdatedAt: now,
    };
    state.currentLoop = null;
    state.lastActivityAt = now;
    return;
  }

  // Keep heartbeat for sessions that reached llm_output without detections.
  state.lastActivityAt = now;
}

export function getCurrentLoopHighestLevel(sessionKey?: string): CurrentLoopHighestLevel {
  const key = pickSessionKey(sessionKey);
  const state = sessionStates.get(key);
  if (!state) {
    return {
      sessionKey: key,
      loopState: "idle",
      highestLevel: "S1",
      startedAt: null,
      lastUpdatedAt: null,
      eventCount: 0,
    };
  }

  if (state.currentLoop) {
    return {
      sessionKey: state.sessionKey,
      loopState: "in_progress",
      highestLevel: state.currentLoop.highestLevel,
      startedAt: state.currentLoop.startedAt,
      lastUpdatedAt: state.currentLoop.lastUpdatedAt,
      eventCount: state.currentLoop.eventCount,
    };
  }

  if (state.lastCompletedLoop) {
    return {
      sessionKey: state.sessionKey,
      loopState: "completed",
      highestLevel: state.lastCompletedLoop.highestLevel,
      startedAt: state.lastCompletedLoop.startedAt,
      lastUpdatedAt: state.lastCompletedLoop.lastUpdatedAt,
      eventCount: state.lastCompletedLoop.eventCount,
    };
  }

  return {
    sessionKey: state.sessionKey,
    loopState: "idle",
    highestLevel: "S1",
    startedAt: null,
    lastUpdatedAt: null,
    eventCount: 0,
  };
}

export function __resetLoopDetectionLevelForTests(): void {
  sessionStates.clear();
}
