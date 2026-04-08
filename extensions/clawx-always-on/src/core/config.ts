export type AlwaysOnConfig = {
  defaultMaxLoops: number;
  defaultMaxCostUsd: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logRetentionDays: number;
  dataDir?: string;
};

const DEFAULTS: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  logLevel: "info",
  logRetentionDays: 30,
};

export function resolveConfig(raw?: Record<string, unknown>): AlwaysOnConfig {
  const cfg = (raw ?? {}) as Partial<AlwaysOnConfig>;
  return {
    defaultMaxLoops: cfg.defaultMaxLoops ?? DEFAULTS.defaultMaxLoops,
    defaultMaxCostUsd: cfg.defaultMaxCostUsd ?? DEFAULTS.defaultMaxCostUsd,
    logLevel: cfg.logLevel ?? DEFAULTS.logLevel,
    logRetentionDays: cfg.logRetentionDays ?? DEFAULTS.logRetentionDays,
    dataDir: cfg.dataDir,
  };
}
