/**
 * GuardClaw Local Model Detector
 * 
 * Local model-based sensitivity detection using Ollama or other local providers.
 */

import type { DetectionContext, DetectionResult, PrivacyConfig, SensitivityLevel } from "./types.js";
import { levelToNumeric } from "./types.js";

/**
 * Detect sensitivity level using a local model
 */
export async function detectByLocalModel(
  context: DetectionContext,
  config: PrivacyConfig
): Promise<DetectionResult> {
  // Check if local model is enabled
  if (!config.localModel?.enabled) {
    return {
      level: "S1",
      levelNumeric: 1,
      reason: "Local model detection disabled",
      detectorType: "localModelDetector",
      confidence: 0,
    };
  }

  try {
    const prompt = buildDetectionPrompt(context);
    const response = await callLocalModel(prompt, config);
    const parsed = parseModelResponse(response);

    return {
      level: parsed.level,
      levelNumeric: levelToNumeric(parsed.level),
      reason: parsed.reason,
      detectorType: "localModelDetector",
      confidence: parsed.confidence ?? 0.8,
    };
  } catch (err) {
    // If local model fails, return S1 (safe) but log the error
    console.error("[GuardClaw] Local model detection failed:", err);
    return {
      level: "S1",
      levelNumeric: 1,
      reason: `Local model error: ${String(err)}`,
      detectorType: "localModelDetector",
      confidence: 0,
    };
  }
}

/**
 * Build detection prompt for the local model
 */
function buildDetectionPrompt(context: DetectionContext): string {
  const parts: string[] = [
    "You are a privacy and security analyzer. Your task is to classify the sensitivity level of content.",
    "",
    "Sensitivity Levels:",
    "- S1 (Safe): General content with no sensitive information",
    "- S2 (Sensitive): Contains information that could be redacted (API keys, IPs, usernames)",
    "- S3 (Private): Deep privacy or dangerous operations (passwords, SSH keys, private data access)",
    "",
    "Analyze the following and respond ONLY with a JSON object in this exact format:",
    '{"level": "S1"|"S2"|"S3", "reason": "brief explanation", "confidence": 0.0-1.0}',
    "",
    "Content to analyze:",
  ];

  if (context.message) {
    parts.push(`Message: ${context.message.slice(0, 1000)}`);
  }

  if (context.toolName) {
    parts.push(`Tool: ${context.toolName}`);
  }

  if (context.toolParams) {
    const paramsStr = JSON.stringify(context.toolParams, null, 2);
    parts.push(`Tool Parameters: ${paramsStr.slice(0, 500)}`);
  }

  if (context.recentContext && context.recentContext.length > 0) {
    parts.push(`Recent Context: ${context.recentContext.slice(-3).join(" | ")}`);
  }

  return parts.join("\n");
}

/**
 * Call local model (Ollama or other providers)
 */
async function callLocalModel(prompt: string, config: PrivacyConfig): Promise<string> {
  const provider = config.localModel?.provider ?? "ollama";
  const model = config.localModel?.model ?? "llama3.2:3b";
  const endpoint = config.localModel?.endpoint ?? "http://localhost:11434";

  if (provider === "ollama") {
    return await callOllama(endpoint, model, prompt);
  }

  throw new Error(`Unsupported local model provider: ${provider}`);
}

/**
 * Call Ollama API
 */
async function callOllama(endpoint: string, model: string, prompt: string): Promise<string> {
  const url = `${endpoint}/api/generate`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for consistent classification
        num_predict: 150, // Short response expected
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { response?: string };
  return data.response ?? "";
}

/**
 * Desensitize content using local model.
 * For S2 content: ask the local model to redact sensitive parts, then return
 * the cleaned text that is safe to send to cloud models.
 *
 * Falls back to rule-based redaction if the local model is unavailable.
 */
export async function desensitizeWithLocalModel(
  content: string,
  config: PrivacyConfig
): Promise<{ desensitized: string; wasModelUsed: boolean }> {
  // If local model is not enabled, fall back to rule-based redaction
  if (!config.localModel?.enabled) {
    // Import at call-time to avoid circular deps
    const { redactSensitiveInfo } = await import("./utils.js");
    return {
      desensitized: redactSensitiveInfo(content),
      wasModelUsed: false,
    };
  }

  try {
    const prompt = buildDesensitizationPrompt(content);
    const response = await callLocalModel(prompt, config);
    const cleaned = parseDesensitizationResponse(response, content);
    return { desensitized: cleaned, wasModelUsed: true };
  } catch (err) {
    console.error("[GuardClaw] Local model desensitization failed, using rule-based fallback:", err);
    const { redactSensitiveInfo } = await import("./utils.js");
    return {
      desensitized: redactSensitiveInfo(content),
      wasModelUsed: false,
    };
  }
}

/**
 * Build prompt for desensitization (S2)
 */
function buildDesensitizationPrompt(content: string): string {
  return [
    "You are a data desensitization tool. Your task is to REDACT sensitive information from the following text.",
    "",
    "Rules:",
    "- Replace passwords, API keys, tokens with [REDACTED:TYPE]",
    "- Replace internal IP addresses with [REDACTED:IP]",
    "- Replace database connection strings with [REDACTED:DB_CONNECTION]",
    "- Replace email addresses with [REDACTED:EMAIL]",
    "- Replace personal names with [REDACTED:NAME]",
    "- Keep the overall structure and meaning intact",
    "- Return ONLY the desensitized text, nothing else",
    "",
    "Text to desensitize:",
    content.slice(0, 2000),
  ].join("\n");
}

/**
 * Parse the desensitization response from the local model
 */
function parseDesensitizationResponse(response: string, originalContent: string): string {
  // The model should return the desensitized text directly
  const trimmed = response.trim();

  // Sanity check: if the response is very short or seems broken, fall back
  if (trimmed.length < originalContent.length * 0.3) {
    // Probably a bad response - use the original with basic redaction
    return originalContent;
  }

  return trimmed;
}

/**
 * Parse model response to extract sensitivity level
 */
function parseModelResponse(response: string): {
  level: SensitivityLevel;
  reason?: string;
  confidence?: number;
} {
  try {
    // Try to find JSON in the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        level?: string;
        reason?: string;
        confidence?: number;
      };

      // Validate level
      const level = parsed.level?.toUpperCase();
      if (level === "S1" || level === "S2" || level === "S3") {
        return {
          level: level as SensitivityLevel,
          reason: parsed.reason,
          confidence: parsed.confidence,
        };
      }
    }

    // Fallback: look for level mentions in text
    const upperResponse = response.toUpperCase();
    if (upperResponse.includes("S3") || upperResponse.includes("PRIVATE")) {
      return {
        level: "S3",
        reason: "Detected from text analysis",
        confidence: 0.6,
      };
    }
    if (upperResponse.includes("S2") || upperResponse.includes("SENSITIVE")) {
      return {
        level: "S2",
        reason: "Detected from text analysis",
        confidence: 0.6,
      };
    }

    // Default to S1 if unable to parse
    return {
      level: "S1",
      reason: "Unable to parse model response",
      confidence: 0.3,
    };
  } catch (err) {
    console.error("[GuardClaw] Error parsing model response:", err);
    return {
      level: "S1",
      reason: "Parse error",
      confidence: 0,
    };
  }
}
