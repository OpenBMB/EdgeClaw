import type { DiscoverResult } from "../types.ts";
import { findCatalogEntry } from "../catalog/index.ts";

type DiscoverParams = {
  provider: string;
  baseUrl?: string;
};

/**
 * Auto-discover available models from a local inference server.
 *
 * Works with Ollama, vLLM, llama.cpp, SGLang, LM Studio, LocalAI —
 * all of which implement OpenAI-compatible GET /v1/models.
 *
 * For Ollama, also tries GET /api/tags (native endpoint) as a fallback.
 */
export async function discoverModels(params: DiscoverParams): Promise<DiscoverResult> {
  const { provider } = params;
  const catalog = findCatalogEntry(provider);
  const baseUrl = params.baseUrl ?? catalog?.defaultBaseUrl;

  if (!baseUrl) {
    return { provider, reachable: false, models: [], error: "No base URL" };
  }

  const base = baseUrl.replace(/\/+$/, "");

  // Try OpenAI-compatible /v1/models first (works for all local servers)
  try {
    const models = await fetchOpenAIModels(base);
    if (models.length > 0) {
      return { provider, reachable: true, models };
    }
  } catch {
    // fall through to Ollama-native endpoint
  }

  // Ollama native: /api/tags
  if (provider === "ollama") {
    try {
      const ollamaBase = base.replace(/\/v1\/?$/, "");
      const models = await fetchOllamaTags(ollamaBase);
      return { provider, reachable: true, models };
    } catch (err) {
      return {
        provider,
        reachable: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { provider, reachable: false, models: [], error: "Could not connect or no models loaded" };
}

async function fetchOpenAIModels(base: string): Promise<Array<{ id: string; label?: string }>> {
  const res = await fetch(`${base}/models`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  return (data.data ?? []).map((m) => ({ id: m.id }));
}

async function fetchOllamaTags(base: string): Promise<Array<{ id: string; label?: string }>> {
  const res = await fetch(`${base}/api/tags`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Ollama /api/tags returned HTTP ${res.status}`);

  const data = (await res.json()) as { models?: Array<{ name: string; size?: number }> };
  return (data.models ?? []).map((m) => ({ id: m.name }));
}
