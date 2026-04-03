import path from "node:path";
import { resolveBundledPluginsDir } from "../plugins/bundled-dir.js";
import { resolveStateDir, DEFAULT_GATEWAY_PORT } from "./paths.js";
import type { OpenClawConfig } from "./types.js";

/**
 * Generate EdgeClaw's opinionated default configuration.
 *
 * Called when no openclaw.json exists at first startup. Providers use
 * `${EDGECLAW_API_KEY}` env-var substitution so the user only needs to
 * export one variable before running the gateway.
 *
 * ClawXRouter is pre-configured for token-saver-only mode (privacy
 * router disabled). ClawXMemory is enabled as the memory slot.
 * ClawXGovernor is enabled for tool governance, context management,
 * and session memory; its MCP server is auto-configured when bundled.
 */
export function generateEdgeClawDefaults(env: NodeJS.ProcessEnv = process.env): OpenClawConfig {
  const stateDir = resolveStateDir(env);
  const apiKeyRef = "${EDGECLAW_API_KEY}";
  const baseUrl = env.EDGECLAW_BASE_URL?.trim() || "https://yeysai.com/v1";
  const proxyUrl = env.EDGECLAW_PROXY_URL?.trim() || baseUrl;
  const bundledDir = resolveBundledPluginsDir(env);

  return {
    models: {
      mode: "replace",
      providers: {
        "yeysai-gemini": {
          baseUrl,
          apiKey: apiKeyRef,
          auth: "api-key",
          api: "openai-completions",
          authHeader: false,
          models: [
            {
              id: "gemini-2.5-flash",
              name: "gemini-2.5-flash",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 8192,
              compat: { maxTokensField: "max_tokens" },
            },
            {
              id: "claude-sonnet-4-5-20250929",
              name: "claude-sonnet-4-5-20250929",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
          ],
        },
        yeysai: {
          baseUrl: proxyUrl,
          apiKey: apiKeyRef,
          auth: "api-key",
          api: "openai-completions",
          authHeader: false,
          models: [
            {
              id: "gpt-5-mini",
              name: "GPT-5 Mini",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
            {
              id: "deepseek-v3.2-thinking",
              name: "DeepSeek V3.2 Thinking",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 131072,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
            {
              id: "glm-5-thinking",
              name: "GLM-5 Thinking",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 131072,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
            {
              id: "claude-opus-4-6-thinking",
              name: "Claude Opus 4.6 Thinking",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 200000,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
            {
              id: "kimi-k2.5",
              name: "Kimi K2.5",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 131072,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
            {
              id: "minimax-m2.5",
              name: "Minimax M2.5",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000000,
              maxTokens: 16384,
              compat: { maxTokensField: "max_tokens" },
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: "yeysai/minimax-m2.5" },
        models: {
          "yeysai-gemini/gemini-2.5-flash": { streaming: true },
          "yeysai/deepseek-v3.2-thinking": { params: { thinking: "medium" }, streaming: true },
          "yeysai/glm-5-thinking": { params: { thinking: "low" }, streaming: true },
          "yeysai/claude-opus-4-6-thinking": { params: { thinking: "adaptive" }, streaming: true },
          "yeysai/kimi-k2.5": { params: { thinking: "high" }, streaming: true },
          "yeysai/minimax-m2.5": { params: { thinking: "high" }, streaming: true },
        },
        workspace: path.join(stateDir, "workspace-main"),
        memorySearch: {
          provider: "openai",
          remote: { baseUrl, apiKey: apiKeyRef },
          enabled: false,
        },
        compaction: { mode: "safeguard", memoryFlush: { enabled: false } },
        thinkingDefault: "medium",
        timeoutSeconds: 600,
        maxConcurrent: 4,
        subagents: { maxConcurrent: 8 },
      },
      list: [{ id: "main", workspace: path.join(stateDir, "workspace-main") }],
    },
    messages: { ackReactionScope: "group-mentions" },
    commands: { native: "auto", nativeSkills: "auto", restart: true, ownerDisplay: "raw" },
    hooks: {
      internal: {
        enabled: true,
        entries: {
          "command-logger": { enabled: true },
          "session-memory": { enabled: false },
        },
      },
    },
    gateway: {
      port: DEFAULT_GATEWAY_PORT,
      mode: "local",
      bind: "loopback",
      auth: { mode: "none" },
      tailscale: { mode: "off", resetOnExit: false },
      http: { endpoints: { chatCompletions: { enabled: true } } },
    },
    skills: { install: { nodeManager: "npm" } },
    plugins: {
      allow: ["ClawXRouter", "openbmb-clawxmemory", "clawxgovernor"],
      entries: {
        ClawXRouter: {
          enabled: true,
          config: {
            privacy: {
              enabled: true,
              proxyPort: 18406,
              routers: {
                privacy: { enabled: false, type: "builtin", weight: 90 },
                "token-saver": {
                  enabled: true,
                  type: "builtin",
                  weight: 40,
                  options: {
                    judgeEndpoint: baseUrl,
                    judgeModel: "gemini-2.5-flash",
                    judgeApiKey: apiKeyRef,
                    judgeProviderType: "openai-compatible",
                    tiers: {
                      SIMPLE: { provider: "yeysai", model: "gpt-5-mini" },
                      MEDIUM: { provider: "yeysai-gemini", model: "gemini-2.5-flash" },
                      COMPLEX: { provider: "yeysai", model: "glm-5-thinking" },
                      REASONING: { provider: "yeysai", model: "claude-opus-4-6-thinking" },
                    },
                  },
                },
              },
              pipeline: {
                onUserMessage: ["token-saver"],
                onToolCallProposed: [],
                onToolCallExecuted: [],
              },
            },
          },
        },
        "openbmb-clawxmemory": {
          enabled: true,
          hooks: { allowPromptInjection: true },
          config: {
            recallEnabled: true,
            addEnabled: true,
            uiEnabled: true,
            uiPort: 39394,
            dataDir: path.join(stateDir, "clawxmemory"),
          },
        },
        clawxgovernor: {
          enabled: true,
          hooks: { allowPromptInjection: true },
          config: {
            recentTailTurns: 6,
            compactThresholdRatio: 0.75,
            summarizeThreshold: 4000,
            loopWindowSize: 10,
            loopMaxRepeats: 3,
            maxHintLines: 5,
          },
        },
        "memory-core": { enabled: false },
      },
      slots: { memory: "openbmb-clawxmemory" },
    },
    tools: {
      alsoAllow: [
        "memory_overview",
        "memory_list",
        "memory_flush",
        "clawxgovernor__context_inspect",
        "clawxgovernor__context_budget_check",
        "clawxgovernor__context_force_compact",
        "clawxgovernor__tool_risk_classify",
        "clawxgovernor__tool_audit_query",
        "clawxgovernor__tool_result_summarize",
        "clawxgovernor__session_note_append",
        "clawxgovernor__session_note_read",
        "clawxgovernor__session_note_search",
      ],
    },
    ...(bundledDir
      ? {
          mcp: {
            servers: {
              clawxgovernor: {
                command: "npx",
                args: ["tsx", path.join(bundledDir, "clawxgovernor", "mcp-server", "index.ts")],
              },
            },
          },
        }
      : {}),
  } as OpenClawConfig;
}
