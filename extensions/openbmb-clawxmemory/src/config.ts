import type { IndexingSettings } from "./core/types.js";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PluginRuntimeConfig {
  dataDir: string;
  dbPath: string;
  skillsDir?: string;
  captureStrategy: "last_turn" | "full_session";
  includeAssistant: boolean;
  maxMessageChars: number;
  heartbeatBatchSize: number;
  autoIndexIntervalMinutes: number;
  autoDreamIntervalMinutes: number;
  autoDreamMinNewL1: number;
  dreamProjectRebuildTimeoutMs: number;
  indexIdleDebounceMs: number;
  defaultIndexingSettings: IndexingSettings;
  recallEnabled: boolean;
  addEnabled: boolean;
  uiEnabled: boolean;
  uiHost: string;
  uiPort: number;
  uiPathPrefix: string;
}

export const pluginConfigJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dataDir: {
      type: "string",
      description: "Base directory used to persist local memory data.",
    },
    dbPath: {
      type: "string",
      description: "Absolute path to sqlite file. Overrides dataDir.",
    },
    skillsDir: {
      type: "string",
      description: "Optional custom path for skills JSON/MD files.",
    },
    captureStrategy: {
      type: "string",
      enum: ["last_turn", "full_session"],
      default: "full_session",
    },
    includeAssistant: {
      type: "boolean",
      default: true,
    },
    maxMessageChars: {
      type: "integer",
      default: 6000,
    },
    heartbeatBatchSize: {
      type: "integer",
      default: 30,
    },
    autoIndexIntervalMinutes: {
      type: "integer",
      default: 60,
    },
    autoDreamIntervalMinutes: {
      type: "integer",
      default: 360,
    },
    autoDreamMinNewL1: {
      type: "integer",
      default: 10,
    },
    dreamProjectRebuildTimeoutMs: {
      type: "integer",
      default: 180000,
      description: "Timeout in milliseconds for the Dream project rebuild LLM request. Set to 0 to disable the timeout.",
    },
    reasoningMode: {
      type: "string",
      enum: ["answer_first", "accuracy_first"],
      default: "answer_first",
    },
    recallTopK: {
      type: "integer",
      default: 10,
    },
    maxAutoReplyLatencyMs: {
      type: "integer",
      default: 1800,
    },
    recallBudgetMs: {
      type: "integer",
      default: 1800,
    },
    indexIdleDebounceMs: {
      type: "integer",
      default: 2500,
    },
    fastRecallFallbackEnabled: {
      type: "boolean",
      default: true,
    },
    recallEnabled: {
      type: "boolean",
      default: true,
    },
    addEnabled: {
      type: "boolean",
      default: true,
    },
    uiEnabled: {
      type: "boolean",
      default: true,
    },
    uiHost: {
      type: "string",
      default: "127.0.0.1",
      description: "Host binding for the local dashboard HTTP server.",
    },
    uiPort: {
      type: "integer",
      default: 39393,
      description: "Port for the local dashboard HTTP server. Change this if 39393 is already in use.",
    },
    uiPathPrefix: {
      type: "string",
      default: "/clawxmemory",
      description: "Path prefix for the local dashboard.",
    },
  },
} as const;

