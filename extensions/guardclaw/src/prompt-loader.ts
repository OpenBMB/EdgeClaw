/**
 * GuardClaw Prompt Loader
 *
 * Loads prompt templates from `extension/prompts/*.md` files at runtime.
 * Users can edit the markdown files to customize detection criteria,
 * guard agent behavior, and PII extraction — no code changes required.
 *
 * Falls back to hardcoded defaults if the file is missing or unreadable.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the prompts/ directory.
 * Works whether running from source (src/) or compiled output (dist/src/).
 */
function resolvePromptsDir(): string {
  const candidates = [
    resolve(__dirname, "../prompts"),     // from src/  → prompts/
    resolve(__dirname, "../../prompts"),  // from dist/src/ → prompts/
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]; // fallback, will trigger per-file fallback
}

const PROMPTS_DIR = resolvePromptsDir();

/** Cache loaded prompts in memory (loaded once, never re-read) */
const cache = new Map<string, string>();

/**
 * Load a prompt template from `prompts/{name}.md`.
 * Returns the file content if found, otherwise returns the fallback string.
 *
 * Results are cached — the file is read only once per process lifetime.
 */
export function loadPrompt(name: string, fallback: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const filePath = resolve(PROMPTS_DIR, `${name}.md`);
  let content: string;

  try {
    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf-8").trim();
      console.log(`[GuardClaw] Loaded custom prompt: prompts/${name}.md`);
    } else {
      content = fallback;
    }
  } catch {
    console.warn(`[GuardClaw] Failed to read prompts/${name}.md, using default`);
    content = fallback;
  }

  cache.set(name, content);
  return content;
}

/**
 * Load a prompt and replace `{{PLACEHOLDER}}` tokens with provided values.
 */
export function loadPromptWithVars(
  name: string,
  fallback: string,
  vars: Record<string, string>,
): string {
  let prompt = loadPrompt(name, fallback);
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt;
}

