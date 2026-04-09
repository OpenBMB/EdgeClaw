export type AlwaysOnConfig = {
  defaultMaxLoops: number;
  defaultMaxCostUsd: number;
  maxConcurrentTasks: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logRetentionDays: number;
  dataDir?: string;
};

export type AlwaysOnConfigFieldKey = keyof AlwaysOnConfig;

type BaseFieldDefinition = {
  key: AlwaysOnConfigFieldKey;
  label: string;
  help?: string;
  placeholder?: string;
  restartRequired?: boolean;
};

type NumberFieldDefinition = BaseFieldDefinition & {
  input: "number";
  minimum: number;
  maximum: number;
  step: number;
};

type SelectFieldDefinition = BaseFieldDefinition & {
  input: "select";
  options: AlwaysOnConfig["logLevel"][];
};

type TextFieldDefinition = BaseFieldDefinition & {
  input: "text";
};

export type AlwaysOnConfigFieldDefinition =
  | NumberFieldDefinition
  | SelectFieldDefinition
  | TextFieldDefinition;

export type AlwaysOnConfigSource = AlwaysOnConfig | (() => AlwaysOnConfig);

export const DEFAULTS: AlwaysOnConfig = {
  defaultMaxLoops: 50,
  defaultMaxCostUsd: 1.0,
  maxConcurrentTasks: 3,
  logLevel: "info",
  logRetentionDays: 30,
};

export const ALWAYS_ON_CONFIG_FIELD_ORDER = [
  "defaultMaxLoops",
  "defaultMaxCostUsd",
  "maxConcurrentTasks",
  "logLevel",
  "logRetentionDays",
  "dataDir",
] as const satisfies readonly AlwaysOnConfigFieldKey[];

export const ALWAYS_ON_CONFIG_RESTART_REQUIRED_FIELDS = [
  "dataDir",
] as const satisfies readonly AlwaysOnConfigFieldKey[];

export const ALWAYS_ON_CONFIG_FIELDS: Record<
  AlwaysOnConfigFieldKey,
  AlwaysOnConfigFieldDefinition
> = {
  defaultMaxLoops: {
    key: "defaultMaxLoops",
    input: "number",
    label: "Default Max Loops",
    help: "Maximum LLM interaction loops per task run.",
    minimum: 1,
    maximum: 1000,
    step: 1,
  },
  defaultMaxCostUsd: {
    key: "defaultMaxCostUsd",
    input: "number",
    label: "Default Max Cost (USD)",
    help: "Maximum estimated USD cost per task run.",
    minimum: 0.01,
    maximum: 100,
    step: 0.01,
  },
  maxConcurrentTasks: {
    key: "maxConcurrentTasks",
    input: "number",
    label: "Max Concurrent Tasks",
    help: "Maximum number of always-on tasks the worker launches at the same time.",
    minimum: 1,
    maximum: 20,
    step: 1,
  },
  logLevel: {
    key: "logLevel",
    input: "select",
    label: "Log Level",
    help: "Minimum log level written to the task activity log.",
    options: ["debug", "info", "warn", "error"],
  },
  logRetentionDays: {
    key: "logRetentionDays",
    input: "number",
    label: "Log Retention (days)",
    help: "Number of days to keep task logs before cleanup.",
    minimum: 1,
    maximum: 365,
    step: 1,
  },
  dataDir: {
    key: "dataDir",
    input: "text",
    label: "Data Directory",
    placeholder: "~/.openclaw/clawx-always-on",
    help: "Optional override for the plugin data directory.",
    restartRequired: true,
  },
};

export function resolveConfigSource(source: AlwaysOnConfigSource): () => AlwaysOnConfig {
  return typeof source === "function" ? source : () => source;
}

export function resolveConfig(raw?: Record<string, unknown>): AlwaysOnConfig {
  return mergeConfig(DEFAULTS, parseConfigPatch(raw ?? {}));
}

