import type { IndexingSettings } from "./core/types.js";
import { dirname, join } from "node:path";
import {
  resolveDefaultClawxmemoryDataDir,
  resolveDefaultClawxmemoryDbPath,
  resolveDefaultClawxmemoryMemoryDir,
} from "./state-paths.js";

export interface PluginRuntimeConfig {
  dataDir: string;
  dbPath: string;
  memoryDir: string;
  captureStrategy: "last_turn" | "full_session";
  includeAssistant: boolean;
  maxMessageChars: number;
  heartbeatBatchSize: number;
  autoIndexIntervalMinutes: number;
  autoDreamIntervalMinutes: number;
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
    memoryDir: {
      type: "string",
      description: "Absolute path to the file-based memory directory. Defaults to <dataDir>/memory.",
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
    reasoningMode: {
      type: "string",
      enum: ["answer_first", "accuracy_first"],
      default: "answer_first",
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
    placeholder: "~/.edgeclaw/clawxmemory/memory.sqlite",
  },
  memoryDir: {
    label: "Memory Directory",
    placeholder: "~/.edgeclaw/clawxmemory/memory",
  },
  captureStrategy: {
    label: "Capture Strategy",
    help: "full_session remains available as a fallback source for background extraction.",
  },
  autoIndexIntervalMinutes: {
    label: "Auto Index Interval (hours)",
    placeholder: "60",
    help: "0 disables automatic indexing.",
  },
  autoDreamIntervalMinutes: {
    label: "Auto Dream Interval (hours)",
    placeholder: "360",
    help: "0 disables automatic Dream.",
  },
  reasoningMode: {
    label: "Reasoning Mode",
    help: "Controls whether recall should favor faster answers or more conservative memory selection.",
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

export function buildPluginConfig(raw: unknown): PluginRuntimeConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const explicitDataDir = typeof cfg.dataDir === "string" && cfg.dataDir.trim() ? cfg.dataDir : "";
  const explicitDbPath = typeof cfg.dbPath === "string" && cfg.dbPath.trim() ? cfg.dbPath : "";
  const dataDir = explicitDataDir || resolveDefaultClawxmemoryDataDir();
  const dbPath = explicitDbPath || resolveDefaultClawxmemoryDbPath();
  const memoryDir = typeof cfg.memoryDir === "string" && cfg.memoryDir.trim()
    ? cfg.memoryDir
    : explicitDbPath && !explicitDataDir
      ? join(dirname(explicitDbPath), "memory")
      : explicitDataDir
        ? join(dataDir, "memory")
        : resolveDefaultClawxmemoryMemoryDir();
  const captureStrategy = cfg.captureStrategy === "last_turn" ? "last_turn" : "full_session";
  const runtime: PluginRuntimeConfig = {
    dataDir,
    dbPath,
    memoryDir,
    captureStrategy,
    includeAssistant: toBoolean(cfg.includeAssistant, true),
    maxMessageChars: toInteger(cfg.maxMessageChars, 6000),
    heartbeatBatchSize: Math.max(1, toInteger(cfg.heartbeatBatchSize, 30)),
    autoIndexIntervalMinutes: Math.max(0, toInteger(cfg.autoIndexIntervalMinutes, 60)),
    autoDreamIntervalMinutes: Math.max(0, toInteger(cfg.autoDreamIntervalMinutes, 360)),
    indexIdleDebounceMs: Math.max(200, toInteger(cfg.indexIdleDebounceMs, 2500)),
    defaultIndexingSettings: {
      reasoningMode: cfg.reasoningMode === "accuracy_first" ? "accuracy_first" : "answer_first",
      autoIndexIntervalMinutes: Math.max(0, toInteger(cfg.autoIndexIntervalMinutes, 60)),
      autoDreamIntervalMinutes: Math.max(0, toInteger(cfg.autoDreamIntervalMinutes, 360)),
    },
    recallEnabled: toBoolean(cfg.recallEnabled, true),
    addEnabled: toBoolean(cfg.addEnabled, true),
    uiEnabled: toBoolean(cfg.uiEnabled, true),
    uiHost: typeof cfg.uiHost === "string" && cfg.uiHost.trim() ? cfg.uiHost : "127.0.0.1",
    uiPort: Math.max(1024, toInteger(cfg.uiPort, 39393)),
    uiPathPrefix: typeof cfg.uiPathPrefix === "string" && cfg.uiPathPrefix.trim() ? cfg.uiPathPrefix : "/clawxmemory",
  };
  return runtime;
}
