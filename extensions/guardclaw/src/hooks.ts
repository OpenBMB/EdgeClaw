/**
 * GuardClaw Hooks — openclaw adaptation
 *
 * Registers all plugin hooks for sensitivity detection at various checkpoints.
 * Uses the RouterPipeline to dispatch to multiple composable routers
 * (built-in "privacy" + any user-defined custom routers).
 *
 * Architecture:
 *   before_model_resolve  → pipeline.run("onUserMessage") → RouterDecision
 *   before_prompt_build   → reads stashed decision → inject prompt/markers
 *   before_tool_call      → pipeline + memory_get path redirect (dual-track)
 *   after_tool_call       → pipeline + memory dual-write sync
 *   tool_result_persist   → PII redaction + memory_search result filtering
 *   before_message_write  → sanitize transcript based on stashed decision
 *   after_compaction      → full memory sync (FULL → clean)
 *   before_reset          → full memory sync before session clear
 *   + session_end, message_sending, before_agent_start, message_received
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getGuardAgentConfig, isGuardSessionKey, isLocalProvider } from "./guard-agent.js";
import { getLiveConfig } from "./live-config.js";
import { desensitizeWithLocalModel } from "./local-model.js";
import { getDefaultMemoryManager } from "./memory-isolation.js";
import { GUARDCLAW_S2_OPEN, GUARDCLAW_S2_CLOSE, stashOriginalProvider } from "./privacy-proxy.js";
import { loadPrompt } from "./prompt-loader.js";
import { getGlobalPipeline } from "./router-pipeline.js";
import { detectByRules } from "./rules.js";
import { getDefaultSessionManager, type SessionMessage } from "./session-manager.js";
import {
  markSessionAsPrivate,
  trackSessionLevel,
  recordDetection,
  isSessionMarkedPrivate,
  stashDetection,
  getPendingDetection,
  consumeDetection,
  setActiveLocalRouting,
  clearActiveLocalRouting,
  isActiveLocalRouting,
} from "./session-state.js";
import { getGlobalCollector } from "./token-stats.js";
import type { PrivacyConfig } from "./types.js";
import { finalizeLoop } from "./loop-detection-level.js";
import { recordFinalReply } from "./usage-intel.js";
import { isProtectedMemoryPath, redactSensitiveInfo } from "./utils.js";

function getPipelineConfig(): Record<string, unknown> {
  return { privacy: getLiveConfig() };
}

const DEFAULT_GUARD_AGENT_SYSTEM_PROMPT = `You are a privacy-aware analyst. Analyze the data the user provides. Do your job.

RULES:
1. Analyze the data directly. Do NOT write code. Do NOT generate programming examples or tutorials.
2. NEVER echo raw sensitive values (exact salary, SSN, bank account, password). Use generic references like "your base salary", "the SSN on file", etc.
3. You MAY discuss percentages, ratios, whether deductions are correct, anomalies, and recommendations.
4. Reply ONCE, then stop. No [message_id:] tags. No multi-turn simulation.
5. **Language rule: Reply in the SAME language the user writes in.** If the user writes in Chinese, reply entirely in Chinese. If the user writes in English, reply entirely in English.
6. Be concise and professional.

语言规则：必须使用与用户相同的语言回复。如果用户用中文提问，你必须用中文回答。`;

function getGuardAgentSystemPrompt(): string {
  return loadPrompt("guard-agent-system", DEFAULT_GUARD_AGENT_SYSTEM_PROMPT);
}

const PRIVACY_S2_SYSTEM_INSTRUCTION = `[PRIVACY GUARD - IMPORTANT]
The user's message may contain a desensitized data section.
You MUST:
1. NEVER reference, quote, or echo any specific PII values
2. Use generic references (e.g., "your address", "the recipient") instead of actual values
3. NEVER include [REDACTED:xxx] tags in your response — use natural language
4. Reply in the same language as the user.`;

// Workspace dir cache — set from first hook that has PluginHookAgentContext
let _cachedWorkspaceDir: string | undefined;

export function registerHooks(api: OpenClawPluginApi): void {
  const memoryManager = getDefaultMemoryManager();
  memoryManager.initializeDirectories().catch((err) => {
    api.logger.error(`[GuardClaw] Failed to initialize memory directories: ${String(err)}`);
  });

  // =========================================================================
  // Hook 1: before_model_resolve — Run pipeline + model routing
  // =========================================================================
  api.on("before_model_resolve", async (event, ctx) => {
    try {
      const { prompt } = event;
      const sessionKey = ctx.sessionKey ?? "";
      if (!sessionKey || !prompt) return;

      clearActiveLocalRouting(sessionKey);

      const privacyConfig = getPrivacyConfigFromApi(api);
      if (!privacyConfig.enabled) return;

      if (isGuardSessionKey(sessionKey)) {
        const guardCfg = getGuardAgentConfig(privacyConfig);
        if (guardCfg) {
          return { providerOverride: guardCfg.provider, modelOverride: guardCfg.modelName };
        }
        return;
      }

      if (ctx.workspaceDir) _cachedWorkspaceDir = ctx.workspaceDir;

      const msgStr = String(prompt);
      if (shouldSkipMessage(msgStr)) return;

      // ── S3 fast path: rule-based pre-check ──────────────────────────
      // Rules are synchronous and deterministic. When they detect S3 we
      // can route to the local model immediately — no need to run the
      // full pipeline (LLM detector, token-saver, custom routers, etc.)
      // which would waste compute and needlessly expose sensitive content.
      const rulePreCheck = detectByRules(
        { checkpoint: "onUserMessage", message: msgStr, sessionKey },
        privacyConfig,
      );

      if (rulePreCheck.level === "S3") {
        recordDetection(sessionKey, "S3", "onUserMessage", rulePreCheck.reason);
        trackSessionLevel(sessionKey, "S3");
        setActiveLocalRouting(sessionKey);
        stashDetection(sessionKey, {
          level: "S3",
          reason: rulePreCheck.reason,
          originalPrompt: msgStr,
          timestamp: Date.now(),
        });

        const guardCfg = getGuardAgentConfig(privacyConfig);
        const defaultProvider = privacyConfig.localModel?.provider ?? "ollama";
        const provider = guardCfg?.provider ?? defaultProvider;
        const model =
          guardCfg?.modelName ?? privacyConfig.localModel?.model ?? "openbmb/minicpm4.1";
        api.logger.info(`[GuardClaw] S3 (rule fast-path) — routing to ${provider}/${model}`);
        return { providerOverride: provider, modelOverride: model };
      }

      // ── Normal path: run the full router pipeline ──────────────────
      const pipeline = getGlobalPipeline();
      if (!pipeline) {
        api.logger.warn("[GuardClaw] Router pipeline not initialized");
        return;
      }

      const decision = await pipeline.run(
        "onUserMessage",
        {
          checkpoint: "onUserMessage",
          message: prompt,
          sessionKey,
          agentId: ctx.agentId,
        },
        getPipelineConfig(),
      );

      recordDetection(sessionKey, decision.level, "onUserMessage", decision.reason);
      if (decision.level === "S1" && decision.action === "passthrough") {
        return;
      }

      // S3 from LLM detector (rules didn't catch it above): route to local
      if (decision.level === "S3") {
        trackSessionLevel(sessionKey, "S3");
        setActiveLocalRouting(sessionKey);
        stashDetection(sessionKey, {
          level: "S3",
          reason: decision.reason,
          originalPrompt: msgStr,
          timestamp: Date.now(),
        });
        if (decision.target) {
          api.logger.info(
            `[GuardClaw] S3 — routing to ${decision.target.provider}/${decision.target.model} [${decision.routerId}]`,
          );
          return {
            providerOverride: decision.target.provider,
            ...(decision.target.model ? { modelOverride: decision.target.model } : {}),
          };
        }
        const guardCfg = getGuardAgentConfig(privacyConfig);
        const defaultProvider = privacyConfig.localModel?.provider ?? "ollama";
        api.logger.info(
          `[GuardClaw] S3 — routing to ${guardCfg?.provider ?? defaultProvider}/${guardCfg?.modelName ?? privacyConfig.localModel?.model ?? "openbmb/minicpm4.1"} [${decision.routerId}]`,
        );
        return {
          providerOverride: guardCfg?.provider ?? defaultProvider,
          modelOverride:
            guardCfg?.modelName ?? privacyConfig.localModel?.model ?? "openbmb/minicpm4.1",
        };
      }

      // Desensitize for S2 (needed for both proxy markers and local prompt)
      let desensitized: string | undefined;
      if (decision.level === "S2") {
        const { desensitized: d } = await desensitizeWithLocalModel(
          msgStr,
          privacyConfig,
          sessionKey,
        );
        desensitized = d;
      }

      // Stash decision for before_prompt_build / before_message_write
      stashDetection(sessionKey, {
        level: decision.level,
        reason: decision.reason,
        desensitized,
        originalPrompt: msgStr,
        timestamp: Date.now(),
      });

      // S2-local: route to edge model
      if (
        decision.level === "S2" &&
        decision.action === "redirect" &&
        decision.target?.provider !== "guardclaw-privacy"
      ) {
        markSessionAsPrivate(sessionKey, decision.level);
        if (decision.target) {
          api.logger.info(
            `[GuardClaw] S2 — routing to ${decision.target.provider}/${decision.target.model} [${decision.routerId}]`,
          );
          return {
            providerOverride: decision.target.provider,
            ...(decision.target.model ? { modelOverride: decision.target.model } : {}),
          };
        }
      }

      // S2-proxy path
      if (decision.level === "S2" && decision.target?.provider === "guardclaw-privacy") {
        markSessionAsPrivate(sessionKey, "S2");
        const defaults = api.config.agents?.defaults as Record<string, unknown> | undefined;
        const primaryModel =
          ((defaults?.model as Record<string, unknown> | undefined)?.primary as string) ?? "";
        const defaultProvider =
          (defaults?.provider as string) || primaryModel.split("/")[0] || "openai";
        const providerConfig = api.config.models?.providers?.[defaultProvider];
        if (providerConfig) {
          const pc = providerConfig as Record<string, unknown>;
          const providerApi = (pc.api as string) ?? undefined;
          const stashTarget = {
            baseUrl: (pc.baseUrl as string) ?? resolveDefaultBaseUrl(defaultProvider, providerApi),
            apiKey: (pc.apiKey as string) ?? "",
            provider: defaultProvider,
            api: providerApi,
          };
          stashOriginalProvider(sessionKey, stashTarget);
        }
        const modelInfo = decision.target.model ? ` (model=${decision.target.model})` : "";
        api.logger.info(
          `[GuardClaw] S2 — routing through privacy proxy${modelInfo} [${decision.routerId}]`,
        );
        return {
          providerOverride: "guardclaw-privacy",
          ...(decision.target.model ? { modelOverride: decision.target.model } : {}),
        };
      }

      // Non-privacy routers may return redirect with a custom target
      if (decision.action === "redirect" && decision.target) {
        api.logger.info(
          `[GuardClaw] ${decision.level} — custom route to ${decision.target.provider}/${decision.target.model} [${decision.routerId}]`,
        );
        return {
          providerOverride: decision.target.provider,
          ...(decision.target.model ? { modelOverride: decision.target.model } : {}),
        };
      }

      // Block action at model resolve level → route to edge model as safeguard
      if (decision.action === "block") {
        if (decision.level === "S3") {
          trackSessionLevel(sessionKey, "S3");
          setActiveLocalRouting(sessionKey);
        } else {
          markSessionAsPrivate(sessionKey, decision.level);
        }
        const guardCfg = getGuardAgentConfig(privacyConfig);
        const defaultProvider = privacyConfig.localModel?.provider ?? "ollama";
        api.logger.warn(
          `[GuardClaw] ${decision.level} BLOCK — redirecting to edge model [${decision.routerId}]`,
        );
        return {
          providerOverride: guardCfg?.provider ?? defaultProvider,
          modelOverride:
            guardCfg?.modelName ?? privacyConfig.localModel?.model ?? "openbmb/minicpm4.1",
        };
      }

      // Default: no override — let the original provider handle the request
      // so provider-specific sanitization (Google turn ordering, tool schema
      // cleaning, transcript policy) in openclaw core still triggers correctly.
      return;
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_model_resolve hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 2: before_prompt_build — Inject guard prompt / S2 markers
  // =========================================================================
  api.on("before_prompt_build", async (_event, ctx) => {
    try {
      const sessionKey = ctx.sessionKey ?? "";
      if (!sessionKey) return;

      const pending = getPendingDetection(sessionKey);
      if (!pending || pending.level === "S1") return;

      const privacyConfig = getPrivacyConfigFromApi(api);

      // S3: keep original agent system prompt and skills — tool results
      // will be intercepted by tool_result_persist before reaching the LLM
      if (pending.level === "S3") {
        return;
      }

      // S2-local: inject guard agent system prompt
      if (pending.level === "S2" && (privacyConfig.s2Policy ?? "proxy") === "local") {
        const guardPrompt = getGuardAgentSystemPrompt();
        return { prependSystemContext: guardPrompt };
      }

      // S2-proxy: inject markers for privacy-proxy to strip
      if (pending.level === "S2" && pending.desensitized) {
        return {
          prependContext: `${GUARDCLAW_S2_OPEN}\n${pending.desensitized}\n${GUARDCLAW_S2_CLOSE}`,
          appendSystemContext: PRIVACY_S2_SYSTEM_INSTRUCTION,
        };
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_prompt_build hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 3: before_tool_call — Run pipeline at onToolCallProposed
  // =========================================================================
  api.on("before_tool_call", async (event, ctx) => {
    try {
      const { toolName, params } = event;
      const sessionKey = ctx.sessionKey ?? "";
      if (!toolName) return;

      const typedParams = params as Record<string, unknown>;
      const privacyConfig = getPrivacyConfigFromApi(api);
      const baseDir = privacyConfig.session?.baseDir ?? "~/.openclaw";

      // File-access guard for cloud models only — local models (Guard Agent
      // sessions and S3 active routing) are trusted to read full history.
      if (!isGuardSessionKey(sessionKey) && !isActiveLocalRouting(sessionKey)) {
        const pathValues = extractPathValuesFromParams(typedParams);
        for (const p of pathValues) {
          if (isProtectedMemoryPath(p, baseDir)) {
            api.logger.warn(
              `[GuardClaw] BLOCKED: cloud model tried to access protected path: ${p}`,
            );
            return {
              block: true,
              blockReason: `GuardClaw: access to full history/memory is restricted for cloud models (${p})`,
            };
          }
        }
      }

      // Memory read routing: private sessions read from MEMORY-FULL.md / memory-full/
      if (toolName === "memory_get" && isSessionMarkedPrivate(sessionKey)) {
        const p = String(typedParams.path ?? "");
        if (p === "MEMORY.md" || p === "memory.md") {
          return { params: { ...typedParams, path: "MEMORY-FULL.md" } };
        }
        if (p.startsWith("memory/")) {
          return { params: { ...typedParams, path: p.replace(/^memory\//, "memory-full/") } };
        }
      }

      // Subagent / A2A guard
      const isSpawn = toolName === "sessions_spawn";
      const isSend = toolName === "sessions_send";
      if (isSpawn || isSend) {
        const contentField = isSpawn
          ? String(typedParams?.task ?? "")
          : String(typedParams?.message ?? "");
        if (contentField.trim()) {
          const pipeline = getGlobalPipeline();
          if (pipeline) {
            const decision = await pipeline.run(
              "onToolCallProposed",
              {
                checkpoint: "onToolCallProposed",
                message: contentField,
                toolName,
                toolParams: typedParams,
                sessionKey,
                agentId: ctx.agentId,
              },
              getPipelineConfig(),
            );
            recordDetection(sessionKey, decision.level, "onToolCallProposed", decision.reason);

            if (decision.level === "S3" || decision.action === "block") {
              if (decision.level === "S3") {
                trackSessionLevel(sessionKey, "S3");
              } else {
                markSessionAsPrivate(sessionKey, decision.level);
              }
              return {
                block: true,
                blockReason: `GuardClaw: ${isSpawn ? "subagent task" : "A2A message"} blocked — ${decision.level} (${decision.reason ?? "sensitive"})`,
              };
            }
            if (decision.level === "S2") {
              markSessionAsPrivate(sessionKey, "S2");
              const { desensitized } = await desensitizeWithLocalModel(
                contentField,
                privacyConfig,
                sessionKey,
              );
              return { params: { ...typedParams, [isSpawn ? "task" : "message"]: desensitized } };
            }
          }
        }
      }

      // General tool call detection via pipeline.
      // S3 local routing: the model is already local — re-running the
      // pipeline would block the very tool calls the local model needs.
      if (!isActiveLocalRouting(sessionKey)) {
        const pipeline = getGlobalPipeline();
        if (pipeline) {
          const decision = await pipeline.run(
            "onToolCallProposed",
            {
              checkpoint: "onToolCallProposed",
              toolName,
              toolParams: typedParams,
              sessionKey,
              agentId: ctx.agentId,
            },
            getPipelineConfig(),
          );
          recordDetection(sessionKey, decision.level, "onToolCallProposed", decision.reason);

          if (decision.level === "S3" || decision.action === "block") {
            if (decision.level === "S3") {
              trackSessionLevel(sessionKey, "S3");
            } else {
              markSessionAsPrivate(sessionKey, decision.level);
            }
            return {
              block: true,
              blockReason: `GuardClaw: tool "${toolName}" blocked — ${decision.level} (${decision.reason ?? "sensitive"})`,
            };
          }
          if (decision.level === "S2") {
            markSessionAsPrivate(sessionKey, "S2");
          }
        }
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_tool_call hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 4: after_tool_call — Pipeline detection + memory dual-write sync
  // =========================================================================
  api.on("after_tool_call", async (event, ctx) => {
    try {
      const { toolName, result } = event;
      const sessionKey = ctx.sessionKey ?? "";
      if (!toolName) return;

      // Pipeline detection — skip when already in S3 local routing
      if (!isActiveLocalRouting(sessionKey)) {
        const pipeline = getGlobalPipeline();
        if (pipeline) {
          const decision = await pipeline.run(
            "onToolCallExecuted",
            {
              checkpoint: "onToolCallExecuted",
              toolName,
              toolResult: result,
              sessionKey,
              agentId: ctx.agentId,
            },
            getPipelineConfig(),
          );
          recordDetection(sessionKey, decision.level, "onToolCallExecuted", decision.reason);

          if (decision.level === "S3") {
            trackSessionLevel(sessionKey, "S3");
          } else if (decision.level === "S2") {
            markSessionAsPrivate(sessionKey, "S2");
          }
        }
      }

      // Memory dual-write: when Agent writes to memory files, sync the other track
      if (toolName === "write" || toolName === "write_file") {
        const writePath = String(event.params?.path ?? "");
        if (writePath && isMemoryWritePath(writePath)) {
          const workspaceDir = _cachedWorkspaceDir ?? process.cwd();
          const privacyConfig = getPrivacyConfigFromApi(api);
          syncMemoryWrite(writePath, workspaceDir, privacyConfig, api.logger).catch((err) => {
            api.logger.warn(`[GuardClaw] Memory dual-write sync failed: ${String(err)}`);
          });
        }
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in after_tool_call hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 5: tool_result_persist — PII detection, memory_search filtering
  // =========================================================================
  api.on("tool_result_persist", (event, ctx) => {
    try {
      const sessionKey = ctx.sessionKey ?? "";
      if (!sessionKey) return;

      const msg = event.message;
      if (!msg) return;

      // ── memory_search result filtering ──
      // QMD indexes both MEMORY.md and MEMORY-FULL.md (via extraPaths).
      // Filter out the wrong track so each session type only sees its own.
      if (ctx.toolName === "memory_search") {
        const filtered = filterMemorySearchResults(msg, isSessionMarkedPrivate(sessionKey));
        if (filtered) return { message: filtered };
        return;
      }

      // ── PII detection & redaction on all other tool results ──
      // S3 sessions are routed to a local model — data never leaves the
      // local environment, so PII redaction is unnecessary and would
      // degrade the local model's analysis quality.
      if (isActiveLocalRouting(sessionKey)) return;

      const textContent = extractMessageText(msg);
      if (!textContent || textContent.length < 10) return;

      // Rule-based PII redaction (sync — tool_result_persist cannot be async)
      const redacted = redactSensitiveInfo(textContent);
      const wasRedacted = redacted !== textContent;

      if (wasRedacted) {
        markSessionAsPrivate(sessionKey, "S2");
        api.logger.info(
          `[GuardClaw] PII redacted in tool result (tool=${ctx.toolName ?? "unknown"})`,
        );
        const modified = replaceMessageText(msg, redacted);
        if (modified) return { message: modified };
      }

      // Persist to dual history if session is private
      if (isSessionMarkedPrivate(sessionKey)) {
        const sessionManager = getDefaultSessionManager();
        const msgText = typeof msg === "string" ? msg : JSON.stringify(msg);
        const sessionMessage: SessionMessage = {
          role: "tool",
          content: msgText,
          timestamp: Date.now(),
          sessionKey,
        };
        sessionManager.persistMessage(sessionKey, sessionMessage).catch((err) => {
          console.error("[GuardClaw] Failed to persist tool result to dual history:", err);
        });
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in tool_result_persist hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 6: before_message_write — Dual history persistence + sanitize transcript
  // =========================================================================
  api.on("before_message_write", (event, ctx) => {
    try {
      const sessionKey = ctx.sessionKey ?? "";
      if (!sessionKey) return;

      const msg = event.message;
      if (!msg) return;

      const role = (msg as { role?: string }).role ?? "";
      const pending = getPendingDetection(sessionKey);

      // ── Dual session history persistence ──
      // Persist every message (user, assistant, system) to full/clean tracks
      // when the session is private.  Tool messages are handled separately
      // in tool_result_persist (Hook 5) to avoid double-writes.
      //
      // Also persist when pending detection is S3: Guard Agent is physically
      // isolated so the main session isn't marked private, but we still want
      // the S3 user message recorded (original → full, placeholder → clean)
      // for audit purposes.
      const needsDualHistory = isSessionMarkedPrivate(sessionKey) || pending?.level === "S3";
      if (needsDualHistory && role !== "tool") {
        const sessionManager = getDefaultSessionManager();
        const msgText = extractMessageText(msg);
        const ts = Date.now();

        if (role === "user" && pending && pending.level !== "S1") {
          // S2/S3 user message: original content → full, sanitized → clean
          const original = pending.originalPrompt ?? msgText;
          sessionManager
            .writeToFull(sessionKey, {
              role: "user",
              content: original,
              timestamp: ts,
              sessionKey,
            })
            .catch((err) => {
              console.error("[GuardClaw] Failed to persist user message to full history:", err);
            });
          const cleanContent =
            pending.level === "S3"
              ? "🔒 [Private content — processed locally]"
              : (pending.desensitized ?? msgText);
          sessionManager
            .writeToClean(sessionKey, {
              role: "user",
              content: cleanContent,
              timestamp: ts,
              sessionKey,
            })
            .catch((err) => {
              console.error("[GuardClaw] Failed to persist user message to clean history:", err);
            });
        } else if (msgText) {
          // Assistant / system / S1-user messages: persistMessage handles
          // the guard-agent filtering (guard → full only, others → both).
          sessionManager
            .persistMessage(sessionKey, {
              role: (role as SessionMessage["role"]) || "assistant",
              content: msgText,
              timestamp: ts,
              sessionKey,
            })
            .catch((err) => {
              console.error("[GuardClaw] Failed to persist message to dual history:", err);
            });
        }
      }

      // ── Sanitize user messages for session transcript ──
      if (role !== "user") return;
      if (!pending || pending.level === "S1") return;

      if (pending.level === "S3") {
        consumeDetection(sessionKey);
        return {
          message: {
            ...msg,
            content: [{ type: "text", text: "🔒 [Private content — processed locally]" }],
          },
        };
      }
      if (pending.level === "S2" && pending.desensitized) {
        consumeDetection(sessionKey);
        return { message: { ...msg, content: [{ type: "text", text: pending.desensitized }] } };
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_message_write hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 7: session_end — Memory sync
  // =========================================================================
  api.on("session_end", async (event, ctx) => {
    try {
      const sessionKey = event.sessionKey ?? ctx.sessionKey;
      if (!sessionKey) return;

      const wasPrivate = isSessionMarkedPrivate(sessionKey);
      api.logger.info(
        `[GuardClaw] ${wasPrivate ? "private" : "cloud"} session ${sessionKey} ended. Syncing memory…`,
      );

      const memMgr = getDefaultMemoryManager();
      const privacyConfig = getPrivacyConfigFromApi(api);
      await memMgr.syncAllMemoryToClean(privacyConfig);

      const collector = getGlobalCollector();
      if (collector) await collector.flush();
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in session_end hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 8: after_compaction — Full memory sync
  // =========================================================================
  api.on("after_compaction", async (_event, ctx) => {
    try {
      if (ctx.workspaceDir) _cachedWorkspaceDir = ctx.workspaceDir;
      const memMgr = getDefaultMemoryManager();
      const privacyConfig = getPrivacyConfigFromApi(api);
      await memMgr.syncAllMemoryToClean(privacyConfig);
      api.logger.info("[GuardClaw] Memory synced after compaction");
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in after_compaction hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 9: llm_output — Token usage tracking
  // =========================================================================
  api.on("llm_output", async (event, ctx) => {
    try {
      const sessionKey = ctx.sessionKey ?? event.sessionId ?? "";
      const provider = event.provider ?? "unknown";
      const model = event.model ?? "unknown";

      const collector = getGlobalCollector();
      collector?.record({
        sessionKey,
        provider,
        model,
        source: "task",
        usage: event.usage,
      });

      const liveConfig = getLiveConfig();
      const origin =
        provider === "guardclaw-privacy"
          ? "cloud"
          : isLocalProvider(provider, liveConfig.localProviders)
            ? "local"
            : "cloud";
      const reason =
        provider === "guardclaw-privacy"
          ? "guardclaw_proxy_to_cloud"
          : origin === "local"
            ? "local_provider"
            : "provider_not_local";

      recordFinalReply({
        sessionKey,
        provider,
        model,
        usage: event.usage,
        extraLocalProviders: liveConfig.localProviders,
        originHint: origin,
        reasonHint: reason,
      });

      // End-of-loop signal: freeze current loop detection max for API reads.
      finalizeLoop(sessionKey);
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in llm_output hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 10: before_reset — Full memory sync before session clear
  // =========================================================================
  api.on("before_reset", async (_event, ctx) => {
    try {
      if (ctx.workspaceDir) _cachedWorkspaceDir = ctx.workspaceDir;
      const memMgr = getDefaultMemoryManager();
      const privacyConfig = getPrivacyConfigFromApi(api);
      await memMgr.syncAllMemoryToClean(privacyConfig);
      api.logger.info("[GuardClaw] Memory synced before reset");
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_reset hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 11: message_sending — Outbound message guard (via pipeline)
  // =========================================================================
  api.on("message_sending", async (event, ctx) => {
    try {
      const { content } = event;
      if (!content?.trim()) return;

      const privacyConfig = getPrivacyConfigFromApi(api);
      if (!privacyConfig.enabled) return;

      const pipeline = getGlobalPipeline();
      if (!pipeline) return;

      const decision = await pipeline.run(
        "onToolCallExecuted",
        { checkpoint: "onToolCallExecuted", message: content },
        getPipelineConfig(),
      );

      if (decision.level === "S3" || decision.action === "block") {
        api.logger.warn("[GuardClaw] BLOCKED outbound message: S3/block detected");
        return { cancel: true };
      }
      if (decision.level === "S2") {
        const { desensitized } = await desensitizeWithLocalModel(
          content,
          privacyConfig,
          ctx.sessionKey,
        );
        return { content: desensitized };
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in message_sending hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 12: before_agent_start — Subagent guard (via pipeline)
  // =========================================================================
  api.on("before_agent_start", async (event, ctx) => {
    try {
      const { prompt } = event;
      const sessionKey = ctx.sessionKey ?? "";
      if (!sessionKey.includes(":subagent:") || !prompt?.trim()) return;

      const privacyConfig = getPrivacyConfigFromApi(api);
      if (!privacyConfig.enabled) return;

      const pipeline = getGlobalPipeline();
      if (!pipeline) return;

      const decision = await pipeline.run(
        "onUserMessage",
        { checkpoint: "onUserMessage", message: prompt, sessionKey, agentId: ctx.agentId },
        getPipelineConfig(),
      );

      // S3: subagent keeps original system prompt and skills (already routed to local model)
      // Only block if the action explicitly requires it
      if (decision.action === "block") {
        return {
          systemPrompt:
            `[PRIVACY GUARD] This task contains ${decision.level}-level content (${decision.reason ?? "sensitive data"}). ` +
            `You MUST NOT process, analyze, or echo any of this data. ` +
            `Reply with: "This task contains private data that cannot be processed by a cloud model." Do NOT attempt the task.`,
        };
      }
      if (decision.level === "S2") {
        return {
          prependContext: `[PRIVACY NOTICE] The task below may contain PII. Do NOT echo exact PII values. Use generic references instead.`,
        };
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_agent_start hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 13: message_received — Observational logging
  // =========================================================================
  api.on("message_received", async (event, _ctx) => {
    try {
      const privacyConfig = getPrivacyConfigFromApi(api);
      if (!privacyConfig.enabled) return;
      api.logger.info?.(`[GuardClaw] Message received from ${event.from ?? "unknown"}`);
    } catch {
      /* observational only */
    }
  });

  api.logger.info("[GuardClaw] All hooks registered (13 hooks, pipeline-driven)");
}