export function parseConfigPatch(
  raw: Record<string, unknown>,
  options: { strict?: boolean } = {},
): Partial<AlwaysOnConfig> {
  const patch: Partial<AlwaysOnConfig> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!isConfigFieldKey(key)) {
      if (options.strict) {
        throw new Error(`Unknown config field: ${key}`);
      }
      continue;
    }

    if (key === "defaultMaxLoops") {
      patch.defaultMaxLoops = parseNumberField(key, value, { integer: true });
      continue;
    }
    if (key === "defaultMaxCostUsd") {
      patch.defaultMaxCostUsd = parseNumberField(key, value, { integer: false });
      continue;
    }
    if (key === "maxConcurrentTasks") {
      patch.maxConcurrentTasks = parseNumberField(key, value, { integer: true });
      continue;
    }
    if (key === "logLevel") {
      patch.logLevel = parseLogLevel(value);
      continue;
    }
    if (key === "logRetentionDays") {
      patch.logRetentionDays = parseNumberField(key, value, { integer: true });
      continue;
    }
    if (key === "dataDir") {
      patch.dataDir = parseDataDir(value);
    }
  }

  return patch;
}

export function mergeConfig(base: AlwaysOnConfig, patch: Partial<AlwaysOnConfig>): AlwaysOnConfig {
  const next: AlwaysOnConfig = {
    defaultMaxLoops: patch.defaultMaxLoops ?? base.defaultMaxLoops,
    defaultMaxCostUsd: patch.defaultMaxCostUsd ?? base.defaultMaxCostUsd,
    maxConcurrentTasks: patch.maxConcurrentTasks ?? base.maxConcurrentTasks,
    logLevel: patch.logLevel ?? base.logLevel,
    logRetentionDays: patch.logRetentionDays ?? base.logRetentionDays,
    dataDir: hasOwnKey(patch, "dataDir") ? patch.dataDir : base.dataDir,
  };
  if (next.dataDir !== undefined && !next.dataDir.trim()) {
    next.dataDir = undefined;
  }
  return next;
}

export function serializeConfig(config: AlwaysOnConfig): Record<string, unknown> {
  return {
    defaultMaxLoops: config.defaultMaxLoops,
    defaultMaxCostUsd: config.defaultMaxCostUsd,
    maxConcurrentTasks: config.maxConcurrentTasks,
    logLevel: config.logLevel,
    logRetentionDays: config.logRetentionDays,
    ...(config.dataDir ? { dataDir: config.dataDir } : {}),
  };
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return left === right;
}

function isConfigFieldKey(value: string): value is AlwaysOnConfigFieldKey {
  return ALWAYS_ON_CONFIG_FIELD_ORDER.includes(value as AlwaysOnConfigFieldKey);
}

function hasOwnKey<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseNumberField(
  key: "defaultMaxLoops" | "defaultMaxCostUsd" | "maxConcurrentTasks" | "logRetentionDays",
  value: unknown,
  options: { integer: boolean },
): number {
  const field = ALWAYS_ON_CONFIG_FIELDS[key] as NumberFieldDefinition;
  if (typeof value === "string" && !value.trim()) {
    throw new Error(`${field.label} is required`);
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`${field.label} must be a number`);
  }
  if (options.integer && !Number.isInteger(parsed)) {
    throw new Error(`${field.label} must be an integer`);
  }
  if (parsed < field.minimum || parsed > field.maximum) {
    throw new Error(`${field.label} must be between ${field.minimum} and ${field.maximum}`);
  }

  return parsed;
}

function parseLogLevel(value: unknown): AlwaysOnConfig["logLevel"] {
  const field = ALWAYS_ON_CONFIG_FIELDS.logLevel as SelectFieldDefinition;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (field.options.includes(normalized as AlwaysOnConfig["logLevel"])) {
    return normalized as AlwaysOnConfig["logLevel"];
  }
  throw new Error(`${field.label} must be one of: ${field.options.join(", ")}`);
}

function parseDataDir(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Data Directory must be a string");
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
