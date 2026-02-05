/**
 * GuardClaw Hooks Registration
 * 
 * Registers all plugin hooks for sensitivity detection at various checkpoints.
 * Includes automatic model switching for privacy protection.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { detectSensitivityLevel } from "./detector.js";
import { markSessionAsPrivate, recordDetection, isSessionMarkedPrivate, getSessionSensitivity } from "./session-state.js";
import type { PrivacyConfig } from "./types.js";
import { defaultPrivacyConfig } from "./config-schema.js";

/**
 * Register all GuardClaw hooks
 */
export function registerHooks(api: OpenClawPluginApi): void {
  // Hook 1: message_received - Checkpoint for user messages
  api.on("message_received", async (event, ctx) => {
    try {
      const { message, sessionKey, agentId } = event;

      if (!message || !sessionKey) {
        return;
      }

      // Extract text from message
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

      // Log detection if not S1
      if (result.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Message sensitivity: ${result.level} for session ${sessionKey} - ${result.reason ?? "no reason"}`
        );
      }

      // Mark session as private if S3
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.warn(
          `[GuardClaw] Session ${sessionKey} marked as PRIVATE (S3 detected)`
        );
      } else if (result.level === "S2") {
        // For S2, we could optionally prompt the user here
        // But that would require message sending capability
        api.logger.info(
          `[GuardClaw] S2 detected for session ${sessionKey}. Consider using local models.`
        );
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in message_received hook: ${String(err)}`);
    }
  });

  // Hook 2: before_tool_call - Checkpoint for tool calls before execution
  api.on("before_tool_call", async (event, ctx) => {
    try {
      const { toolName, params, sessionKey } = event;

      if (!toolName || !sessionKey) {
        return;
      }

      // Detect sensitivity level
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onToolCallProposed",
          toolName,
          toolParams: params as Record<string, unknown>,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      // Record detection
      recordDetection(sessionKey, result.level, "onToolCallProposed", result.reason);

      // Log detection if not S1
      if (result.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Tool call sensitivity: ${result.level} for ${toolName} - ${result.reason ?? "no reason"}`
        );
      }

      // Mark session as private if S3
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.warn(
          `[GuardClaw] Tool ${toolName} triggered S3. Session ${sessionKey} marked as PRIVATE.`
        );

        // TODO: In the future, we could block the tool and redirect to guard agent
        // For now, just log the warning
        // return { blocked: true, reason: "S3 sensitivity detected" };
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_tool_call hook: ${String(err)}`);
    }
  });

  // Hook 3: after_tool_call - Checkpoint for tool results
  api.on("after_tool_call", async (event, ctx) => {
    try {
      const { toolName, result, sessionKey } = event;

      if (!toolName || !sessionKey) {
        return;
      }

      // Detect sensitivity level in the result
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

      // Record detection
      recordDetection(
        sessionKey,
        detectionResult.level,
        "onToolCallExecuted",
        detectionResult.reason
      );

      // Log detection if not S1
      if (detectionResult.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Tool result sensitivity: ${detectionResult.level} for ${toolName} - ${detectionResult.reason ?? "no reason"}`
        );
      }

      // Mark session as private if S3
      if (detectionResult.level === "S3") {
        markSessionAsPrivate(sessionKey, detectionResult.level);
        api.logger.warn(
          `[GuardClaw] Tool ${toolName} result contains S3 content. Session ${sessionKey} marked as PRIVATE.`
        );
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in after_tool_call hook: ${String(err)}`);
    }
  });

  // Hook 4: tool_result_persist - Control history persistence
  api.on("tool_result_persist", (event, ctx) => {
    try {
      const { message, sessionKey } = event;

      // Check if this is a sensitive session
      const isPrivate = isSessionMarkedPrivate(sessionKey ?? "");

      if (isPrivate) {
        // For private sessions, we'll handle dual history writing
        // This is a placeholder - actual implementation would need
        // to integrate with the session manager

        api.logger.debug(
          `[GuardClaw] Tool result in private session ${sessionKey}, dual history enabled`
        );

        // Return transformed message or custom persistence logic
        // For now, just pass through
        return;
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in tool_result_persist hook: ${String(err)}`);
    }
  });

  // Hook 5: session_end - Cleanup when session ends
  api.on("session_end", async (event, ctx) => {
    try {
      const { sessionKey } = event;

      if (sessionKey) {
        const wasPrivate = isSessionMarkedPrivate(sessionKey);
        if (wasPrivate) {
          api.logger.info(`[GuardClaw] Private session ${sessionKey} ended. Cleaning up state.`);
        }
        // Note: We keep the state for now for audit purposes
        // If you want to clear it, uncomment: clearSessionState(sessionKey);
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in session_end hook: ${String(err)}`);
    }
  });

  // Hook 6: resolve_model - Auto-switch to local model AND subsession for sensitive content
  // SUBSESSION ISOLATION: Sensitive content goes to a separate guard session with local model
  api.on("resolve_model", async (event, ctx) => {
    try {
      const { message, provider, model, isDefault } = event;
      const { sessionKey, agentId } = ctx;

      if (!sessionKey) {
        return;
      }

      // Get privacy config
      const privacyConfig = mergeWithDefaults(
        (api.pluginConfig?.privacy as PrivacyConfig) ?? {},
        defaultPrivacyConfig
      );

      // Check if privacy is enabled
      if (!privacyConfig.enabled) {
        return;
      }

      // Get guard model config
      const guardModel = privacyConfig.guardAgent?.model ?? "ollama/llama3.2:3b";
      const [guardProvider, guardModelName] = guardModel.includes("/")
        ? guardModel.split("/", 2)
        : ["ollama", guardModel];

      // Check if this is already a guard session (avoid recursive redirection)
      const isGuardSession = sessionKey.includes(":guard");
      if (isGuardSession) {
        // Already in guard session, just ensure local model is used
        if (provider !== guardProvider || model !== guardModelName) {
          return {
            provider: guardProvider,
            model: guardModelName,
            reason: `GuardClaw: Guard session using local model`,
          };
        }
        return;
      }

      // Check the current message for sensitive content
      if (message) {
        const result = await detectSensitivityLevel(
          {
            checkpoint: "onUserMessage",
            message,
            sessionKey,
            agentId,
          },
          api.pluginConfig
        );

        // Record this detection in the main session
        recordDetection(sessionKey, result.level, "onUserMessage", result.reason);

        // If sensitive content detected, redirect to guard subsession
        if (result.level === "S2" || result.level === "S3") {
          // Generate guard session key based on main session
          // Format: {mainSessionKey}:guard
          const guardSessionKey = `${sessionKey}:guard`;
          
          // Mark both sessions appropriately
          markSessionAsPrivate(sessionKey, result.level);
          markSessionAsPrivate(guardSessionKey, result.level);
          
          api.logger.info(
            `[GuardClaw] ${result.level} detected. Redirecting to guard subsession: ${guardSessionKey}`
          );

          return {
            provider: guardProvider,
            model: guardModelName,
            sessionKey: guardSessionKey,
            deliverToOriginal: true,
            reason: `GuardClaw: ${result.level} - redirected to isolated guard session`,
          };
        }
      }

      // Check if main session was previously marked as private
      // If so, always redirect to guard session for history protection
      if (isSessionMarkedPrivate(sessionKey)) {
        const sessionSensitivity = getSessionSensitivity(sessionKey);
        const guardSessionKey = `${sessionKey}:guard`;
        
        api.logger.info(
          `[GuardClaw] Session ${sessionKey} has sensitive history (${sessionSensitivity?.highestLevel ?? "unknown"}). ` +
          `Redirecting to guard subsession to protect history.`
        );

        return {
          provider: guardProvider,
          model: guardModelName,
          sessionKey: guardSessionKey,
          deliverToOriginal: true,
          reason: `GuardClaw: ${sessionSensitivity?.highestLevel ?? "sensitive"} history - using isolated guard session`,
        };
      }

      // Session is clean, no sensitive content detected - use cloud model normally
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in resolve_model hook: ${String(err)}`);
    }
  });

  api.logger.info("[GuardClaw] All hooks registered successfully");
}

/**
 * Merge user config with defaults
 */
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
    
    // Try common message text fields
    if (typeof msg.text === "string") {
      return msg.text;
    }
    if (typeof msg.content === "string") {
      return msg.content;
    }
    if (typeof msg.body === "string") {
      return msg.body;
    }
  }

  return undefined;
}
