/**
 * GuardClaw Rules Detector
 * 
 * Rule-based sensitivity detection for keywords, tool types, and parameters.
 */

import type { DetectionContext, DetectionResult, PrivacyConfig, SensitivityLevel } from "./types.js";
import { levelToNumeric, maxLevel } from "./types.js";
import { extractPathsFromParams, matchesPathPattern } from "./utils.js";

/**
 * Detect sensitivity level based on configured rules
 */
export function detectByRules(
  context: DetectionContext,
  config: PrivacyConfig
): DetectionResult {
  const levels: SensitivityLevel[] = [];
  const reasons: string[] = [];

  // 1. Check keywords in message
  if (context.message) {
    const keywordResult = checkKeywords(context.message, config);
    if (keywordResult.level !== "S1") {
      levels.push(keywordResult.level);
      if (keywordResult.reason) {
        reasons.push(keywordResult.reason);
      }
    }
  }

  // 2. Check tool type and parameters
  if (context.toolName) {
    const toolResult = checkToolType(context.toolName, config);
    if (toolResult.level !== "S1") {
      levels.push(toolResult.level);
      if (toolResult.reason) {
        reasons.push(toolResult.reason);
      }
    }
  }

  // 3. Check tool parameters (paths, etc.)
  if (context.toolParams) {
    const paramResult = checkToolParams(context.toolParams, config);
    if (paramResult.level !== "S1") {
      levels.push(paramResult.level);
      if (paramResult.reason) {
        reasons.push(paramResult.reason);
      }
    }
  }

  // 4. Check tool result content
  if (context.toolResult) {
    const resultText = typeof context.toolResult === "string" 
      ? context.toolResult 
      : JSON.stringify(context.toolResult);
    const resultLevel = checkKeywords(resultText, config);
    if (resultLevel.level !== "S1") {
      levels.push(resultLevel.level);
      if (resultLevel.reason) {
        reasons.push(`Result: ${resultLevel.reason}`);
      }
    }
  }

  // Determine final level (max of all checks)
  const finalLevel = levels.length > 0 ? maxLevel(...levels) : "S1";
  const finalReason = reasons.length > 0 ? reasons.join("; ") : undefined;

  return {
    level: finalLevel,
    levelNumeric: levelToNumeric(finalLevel),
    reason: finalReason,
    detectorType: "ruleDetector",
    confidence: 1.0, // Rules have high confidence
  };
}

/**
 * Check for sensitive keywords in text
 */
function checkKeywords(
  text: string,
  config: PrivacyConfig
): { level: SensitivityLevel; reason?: string } {
  const lowerText = text.toLowerCase();

  // Check S3 keywords first (higher priority)
  const s3Keywords = config.rules?.keywords?.S3 ?? [];
  for (const keyword of s3Keywords) {
    const pattern = keyword.toLowerCase();
    if (lowerText.includes(pattern)) {
      return {
        level: "S3",
        reason: `S3 keyword detected: ${keyword}`,
      };
    }
  }

  // Check S2 keywords
  const s2Keywords = config.rules?.keywords?.S2 ?? [];
  for (const keyword of s2Keywords) {
    const pattern = keyword.toLowerCase();
    if (lowerText.includes(pattern)) {
      return {
        level: "S2",
        reason: `S2 keyword detected: ${keyword}`,
      };
    }
  }

  return { level: "S1" };
}

/**
 * Check tool type against configured sensitive tools
 */
function checkToolType(
  toolName: string,
  config: PrivacyConfig
): { level: SensitivityLevel; reason?: string } {
  const normalizedTool = toolName.toLowerCase();

  // Check S3 tools first (higher priority)
  const s3Tools = config.rules?.tools?.S3?.tools ?? [];
  for (const tool of s3Tools) {
    const pattern = tool.toLowerCase();
    if (normalizedTool === pattern || normalizedTool.includes(pattern)) {
      return {
        level: "S3",
        reason: `S3 tool detected: ${toolName}`,
      };
    }
  }

  // Check S2 tools
  const s2Tools = config.rules?.tools?.S2?.tools ?? [];
  for (const tool of s2Tools) {
    const pattern = tool.toLowerCase();
    if (normalizedTool === pattern || normalizedTool.includes(pattern)) {
      return {
        level: "S2",
        reason: `S2 tool detected: ${toolName}`,
      };
    }
  }

  return { level: "S1" };
}

/**
 * Check tool parameters for sensitive paths or values
 */
function checkToolParams(
  params: Record<string, unknown>,
  config: PrivacyConfig
): { level: SensitivityLevel; reason?: string } {
  const paths = extractPathsFromParams(params);

  if (paths.length === 0) {
    return { level: "S1" };
  }

  // Check S3 paths first (higher priority)
  const s3Paths = config.rules?.tools?.S3?.paths ?? [];
  for (const path of paths) {
    if (matchesPathPattern(path, s3Paths)) {
      return {
        level: "S3",
        reason: `S3 path detected: ${path}`,
      };
    }
  }

  // Check S2 paths
  const s2Paths = config.rules?.tools?.S2?.paths ?? [];
  for (const path of paths) {
    if (matchesPathPattern(path, s2Paths)) {
      return {
        level: "S2",
        reason: `S2 path detected: ${path}`,
      };
    }
  }

  // Check for common sensitive file extensions
  for (const path of paths) {
    const lowerPath = path.toLowerCase();
    if (
      lowerPath.endsWith(".pem") ||
      lowerPath.endsWith(".key") ||
      lowerPath.endsWith(".p12") ||
      lowerPath.endsWith(".pfx") ||
      lowerPath.includes("id_rsa") ||
      lowerPath.includes("id_dsa") ||
      lowerPath.includes("id_ecdsa") ||
      lowerPath.includes("id_ed25519")
    ) {
      return {
        level: "S3",
        reason: `Sensitive file extension detected: ${path}`,
      };
    }
  }

  return { level: "S1" };
}