export const pluginConfigUiHints = {
  dbPath: {
    label: "SQLite Path",
    placeholder: "~/.openclaw/clawxmemory/memory.sqlite",
  },
  skillsDir: {
    label: "Skills Directory",
    placeholder: "~/.openclaw/clawxmemory/skills",
  },
  captureStrategy: {
    label: "Capture Strategy",
    help: "full_session is retained as a fallback source, but indexing now closes L1 on topic shift instead of time/count windows.",
  },
  autoIndexIntervalMinutes: {
    label: "Auto Index Interval",
    placeholder: "60",
  },
  autoDreamIntervalMinutes: {
    label: "Auto Dream Interval",
    placeholder: "360",
  },
  autoDreamMinNewL1: {
    label: "Auto Dream L1 Threshold",
    placeholder: "10",
  },
  dreamProjectRebuildTimeoutMs: {
    label: "Dream Rebuild Timeout (ms)",
    placeholder: "180000",
    help: "Default is 180000ms. Set to 0 to disable the timeout for Dream project rebuild requests.",
  },
  reasoningMode: {
    label: "Reasoning Mode",
    help: "answer_first stops at L2 evidence notes; accuracy_first can continue down to L1 and L0.",
  },
  recallTopK: {
    label: "Recall Top K",
    placeholder: "10",
  },
  maxAutoReplyLatencyMs: {
    label: "Legacy Max Auto Reply Latency (ms)",
    placeholder: "1800",
  },
  uiEnabled: {
    label: "Enable Local UI",
    help: "Start local read-only dashboard server for timeline/project/profile memory.",
  },
  uiHost: {
    label: "UI Host",
    placeholder: "127.0.0.1",
  },
  uiPort: {
    label: "UI Port",
    placeholder: "39393",
    help: "Default is 39393. Change this if the dashboard port is already in use on this machine.",
  },
  uiPathPrefix: {
    label: "UI Path Prefix",
    placeholder: "/clawxmemory",
  },
} as const;

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function toInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = toInteger(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

export function buildPluginConfig(raw: unknown): PluginRuntimeConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const dataDir = typeof cfg.dataDir === "string" && cfg.dataDir.trim()
    ? cfg.dataDir
    : join(homedir(), ".openclaw", "clawxmemory");
  const dbPath = typeof cfg.dbPath === "string" && cfg.dbPath.trim()
    ? cfg.dbPath
    : join(dataDir, "memory.sqlite");
  const skillsDir = typeof cfg.skillsDir === "string" && cfg.skillsDir.trim() ? cfg.skillsDir : undefined;

  const configuredRecallTopK = typeof cfg.recallTopK === "number" && Number.isFinite(cfg.recallTopK)
    ? Math.floor(cfg.recallTopK)
    : typeof cfg.recallTopK === "string" && cfg.recallTopK.trim()
      ? Number.parseInt(cfg.recallTopK, 10)
      : 10;
  const captureStrategy = cfg.captureStrategy === "last_turn" ? "last_turn" : "full_session";
  const runtime: PluginRuntimeConfig = {
    dataDir,
    dbPath,
    captureStrategy,
    includeAssistant: toBoolean(cfg.includeAssistant, true),
    maxMessageChars: toInteger(cfg.maxMessageChars, 6000),
    heartbeatBatchSize: Math.max(1, toInteger(cfg.heartbeatBatchSize, 30)),
    autoIndexIntervalMinutes: Math.max(0, toInteger(cfg.autoIndexIntervalMinutes, 60)),
    autoDreamIntervalMinutes: Math.max(0, toInteger(cfg.autoDreamIntervalMinutes, 360)),
    autoDreamMinNewL1: Math.max(0, toInteger(cfg.autoDreamMinNewL1, 10)),
    dreamProjectRebuildTimeoutMs: toNonNegativeInteger(cfg.dreamProjectRebuildTimeoutMs, 180_000),
    indexIdleDebounceMs: Math.max(200, toInteger(cfg.indexIdleDebounceMs, 2500)),
    defaultIndexingSettings: {
      reasoningMode: cfg.reasoningMode === "accuracy_first" ? "accuracy_first" : "answer_first",
      recallTopK: Math.max(1, Math.min(50, Number.isFinite(configuredRecallTopK) ? configuredRecallTopK : 10)),
      autoIndexIntervalMinutes: Math.max(0, toInteger(cfg.autoIndexIntervalMinutes, 60)),
      autoDreamIntervalMinutes: Math.max(0, toInteger(cfg.autoDreamIntervalMinutes, 360)),
      autoDreamMinNewL1: Math.max(0, toInteger(cfg.autoDreamMinNewL1, 10)),
      dreamProjectRebuildTimeoutMs: toNonNegativeInteger(cfg.dreamProjectRebuildTimeoutMs, 180_000),
    },
    recallEnabled: toBoolean(cfg.recallEnabled, true),
    addEnabled: toBoolean(cfg.addEnabled, true),
    uiEnabled: toBoolean(cfg.uiEnabled, true),
    uiHost: typeof cfg.uiHost === "string" && cfg.uiHost.trim() ? cfg.uiHost : "127.0.0.1",
    uiPort: Math.max(1024, toInteger(cfg.uiPort, 39393)),
    uiPathPrefix: typeof cfg.uiPathPrefix === "string" && cfg.uiPathPrefix.trim() ? cfg.uiPathPrefix : "/clawxmemory",
  };
  if (skillsDir) {
    runtime.skillsDir = skillsDir;
  }
  return runtime;
}