// ==========================================================================
// Helpers
// ==========================================================================

function getPrivacyConfigFromApi(_api: OpenClawPluginApi): PrivacyConfig {
  return getLiveConfig();
}

function resolveDefaultBaseUrl(provider: string, api?: string): string {
  const p = provider.toLowerCase();
  const a = (api ?? "").toLowerCase();
  if (
    p === "google" ||
    p.includes("gemini") ||
    p.includes("vertex") ||
    a.includes("google") ||
    a.includes("gemini")
  ) {
    return "https://generativelanguage.googleapis.com/v1beta";
  }
  if (p === "anthropic" || a === "anthropic-messages") {
    return "https://api.anthropic.com";
  }
  return "https://api.openai.com/v1";
}

function shouldSkipMessage(msg: string): boolean {
  if (msg.includes("[REDACTED:") || msg.startsWith("[SYSTEM]")) return true;
  if (/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(msg)) return true;
  return false;
}

function extractPathValuesFromParams(params: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const pathKeys = ["path", "file", "filepath", "filename", "dir", "directory", "target", "source"];
  for (const key of pathKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) paths.push(value.trim());
  }
  for (const value of Object.values(params)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...extractPathValuesFromParams(value as Record<string, unknown>));
    }
  }
  return paths;
}

/**
 * Extract text from an AgentMessage (supports string content and content arrays).
 */
