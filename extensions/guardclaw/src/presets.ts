/**
 * GuardClaw Provider Presets
 *
 * Built-in and user-defined presets for quickly switching localModel + guardAgent
 * + (optionally) the EdgeClaw default model across provider configurations.
 *
 * localModel + guardAgent changes are hot-reloaded (no restart needed).
 * defaultModel changes write to openclaw.json and require a gateway restart.
 *
 * Storage: user presets live in guardclaw.json under "presets" (top-level array).
 * The last-applied preset id is tracked in "activePreset".
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EdgeProviderType } from "./types.js";
import { getLiveConfig, updateLiveConfig } from "./live-config.js";

export type ProviderPreset = {
  id: string;
  name: string;
  builtin?: boolean;
  localModel: {
    type: EdgeProviderType;
    provider: string;
    model: string;
    endpoint: string;
    apiKey?: string;
  };
  guardAgent: {
    model: string;
  };
  /** EdgeClaw default model in "provider/model" format. Requires gateway restart. */
  defaultModel?: string;
};

export type ApplyPresetResult = {
  ok: boolean;
  error?: string;
  /** Whether defaultModel was written to openclaw.json */
  defaultModelApplied?: boolean;
  /** Error message if defaultModel write failed (localModel + guardAgent still applied) */
  defaultModelError?: string;
  needsRestart?: boolean;
};

export const BUILTIN_PRESETS: ProviderPreset[] = [
  {
    id: "vllm-qwen35",
    name: "vLLM / Qwen 3.5-35B",
    builtin: true,
    localModel: {
      type: "openai-compatible",
      provider: "vllm",
      model: "qwen3.5-35b",
      endpoint: "http://localhost:7999",
    },
    guardAgent: { model: "vllm/qwen3.5-35b" },
    defaultModel: "vllm/qwen3.5-35b",
  },
  {
    id: "minimax-cloud",
    name: "MiniMax M2.5 (Cloud)",
    builtin: true,
    localModel: {
      type: "openai-compatible",
      provider: "vllm",
      model: "qwen3.5-35b",
      endpoint: "http://localhost:7999",
    },
    guardAgent: { model: "vllm/qwen3.5-35b" },
    defaultModel: "minimax/MiniMax-M2.5-highspeed",
  },
];

// ── Config file I/O ─────────────────────────────────────────────────────

