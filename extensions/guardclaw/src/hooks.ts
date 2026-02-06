/**
 * GuardClaw Hooks Registration
 * 
 * Registers all plugin hooks for sensitivity detection at various checkpoints.
 * Implements:
 *   - S1: pass-through (no intervention)
 *   - S2: desensitize content via local model / rules, then forward to cloud
 *   - S3: redirect to isolated guard subsession with local-only model
 *   - Dual session history (full vs clean)
 *   - Memory isolation (MEMORY-FULL.md vs MEMORY.md)
 *   - File-access guards (block cloud models from reading full history/memory)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { detectSensitivityLevel } from "./detector.js";
import {
  markSessionAsPrivate,
  recordDetection,
  isSessionMarkedPrivate,
  getSessionSensitivity,
} from "./session-state.js";
import { desensitizeWithLocalModel } from "./local-model.js";
import { getDefaultSessionManager, type SessionMessage } from "./session-manager.js";
import { getDefaultMemoryManager } from "./memory-isolation.js";
import {
  generateGuardSessionKey,
  isGuardSessionKey,
  getGuardAgentConfig,
  buildMainSessionPlaceholder,
  isLocalProvider,
} from "./guard-agent.js";
import { redactSensitiveInfo, isProtectedMemoryPath } from "./utils.js";
import type { PrivacyConfig } from "./types.js";
import { defaultPrivacyConfig } from "./config-schema.js";

/**
 * Privacy-aware system prompt for the guard agent.
 * Instructs the model to never repeat, echo, or include sensitive information in responses.
 */
const GUARD_AGENT_SYSTEM_PROMPT = `## Privacy Guidelines

You are handling a privacy-sensitive request. Follow these critical rules:

1. **NEVER repeat or echo back** any sensitive information from the user's message (passwords, API keys, tokens, private data, etc.)
2. **NEVER include** passwords, keys, credentials, or other secrets in your response
3. If asked about credentials or secrets, provide guidance WITHOUT showing the actual values
4. Use placeholders like [REDACTED], <password>, or <api-key> when referencing sensitive values
5. Focus on helping the user accomplish their task safely without exposing their private information
6. If you need to reference something sensitive, describe it generically (e.g., "your password" instead of showing it)

Remember: Your response may be logged or displayed elsewhere. Protect the user's privacy at all times.`;

/**
 * Register all GuardClaw hooks
 */
