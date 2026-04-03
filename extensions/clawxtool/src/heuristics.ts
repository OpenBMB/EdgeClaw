import type { SecurityLevel } from "./bash-patterns.js";

export interface HeuristicResult {
  level: SecurityLevel;
  reason: string;
}

export function analyzeHeuristics(command: string): HeuristicResult[] {
  const results: HeuristicResult[] = [];

  // Pipe to shell execution
  if (/\|\s*(ba)?sh\b/.test(command) || /\|\s*zsh\b/.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Pipes output to shell interpreter (potential remote code execution)",
    });
  }

  // Download and execute
  if (/\b(curl|wget)\b.*\|\s*(ba)?sh\b/.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Downloads and executes remote script (curl/wget | sh pattern)",
    });
  }

  // Command substitution with dangerous potential
  if (/\$\(.*\b(curl|wget|nc)\b.*\)/.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Command substitution executing network command",
    });
  }

  // Backtick command substitution
  if (/`[^`]*\b(curl|wget|nc|rm|mkfs)\b[^`]*`/.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Backtick substitution with potentially dangerous command",
    });
  }

  // Redirect to sensitive system paths
  const sensitivePathRedirect = />\s*\/(?:etc|boot|usr\/(?:s?bin)|var\/(?:run|lock)|proc|sys)\//;
  if (sensitivePathRedirect.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Redirects output to sensitive system directory",
    });
  }

  // Writing to /tmp can be okay, but executing from /tmp is suspicious
  if (/\/tmp\/[^\s]+.*&&.*\/tmp\//.test(command) || /chmod\s+\+x\s+\/tmp\//.test(command)) {
    results.push({
      level: "needs_approval",
      reason: "Creates and potentially executes file in /tmp (common attack pattern)",
    });
  }

  // eval with variables
  if (/\beval\b/.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Uses eval (arbitrary code execution)",
    });
  }

  // base64 decode and execute
  if (/base64\s+(-d|--decode).*\|\s*(ba)?sh/.test(command)) {
    results.push({
      level: "dangerous",
      reason: "Decodes base64 and pipes to shell (obfuscated execution)",
    });
  }

  // Environment variable manipulation affecting security
  if (/\bexport\s+(PATH|LD_PRELOAD|LD_LIBRARY_PATH|PYTHONPATH)\s*=/.test(command)) {
    results.push({
      level: "needs_approval",
      reason: "Modifies security-sensitive environment variable",
    });
  }

  // sudo with command
  if (/\bsudo\b/.test(command)) {
    results.push({
      level: "needs_approval",
      reason: "Requires elevated privileges (sudo)",
    });
  }

  // Process/system information gathering (recon)
  if (/\bps\s+aux\b/.test(command) && /\|\s*grep\b/.test(command)) {
    // ps aux | grep is usually fine for debugging
  }

  // Crontab modification
  if (/\bcrontab\s+-[er]/.test(command)) {
    results.push({
      level: "needs_approval",
      reason: "Modifies scheduled tasks (crontab)",
    });
  }

  // History manipulation
  if (/\bhistory\s+-c\b/.test(command) || />\s*~\/\.bash_history/.test(command)) {
    results.push({
      level: "needs_approval",
      reason: "Clears or modifies shell history",
    });
  }

  // Chained commands with mixed intent
  const parts = command.split(/\s*(?:&&|\|\||;)\s*/);
  if (parts.length > 3) {
    results.push({
      level: "needs_approval",
      reason: `Long command chain (${parts.length} parts) — review each step`,
    });
  }

  return results;
}
