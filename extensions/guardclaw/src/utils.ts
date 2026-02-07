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
 * Sanitize sensitive information from text (comprehensive rule-based redaction).
 * Used for S2 desensitization: redact known patterns then forward to cloud.
 *
 * Two-phase approach:
 *   Phase 1 – Pattern-based: well-known formats (SSH keys, API keys, IPs, etc.)
 *   Phase 2 – Context-based: keyword + connecting words + value
 *             e.g. "password is in abc123" → "[REDACTED:PASSWORD]"
 */
export function redactSensitiveInfo(text: string): string {
  let redacted = text;

  // ── Phase 1: Pattern-based redaction ──────────────────────────────────────

  // Redact SSH private key blocks
  redacted = redacted.replace(
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    "[REDACTED:PRIVATE_KEY]"
  );

  // Redact API keys (sk-xxx, key-xxx patterns)
  redacted = redacted.replace(/\b(?:sk|key|token)-[A-Za-z0-9]{16,}\b/g, "[REDACTED:KEY]");

  // Redact AWS Access Key IDs
  redacted = redacted.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED:AWS_KEY]");

  // Redact database connection strings
  redacted = redacted.replace(
    /(?:mysql|postgres|postgresql|mongodb|redis|amqp):\/\/[^\s"']+/gi,
    "[REDACTED:DB_CONNECTION]"
  );

  // Redact internal IP addresses (10.x, 172.16-31.x, 192.168.x)
  redacted = redacted.replace(
    /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
    "[REDACTED:INTERNAL_IP]"
  );

  // Redact email addresses
  redacted = redacted.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED:EMAIL]");

  // Redact .env file content patterns (KEY=VALUE)
  redacted = redacted.replace(
    /^(?:export\s+)?[A-Z_]{2,}=(?:["'])?[^\s"']+(?:["'])?$/gm,
    "[REDACTED:ENV_VAR]"
  );

  // Redact credit card numbers (13-19 digits, optionally separated by hyphens/spaces)
  redacted = redacted.replace(
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g,
    "[REDACTED:CARD_NUMBER]"
  );

  // ── Phase 1b: Chinese PII pattern-based redaction ──────────────────────────
  // Chinese mobile phone numbers (13x-19x, 11 digits)
  redacted = redacted.replace(/\b1[3-9]\d{9}\b/g, "[REDACTED:PHONE]");

  // Chinese ID card numbers (18 digits or 17+X)
  redacted = redacted.replace(/\b\d{17}[\dXx]\b/g, "[REDACTED:ID]");

  // Chinese delivery tracking numbers (common carriers, 10-20 alphanumeric)
  redacted = redacted.replace(
    /(?:快递单号|运单号|取件码)[：:\s]*[A-Za-z0-9]{6,20}/g,
    "[REDACTED:DELIVERY]"
  );

  // Door access codes following keywords
  redacted = redacted.replace(
    /(?:门禁码|门禁密码|门锁密码|开门密码)[：:\s]*[A-Za-z0-9#*]{3,12}/g,
    "[REDACTED:ACCESS_CODE]"
  );

  // Chinese address patterns (省/市/区/路/号/弄/栋/幢/室)
  redacted = redacted.replace(
    /[\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|路|街|巷|弄|号|栋|幢|室|楼|单元|门牌)\d*[\u4e00-\u9fa5\d]*/g,
    "[REDACTED:ADDRESS]"
  );

  // ── Phase 2: Context-based redaction ──────────────────────────────────────
  // Match: <keyword> <connecting words> <actual value>
  // This catches patterns like "password is abc123", "credit card number is in 12896489bf"
  //
  // Two CONNECT modes:
  //   STRICT — requires a verb (is/are/was) or delimiter (=/:) before the value.
  //            Used for broad keywords like "credit card" to avoid false positives.
  //   LOOSE  — also accepts a plain space between keyword and value.
  //            Used for credential keywords like "password" where the next word is very
  //            likely the value.

  const STRICT_CONNECT = "(?:\\s+(?:is|are|was|were)(?:\\s+(?:in|at|on|of|for))*|\\s*[=:])\\s*";
  const LOOSE_CONNECT = "(?:\\s+(?:is|are|was|were)(?:\\s+(?:in|at|on|of|for))*\\s*|\\s*[=:]\\s*|\\s+)";

  const contextualRules: Array<{ pattern: RegExp; label: string }> = [
    {
      // password / passwd / pwd / passcode + value (LOOSE — next word is likely the value)
      pattern: new RegExp(`(?:password|passwd|pwd|passcode)${LOOSE_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "PASSWORD",
    },
    {
      // credit card / card number / card no + value (STRICT — avoid "credit card to buy")
      pattern: new RegExp(`(?:credit\\s*card|card\\s*(?:number|no\\.?))${STRICT_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "CARD",
    },
    {
      // api_key / apikey / api key / access key + value
      pattern: new RegExp(`(?:api[_\\s]?key|access[_\\s]?key|SECRET_KEY|API_KEY)${LOOSE_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "API_KEY",
    },
    {
      // secret + value (STRICT — "secret" is a common English word)
      pattern: new RegExp(`(?:secret)${STRICT_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "SECRET",
    },
    {
      // token / bearer / auth token + value
      pattern: new RegExp(`(?:(?:auth[_\\s]?)?token|bearer)${LOOSE_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "TOKEN",
    },
    {
      // credential / cred + value
      pattern: new RegExp(`(?:credential|cred)s?${LOOSE_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "CREDENTIAL",
    },
    {
      // ssn / social security number + value (STRICT)
      pattern: new RegExp(`(?:ssn|social\\s*security(?:\\s*(?:number|no\\.?))?)${STRICT_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "SSN",
    },
    {
      // pin / pin code / pin number + value
      pattern: new RegExp(`(?:pin(?:\\s*(?:code|number))?)${STRICT_CONNECT}["']?([^\\s"']{2,})["']?`, "gi"),
      label: "PIN",
    },
  ];

  for (const rule of contextualRules) {
    redacted = redacted.replace(rule.pattern, `[REDACTED:${rule.label}]`);
  }

  return redacted;
}

/**
 * Check if a path refers to protected memory/history directories that cloud models should not access.
 */
export function isProtectedMemoryPath(filePath: string, baseDir: string = "~/.openclaw"): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedBase = normalizePath(baseDir);

  // Patterns that cloud models must NOT read
  const protectedPaths = [
    `${normalizedBase}/agents/*/sessions/full`,
    `${normalizedBase}/*/MEMORY-FULL.md`,
    `${normalizedBase}/*/memory-full`,
  ];

  for (const pattern of protectedPaths) {
    // Convert glob-like pattern to regex
    const regexStr = pattern.replace(/\*/g, "[^/]+");
    const regex = new RegExp(`^${regexStr}`);
    if (regex.test(normalizedFile)) {
      return true;
    }
  }

  // Also check for direct "full" history paths
  if (
    normalizedFile.includes("/sessions/full/") ||
    normalizedFile.includes("/memory-full/") ||
    normalizedFile.endsWith("/MEMORY-FULL.md")
  ) {
    return true;
  }

  return false;
}
