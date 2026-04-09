import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { OpenClawPluginApi } from "../../api.js";
import {
  ALWAYS_ON_CONFIG_FIELDS,
  ALWAYS_ON_CONFIG_FIELD_ORDER,
  ALWAYS_ON_CONFIG_RESTART_REQUIRED_FIELDS,
  DEFAULTS,
  mergeConfig,
  parseConfigPatch,
  resolveConfig,
  serializeConfig,
  valuesEqual,
  type AlwaysOnConfig,
  type AlwaysOnConfigFieldDefinition,
  type AlwaysOnConfigFieldKey,
} from "./config.js";
import { PLUGIN_ID } from "./constants.js";

export type AlwaysOnConfigSnapshot = {
  values: AlwaysOnConfig;
  effectiveValues: AlwaysOnConfig;
  defaults: AlwaysOnConfig;
  fields: AlwaysOnConfigFieldDefinition[];
  restartRequiredFields: AlwaysOnConfigFieldKey[];
  pendingRestartFields: AlwaysOnConfigFieldKey[];
};

type ConfigUpdateListener = (
  event: AlwaysOnConfigSnapshot & { changedFields: AlwaysOnConfigFieldKey[] },
) => void;

export class AlwaysOnConfigControllerError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AlwaysOnConfigControllerError";
  }
}

export class AlwaysOnConfigController {
  private effectiveConfig: AlwaysOnConfig;
  private readonly listeners = new Set<ConfigUpdateListener>();

  constructor(
    private readonly api: OpenClawPluginApi,
    initialConfig: AlwaysOnConfig,
  ) {
    this.effectiveConfig = initialConfig;
  }

  getConfig(): AlwaysOnConfig {
    return this.effectiveConfig;
  }

  getSnapshot(): AlwaysOnConfigSnapshot {
    const savedConfig = this.readSavedConfig();
    return buildSnapshot(savedConfig, this.effectiveConfig);
  }

  subscribe(listener: ConfigUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async update(rawPatch: Record<string, unknown>): Promise<AlwaysOnConfigSnapshot> {
    const currentFileConfig = this.loadOpenClawConfig();
    const savedConfig = resolveConfig(readPluginConfig(currentFileConfig));
    let patch: Partial<AlwaysOnConfig>;
    try {
      patch = parseConfigPatch(rawPatch, { strict: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid config update";
      throw new AlwaysOnConfigControllerError(400, message);
    }
    const nextSavedConfig = mergeConfig(savedConfig, patch);
    const changedFields = ALWAYS_ON_CONFIG_FIELD_ORDER.filter(
      (field) => !valuesEqual(savedConfig[field], nextSavedConfig[field]),
    );

    if (changedFields.length === 0) {
      return buildSnapshot(savedConfig, this.effectiveConfig);
    }

    const nextFileConfig = writePluginConfig(currentFileConfig, nextSavedConfig);
    await this.api.runtime.config.writeConfigFile(nextFileConfig as never);

    this.effectiveConfig = mergeEffectiveConfig(this.effectiveConfig, nextSavedConfig);

    const snapshot = buildSnapshot(nextSavedConfig, this.effectiveConfig);
    const event = { ...snapshot, changedFields };
    for (const listener of this.listeners) {
      listener(event);
    }
    return snapshot;
  }

  private readSavedConfig(): AlwaysOnConfig {
    return resolveConfig(readPluginConfig(this.loadOpenClawConfig()));
  }

  private loadOpenClawConfig(): OpenClawConfig {
    const loaded = this.api.runtime.config.loadConfig();
    return (loaded ?? {}) as OpenClawConfig;
  }
}

function mergeEffectiveConfig(
  currentEffectiveConfig: AlwaysOnConfig,
  savedConfig: AlwaysOnConfig,
): AlwaysOnConfig {
  const nextEffectiveConfig: AlwaysOnConfig = { ...savedConfig };
  for (const field of ALWAYS_ON_CONFIG_RESTART_REQUIRED_FIELDS) {
    if (!valuesEqual(savedConfig[field], currentEffectiveConfig[field])) {
      nextEffectiveConfig[field] = currentEffectiveConfig[field];
    }
  }
  return nextEffectiveConfig;
}

function buildSnapshot(
  savedConfig: AlwaysOnConfig,
  effectiveConfig: AlwaysOnConfig,
): AlwaysOnConfigSnapshot {
  return {
    values: savedConfig,
    effectiveValues: effectiveConfig,
    defaults: DEFAULTS,
    fields: ALWAYS_ON_CONFIG_FIELD_ORDER.map((field) => ALWAYS_ON_CONFIG_FIELDS[field]),
    restartRequiredFields: [...ALWAYS_ON_CONFIG_RESTART_REQUIRED_FIELDS],
    pendingRestartFields: ALWAYS_ON_CONFIG_RESTART_REQUIRED_FIELDS.filter(
      (field) => !valuesEqual(savedConfig[field], effectiveConfig[field]),
    ),
  };
}

function readPluginConfig(config: OpenClawConfig): Record<string, unknown> | undefined {
  const plugins = asObjectRecord(config.plugins);
  const entries = asObjectRecord(plugins?.entries);
  const pluginEntry = asObjectRecord(entries?.[PLUGIN_ID]);
  const pluginConfig = asObjectRecord(pluginEntry?.config);
  return pluginConfig ?? undefined;
}

function writePluginConfig(config: OpenClawConfig, pluginConfig: AlwaysOnConfig): OpenClawConfig {
  const nextConfig = structuredClone(config ?? {});
  const root = nextConfig as Record<string, unknown>;
  const plugins = ensureObjectRecord(root, "plugins");
  const entries = ensureObjectRecord(plugins, "entries");
  const pluginEntry = ensureObjectRecord(entries, PLUGIN_ID);
  pluginEntry.config = serializeConfig(pluginConfig);
  return nextConfig as OpenClawConfig;
}

function ensureObjectRecord(holder: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asObjectRecord(holder[key]);
  if (existing) {
    return existing;
  }
  const next: Record<string, unknown> = {};
  holder[key] = next;
  return next;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