export function registerHooks(api: OpenClawPluginApi): void {
  // Initialize memory directories on startup
  const memoryManager = getDefaultMemoryManager();
  memoryManager.initializeDirectories().catch((err) => {
    api.logger.error(`[GuardClaw] Failed to initialize memory directories: ${String(err)}`);
  });

  // =========================================================================
  // Hook 1: message_received — Checkpoint for user messages
  // =========================================================================
  api.on("message_received", async (event, ctx) => {
    try {
      const { message, sessionKey, agentId } = event;

      if (!message || !sessionKey) {
        return;
      }

      const messageText = extractMessageText(message);
      if (!messageText) {
        return;
      }

      // Detect sensitivity level
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onUserMessage",
          message: messageText,
          sessionKey,
          agentId,
        },
        api.pluginConfig
      );

      // Record detection
      recordDetection(sessionKey, result.level, "onUserMessage", result.reason);

      if (result.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Message sensitivity: ${result.level} for session ${sessionKey} — ${result.reason ?? "no reason"}`
        );
      }

      // Persist to dual history
      const sessionManager = getDefaultSessionManager();
      const sessionMessage: SessionMessage = {
        role: "user",
        content: messageText,
        timestamp: Date.now(),
        sessionKey,
      };
      await sessionManager.persistMessage(sessionKey, sessionMessage, agentId ?? "main");

      // Mark session state
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.warn(
          `[GuardClaw] Session ${sessionKey} marked as PRIVATE (S3 detected)`
        );
      } else if (result.level === "S2") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.info(
          `[GuardClaw] S2 detected for session ${sessionKey}. Content will be desensitized for cloud.`
        );
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in message_received hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 2: before_tool_call — Checkpoint for tool calls before execution
  //   S3 tools → BLOCK the call and return an error
  //   S2 tools → allow but log
  //   Also: block cloud model access to protected memory/history paths
  // =========================================================================
  api.on("before_tool_call", async (event, ctx) => {
    try {
      const { toolName, params } = event;
      const sessionKey = ctx.sessionKey ?? "";

      if (!toolName) {
        return;
      }

      // ── File-access guard: block cloud models from reading full history / memory ──
      const typedParams = params as Record<string, unknown>;
      if (typedParams) {
        const privacyConfig = getPrivacyConfigFromApi(api);
        const baseDir = privacyConfig.session?.baseDir ?? "~/.openclaw";
        const pathValues = extractPathValuesFromParams(typedParams);

        // If the session is NOT a guard session (i.e., cloud model context),
        // block access to protected full-history / full-memory paths.
        if (!isGuardSessionKey(sessionKey)) {
          for (const p of pathValues) {
            if (isProtectedMemoryPath(p, baseDir)) {
              api.logger.warn(
                `[GuardClaw] BLOCKED: cloud model tried to access protected path: ${p}`
              );
              return {
                block: true,
                blockReason: `GuardClaw: access to full history/memory is restricted for cloud models (${p})`,
              };
            }
          }
        }
      }

      // ── Sensitivity detection ──
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onToolCallProposed",
          toolName,
          toolParams: typedParams,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      recordDetection(sessionKey, result.level, "onToolCallProposed", result.reason);

      if (result.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Tool call sensitivity: ${result.level} for ${toolName} — ${result.reason ?? "no reason"}`
        );
      }

      // S3 → BLOCK the tool call
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.warn(
          `[GuardClaw] BLOCKED tool ${toolName} (S3). Session ${sessionKey} marked as PRIVATE.`
        );
        return {
          block: true,
          blockReason: `GuardClaw: tool "${toolName}" blocked — S3 sensitivity detected (${result.reason ?? "sensitive operation"})`,
        };
      }

      // S2 → allow but mark session
      if (result.level === "S2") {
        markSessionAsPrivate(sessionKey, result.level);
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_tool_call hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 3: after_tool_call — Checkpoint for tool results
  // =========================================================================
  api.on("after_tool_call", async (event, ctx) => {
    try {
      const { toolName, result } = event;
      const sessionKey = ctx.sessionKey ?? "";

      if (!toolName) {
        return;
      }

      const detectionResult = await detectSensitivityLevel(
        {
          checkpoint: "onToolCallExecuted",
          toolName,
          toolResult: result,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      recordDetection(
        sessionKey,
        detectionResult.level,
        "onToolCallExecuted",
        detectionResult.reason
      );

      if (detectionResult.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Tool result sensitivity: ${detectionResult.level} for ${toolName} — ${detectionResult.reason ?? "no reason"}`
        );
      }

      if (detectionResult.level === "S3" || detectionResult.level === "S2") {
        markSessionAsPrivate(sessionKey, detectionResult.level);
        if (detectionResult.level === "S3") {
          api.logger.warn(
            `[GuardClaw] Tool ${toolName} result contains S3 content. Session ${sessionKey} marked as PRIVATE.`
          );
        }
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in after_tool_call hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 4: tool_result_persist — Control dual-history persistence
  // =========================================================================
  api.on("tool_result_persist", (event, ctx) => {
    try {
      const { message, sessionKey } = event;
      const isPrivate = isSessionMarkedPrivate(sessionKey ?? "");

      if (isPrivate && sessionKey) {
        // Persist to full history (includes everything)
        const sessionManager = getDefaultSessionManager();
        const msgText = typeof message === "string" ? message : JSON.stringify(message);
        const sessionMessage: SessionMessage = {
          role: "tool",
          content: msgText,
          timestamp: Date.now(),
          sessionKey,
        };
        // Fire-and-forget async write
        sessionManager.persistMessage(sessionKey, sessionMessage).catch((err) => {
          console.error(`[GuardClaw] Failed to persist tool result to dual history:`, err);
        });

        api.logger.debug(
          `[GuardClaw] Tool result in private session ${sessionKey}, dual history write triggered`
        );
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in tool_result_persist hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 5: session_end — Cleanup and memory sync
  // =========================================================================
  api.on("session_end", async (event, ctx) => {
    try {
      const { sessionKey } = event;

      if (sessionKey) {
        const wasPrivate = isSessionMarkedPrivate(sessionKey);
        if (wasPrivate) {
          api.logger.info(
            `[GuardClaw] Private session ${sessionKey} ended. Syncing memory…`
          );

          // Sync full memory → clean memory (strip guard agent sections)
          const memMgr = getDefaultMemoryManager();
          await memMgr.syncMemoryToClean();
        }
        // Note: We keep session state for audit purposes
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in session_end hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 6: resolve_model — Model + session routing
  //
  //   S1 → pass-through (cloud model, normal session)
  //   S2 → desensitize content, send desensitized version to cloud model
  //   S3 → redirect to guard subsession with local-only model
  // =========================================================================
  api.on("resolve_model", async (event, ctx) => {
    try {
      const { message, provider, model } = event;
      const sessionKey = ctx.sessionKey ?? "";

      api.logger.info(
        `[GuardClaw] resolve_model called: sessionKey=${sessionKey}, message=${String(message).slice(0, 50)}, provider=${provider}, model=${model}`
      );

      if (!sessionKey) {
        api.logger.info(`[GuardClaw] resolve_model: no sessionKey, returning`);
        return;
      }

      const privacyConfig = getPrivacyConfigFromApi(api);
      api.logger.info(
        `[GuardClaw] resolve_model: enabled=${privacyConfig.enabled}, keywords.S2=${JSON.stringify(privacyConfig.rules?.keywords?.S2)}`
      );
      if (!privacyConfig.enabled) {
        api.logger.info(`[GuardClaw] resolve_model: privacy disabled, returning`);
        return;
      }

      // If already in a guard session, enforce local model
      if (isGuardSessionKey(sessionKey)) {
        const guardCfg = getGuardAgentConfig(privacyConfig);
        if (guardCfg && (!isLocalProvider(provider ?? "") || model !== guardCfg.modelName)) {
          return {
            provider: guardCfg.provider,
            model: guardCfg.modelName,
            reason: "GuardClaw: guard session must use local model",
          };
        }
        return; // already correct
      }

      // Detect sensitivity of current message
      if (!message) {
        api.logger.info(`[GuardClaw] resolve_model: no message, returning`);
        return;
      }

      api.logger.info(`[GuardClaw] resolve_model: calling detectSensitivityLevel with message="${String(message).slice(0, 80)}"`);
      
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onUserMessage",
          message,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      api.logger.info(
        `[GuardClaw] resolve_model: detection result: level=${result.level}, reason=${result.reason}`
      );

      recordDetection(sessionKey, result.level, "onUserMessage", result.reason);

      // ── S3: full redirect to guard subsession with local model ──
      if (result.level === "S3") {
        const guardCfg = getGuardAgentConfig(privacyConfig);
        const guardProvider = guardCfg?.provider ?? "ollama";
        const guardModelName = guardCfg?.modelName ?? "llama3.2:3b";
        const guardSessionKey = generateGuardSessionKey(sessionKey);

        markSessionAsPrivate(sessionKey, result.level);
        markSessionAsPrivate(guardSessionKey, result.level);

        api.logger.info(
          `[GuardClaw] S3 detected. Redirecting to guard subsession: ${guardSessionKey}`
        );

        // Emit UI event
        api.emitEvent("privacy_activated", {
          active: true,
          level: result.level,
          model: `${guardProvider}/${guardModelName}`,
          provider: guardProvider,
          reason: result.reason ?? "S3 content detected",
          sessionKey: guardSessionKey,
          originalSessionKey: sessionKey,
        });

        // Write a placeholder to the main session's clean history
        const sessionManager = getDefaultSessionManager();
        const placeholder = buildMainSessionPlaceholder(result.level, result.reason);
        await sessionManager.persistMessage(sessionKey, {
          role: "user",
          content: placeholder,
          timestamp: Date.now(),
          sessionKey,
        });

        const wrappedUserPrompt = buildGuardUserPrompt(message, result.level, result.reason);

        return {
          provider: guardProvider,
          model: guardModelName,
          sessionKey: guardSessionKey,
          deliverToOriginal: true,
          reason: `GuardClaw: S3 — redirected to isolated guard session`,
          extraSystemPrompt: GUARD_AGENT_SYSTEM_PROMPT,
          userPromptOverride: wrappedUserPrompt,
        };
      }

      // ── S2: desensitize content, then forward to cloud model ──
      if (result.level === "S2") {
        markSessionAsPrivate(sessionKey, result.level);

        api.logger.info(
          `[GuardClaw] S2 detected. Desensitizing content for cloud model.`
        );

        // Desensitize the user message (via local model or rule-based fallback)
        const { desensitized, wasModelUsed } = await desensitizeWithLocalModel(
          message,
          privacyConfig
        );

        api.logger.info(
          `[GuardClaw] Desensitization complete (model=${wasModelUsed}). Forwarding to cloud.`
        );

        // Persist the ORIGINAL message to full history
        const sessionManager = getDefaultSessionManager();
        await sessionManager.persistMessage(sessionKey, {
          role: "user",
          content: message,
          timestamp: Date.now(),
          sessionKey,
        });

        // Emit UI event
        api.emitEvent("privacy_activated", {
          active: true,
          level: result.level,
          desensitized: true,
          wasModelUsed,
          reason: result.reason ?? "S2 content detected — desensitized",
          sessionKey,
        });

        // Forward the DESENSITIZED message to cloud (don't change provider/model)
        return {
          reason: `GuardClaw: S2 — content desensitized before cloud delivery`,
          userPromptOverride: desensitized,
        };
      }

      // ── S1: no intervention ──
      // Session is clean, use cloud model normally
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in resolve_model hook: ${String(err)}`);
    }
  });

  api.logger.info("[GuardClaw] All hooks registered successfully");
}

// ==========================================================================
// Helpers
// ==========================================================================

/**
 * Merge user config with defaults and return typed PrivacyConfig
 */
function getPrivacyConfigFromApi(api: OpenClawPluginApi): PrivacyConfig {
  return mergeWithDefaults(
    (api.pluginConfig?.privacy as PrivacyConfig) ?? {},
    defaultPrivacyConfig
  );
}

function mergeWithDefaults(
  userConfig: PrivacyConfig,
  defaults: typeof defaultPrivacyConfig
): PrivacyConfig {
  return {
    enabled: userConfig.enabled ?? defaults.enabled,
    checkpoints: {
      onUserMessage: userConfig.checkpoints?.onUserMessage ?? defaults.checkpoints?.onUserMessage,
      onToolCallProposed:
        userConfig.checkpoints?.onToolCallProposed ?? defaults.checkpoints?.onToolCallProposed,
      onToolCallExecuted:
        userConfig.checkpoints?.onToolCallExecuted ?? defaults.checkpoints?.onToolCallExecuted,
    },
    rules: {
      keywords: {
        S2: userConfig.rules?.keywords?.S2 ?? defaults.rules?.keywords?.S2,
        S3: userConfig.rules?.keywords?.S3 ?? defaults.rules?.keywords?.S3,
      },
      patterns: {
        S2: userConfig.rules?.patterns?.S2 ?? defaults.rules?.patterns?.S2,
        S3: userConfig.rules?.patterns?.S3 ?? defaults.rules?.patterns?.S3,
      },
      tools: {
        S2: {
          tools: userConfig.rules?.tools?.S2?.tools ?? defaults.rules?.tools?.S2?.tools,
          paths: userConfig.rules?.tools?.S2?.paths ?? defaults.rules?.tools?.S2?.paths,
        },
        S3: {
          tools: userConfig.rules?.tools?.S3?.tools ?? defaults.rules?.tools?.S3?.tools,
          paths: userConfig.rules?.tools?.S3?.paths ?? defaults.rules?.tools?.S3?.paths,
        },
      },
    },
    localModel: {
      enabled: userConfig.localModel?.enabled ?? defaults.localModel?.enabled,
      provider: userConfig.localModel?.provider ?? defaults.localModel?.provider,
      model: userConfig.localModel?.model ?? defaults.localModel?.model,
      endpoint: userConfig.localModel?.endpoint ?? defaults.localModel?.endpoint,
    },
    guardAgent: {
      id: userConfig.guardAgent?.id ?? defaults.guardAgent?.id,
      workspace: userConfig.guardAgent?.workspace ?? defaults.guardAgent?.workspace,
      model: userConfig.guardAgent?.model ?? defaults.guardAgent?.model,
    },
    session: {
      isolateGuardHistory:
        userConfig.session?.isolateGuardHistory ?? defaults.session?.isolateGuardHistory,
      baseDir: userConfig.session?.baseDir ?? defaults.session?.baseDir,
    },
  };
}

/**
 * Extract text from message object
 */
function extractMessageText(message: unknown): string | undefined {
  if (typeof message === "string") {
    return message;
  }

  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    if (typeof msg.text === "string") return msg.text;
    if (typeof msg.content === "string") return msg.content;
    if (typeof msg.body === "string") return msg.body;
  }

  return undefined;
}

/**
 * Build a wrapped user prompt for the guard agent (S3)
 */
function buildGuardUserPrompt(
  originalMessage: string,
  level: string,
  reason?: string
): string {
  return `[Privacy Level: ${level}${reason ? ` — ${reason}` : ""}]

${originalMessage}`;
}

/**
 * Extract path-like values from tool params for file-access guarding
 */
function extractPathValuesFromParams(params: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const pathKeys = ["path", "file", "filepath", "filename", "dir", "directory", "target", "source"];

  for (const key of pathKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
  }

  // Recurse into nested objects
  for (const value of Object.values(params)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...extractPathValuesFromParams(value as Record<string, unknown>));
    }
  }

  return paths;
}
