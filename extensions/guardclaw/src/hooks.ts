/**
 * GuardClaw Hooks Registration
 * 
 * Registers all plugin hooks for sensitivity detection at various checkpoints.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { detectSensitivityLevel } from "./detector.js";
import { markSessionAsPrivate, recordDetection, isSessionMarkedPrivate } from "./session-state.js";

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

  api.logger.info("[GuardClaw] All hooks registered successfully");
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
