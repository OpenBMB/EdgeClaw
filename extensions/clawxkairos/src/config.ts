export type KairosConfig = {
  maxTurnsPerSession?: number;
  minSleepMs?: number;
  maxSleepMs?: number;
  tickDelayMs?: number;
  autoBackgroundAfterMs?: number;
  startMode?: "on-message" | "on-heartbeat" | "on-gateway-start";
  asyncSubagents?: boolean;
};

const DEFAULTS = {
  maxTurnsPerSession: 50,
  minSleepMs: 5_000,
  maxSleepMs: 300_000,
  tickDelayMs: 100,
  autoBackgroundAfterMs: 30_000,
  startMode: "on-message" as const,
  asyncSubagents: true,
};

export function resolveConfig(raw?: Record<string, unknown>): Required<KairosConfig> {
  const cfg = (raw ?? {}) as KairosConfig;
  return {
    maxTurnsPerSession: cfg.maxTurnsPerSession ?? DEFAULTS.maxTurnsPerSession,
    minSleepMs: cfg.minSleepMs ?? DEFAULTS.minSleepMs,
    maxSleepMs: cfg.maxSleepMs ?? DEFAULTS.maxSleepMs,
    tickDelayMs: cfg.tickDelayMs ?? DEFAULTS.tickDelayMs,
    autoBackgroundAfterMs: cfg.autoBackgroundAfterMs ?? DEFAULTS.autoBackgroundAfterMs,
    startMode: cfg.startMode ?? DEFAULTS.startMode,
    asyncSubagents: cfg.asyncSubagents ?? DEFAULTS.asyncSubagents,
  };
}

/**
 * Mutable runtime state shared across all hooks within a single plugin instance.
 * Not persisted — resets on gateway restart.
 */
export type KairosState = {
  /** Runtime on/off toggle, controlled by /kairos command. */
  active: boolean;
  /** Consecutive autonomous turns in the current burst. Reset on user message. */
  turnCount: number;
  /** Pending sleep timer handle (for cancellation on user interrupt). */
  sleepTimer: ReturnType<typeof setTimeout> | null;
  /** Pending sleep resolve callback (for early wake on user interrupt). */
  sleepResolve: (() => void) | null;
  /** Set by llm_output when the model replied HEARTBEAT_OK instead of calling Sleep. */
  lastReplyWasAck: boolean;
};

export function createInitialState(): KairosState {
  return {
    active: true,
    turnCount: 0,
    sleepTimer: null,
    sleepResolve: null,
    lastReplyWasAck: false,
  };
}
