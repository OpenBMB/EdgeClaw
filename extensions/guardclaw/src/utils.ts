/**
 * GuardClaw Utilities
 * 
 * Helper functions for the GuardClaw plugin.
 */

import type { PrivacyConfig } from "./types.js";

/**
 * Get privacy config from plugin config
 */
export function getPrivacyConfig(pluginConfig: Record<string, unknown>): PrivacyConfig {
  return (pluginConfig?.privacy as PrivacyConfig) ?? {};
}

/**
 * Check if privacy features are enabled
 */
export function isPrivacyEnabled(config: PrivacyConfig): boolean {
  return config.enabled !== false; // Default to true
}

/**
 * Normalize path for comparison (expand ~, resolve relative paths)
 */
export function normalizePath(path: string): string {
  if (path.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "~";
    return path.replace("~", home);
  }
  return path;
}

/**
 * Check if a path matches any of the patterns
 */
export function matchesPathPattern(path: string, patterns: string[]): boolean {
  const normalizedPath = normalizePath(path);
  
  for (const pattern of patterns) {
    const normalizedPattern = normalizePath(pattern);
    
    // Exact match
    if (normalizedPath === normalizedPattern) {
      return true;
    }
    
    // Prefix match (directory)
    if (normalizedPath.startsWith(normalizedPattern + "/") || 
        normalizedPath.startsWith(normalizedPattern + "\\")) {
      return true;
    }
    
    // Suffix match (file extension)
    if (pattern.startsWith("*") && normalizedPath.endsWith(pattern.slice(1))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extract paths from tool parameters
 */
export function extractPathsFromParams(params: Record<string, unknown>): string[] {
  const paths: string[] = [];
  
  // Common path parameter names
  const pathKeys = ["path", "file", "filepath", "filename", "dir", "directory", "target"];
  
  for (const key of pathKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
  }
  
  // Also check nested objects
  for (const value of Object.values(params)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...extractPathsFromParams(value as Record<string, unknown>));
    }
  }
  
  return paths;
}

/**
 * Sanitize sensitive information from text (basic redaction)
 */
export function redactSensitiveInfo(text: string): string {
  // Redact API keys
  let redacted = text.replace(/sk-[a-zA-Z0-9]{32,}/g, "sk-***");
  
  // Redact tokens
  redacted = redacted.replace(/token[:\s=]+[a-zA-Z0-9_-]{20,}/gi, "token=***");
  
  // Redact passwords (basic pattern)
  redacted = redacted.replace(/password[:\s=]+\S+/gi, "password=***");
  
  return redacted;
}
