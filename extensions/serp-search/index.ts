import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/provider-web-search";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const SERP_HK_ENDPOINT = "https://api.serp.hk/serp/google/search/advanced";
const SERP_GLOBAL_ENDPOINT = "https://api.serp.global/serp/google/search/advanced";

function resolveApiKey(api: OpenClawPluginApi): string | undefined {
  const fromConfig =
    api.pluginConfig && typeof api.pluginConfig.apiKey === "string"
      ? api.pluginConfig.apiKey.trim()
      : "";
  return fromConfig || process.env.SERP_API_KEY?.trim() || undefined;
}

function resolveEndpoint(api: OpenClawPluginApi): string {
  const region =
    api.pluginConfig && typeof api.pluginConfig.region === "string"
      ? api.pluginConfig.region.trim().toLowerCase()
      : "cn";
  return region === "global" ? SERP_GLOBAL_ENDPOINT : SERP_HK_ENDPOINT;
}

const SerpSearchSchema = Type.Object(
  {
    q: Type.String({ description: "Search query string." }),
    gl: Type.Optional(
      Type.String({
        description:
          'Country code for localized results (default "CN"). Use "US" for English results.',
      }),
    ),
  },
  { additionalProperties: false },
);

function createSerpSearchTool(api: OpenClawPluginApi, apiKey: string, endpoint: string) {
  return {
    name: "serp_search",
    label: "Google Search (serp.hk)",
    description:
      "Search Google via serp.hk proxy. Returns organic results, knowledge graph, answer boxes, and related queries. Works in China without VPN.",
    parameters: SerpSearchSchema,
    execute: async (_toolCallId: string, rawArgs: Record<string, unknown>) => {
      const q = readStringParam(rawArgs, "q", { required: true });
      if (!q) {
        return jsonResult({ error: "missing query" });
      }

      const body: Record<string, string> = { q };
      const gl = readStringParam(rawArgs, "gl");
      if (gl) body.gl = gl;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return jsonResult({ error: `serp.hk API error (${res.status})`, detail: text });
      }

      const data = (await res.json()) as Record<string, unknown>;

      if (typeof data.code === "number" && data.code !== 0) {
        return jsonResult({ error: data.msg || "serp.hk error", code: data.code });
      }

      const result = (data.result ?? data) as Record<string, unknown>;

      const organic = Array.isArray(result.organic)
        ? (result.organic as Array<Record<string, unknown>>).slice(0, 8).map((r) => ({
            title: r.title,
            link: r.link,
            snippet: r.snippet,
            source: r.source,
          }))
        : [];

      const output: Record<string, unknown> = { query: q, organic };

      if (result.knowledge_graph) output.knowledge_graph = result.knowledge_graph;
      if (result.answer_box) output.answer_box = result.answer_box;
      if (Array.isArray(result.top_stories) && result.top_stories.length > 0) {
        output.top_stories = (result.top_stories as Array<Record<string, unknown>>).slice(0, 5);
      }

      return jsonResult(output);
    },
  };
}

export default definePluginEntry({
  id: "serp-search",
  name: "SERP Search Plugin",
  description: "Google search via serp.hk proxy (works in China without VPN)",
  register(api) {
    const apiKey = resolveApiKey(api);
    if (!apiKey) {
      api.logger.warn(
        "serp-search: no API key. Set plugins.entries.serp-search.config.apiKey or SERP_API_KEY env var.",
      );
      return;
    }
    const endpoint = resolveEndpoint(api);
    api.logger.info(`serp_search: registered (endpoint=${new URL(endpoint).hostname})`);
    api.registerTool(createSerpSearchTool(api, apiKey, endpoint));
  },
});
