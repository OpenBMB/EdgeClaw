import type { BudgetExceededAction } from "./types.js";

export type AlwaysOnConfig = {
  defaultMaxLoops: number;
  defaultMaxCostUsd: number;
  defaultBudgetExceededAction: BudgetExceededAction;
  defaultProvider?: string;
  defaultModel?: string;
  maxConcurrentTasks: number;
  dreamEnabled: boolean;
  dreamIntervalMinutes: number;
  dreamProvider?: string;
  dreamModel?: string;
  dreamMaxCandidates: number;
  dreamContextMessageLimit: number;
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
  options: string[];
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
  defaultBudgetExceededAction: "warn",
  maxConcurrentTasks: 3,
  dreamEnabled: false,
  dreamIntervalMinutes: 60,
  dreamMaxCandidates: 3,
  dreamContextMessageLimit: 40,
  logLevel: "info",
  logRetentionDays: 30,
};

export const ALWAYS_ON_CONFIG_FIELD_ORDER = [
  "defaultMaxLoops",
  "defaultMaxCostUsd",
  "defaultBudgetExceededAction",
  "defaultProvider",
  "defaultModel",
  "maxConcurrentTasks",
  "dreamEnabled",
  "dreamIntervalMinutes",
  "dreamProvider",
  "dreamModel",
  "dreamMaxCandidates",
  "dreamContextMessageLimit",
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
  defaultBudgetExceededAction: {
    key: "defaultBudgetExceededAction",
    input: "select",
    label: "Budget Exceeded Action",
    help: "What to do when an always-on task exceeds budget.",
    options: ["warn", "terminate"],
  },
  defaultProvider: {
    key: "defaultProvider",
    input: "text",
    label: "Default Provider",
    help: "Optional provider override for always-on task execution.",
  },
  defaultModel: {
    key: "defaultModel",
    input: "text",
    label: "Default Model",
    help: "Optional model override for always-on task execution.",
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
  dreamEnabled: {
    key: "dreamEnabled",
    input: "select",
    label: "Enable Dream",
    help: "Allow the plugin to derive new pending always-on tasks from transcript, memory, and task state.",
    options: ["true", "false"],
  },
  dreamIntervalMinutes: {
    key: "dreamIntervalMinutes",
    input: "number",
    label: "Dream Interval (minutes)",
    help: "How often the dream scheduler should derive new pending tasks.",
    minimum: 5,
    maximum: 1440,
    step: 1,
  },
  dreamProvider: {
    key: "dreamProvider",
    input: "text",
    label: "Dream Provider",
    help: "Optional provider override for dream planning.",
  },
  dreamModel: {
    key: "dreamModel",
    input: "text",
    label: "Dream Model",
    help: "Optional model override for dream planning.",
  },
  dreamMaxCandidates: {
    key: "dreamMaxCandidates",
    input: "number",
    label: "Dream Max Candidates",
    help: "Maximum number of pending tasks to derive in each dream run.",
    minimum: 1,
    maximum: 10,
    step: 1,
  },
  dreamContextMessageLimit: {
    key: "dreamContextMessageLimit",
    input: "number",
    label: "Dream Transcript Messages",
    help: "How many recent transcript messages to include when deriving dream candidates.",
    minimum: 5,
    maximum: 200,
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
    if (key === "defaultBudgetExceededAction") {
      patch.defaultBudgetExceededAction = parseBudgetExceededAction(value);
      continue;
    }
    if (key === "defaultProvider") {
      patch.defaultProvider = parseOptionalTextField(
        value,
        ALWAYS_ON_CONFIG_FIELDS.defaultProvider.label,
      );
      continue;
    }
    if (key === "defaultModel") {
      patch.defaultModel = parseOptionalTextField(
        value,
        ALWAYS_ON_CONFIG_FIELDS.defaultModel.label,
      );
      continue;
    }
    if (key === "maxConcurrentTasks") {
      patch.maxConcurrentTasks = parseNumberField(key, value, { integer: true });
      continue;
    }
    if (key === "dreamEnabled") {
      patch.dreamEnabled = parseBooleanField(value, ALWAYS_ON_CONFIG_FIELDS.dreamEnabled.label);
      continue;
    }
    if (key === "dreamIntervalMinutes") {
      patch.dreamIntervalMinutes = parseNumberField(key, value, { integer: true });
      continue;
    }
    if (key === "dreamProvider") {
      patch.dreamProvider = parseOptionalTextField(
        value,
        ALWAYS_ON_CONFIG_FIELDS.dreamProvider.label,
      );
      continue;
    }
    if (key === "dreamModel") {
      patch.dreamModel = parseOptionalTextField(value, ALWAYS_ON_CONFIG_FIELDS.dreamModel.label);
      continue;
    }
    if (key === "dreamMaxCandidates") {
      patch.dreamMaxCandidates = parseNumberField(key, value, { integer: true });
      continue;
    }
    if (key === "dreamContextMessageLimit") {
      patch.dreamContextMessageLimit = parseNumberField(key, value, { integer: true });
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
    defaultBudgetExceededAction:
      patch.defaultBudgetExceededAction ?? base.defaultBudgetExceededAction,
    defaultProvider: hasOwnKey(patch, "defaultProvider")
      ? patch.defaultProvider
      : base.defaultProvider,
    defaultModel: hasOwnKey(patch, "defaultModel") ? patch.defaultModel : base.defaultModel,
    maxConcurrentTasks: patch.maxConcurrentTasks ?? base.maxConcurrentTasks,
    dreamEnabled: patch.dreamEnabled ?? base.dreamEnabled,
    dreamIntervalMinutes: patch.dreamIntervalMinutes ?? base.dreamIntervalMinutes,
    dreamProvider: hasOwnKey(patch, "dreamProvider") ? patch.dreamProvider : base.dreamProvider,
    dreamModel: hasOwnKey(patch, "dreamModel") ? patch.dreamModel : base.dreamModel,
    dreamMaxCandidates: patch.dreamMaxCandidates ?? base.dreamMaxCandidates,
    dreamContextMessageLimit: patch.dreamContextMessageLimit ?? base.dreamContextMessageLimit,
    logLevel: patch.logLevel ?? base.logLevel,
    logRetentionDays: patch.logRetentionDays ?? base.logRetentionDays,
    dataDir: hasOwnKey(patch, "dataDir") ? patch.dataDir : base.dataDir,
  };
  next.defaultProvider = normalizeOptionalString(next.defaultProvider);
  next.defaultModel = normalizeOptionalString(next.defaultModel);
  next.dreamProvider = normalizeOptionalString(next.dreamProvider);
  next.dreamModel = normalizeOptionalString(next.dreamModel);
  if (next.dataDir !== undefined && !next.dataDir.trim()) {
    next.dataDir = undefined;
  }
  return next;
}

export function serializeConfig(config: AlwaysOnConfig): Record<string, unknown> {
  return {
    defaultMaxLoops: config.defaultMaxLoops,
    defaultMaxCostUsd: config.defaultMaxCostUsd,
    defaultBudgetExceededAction: config.defaultBudgetExceededAction,
    ...(config.defaultProvider ? { defaultProvider: config.defaultProvider } : {}),
    ...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
    maxConcurrentTasks: config.maxConcurrentTasks,
    dreamEnabled: config.dreamEnabled,
    dreamIntervalMinutes: config.dreamIntervalMinutes,
    ...(config.dreamProvider ? { dreamProvider: config.dreamProvider } : {}),
    ...(config.dreamModel ? { dreamModel: config.dreamModel } : {}),
    dreamMaxCandidates: config.dreamMaxCandidates,
    dreamContextMessageLimit: config.dreamContextMessageLimit,
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
  key:
    | "defaultMaxLoops"
    | "defaultMaxCostUsd"
    | "maxConcurrentTasks"
    | "dreamIntervalMinutes"
    | "dreamMaxCandidates"
    | "dreamContextMessageLimit"
    | "logRetentionDays",
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

function parseBudgetExceededAction(value: unknown): BudgetExceededAction {
  const field = ALWAYS_ON_CONFIG_FIELDS.defaultBudgetExceededAction as SelectFieldDefinition;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "warn" || normalized === "terminate") {
    return normalized;
  }
  throw new Error(`${field.label} must be one of: ${field.options.join(", ")}`);
}

function parseBooleanField(value: unknown, label: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new Error(`${label} must be true or false`);
}

function parseOptionalTextField(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return normalizeOptionalString(value);
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

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
