/**
 * GuardClaw Usage Intelligence (in-memory)
 *
 * Tracks latest completed agent loop for:
 * - GuardClaw router overhead (detection/desensitization)
 * - final reply model origin (local/cloud)
 * - loop-level totals (local/cloud/combined)
 */

export type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

export type TokenCounter = {
  input: number;
  output: number;
  total: number;
};

export type RouterPhase = "detection" | "desensitization";
export type ModelOrigin = "local" | "cloud";

type RouterTokenSummary = {
  detection: TokenCounter;
  desensitization: TokenCounter;
  combined: TokenCounter;
};

export type LoopSummary = {
  sessionKey: string;
  turnTs: number;
  startedAt: number;
  provider: string;
  model: string;
  origin: ModelOrigin;
  reason: string;
  routerTokens: RouterTokenSummary;
  loopTotalTokens: TokenCounter;
  loopLocalTokens: TokenCounter;
  loopCloudTokens: TokenCounter;
};

type LoopAccumulator = {
  startedAt: number;
  routerTokens: RouterTokenSummary;
  routerLocalTokens: TokenCounter;
  routerCloudTokens: TokenCounter;
};

type SessionLoopState = {
  sessionKey: string;
  currentLoop: LoopAccumulator | null;
  lastCompletedLoop: LoopSummary | null;
  lastActivityAt: number;
};

const BUILTIN_LOCAL_PROVIDERS = new Set([
  "ollama",
  "llama.cpp",
  "localai",
  "llamafile",
  "lmstudio",
  "vllm",
  "mlx",
  "sglang",
  "tgi",
  "koboldcpp",
  "tabbyapi",
  "nitro",
]);

const sessionLoopStates = new Map<string, SessionLoopState>();

function emptyCounter(): TokenCounter {
  return { input: 0, output: 0, total: 0 };
}

function emptyRouterSummary(): RouterTokenSummary {
  return {
    detection: emptyCounter(),
    desensitization: emptyCounter(),
    combined: emptyCounter(),
  };
}

function usageToCounter(usage?: UsageLike): TokenCounter {
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  return {
    input,
    output,
    total: usage?.total ?? input + output,
  };
}

function addCounter(target: TokenCounter, value: TokenCounter): void {
  target.input += value.input;
  target.output += value.output;
  target.total += value.total;
}

function resolveSessionKey(sessionKey?: string): string {
  return sessionKey?.trim() || "__global__";
}

function getOrCreateSessionState(sessionKey?: string): SessionLoopState {
  const key = resolveSessionKey(sessionKey);
  const existing = sessionLoopStates.get(key);
  if (existing) return existing;
  const next: SessionLoopState = {
    sessionKey: key,
    currentLoop: null,
    lastCompletedLoop: null,
    lastActivityAt: Date.now(),
  };
  sessionLoopStates.set(key, next);
  return next;
}

function ensureCurrentLoop(state: SessionLoopState): LoopAccumulator {
  if (!state.currentLoop) {
    state.currentLoop = {
      startedAt: Date.now(),
      routerTokens: emptyRouterSummary(),
      routerLocalTokens: emptyCounter(),
      routerCloudTokens: emptyCounter(),
    };
  }
  return state.currentLoop;
}

function resolveOriginByProvider(
  provider: string,
  extraLocalProviders?: string[],
  originHint?: ModelOrigin,
): { origin: ModelOrigin; reason: string } {
  if (originHint) {
    return { origin: originHint, reason: "origin_hint" };
  }

  const lower = provider.toLowerCase();
  if (lower === "guardclaw-privacy") {
    return { origin: "cloud", reason: "guardclaw_proxy_to_cloud" };
  }
  if (BUILTIN_LOCAL_PROVIDERS.has(lower)) {
    return { origin: "local", reason: "builtin_local_provider" };
  }
  if (extraLocalProviders?.some((p) => p.toLowerCase() === lower)) {
    return { origin: "local", reason: "configured_local_provider" };
  }
  return { origin: "cloud", reason: "provider_not_local" };
}

function pickLatestSessionKey(preferred?: string): string | null {
  if (preferred?.trim()) return preferred.trim();

  let latest: SessionLoopState | null = null;
  for (const state of sessionLoopStates.values()) {
    if (!state.lastCompletedLoop) continue;
    if (!latest || state.lastActivityAt > latest.lastActivityAt) {
      latest = state;
    }
  }
  return latest?.sessionKey ?? null;
}

