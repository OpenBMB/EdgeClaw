import type { OpenClawConfig } from "../../../../src/config/types.openclaw.ts";
import type { ProviderListEntry } from "../types.ts";
import { CATALOG, findCatalogEntry } from "../catalog/index.ts";

/**
 * Build the full provider list by merging the catalog with live config state.
 * Providers that are configured but not in the catalog appear as "custom" entries.
 */
export function buildProviderList(config: OpenClawConfig): ProviderListEntry[] {
  const configured = (config as Record<string, unknown>).models as
    | { providers?: Record<string, Record<string, unknown>> }
    | undefined;
  const providerMap = configured?.providers ?? {};

  const entries: ProviderListEntry[] = CATALOG.map((entry) => ({
    ...entry,
    configured: entry.id in providerMap,
    hasKey: hasApiKey(providerMap[entry.id]),
  }));

  // Append user-defined providers not in catalog
  for (const [id, provider] of Object.entries(providerMap)) {
    if (findCatalogEntry(id)) continue;

    entries.push({
      id,
      label: id,
      region: "global",
      category: "cloud",
      defaultBaseUrl: (provider.baseUrl as string) ?? "",
      defaultApi: (provider.api as string) ?? "openai-completions",
      authMode: "api-key",
      defaultModels: Array.isArray(provider.models)
        ? (provider.models as Array<{ id: string }>).map((m) => ({
            id: m.id,
            capabilities: [],
          }))
        : [],
      configured: true,
      hasKey: hasApiKey(provider),
      notes: "Custom provider (not in catalog)",
    });
  }

  return entries;
}

function hasApiKey(provider: Record<string, unknown> | undefined): boolean {
  if (!provider) return false;
  const key = provider.apiKey;
  return typeof key === "string" && key.length > 0;
}
