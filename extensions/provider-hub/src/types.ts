/**
 * A catalog entry describing a known LLM provider.
 * Used to pre-populate the provider list so users only need to fill in an API key.
 */
export type ProviderCatalogEntry = {
  /** Unique identifier used as the key in `models.providers.<id>` */
  id: string;
  /** Human-readable display name */
  label: string;
  /** Region hint for UI grouping */
  region: "global" | "cn" | "local";
  /** Whether this is a cloud API or a local inference server */
  category: "cloud" | "local";
  /** Default API base URL */
  defaultBaseUrl: string;
  /** Default model API adapter (matches OpenClaw's `ModelApi` enum) */
  defaultApi: string;
  /** Authentication mode */
  authMode: "api-key" | "aws-sdk" | "oauth" | "none";
  /** Expected key prefix for client-side format hints (e.g. "sk-") */
  keyPrefix?: string;
  /** Placeholder text for the API key input */
  keyPlaceholder?: string;
  /** URL where users can obtain an API key */
  docsUrl?: string;
  /** Conventional environment variable name for this provider's key */
  envVar?: string;
  /** Pre-defined model list (empty for local providers that discover at runtime) */
  defaultModels: ProviderDefaultModel[];
  /** Extra notes shown in the UI */
  notes?: string;
};

export type ProviderDefaultModel = {
  id: string;
  label?: string;
  capabilities?: string[];
};

/**
 * Extended entry returned by `hub.providers.list`, includes live config status.
 */
export type ProviderListEntry = ProviderCatalogEntry & {
  /** Whether this provider has a config block in `models.providers` */
  configured: boolean;
  /** Whether an API key is set (may be redacted) */
  hasKey: boolean;
};

export type ProbeResult = {
  provider: string;
  reachable: boolean;
  status: "ok" | "auth" | "rate_limit" | "billing" | "timeout" | "network" | "unknown";
  error?: string;
  latencyMs?: number;
};

export type DiscoverResult = {
  provider: string;
  reachable: boolean;
  models: Array<{ id: string; label?: string }>;
  error?: string;
};
