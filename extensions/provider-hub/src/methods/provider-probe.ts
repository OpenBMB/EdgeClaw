import type { ProbeResult } from "../types.ts";
import { findCatalogEntry } from "../catalog/index.ts";

type ProbeParams = {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
};

/**
 * Validate an API key by making a lightweight real request to the provider.
 *
 * Strategy:
 * - OpenAI-compatible (most providers): GET /v1/models with Bearer token
 * - Anthropic: POST /v1/messages with x-api-key header (minimal payload)
 * - Google AI: GET models endpoint with ?key= param
 * - Local (no auth): GET /v1/models to check reachability
 */
export async function probeProvider(params: ProbeParams): Promise<ProbeResult> {
  const { provider, apiKey } = params;
  const catalog = findCatalogEntry(provider);
  const baseUrl = params.baseUrl ?? catalog?.defaultBaseUrl;
  const api = catalog?.defaultApi ?? "openai-completions";

  if (!baseUrl) {
    return {
      provider,
      reachable: false,
      status: "unknown",
      error: "No base URL — provide baseUrl or use a known provider ID",
    };
  }

  const start = Date.now();
  try {
    if (api === "anthropic-messages") {
      return await probeAnthropic(provider, baseUrl, apiKey, start);
    }
    if (api === "google-generative-ai") {
      return await probeGoogle(provider, baseUrl, apiKey, start);
    }
    // Default: OpenAI-compatible GET /v1/models
    return await probeOpenAICompat(provider, baseUrl, apiKey, start);
  } catch (err) {
    return {
      provider,
      reachable: false,
      status: "network",
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

async function probeOpenAICompat(
  provider: string,
  baseUrl: string,
  apiKey: string | undefined,
  start: number,
): Promise<ProbeResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;

  return {
    provider,
    reachable: true,
    status: classifyHttpStatus(res.status),
    latencyMs,
    ...(res.ok ? {} : { error: `HTTP ${res.status}: ${await safeText(res)}` }),
  };
}

async function probeAnthropic(
  provider: string,
  baseUrl: string,
  apiKey: string | undefined,
  start: number,
): Promise<ProbeResult> {
  // Anthropic doesn't have a /models list endpoint; use a minimal messages call.
  // A request with max_tokens:1 and a trivial prompt is the cheapest valid call.
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;

  return {
    provider,
    reachable: true,
    status: classifyHttpStatus(res.status),
    latencyMs,
    ...(res.ok ? {} : { error: `HTTP ${res.status}: ${await safeText(res)}` }),
  };
}

async function probeGoogle(
  provider: string,
  baseUrl: string,
  apiKey: string | undefined,
  start: number,
): Promise<ProbeResult> {
  const base = baseUrl.replace(/\/+$/, "");
  const url = apiKey ? `${base}/models?key=${apiKey}` : `${base}/models`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - start;

  return {
    provider,
    reachable: true,
    status: classifyHttpStatus(res.status),
    latencyMs,
    ...(res.ok ? {} : { error: `HTTP ${res.status}: ${await safeText(res)}` }),
  };
}

function classifyHttpStatus(status: number): ProbeResult["status"] {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 402) return "billing";
  if (status === 408 || status === 504) return "timeout";
  return "unknown";
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 200 ? `${text.slice(0, 200)}...` : text;
  } catch {
    return "(unable to read response body)";
  }
}