const OPENCLAW_DIR = join(process.env.HOME ?? "/tmp", ".openclaw");
const GUARDCLAW_CONFIG_PATH = join(OPENCLAW_DIR, "guardclaw.json");
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_DIR, "openclaw.json");

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(GUARDCLAW_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, unknown>): void {
  try {
    mkdirSync(OPENCLAW_DIR, { recursive: true });
    writeFileSync(GUARDCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    /* best-effort */
  }
}

/**
 * Read the current default model from openclaw.json.
 * Handles both string and { primary: string } formats.
 */
export function readCurrentDefaultModel(): string | null {
  try {
    const raw = readFileSync(OPENCLAW_CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const agents = config.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    const model = defaults?.model;
    if (typeof model === "string") return model.trim() || null;
    if (model && typeof model === "object") {
      const primary = (model as Record<string, unknown>).primary;
      if (typeof primary === "string") return primary.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write the default model to openclaw.json.
 * Preserves { primary, fallbacks } structure if it already exists.
 */
function writeDefaultModel(modelRef: string): { ok: boolean; error?: string } {
  let raw: string;
  try {
    raw = readFileSync(OPENCLAW_CONFIG_PATH, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: "openclaw.json not found. Run: openclaw onboard" };
    }
    return { ok: false, error: `Failed to read openclaw.json: ${code ?? String(err)}` };
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: "openclaw.json parse failed (may use JSON5). Run: openclaw models set " + modelRef,
    };
  }

  if (!config.agents) config.agents = {};
  const agents = config.agents as Record<string, unknown>;
  if (!agents.defaults) agents.defaults = {};
  const defaults = agents.defaults as Record<string, unknown>;

  const currentModel = defaults.model;
  if (currentModel && typeof currentModel === "object") {
    (currentModel as Record<string, unknown>).primary = modelRef;
  } else {
    defaults.model = modelRef;
  }

  try {
    writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Failed to write openclaw.json: ${String(err)}` };
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export type ListPresetsResult = {
  presets: ProviderPreset[];
  activePreset: string | null;
  currentDefaultModel: string | null;
};

export function listPresets(): ListPresetsResult {
  const config = readConfig();
  const userPresets = (config.presets as ProviderPreset[] | undefined) ?? [];
  const activePreset = (config.activePreset as string | undefined) ?? null;
  return {
    presets: [...BUILTIN_PRESETS, ...userPresets],
    activePreset,
    currentDefaultModel: readCurrentDefaultModel(),
  };
}

export function applyPreset(id: string, opts?: { applyDefaultModel?: boolean }): ApplyPresetResult {
  // Single read: use the config we already need for persistence
  const config = readConfig();
  const userPresets = (config.presets as ProviderPreset[] | undefined) ?? [];
  const allPresets = [...BUILTIN_PRESETS, ...userPresets];
  const preset = allPresets.find((p) => p.id === id);
  if (!preset) return { ok: false, error: `Preset not found: ${id}` };

  // Always apply localModel + guardAgent (instant, hot-reloadable)
  const currentGuardAgent = getLiveConfig().guardAgent;
  updateLiveConfig({
    localModel: { ...preset.localModel, enabled: true },
    guardAgent: { ...currentGuardAgent, model: preset.guardAgent.model },
  });

  const privacy = (config.privacy ?? {}) as Record<string, unknown>;
  privacy.localModel = { ...preset.localModel, enabled: true };
  const existingGA = (privacy.guardAgent ?? {}) as Record<string, unknown>;
  privacy.guardAgent = { ...existingGA, model: preset.guardAgent.model };
  config.privacy = privacy;
  config.activePreset = id;
  writeConfig(config);

  // Conditionally apply defaultModel (requires gateway restart)
  if (preset.defaultModel && opts?.applyDefaultModel) {
    const result = writeDefaultModel(preset.defaultModel);
    if (result.ok) {
      return { ok: true, defaultModelApplied: true, needsRestart: true };
    }
    return { ok: true, defaultModelApplied: false, defaultModelError: result.error };
  }

  return { ok: true };
}

export function saveCurrentAsPreset(name: string): { ok: boolean; id?: string; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "name required" };

  const liveConfig = getLiveConfig();
  const lm = liveConfig.localModel;
  const currentDefault = readCurrentDefaultModel();
  const id =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "") +
    "-" +
    Date.now();

  const preset: ProviderPreset = {
    id,
    name: trimmed,
    localModel: {
      type: lm?.type ?? "openai-compatible",
      provider: lm?.provider ?? "",
      model: lm?.model ?? "",
      endpoint: lm?.endpoint ?? "",
      ...(lm?.apiKey ? { apiKey: lm.apiKey } : {}),
    },
    guardAgent: {
      model: liveConfig.guardAgent?.model ?? "",
    },
    ...(currentDefault ? { defaultModel: currentDefault } : {}),
  };

  const config = readConfig();
  const userPresets = (config.presets as ProviderPreset[] | undefined) ?? [];
  userPresets.push(preset);
  config.presets = userPresets;
  config.activePreset = id;
  writeConfig(config);

  return { ok: true, id };
}

export function deletePreset(id: string): { ok: boolean; error?: string } {
  if (BUILTIN_PRESETS.some((p) => p.id === id)) {
    return { ok: false, error: "Cannot delete built-in preset" };
  }

  const config = readConfig();
  const userPresets = (config.presets as ProviderPreset[] | undefined) ?? [];
  const idx = userPresets.findIndex((p) => p.id === id);
  if (idx === -1) return { ok: false, error: "Preset not found" };

  userPresets.splice(idx, 1);
  config.presets = userPresets;
  if (config.activePreset === id) delete config.activePreset;
  writeConfig(config);

  return { ok: true };
}