export function recordRouterOperation(
  sessionKey: string | undefined,
  phase: RouterPhase,
  usage: UsageLike | undefined,
  _model: string,
  provider?: string,
): void {
  const state = getOrCreateSessionState(sessionKey);
  const loop = ensureCurrentLoop(state);
  const counter = usageToCounter(usage);

  addCounter(loop.routerTokens[phase], counter);
  addCounter(loop.routerTokens.combined, counter);

  const origin = resolveOriginByProvider(provider ?? "ollama").origin;
  if (origin === "local") {
    addCounter(loop.routerLocalTokens, counter);
  } else {
    addCounter(loop.routerCloudTokens, counter);
  }

  state.lastActivityAt = Date.now();
}

export function recordFinalReply(params: {
  sessionKey?: string;
  provider: string;
  model: string;
  usage?: UsageLike;
  extraLocalProviders?: string[];
  originHint?: ModelOrigin;
  reasonHint?: string;
}): void {
  const state = getOrCreateSessionState(params.sessionKey);
  const loop = ensureCurrentLoop(state);
  const resolved = resolveOriginByProvider(
    params.provider,
    params.extraLocalProviders,
    params.originHint,
  );
  const taskCounter = usageToCounter(params.usage);

  const loopLocalTokens = {
    ...loop.routerLocalTokens,
  };
  const loopCloudTokens = {
    ...loop.routerCloudTokens,
  };
  if (resolved.origin === "local") {
    addCounter(loopLocalTokens, taskCounter);
  } else {
    addCounter(loopCloudTokens, taskCounter);
  }
  const loopTotalTokens = {
    input: loopLocalTokens.input + loopCloudTokens.input,
    output: loopLocalTokens.output + loopCloudTokens.output,
    total: loopLocalTokens.total + loopCloudTokens.total,
  };

  state.lastCompletedLoop = {
    sessionKey: state.sessionKey,
    turnTs: Date.now(),
    startedAt: loop.startedAt,
    provider: params.provider,
    model: params.model,
    origin: resolved.origin,
    reason: params.reasonHint ?? resolved.reason,
    routerTokens: {
      detection: { ...loop.routerTokens.detection },
      desensitization: { ...loop.routerTokens.desensitization },
      combined: { ...loop.routerTokens.combined },
    },
    loopTotalTokens,
    loopLocalTokens,
    loopCloudTokens,
  };
  state.currentLoop = null;
  state.lastActivityAt = Date.now();
}

export function getLastTurnTokens(sessionKey?: string): {
  sessionKey: string;
  turnTs: number;
  detection: TokenCounter;
  desensitization: TokenCounter;
  combined: TokenCounter;
} | null {
  const key = pickLatestSessionKey(sessionKey);
  if (!key) return null;
  const snap = sessionLoopStates.get(key)?.lastCompletedLoop;
  if (!snap) return null;
  return {
    sessionKey: snap.sessionKey,
    turnTs: snap.turnTs,
    detection: { ...snap.routerTokens.detection },
    desensitization: { ...snap.routerTokens.desensitization },
    combined: { ...snap.routerTokens.combined },
  };
}

export function getLastReplyModelOrigin(sessionKey?: string): {
  sessionKey: string;
  timestamp: number;
  provider: string;
  model: string;
  origin: ModelOrigin;
  reason: string;
} | null {
  const key = pickLatestSessionKey(sessionKey);
  if (!key) return null;
  const snap = sessionLoopStates.get(key)?.lastCompletedLoop;
  if (!snap) return null;
  return {
    sessionKey: snap.sessionKey,
    timestamp: snap.turnTs,
    provider: snap.provider,
    model: snap.model,
    origin: snap.origin,
    reason: snap.reason,
  };
}

export function getLastReplyLoopSummary(sessionKey?: string): LoopSummary | null {
  const key = pickLatestSessionKey(sessionKey);
  if (!key) return null;
  const snap = sessionLoopStates.get(key)?.lastCompletedLoop;
  if (!snap) return null;
  return {
    ...snap,
    routerTokens: {
      detection: { ...snap.routerTokens.detection },
      desensitization: { ...snap.routerTokens.desensitization },
      combined: { ...snap.routerTokens.combined },
    },
    loopTotalTokens: { ...snap.loopTotalTokens },
    loopLocalTokens: { ...snap.loopLocalTokens },
    loopCloudTokens: { ...snap.loopCloudTokens },
  };
}

export function __resetUsageIntelForTests(): void {
  sessionLoopStates.clear();
}
