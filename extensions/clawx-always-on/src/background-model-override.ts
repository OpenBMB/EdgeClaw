import type { OpenClawPluginApi } from "../api.js";
import { resolveAgentDefaultModelSelection } from "./command-options.js";
import { PLUGIN_ID } from "./core/constants.js";

type BackgroundModelOverrideResult = {
  shouldPassOverride: boolean;
  provider?: string;
  model?: string;
  error?: string;
};

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasTrustedBackgroundModelOverride(
  config: OpenClawPluginApi["config"] | undefined,
): boolean {
  const pluginEntry = config?.plugins?.entries?.[PLUGIN_ID];
  if (!pluginEntry || typeof pluginEntry !== "object") {
    return false;
  }
  const subagent = "subagent" in pluginEntry ? pluginEntry.subagent : undefined;
  if (!subagent || typeof subagent !== "object") {
    return false;
  }
  return "allowModelOverride" in subagent && subagent.allowModelOverride === true;
}

export function resolveBackgroundModelOverride(params: {
  config: OpenClawPluginApi["config"] | undefined;
  provider?: string;
  model?: string;
}): BackgroundModelOverrideResult {
  const provider = trimValue(params.provider);
  const model = trimValue(params.model);
  if (!provider && !model) {
    return { shouldPassOverride: false };
  }

  const defaultSelection = resolveAgentDefaultModelSelection(params.config);
  if (defaultSelection) {
    const effectiveProvider = provider ?? defaultSelection.provider;
    const effectiveModel = model ?? defaultSelection.model;
    if (
      effectiveProvider === defaultSelection.provider &&
      effectiveModel === defaultSelection.model
    ) {
      return { shouldPassOverride: false };
    }
  }

  if (!hasTrustedBackgroundModelOverride(params.config)) {
    return {
      shouldPassOverride: false,
      error:
        "This always-on task requests a background model override that differs from the current agent default model. " +
        "Enable `plugins.entries.clawx-always-on.subagent.allowModelOverride = true` to use a different `--model` " +
        "(or matching plugin defaultProvider/defaultModel) for background task execution.",
    };
  }

  return {
    shouldPassOverride: true,
    provider,
    model,
  };
}