function extractMessageText(msg: unknown): string {
  if (typeof msg === "string") return msg;
  if (!msg || typeof msg !== "object") return "";
  const m = msg as Record<string, unknown>;

  if (typeof m.content === "string") return m.content;

  if (Array.isArray(m.content)) {
    return m.content
      .map((part: unknown) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          return (part as Record<string, unknown>).text as string;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

/**
 * Replace text content in an AgentMessage, preserving the message structure.
 */
function replaceMessageText(msg: unknown, newText: string): unknown | null {
  if (typeof msg === "string") return newText;
  if (!msg || typeof msg !== "object") return null;
  const m = { ...(msg as Record<string, unknown>) };

  if (typeof m.content === "string") {
    return { ...m, content: newText };
  }

  if (Array.isArray(m.content)) {
    return { ...m, content: [{ type: "text", text: newText }] };
  }

  return null;
}

// ── Memory dual-write helpers ─────────────────────────────────────────────

const MEMORY_WRITE_PATTERNS = [/^MEMORY\.md$/, /^memory\.md$/, /^memory\//];

function isMemoryWritePath(writePath: string): boolean {
  const rel = writePath.replace(/^\.\//, "");
  return MEMORY_WRITE_PATTERNS.some((p) => p.test(rel));
}

/**
 * After Agent writes to a memory file, dual-write to the other track:
 *   MEMORY.md written → read content → write full to MEMORY-FULL.md, redact to MEMORY.md
 *   memory/X.md written → read → write full to memory-full/X.md, redact to memory/X.md
 */
async function syncMemoryWrite(
  writePath: string,
  workspaceDir: string,
  privacyConfig: PrivacyConfig,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  const rel = writePath.replace(/^\.\//, "");
  const absPath = path.isAbsolute(writePath) ? writePath : path.resolve(workspaceDir, rel);

  let content: string;
  try {
    content = await fs.promises.readFile(absPath, "utf-8");
  } catch {
    return;
  }

  if (!content.trim()) return;

  // Determine the counterpart path
  let fullRelPath: string;
  if (rel === "MEMORY.md" || rel === "memory.md") {
    fullRelPath = "MEMORY-FULL.md";
  } else if (rel.startsWith("memory/")) {
    fullRelPath = rel.replace(/^memory\//, "memory-full/");
  } else {
    return;
  }

  const fullAbsPath = path.resolve(workspaceDir, fullRelPath);

  // Ensure directory exists for daily memory files
  await fs.promises.mkdir(path.dirname(fullAbsPath), { recursive: true });

  // Write the original (unredacted) content to FULL
  await fs.promises.writeFile(fullAbsPath, content, "utf-8");

  // Redact PII and overwrite the clean version
  const memMgr = getDefaultMemoryManager();
  const redacted = await memMgr.redactContentPublic(content, privacyConfig);
  if (redacted !== content) {
    await fs.promises.writeFile(absPath, redacted, "utf-8");
    logger.info(`[GuardClaw] Memory dual-write: ${rel} → ${fullRelPath} (redacted clean copy)`);
  } else {
    logger.info(`[GuardClaw] Memory dual-write: ${rel} → ${fullRelPath} (no PII found)`);
  }
}

/**
 * Filter memory_search results: strip results from the wrong memory track.
 * Cloud sessions should not see MEMORY-FULL.md / memory-full/ results.
 * Private sessions should not see MEMORY.md / memory/ results (prefer full).
 */
function filterMemorySearchResults(msg: unknown, isPrivate: boolean): unknown | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;

  const textContent = extractMessageText(msg);
  if (!textContent) return null;

  try {
    const parsed = JSON.parse(textContent);
    if (!parsed || typeof parsed !== "object") return null;

    const results = (parsed as Record<string, unknown>).results;
    if (!Array.isArray(results)) return null;

    const filtered = results.filter((r: unknown) => {
      if (!r || typeof r !== "object") return true;
      const rPath = String((r as Record<string, unknown>).path ?? "");
      if (isPrivate) {
        // Private session: exclude clean-track results (prefer full)
        if (rPath === "MEMORY.md" || rPath === "memory.md" || rPath.startsWith("memory/")) {
          return false;
        }
      } else {
        // Cloud session: exclude full-track results
        if (rPath === "MEMORY-FULL.md" || rPath.startsWith("memory-full/")) {
          return false;
        }
      }
      return true;
    });

    if (filtered.length === results.length) return null;

    const newParsed = { ...(parsed as Record<string, unknown>), results: filtered };
    const newText = JSON.stringify(newParsed);
    return replaceMessageText(msg, newText);
  } catch {
    return null;
  }
}
