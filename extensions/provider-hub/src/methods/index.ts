import type { OpenClawPluginApi } from "../../../../src/plugins/types.ts";
import { discoverModels } from "./provider-discover.ts";
import { buildProviderList } from "./provider-list.ts";
import { probeProvider } from "./provider-probe.ts";

/**
 * Register all provider-hub gateway RPC methods on the plugin API.
 */
export function registerProviderHubMethods(api: OpenClawPluginApi): void {
  // ── hub.providers.list ──
  // Returns the full provider catalog merged with current config status.
  api.registerGatewayMethod("hub.providers.list", ({ respond }) => {
    const entries = buildProviderList(api.config);
    respond(true, { providers: entries }, undefined);
  });

  // ── hub.providers.probe ──
  // Validates an API key by making a lightweight real request.
  // Accepts a temporary key (not yet saved to config) for pre-save validation.
  api.registerGatewayMethod("hub.providers.probe", async ({ params, respond }) => {
    const { provider, apiKey, baseUrl } = params as {
      provider?: string;
      apiKey?: string;
      baseUrl?: string;
    };
    if (!provider) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "provider is required" });
      return;
    }
    const result = await probeProvider({ provider, apiKey, baseUrl });
    respond(true, result, undefined);
  });

  // ── hub.providers.discover ──
  // Auto-discovers models from a local inference server (Ollama, vLLM, etc.).
  api.registerGatewayMethod("hub.providers.discover", async ({ params, respond }) => {
    const { provider, baseUrl } = params as {
      provider?: string;
      baseUrl?: string;
    };
    if (!provider) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "provider is required" });
      return;
    }
    const result = await discoverModels({ provider, baseUrl });
    respond(true, result, undefined);
  });
}
