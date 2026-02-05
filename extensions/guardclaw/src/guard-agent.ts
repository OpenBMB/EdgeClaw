/**
 * GuardClaw Guard Agent Management
 * 
 * Manages guard agent invocation for S3 (private) operations.
 */

import type { PrivacyConfig } from "./types.js";

/**
 * Invoke guard agent for sensitive operations
 * 
 * This function would integrate with OpenClaw's sessions_spawn tool
 * to create a sub-agent that runs with local models only.
 * 
 * NOTE: This is a placeholder implementation. In a real scenario,
 * this would need to integrate with the gateway RPC to spawn the agent.
 */
export async function invokeGuardAgent(params: {
  sessionKey: string;
  message: string;
  agentId?: string;
  config: PrivacyConfig;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const guardAgentId = params.config.guardAgent?.id ?? "guard";
    const guardModel = params.config.guardAgent?.model ?? "ollama/llama3.2:3b";

    // In a full implementation, this would call the gateway's agent RPC
    // to spawn a sub-agent with the guard agent configuration
    
    // Example pseudo-code:
    // const result = await gatewayRpc.agent({
    //   message: params.message,
    //   agentId: guardAgentId,
    //   sessionKey: `${params.sessionKey}:guard:${Date.now()}`,
    //   model: guardModel,
    //   deliver: false, // Don't deliver result, just execute
    //   lane: "subagent",
    // });

    console.log(
      `[GuardClaw] Would invoke guard agent ${guardAgentId} for session ${params.sessionKey}`
    );
    console.log(`[GuardClaw] Guard agent model: ${guardModel}`);
    console.log(`[GuardClaw] Message: ${params.message.slice(0, 100)}...`);

    // For now, just return success
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: String(err),
    };
  }
}

/**
 * Check if guard agent is properly configured
 */
export function isGuardAgentConfigured(config: PrivacyConfig): boolean {
  return Boolean(
    config.guardAgent?.id &&
    config.guardAgent?.model &&
    config.guardAgent?.workspace
  );
}

/**
 * Get guard agent configuration
 */
export function getGuardAgentConfig(config: PrivacyConfig): {
  id: string;
  model: string;
  workspace: string;
} | null {
  if (!isGuardAgentConfigured(config)) {
    return null;
  }

  return {
    id: config.guardAgent?.id ?? "guard",
    model: config.guardAgent?.model ?? "ollama/llama3.2:3b",
    workspace: config.guardAgent?.workspace ?? "~/.openclaw/workspace-guard",
  };
}

/**
 * Generate a unique guard agent session key
 */
export function generateGuardSessionKey(parentSessionKey: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${parentSessionKey}:guard:${timestamp}:${random}`;
}

/**
 * Check if a session key is for a guard agent
 */
export function isGuardSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(":guard:");
}
