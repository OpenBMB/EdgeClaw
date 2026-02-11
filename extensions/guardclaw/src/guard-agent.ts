/**
 * GuardClaw Guard Agent Management
 * 
 * Manages guard agent configuration and session routing for S3 (private) operations.
 * 
 * The guard agent is a sub-agent that runs exclusively with local models.
 * When S3 content is detected, the resolve_model hook redirects the message
 * to a guard subsession. This module provides utilities for:
 * - Guard agent configuration validation
 * - Guard session key generation and detection
 * - Placeholder message generation for the main session history
 */

import type { PrivacyConfig, SensitivityLevel } from "./types.js";

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
 * Get guard agent configuration (returns null if not fully configured)
 */
export function getGuardAgentConfig(config: PrivacyConfig): {
  id: string;
  model: string;
  workspace: string;
  provider: string;
  modelName: string;
} | null {
  if (!isGuardAgentConfigured(config)) {
    return null;
  }

  const fullModel = config.guardAgent?.model ?? "ollama/openbmb/minicpm4.1";
  // Split on FIRST slash only — model names like "openbmb/minicpm4.1" contain slashes
  const firstSlash = fullModel.indexOf("/");
  const [provider, modelName] = firstSlash >= 0
    ? [fullModel.slice(0, firstSlash), fullModel.slice(firstSlash + 1)]
    : ["ollama", fullModel];

  return {
    id: config.guardAgent?.id ?? "guard",
    model: fullModel,
    workspace: config.guardAgent?.workspace ?? "~/.openclaw/workspace-guard",
    provider,
    modelName,
  };
}

/**
 * Generate a guard subsession key from the parent session key.
 * Format: {parentSessionKey}:guard
 * 
 * This is a stable key so that the guard subsession accumulates
 * its own history across multiple redirections within the same parent session.
 */
export function generateGuardSessionKey(parentSessionKey: string): string {
  return `${parentSessionKey}:guard`;
}

/**
 * Check if a session key belongs to a guard subsession
 */
export function isGuardSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(":guard") || sessionKey.includes(":guard:");
}

/**
 * Extract the parent session key from a guard session key
 */
export function getParentSessionKey(guardSessionKey: string): string | null {
  if (!isGuardSessionKey(guardSessionKey)) {
    return null;
  }
  // Remove the :guard suffix
  const idx = guardSessionKey.indexOf(":guard");
  return idx > 0 ? guardSessionKey.slice(0, idx) : null;
}

/**
 * Build a placeholder message to insert into the main (cloud-visible) session history
 * when a message is redirected to the guard subsession.
 * 
 * This ensures the cloud model never sees the actual sensitive content,
 * but knows that something was handled privately.
 */
export function buildMainSessionPlaceholder(level: SensitivityLevel, reason?: string): string {
  const emoji = level === "S3" ? "🔒" : "🔑";
  const levelLabel = level === "S3" ? "Private" : "Sensitive";
  const reasonSuffix = reason ? ` (${reason})` : "";
  return `${emoji} [${levelLabel} message — processed locally${reasonSuffix}]`;
}

/**
 * Validate that a model reference is local-only (not a cloud provider).
 * Used to enforce the constraint that guard sessions only use local models.
 */
export function isLocalProvider(provider: string): boolean {
  const localProviders = ["ollama", "llama.cpp", "localai", "llamafile", "lmstudio"];
  return localProviders.includes(provider.toLowerCase());
}
