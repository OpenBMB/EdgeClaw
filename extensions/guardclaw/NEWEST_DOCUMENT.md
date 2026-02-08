Let me start by exploring the project structure and reading the actual code files.

[18 tools called]

Now let me read the remaining files.

[13 tools called]

Good, I've now read all code files. Let me also check if there's a `memory/` directory with today's notes, and then compile the full document.

[2 tools called]

Let me re-read all the source files to get their complete content for the document.

[12 tools called]

Now I have all the code. Let me also read the config files to complete the picture.

[3 tools called]

Now I have every code file. Let me write the comprehensive document.

[1 tool called]

Here's the comprehensive code-only document of **GuardClaw**:

---

# GuardClaw — Complete Code Document

## Project Structure

```
openclaw/extensions/guardclaw/
├── index.ts                    — Plugin entry point
├── package.json                — NPM package manifest
├── openclaw.plugin.json        — OpenClaw plugin manifest
├── config.example.json         — Example configuration
├── tsconfig.json               — TypeScript config
├── src/
│   ├── types.ts                — Core type definitions
│   ├── config-schema.ts        — TypeBox config schema + defaults
│   ├── detector.ts             — Detection engine (orchestrator)
│   ├── rules.ts                — Rule-based detection (keywords, patterns, tools, paths)
│   ├── local-model.ts          — Local LLM detection + PII extraction + desensitization
│   ├── hooks.ts                — Plugin hooks (main orchestration layer)
│   ├── guard-agent.ts          — Guard agent config/routing utilities
│   ├── session-state.ts        — In-memory per-session privacy state
│   ├── session-manager.ts      — Dual session history (full vs clean)
│   ├── memory-isolation.ts     — Dual memory directories (MEMORY-FULL.md vs MEMORY.md)
│   └── utils.ts                — Path utilities, PII redaction, protected path checks
└── test/
    ├── detector.test.ts        — Detector core tests
    ├── rules.test.ts           — Rules detector tests
    ├── session-manager.test.ts — Dual session manager tests
    └── integration.test.ts     — End-to-end integration tests
```

---

## 1. Entry Point — `index.ts`

```1:18:openclaw/extensions/guardclaw/index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { guardClawConfigSchema } from "./src/config-schema.js";
import { registerHooks } from "./src/hooks.js";

const plugin = {
  id: "guardclaw",
  name: "GuardClaw",
  description: "Privacy-aware plugin with sensitivity detection and guard agent support",
  version: "2026.2.4",
  configSchema: guardClawConfigSchema,
  register(api: OpenClawPluginApi) {
    api.logger.info("[GuardClaw] Registering hooks...");
    registerHooks(api);
    api.logger.info("[GuardClaw] Plugin initialized");
  },
};

export default plugin;
```

Registers with OpenClaw's plugin system. The `register()` method calls `registerHooks(api)` to wire up all 6 event hooks.

---

## 2. Core Types — `src/types.ts`

```1:121:openclaw/extensions/guardclaw/src/types.ts
/**
 * GuardClaw Types
 * 
 * Core type definitions for the GuardClaw plugin.
 */

export type SensitivityLevel = "S1" | "S2" | "S3";

export type SensitivityLevelNumeric = 1 | 2 | 3;

export type DetectorType = "ruleDetector" | "localModelDetector";

export type Checkpoint = "onUserMessage" | "onToolCallProposed" | "onToolCallExecuted";

export type PrivacyConfig = {
  enabled?: boolean;
  checkpoints?: {
    onUserMessage?: DetectorType[];
    onToolCallProposed?: DetectorType[];
    onToolCallExecuted?: DetectorType[];
  };
  rules?: {
    keywords?: {
      S2?: string[];
      S3?: string[];
    };
    /** Regex patterns for matching sensitive content (strings are compiled to RegExp) */
    patterns?: {
      S2?: string[];
      S3?: string[];
    };
    tools?: {
      S2?: {
        tools?: string[];
        paths?: string[];
      };
      S3?: {
        tools?: string[];
        paths?: string[];
      };
    };
  };
  localModel?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    endpoint?: string;
  };
  guardAgent?: {
    id?: string;
    workspace?: string;
    model?: string;
  };
  session?: {
    isolateGuardHistory?: boolean;
    /** Base directory for session histories (default: ~/.openclaw) */
    baseDir?: string;
  };
};

export type DetectionContext = {
  checkpoint: Checkpoint;
  message?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  sessionKey?: string;
  agentId?: string;
  recentContext?: string[];
  /** Pre-read file content for file-reference messages (used for classification) */
  fileContentSnippet?: string;
};

export type DetectionResult = {
  level: SensitivityLevel;
  levelNumeric: SensitivityLevelNumeric;
  reason?: string;
  detectorType: DetectorType;
  confidence?: number;
};

export type SessionPrivacyState = {
  sessionKey: string;
  isPrivate: boolean;
  highestLevel: SensitivityLevel;
  detectionHistory: Array<{
    timestamp: number;
    level: SensitivityLevel;
    checkpoint: Checkpoint;
    reason?: string;
  }>;
};

export function levelToNumeric(level: SensitivityLevel): SensitivityLevelNumeric {
  switch (level) {
    case "S1":
      return 1;
    case "S2":
      return 2;
    case "S3":
      return 3;
  }
}

export function numericToLevel(numeric: SensitivityLevelNumeric): SensitivityLevel {
  switch (numeric) {
    case 1:
      return "S1";
    case 2:
      return "S2";
    case 3:
      return "S3";
  }
}

export function maxLevel(...levels: SensitivityLevel[]): SensitivityLevel {
  const numeric = levels.map(levelToNumeric);
  const max = Math.max(...numeric) as SensitivityLevelNumeric;
  return numericToLevel(max);
}
```

**Key design:**
- **S1** = Safe (no intervention, cloud model)
- **S2** = Sensitive (desensitize PII, then forward to cloud)
- **S3** = Private (redirect entirely to local-only guard model)
- Three checkpoints: `onUserMessage`, `onToolCallProposed`, `onToolCallExecuted`
- Two detector types: `ruleDetector` (fast, deterministic) and `localModelDetector` (LLM-based)

---

## 3. Config Schema — `src/config-schema.ts`

```1:132:openclaw/extensions/guardclaw/src/config-schema.ts
/**
 * GuardClaw Config Schema
 * 
 * Configuration schema for the GuardClaw plugin using TypeBox.
 */

import { Type } from "@sinclair/typebox";

export const guardClawConfigSchema = Type.Object({
  privacy: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      checkpoints: Type.Optional(
        Type.Object({
          onUserMessage: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")])
            )
          ),
          onToolCallProposed: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")])
            )
          ),
          onToolCallExecuted: Type.Optional(
            Type.Array(
              Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")])
            )
          ),
        })
      ),
      rules: Type.Optional(
        Type.Object({
          keywords: Type.Optional(
            Type.Object({
              S2: Type.Optional(Type.Array(Type.String())),
              S3: Type.Optional(Type.Array(Type.String())),
            })
          ),
          patterns: Type.Optional(
            Type.Object({
              S2: Type.Optional(Type.Array(Type.String())),
              S3: Type.Optional(Type.Array(Type.String())),
            })
          ),
          tools: Type.Optional(
            Type.Object({
              S2: Type.Optional(
                Type.Object({
                  tools: Type.Optional(Type.Array(Type.String())),
                  paths: Type.Optional(Type.Array(Type.String())),
                })
              ),
              S3: Type.Optional(
                Type.Object({
                  tools: Type.Optional(Type.Array(Type.String())),
                  paths: Type.Optional(Type.Array(Type.String())),
                })
              ),
            })
          ),
        })
      ),
      localModel: Type.Optional(
        Type.Object({
          enabled: Type.Optional(Type.Boolean()),
          provider: Type.Optional(Type.String()),
          model: Type.Optional(Type.String()),
          endpoint: Type.Optional(Type.String()),
        })
      ),
      guardAgent: Type.Optional(
        Type.Object({
          id: Type.Optional(Type.String()),
          workspace: Type.Optional(Type.String()),
          model: Type.Optional(Type.String()),
        })
      ),
      session: Type.Optional(
        Type.Object({
          isolateGuardHistory: Type.Optional(Type.Boolean()),
          baseDir: Type.Optional(Type.String()),
        })
      ),
    })
  ),
});

/**
 * Default configuration values.
 *
 * Detection relies entirely on the local LLM judge (localModelDetector).
 * Rule-based detection is kept as an optional fallback but NOT enabled by default.
 */
export const defaultPrivacyConfig = {
  enabled: true,
  checkpoints: {
    onUserMessage: ["localModelDetector" as const],
    onToolCallProposed: ["localModelDetector" as const],
    onToolCallExecuted: ["localModelDetector" as const],
  },
  rules: {
    keywords: {
      S2: [] as string[],
      S3: [] as string[],
    },
    patterns: {
      S2: [] as string[],
      S3: [] as string[],
    },
    tools: {
      S2: { tools: [] as string[], paths: [] as string[] },
      S3: { tools: [] as string[], paths: [] as string[] },
    },
  },
  localModel: {
    enabled: true,
    provider: "ollama",
    model: "openbmb/minicpm4.1",
    endpoint: "http://localhost:11434",
  },
  guardAgent: {
    id: "guard",
    workspace: "~/.openclaw/workspace-guard",
    model: "ollama/openbmb/minicpm4.1",
  },
  session: {
    isolateGuardHistory: true,
    baseDir: "~/.openclaw",
  },
};
```

**Key defaults:** LLM-based detection (MiniCPM4.1 via Ollama) is the primary detector. Rule-based detection has empty keyword/pattern lists by default — users opt into rules via config.

---

## 4. Detection Engine — `src/detector.ts`

```1:221:openclaw/extensions/guardclaw/src/detector.ts
/**
 * GuardClaw Detector Core
 * 
 * Main sensitivity detection engine that coordinates rule-based and model-based detection.
 */

import type { 
  Checkpoint, 
  DetectionContext, 
  DetectionResult, 
  DetectorType, 
  PrivacyConfig, 
  SensitivityLevel 
} from "./types.js";
import { maxLevel } from "./types.js";
import { detectByRules } from "./rules.js";
import { detectByLocalModel } from "./local-model.js";
import { defaultPrivacyConfig } from "./config-schema.js";

/**
 * Main detection function that coordinates all detectors
 */
export async function detectSensitivityLevel(
  context: DetectionContext,
  pluginConfig: Record<string, unknown>
): Promise<DetectionResult> {
  const privacyConfig = mergeWithDefaults(
    (pluginConfig?.privacy as PrivacyConfig) ?? {},
    defaultPrivacyConfig
  );

  // Check if privacy is enabled
  if (privacyConfig.enabled === false) {
    return {
      level: "S1",
      levelNumeric: 1,
      reason: "Privacy detection disabled",
      detectorType: "ruleDetector",
      confidence: 1.0,
    };
  }

  // Get detectors for this checkpoint
  const detectors = getDetectorsForCheckpoint(context.checkpoint, privacyConfig);

  if (detectors.length === 0) {
    return {
      level: "S1",
      levelNumeric: 1,
      reason: "No detectors configured",
      detectorType: "ruleDetector",
      confidence: 1.0,
    };
  }

  // Run all configured detectors
  const results = await runDetectors(detectors, context, privacyConfig);

  // Merge results (take maximum level)
  return mergeDetectionResults(results);
}

// ... getDetectorsForCheckpoint, runDetectors, mergeDetectionResults, mergeWithDefaults
```

**Flow:**
1. Merge user config with defaults
2. Check if privacy is enabled
3. Look up which detectors are configured for the current checkpoint
4. Run all detectors (rule + LLM, in sequence; errors don't stop other detectors)
5. Merge results: take the **maximum** sensitivity level, combine reasons, average confidence

---

## 5. Rule-Based Detection — `src/rules.ts`

```1:278:openclaw/extensions/guardclaw/src/rules.ts
/**
 * GuardClaw Rules Detector
 * 
 * Rule-based sensitivity detection for keywords, regex patterns, tool types, and parameters.
 */

import type { DetectionContext, DetectionResult, PrivacyConfig, SensitivityLevel } from "./types.js";
import { levelToNumeric, maxLevel } from "./types.js";
import { extractPathsFromParams, matchesPathPattern } from "./utils.js";

/** Cache compiled regex patterns to avoid re-compilation on every call */
const patternCache = new Map<string, RegExp>();

function getOrCompileRegex(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern);
  if (cached) return cached;
  try {
    const compiled = new RegExp(pattern, "i");
    patternCache.set(pattern, compiled);
    return compiled;
  } catch {
    console.warn(`[GuardClaw] Invalid regex pattern: ${pattern}`);
    return null;
  }
}

export function detectByRules(
  context: DetectionContext,
  config: PrivacyConfig
): DetectionResult {
  const levels: SensitivityLevel[] = [];
  const reasons: string[] = [];

  // 1. Check keywords in message
  // 2. Check regex patterns in message
  // 3. Check tool type against S2/S3 tool lists
  // 4. Check tool parameters (paths)
  // 5. Check tool result content (keywords + patterns)
  // ... each adds to levels[] and reasons[]

  const finalLevel = levels.length > 0 ? maxLevel(...levels) : "S1";
  return {
    level: finalLevel,
    levelNumeric: levelToNumeric(finalLevel),
    reason: reasons.join("; "),
    detectorType: "ruleDetector",
    confidence: 1.0,
  };
}
```

**Detection layers (all run, highest wins):**
1. **Keywords** — case-insensitive substring match against S2/S3 keyword lists
2. **Regex patterns** — compiled and cached `RegExp` against S2/S3 patterns
3. **Tool type** — tool name matched against S2/S3 tool blacklists
4. **Tool parameters** — path values extracted and matched against S2/S3 path patterns; also checks sensitive file extensions (`.pem`, `.key`, `id_rsa`, etc.)
5. **Tool results** — keywords and patterns checked in tool output text

---

## 6. Local Model Detection + Desensitization — `src/local-model.ts`

```1:612:openclaw/extensions/guardclaw/src/local-model.ts
/**
 * GuardClaw Local Model Detector
 * 
 * Local model-based sensitivity detection using Ollama or other local providers.
 */

import type { DetectionContext, DetectionResult, PrivacyConfig, SensitivityLevel } from "./types.js";
import { levelToNumeric } from "./types.js";

export async function detectByLocalModel(
  context: DetectionContext,
  config: PrivacyConfig
): Promise<DetectionResult> {
  if (!config.localModel?.enabled) {
    return { level: "S1", levelNumeric: 1, reason: "Local model detection disabled", detectorType: "localModelDetector", confidence: 0 };
  }
  try {
    const prompt = buildDetectionPrompt(context);
    const response = await callLocalModel(prompt, config);
    const parsed = parseModelResponse(response);
    let { level } = parsed;

    // Safety net: if LLM says S1 but file content has obvious PII → bump to S2+
    if (level === "S1" && context.fileContentSnippet) {
      const piiLevel = quickPiiScan(context.fileContentSnippet);
      if (piiLevel !== "S1") {
        level = piiLevel;
        parsed.reason = `${parsed.reason ?? ""}; file content contains PII (auto-bumped to ${piiLevel})`;
      }
    }
    return { level, levelNumeric: levelToNumeric(level), reason: parsed.reason, detectorType: "localModelDetector", confidence: parsed.confidence ?? 0.8 };
  } catch (err) {
    return { level: "S1", levelNumeric: 1, reason: `Local model error: ${String(err)}`, detectorType: "localModelDetector", confidence: 0 };
  }
}
```

**Key components:**

- `buildDetectionPrompt()` — Bilingual (EN+CN) system prompt for the privacy classifier. Outputs JSON `{"level":"S1|S2|S3","reason":"..."}`. Tuned for MiniCPM4.1 8B.
- `callOllama()` — `/api/generate` with `temperature: 0.1`, strips `<think>...</think>` blocks for reasoning models (MiniCPM, Qwen3).
- `quickPiiScan()` — Regex safety net for file content. If the LLM misclassifies as S1 but the file has PII patterns (phones, SSN, addresses, passwords), bumps to S2/S3.
- `desensitizeWithLocalModel()` — **Two-step PII redaction:**
  1. `extractPiiWithModel()` — completion-style prompt: model outputs JSON array of `{type, value}` PII items
  2. Programmatic `replaceAll()` — sorted by value length (longest first), replaces with `[REDACTED:TYPE]` tags
- `mapPiiTypeToTag()` — Maps 30+ PII type names to normalized `[REDACTED:...]` tags
- `callLocalModelDirect()` — Direct Ollama call for S3 guard responses, with `repeat_penalty: 1.3` and stop sequences to prevent degenerate output
- `callOllamaChat()` — Chat API wrapper with system/user message separation

---

## 7. Hooks (Main Orchestration) — `src/hooks.ts`

This is the heart of the plugin — 792 lines registering 6 hooks:

```46:56:openclaw/extensions/guardclaw/src/hooks.ts
const GUARD_AGENT_SYSTEM_PROMPT = `You are a privacy-aware analyst. Analyze the data the user provides. Do your job.

RULES:
1. Analyze the data directly. Do NOT write code. Do NOT generate programming examples or tutorials.
2. NEVER echo raw sensitive values (exact salary, SSN, bank account, password). Use generic references like "your base salary", "the SSN on file", etc.
3. You MAY discuss percentages, ratios, whether deductions are correct, anomalies, and recommendations.
4. Reply ONCE, then stop. No [message_id:] tags. No multi-turn simulation.
5. **Language rule: Reply in the SAME language the user writes in.** If the user writes in Chinese, reply entirely in Chinese. If the user writes in English, reply entirely in English.
6. Be concise and professional.

语言规则：必须使用与用户相同的语言回复。如果用户用中文提问，你必须用中文回答。`;
```

### Hook 1: `message_received` (lines 71–129)
- Runs `detectSensitivityLevel()` at checkpoint `onUserMessage`
- Records detection, persists to dual session history
- Marks session state as private for S2/S3

### Hook 2: `before_tool_call` (lines 137–223)
- **File-access guard:** blocks cloud models from reading protected paths (`sessions/full/`, `MEMORY-FULL.md`, `memory-full/`)
- **Pre-read file guard:** blocks redundant tool reads for files already desensitized in the S2 flow
- Runs detection at `onToolCallProposed`
- **S3 → BLOCKS** the tool call entirely (returns `block: true`)
- **S2 → allows** but marks session

### Hook 3: `after_tool_call` (lines 228–272)
- Runs detection on tool results at `onToolCallExecuted`
- Upgrades session state if S2/S3 content found in results

### Hook 4: `tool_result_persist` (lines 277–304)
- For private sessions: writes tool results to the dual history (fire-and-forget)

### Hook 5: `session_end` (lines 309–329)
- Syncs `MEMORY-FULL.md` → `MEMORY.md` (filters guard agent content)

### Hook 6: `resolve_model` (lines 338–573) — **The core routing logic**

```420:488:openclaw/extensions/guardclaw/src/hooks.ts
      // ── S3: call local model directly with pre-read file content ──
      if (result.level === "S3") {
        // ... get guard config, mark private, emit UI event ...
        // Build user prompt with embedded file content if available
        // Call callLocalModelDirect() with GUARD_AGENT_SYSTEM_PROMPT
        // Return directResponse wrapped in 🔒 prefix
        return {
          reason: `GuardClaw: S3 — processed locally by ${guardModelName}`,
          provider: guardProvider,
          model: guardModelName,
          directResponse: `🔒 [Processed locally by privacy guard]\n\n${directReply}`,
        };
      }

      // ── S2: desensitize content, then forward to cloud model ──
      if (result.level === "S2") {
        // ... mark private ...
        // If file referenced: desensitize FILE content, keep request intact
        // If inline PII: desensitize the message directly
        // Persist ORIGINAL to full history
        // Emit privacy_activated event
        // Return userPromptOverride with desensitized content
        return {
          reason: `GuardClaw: S2 — content desensitized before cloud delivery`,
          userPromptOverride: desensitizedPrompt,
        };
      }
      // ── S1: no intervention ──
```

**Additional helpers in hooks.ts:**
- `tryReadReferencedFile()` — Pre-reads files referenced in messages (supports `.xlsx` via `xlsx2csv`/`openpyxl`, `.docx` via `python-docx`, and plain text)
- `extractPathValuesFromParams()` — Recursively extracts path-like values from tool params
- `extractMessageText()` — Polymorphic message text extraction (string, or object with `.text`/`.content`/`.body`)

---

## 8. Guard Agent Utilities — `src/guard-agent.ts`

```1:108:openclaw/extensions/guardclaw/src/guard-agent.ts
/**
 * GuardClaw Guard Agent Management
 * 
 * Manages guard agent configuration and session routing for S3 (private) operations.
 */

import type { PrivacyConfig, SensitivityLevel } from "./types.js";

export function isGuardAgentConfigured(config: PrivacyConfig): boolean {
  return Boolean(config.guardAgent?.id && config.guardAgent?.model && config.guardAgent?.workspace);
}

export function getGuardAgentConfig(config: PrivacyConfig): {
  id: string; model: string; workspace: string; provider: string; modelName: string;
} | null {
  // Splits "ollama/openbmb/minicpm4.1" → provider="ollama", modelName="openbmb/minicpm4.1"
  // Uses first slash only — model names can contain slashes
}

export function generateGuardSessionKey(parentSessionKey: string): string {
  return `${parentSessionKey}:guard`;  // stable key for history accumulation
}

export function isGuardSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(":guard") || sessionKey.includes(":guard:");
}

export function getParentSessionKey(guardSessionKey: string): string | null { /* ... */ }

export function buildMainSessionPlaceholder(level: SensitivityLevel, reason?: string): string {
  // Returns: "🔒 [Private message — processed locally (reason)]"
  // or:      "🔑 [Sensitive message — processed locally (reason)]"
}

export function isLocalProvider(provider: string): boolean {
  const localProviders = ["ollama", "llama.cpp", "localai", "llamafile", "lmstudio"];
  return localProviders.includes(provider.toLowerCase());
}
```

---

## 9. Session State — `src/session-state.ts`

```1:168:openclaw/extensions/guardclaw/src/session-state.ts
/**
 * GuardClaw Session State Management
 * Tracks privacy state for each session.
 */
import type { Checkpoint, SensitivityLevel, SessionPrivacyState } from "./types.js";

const sessionStates = new Map<string, SessionPrivacyState>();

export function markSessionAsPrivate(sessionKey: string, level: SensitivityLevel): void {
  // Once private, always private (never downgrades)
  // Tracks highest level across all detections
}

export function isSessionMarkedPrivate(sessionKey: string): boolean { /* ... */ }
export function getSessionHighestLevel(sessionKey: string): SensitivityLevel { /* ... */ }

export function recordDetection(sessionKey: string, level: SensitivityLevel, checkpoint: Checkpoint, reason?: string): void {
  // Appends to detectionHistory, capped at 50 entries
}

export function clearSessionState(sessionKey: string): void { /* ... */ }
export function resetSessionPrivacy(sessionKey: string): boolean {
  // Resets to S1, clears history, also clears guard subsession
}

// ── Pre-read file tracking ──
const preReadFiles = new Map<string, Set<string>>();

export function markPreReadFiles(sessionKey: string, message: string): void {
  // Extracts file paths from message via regex, stores in preReadFiles set
}

export function isFilePreRead(sessionKey: string, filePath: string): boolean {
  // Checks if filePath matches any pre-read file (suffix match)
}
```

**Key invariant:** Once a session reaches S2 or S3, it **never downgrades** back to S1. The `resetSessionPrivacy()` function exists but must be explicitly called.

---

## 10. Dual Session Manager — `src/session-manager.ts`

```1:246:openclaw/extensions/guardclaw/src/session-manager.ts
/**
 * GuardClaw Session Manager
 * Manages dual session histories (full vs clean) for privacy isolation.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isGuardSessionKey } from "./guard-agent.js";

export type SessionMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  sessionKey?: string;
};

export class DualSessionManager {
  // baseDir defaults to ~/.openclaw
  
  async persistMessage(sessionKey, message, agentId): Promise<void> {
    // ALWAYS writes to full history
    // Writes to clean history ONLY if not a guard agent message
  }

  async loadHistory(sessionKey, isCloudModel, agentId, limit?): Promise<SessionMessage[]> {
    // Cloud models → clean history
    // Local models → full history
  }

  private isGuardAgentMessage(message: SessionMessage): boolean {
    // Checks: sessionKey contains ":guard", or content contains "[Guard Agent]"
  }

  // Storage: JSONL files at ~/.openclaw/agents/{agentId}/sessions/{full|clean}/{sessionKey}.jsonl
}
```

**Dual history structure:**
```
~/.openclaw/agents/main/sessions/
  ├── full/       ← everything (for local models + audit)
  │   └── session-abc.jsonl
  └── clean/      ← guard content stripped (for cloud models)
      └── session-abc.jsonl
```

---

## 11. Memory Isolation — `src/memory-isolation.ts`

```1:254:openclaw/extensions/guardclaw/src/memory-isolation.ts
/**
 * GuardClaw Memory Isolation
 * Manages dual memory directories for privacy isolation.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export class MemoryIsolationManager {
  getMemoryDir(isCloudModel: boolean): string {
    // Cloud → "memory", Local → "memory-full"
  }

  getMemoryFilePath(isCloudModel: boolean): string {
    // Cloud → MEMORY.md, Local → MEMORY-FULL.md
  }

  async writeMemory(content, isCloudModel, options?): Promise<void> { /* ... */ }
  async readMemory(isCloudModel, options?): Promise<string> { /* ... */ }

  async syncMemoryToClean(): Promise<void> {
    // Reads MEMORY-FULL.md → filters guard content → writes MEMORY.md
  }

  private filterGuardContent(content: string): string {
    // Strips lines/sections containing "[Guard Agent]", "guard:", "private context:"
  }

  async initializeDirectories(): Promise<void> {
    // Creates both memory/ and memory-full/ directories
  }
}
```

---

## 12. Utilities — `src/utils.ts`

```1:265:openclaw/extensions/guardclaw/src/utils.ts
/**
 * GuardClaw Utilities
 */
import type { PrivacyConfig } from "./types.js";

export function normalizePath(path: string): string {
  // Expands ~/... to $HOME/...
}

export function matchesPathPattern(path: string, patterns: string[]): boolean {
  // Exact match, prefix match (directory), or wildcard suffix match
}

export function extractPathsFromParams(params: Record<string, unknown>): string[] {
  // Extracts values from keys: path, file, filepath, filename, dir, directory, target
  // Recurses into nested objects
}

export function redactSensitiveInfo(text: string): string {
  // Phase 1: Pattern-based — SSH keys, API keys (sk-xxx), AWS keys (AKIA...),
  //          DB connection strings, internal IPs, emails, .env vars, credit cards,
  //          CN mobile phones, CN ID cards, delivery numbers, door codes, CN addresses
  // Phase 2: Context-based — keyword + connecting words + value
  //          e.g. "password is abc123" → "[REDACTED:PASSWORD]"
  //          Uses STRICT connect (requires verb/delimiter) for broad keywords like "credit card"
  //          Uses LOOSE connect (accepts plain space) for credential keywords like "password"
}

export function isProtectedMemoryPath(filePath: string, baseDir: string): boolean {
  // Blocks: */sessions/full/*, */MEMORY-FULL.md, */memory-full/*
  // Also checks for direct substring: /sessions/full/, /memory-full/, /MEMORY-FULL.md
}
```

---

## 13. Test Suite

### `test/detector.test.ts` — Core detector tests
- S3 from message keywords, S2 from tool type, S1 for safe content
- Config: disabled privacy → S1, minimal config → defaults

### `test/rules.test.ts` — Rule detector tests
- Keyword detection: S3 (`id_rsa`), S2 (`api_key`), S1 (safe), case-insensitive
- Tool type detection: S3 (`system.run`), S2 (`exec`), S1 (`read_file`)
- Path detection: S3 (`~/.ssh/id_rsa`), S2 (`~/secrets/...`), sensitive extensions (`.pem`)
- Result merging: multiple issues → highest level wins

### `test/session-manager.test.ts` — Dual session history tests
- Normal messages → written to both full + clean
- Guard agent messages → written to full only (excluded from clean)
- Cloud models load clean history, local models load full history
- Limit parameter, stats, clear

### `test/integration.test.ts` — End-to-end flow tests
- Detect S3 → mark private → record detection → verify state
- Multiple detections → highest level maintained
- Full hook chain simulation: message → tool call → tool result (S2 → S3 escalation)
- Edge cases: disabled config, empty config, missing fields, very long messages

---

## 14. Configuration Files

### `package.json`
```json
{
  "name": "@openclaw/guardclaw",
  "version": "2026.2.4",
  "type": "module",
  "openclaw": { "extensions": ["./index.ts"] }
}
```

### `tsconfig.json`
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "rootDir": ".", "outDir": "./dist" },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### `config.example.json` — Shows rule-based config with:
- S2 keywords: `password`, `api_key`, `secret`, `token`, `credential`, `auth_token`
- S3 keywords: `ssh`, `id_rsa`, `private_key`, `.pem`, `.key`, `.env`, `master_password`
- S2 tools: `exec`, `shell` | S3 tools: `system.run`, `sudo`
- S3 paths: `~/.ssh`, `/etc`, `~/.aws`, `~/.config/credentials`, `/root`
- Guard agent: `ollama/llama3.2:3b` in `~/.openclaw/workspace-guard`

---

## Architecture Summary

```
User Message
     │
     ▼
┌─────────────────────────────────┐
│  resolve_model hook             │
│  1. Pre-read referenced files   │
│  2. detectSensitivityLevel()    │
│     ├─ ruleDetector             │
│     └─ localModelDetector       │
│  3. Route by level:             │
│     S1 → pass-through (cloud)   │
│     S2 → desensitize → cloud    │
│     S3 → local model direct     │
└─────────────────────────────────┘
     │               │
     ▼               ▼
  Cloud Model    Local Guard
  (clean hist)   (full hist)
     │               │
     ▼               ▼
  MEMORY.md      MEMORY-FULL.md
  memory/        memory-full/
  sessions/clean sessions/full
```

**Data never sent to cloud:** S3 content, guard agent messages, full session history, `MEMORY-FULL.md`, `memory-full/` directory.

[1 tool called]

Here's the complete code-only document of GuardClaw — every source file analyzed, no Markdown docs included.

---

# GuardClaw — Complete Code Document

**Version:** 2026.2.4  
**Package:** `@openclaw/guardclaw`  
**Type:** OpenClaw privacy-aware plugin

---

## File Structure

```
openclaw/extensions/guardclaw/
├── index.ts                    ← Plugin entry point
├── package.json                ← Package manifest
├── openclaw.plugin.json        ← Plugin metadata + config schema
├── tsconfig.json               ← TypeScript config
├── config.example.json         ← Example config with rule-based setup
├── src/
│   ├── types.ts                ← Core type definitions
│   ├── config-schema.ts        ← TypeBox schema + defaults
│   ├── detector.ts             ← Detection engine (coordinator)
│   ├── rules.ts                ← Rule-based detector
│   ├── local-model.ts          ← Local LLM detector + desensitizer
│   ├── hooks.ts                ← All hook registrations (main logic)
│   ├── guard-agent.ts          ← Guard agent utilities
│   ├── session-state.ts        ← In-memory session privacy tracking
│   ├── session-manager.ts      ← Dual session history (full/clean)
│   ├── memory-isolation.ts     ← Dual memory directories
│   └── utils.ts                ← Path matching, PII redaction
└── test/
    ├── detector.test.ts        ← Detector core tests
    ├── rules.test.ts           ← Rule detector tests
    ├── session-manager.test.ts ← Dual history tests
    └── integration.test.ts     ← End-to-end flow tests
```

---

## 1. Plugin Entry — `index.ts`

```1:18:openclaw/extensions/guardclaw/index.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { guardClawConfigSchema } from "./src/config-schema.js";
import { registerHooks } from "./src/hooks.js";

const plugin = {
  id: "guardclaw",
  name: "GuardClaw",
  description: "Privacy-aware plugin with sensitivity detection and guard agent support",
  version: "2026.2.4",
  configSchema: guardClawConfigSchema,
  register(api: OpenClawPluginApi) {
    api.logger.info("[GuardClaw] Registering hooks...");
    registerHooks(api);
    api.logger.info("[GuardClaw] Plugin initialized");
  },
};

export default plugin;
```

Simple entry point: declares plugin metadata, provides a TypeBox config schema, and delegates all behavior to `registerHooks(api)`.

---

## 2. Core Types — `src/types.ts`

```1:121:openclaw/extensions/guardclaw/src/types.ts
/**
 * GuardClaw Types
 * 
 * Core type definitions for the GuardClaw plugin.
 */

export type SensitivityLevel = "S1" | "S2" | "S3";

export type SensitivityLevelNumeric = 1 | 2 | 3;

export type DetectorType = "ruleDetector" | "localModelDetector";

export type Checkpoint = "onUserMessage" | "onToolCallProposed" | "onToolCallExecuted";

export type PrivacyConfig = {
  enabled?: boolean;
  checkpoints?: {
    onUserMessage?: DetectorType[];
    onToolCallProposed?: DetectorType[];
    onToolCallExecuted?: DetectorType[];
  };
  rules?: {
    keywords?: {
      S2?: string[];
      S3?: string[];
    };
    /** Regex patterns for matching sensitive content (strings are compiled to RegExp) */
    patterns?: {
      S2?: string[];
      S3?: string[];
    };
    tools?: {
      S2?: {
        tools?: string[];
        paths?: string[];
      };
      S3?: {
        tools?: string[];
        paths?: string[];
      };
    };
  };
  localModel?: {
    enabled?: boolean;
    provider?: string;
    model?: string;
    endpoint?: string;
  };
  guardAgent?: {
    id?: string;
    workspace?: string;
    model?: string;
  };
  session?: {
    isolateGuardHistory?: boolean;
    /** Base directory for session histories (default: ~/.openclaw) */
    baseDir?: string;
  };
};

export type DetectionContext = {
  checkpoint: Checkpoint;
  message?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  sessionKey?: string;
  agentId?: string;
  recentContext?: string[];
  /** Pre-read file content for file-reference messages (used for classification) */
  fileContentSnippet?: string;
};

export type DetectionResult = {
  level: SensitivityLevel;
  levelNumeric: SensitivityLevelNumeric;
  reason?: string;
  detectorType: DetectorType;
  confidence?: number;
};

export type SessionPrivacyState = {
  sessionKey: string;
  isPrivate: boolean;
  highestLevel: SensitivityLevel;
  detectionHistory: Array<{
    timestamp: number;
    level: SensitivityLevel;
    checkpoint: Checkpoint;
    reason?: string;
  }>;
};

export function levelToNumeric(level: SensitivityLevel): SensitivityLevelNumeric {
  switch (level) {
    case "S1": return 1;
    case "S2": return 2;
    case "S3": return 3;
  }
}

export function numericToLevel(numeric: SensitivityLevelNumeric): SensitivityLevel {
  switch (numeric) {
    case 1: return "S1";
    case 2: return "S2";
    case 3: return "S3";
  }
}

export function maxLevel(...levels: SensitivityLevel[]): SensitivityLevel {
  const numeric = levels.map(levelToNumeric);
  const max = Math.max(...numeric) as SensitivityLevelNumeric;
  return numericToLevel(max);
}
```

**Key concept: Three sensitivity levels**
- **S1** = Safe — no intervention, cloud model proceeds normally
- **S2** = Sensitive — PII redacted (`[REDACTED:TYPE]`), then sent to cloud
- **S3** = Private — entire request redirected to local-only model, never touches cloud

---

## 3. Configuration Schema — `src/config-schema.ts`

```1:131:openclaw/extensions/guardclaw/src/config-schema.ts
/**
 * GuardClaw Config Schema
 * 
 * Configuration schema for the GuardClaw plugin using TypeBox.
 */

import { Type } from "@sinclair/typebox";

export const guardClawConfigSchema = Type.Object({
  privacy: Type.Optional(
    Type.Object({
      enabled: Type.Optional(Type.Boolean()),
      checkpoints: Type.Optional(
        Type.Object({
          onUserMessage: Type.Optional(Type.Array(Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")]))),
          onToolCallProposed: Type.Optional(Type.Array(Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")]))),
          onToolCallExecuted: Type.Optional(Type.Array(Type.Union([Type.Literal("ruleDetector"), Type.Literal("localModelDetector")]))),
        })
      ),
      rules: Type.Optional(Type.Object({ /* keywords, patterns, tools — all Optional */ })),
      localModel: Type.Optional(Type.Object({ enabled, provider, model, endpoint — all Optional })),
      guardAgent: Type.Optional(Type.Object({ id, workspace, model — all Optional })),
      session: Type.Optional(Type.Object({ isolateGuardHistory, baseDir — all Optional })),
    })
  ),
});

/**
 * Default configuration values.
 * Detection relies entirely on the local LLM judge (localModelDetector).
 * Rule-based detection is kept as an optional fallback but NOT enabled by default.
 */
export const defaultPrivacyConfig = {
  enabled: true,
  checkpoints: {
    onUserMessage: ["localModelDetector" as const],
    onToolCallProposed: ["localModelDetector" as const],
    onToolCallExecuted: ["localModelDetector" as const],
  },
  rules: {
    keywords: { S2: [] as string[], S3: [] as string[] },
    patterns: { S2: [] as string[], S3: [] as string[] },
    tools: {
      S2: { tools: [] as string[], paths: [] as string[] },
      S3: { tools: [] as string[], paths: [] as string[] },
    },
  },
  localModel: {
    enabled: true,
    provider: "ollama",
    model: "openbmb/minicpm4.1",
    endpoint: "http://localhost:11434",
  },
  guardAgent: {
    id: "guard",
    workspace: "~/.openclaw/workspace-guard",
    model: "ollama/openbmb/minicpm4.1",
  },
  session: {
    isolateGuardHistory: true,
    baseDir: "~/.openclaw",
  },
};
```

**Defaults:** Local model (`openbmb/minicpm4.1` via Ollama) handles all detection. No rule-based keywords/patterns out of the box — users add them explicitly via config.

---

## 4. Detection Engine — `src/detector.ts`

```1:221:openclaw/extensions/guardclaw/src/detector.ts
/**
 * GuardClaw Detector Core
 * Main sensitivity detection engine that coordinates rule-based and model-based detection.
 */
// ... imports ...

export async function detectSensitivityLevel(
  context: DetectionContext,
  pluginConfig: Record<string, unknown>
): Promise<DetectionResult> {
  const privacyConfig = mergeWithDefaults(
    (pluginConfig?.privacy as PrivacyConfig) ?? {},
    defaultPrivacyConfig
  );

  if (privacyConfig.enabled === false) {
    return { level: "S1", levelNumeric: 1, reason: "Privacy detection disabled", ... };
  }

  const detectors = getDetectorsForCheckpoint(context.checkpoint, privacyConfig);
  if (detectors.length === 0) {
    return { level: "S1", ... reason: "No detectors configured" };
  }

  const results = await runDetectors(detectors, context, privacyConfig);
  return mergeDetectionResults(results);
}
```

**Flow:**
1. Merge user config with defaults (field-by-field `??` fallback)
2. Look up which detectors to run for this checkpoint (falls back to `["localModelDetector"]`)
3. Run each detector sequentially (try/catch per detector — failures don't block others)
4. Merge results: **highest level wins**, reasons concatenated, confidence averaged

---

## 5. Rule-Based Detector — `src/rules.ts`

```30:113:openclaw/extensions/guardclaw/src/rules.ts
export function detectByRules(
  context: DetectionContext,
  config: PrivacyConfig
): DetectionResult {
  const levels: SensitivityLevel[] = [];
  const reasons: string[] = [];

  // 1. Check keywords in message (case-insensitive, S3 checked before S2)
  // 2. Check regex patterns in message (compiled + cached)
  // 3. Check tool type (exact or substring match against tool name)
  // 4. Check tool parameters (extract paths, match against S3/S2 path patterns)
  // 5. Check tool result content (keywords + patterns)

  const finalLevel = levels.length > 0 ? maxLevel(...levels) : "S1";
  return { level: finalLevel, levelNumeric: ..., reason: reasons.join("; "), detectorType: "ruleDetector", confidence: 1.0 };
}
```

**Detection checks (in order):**
- **Keywords:** case-insensitive substring match. S3 keywords checked before S2.
- **Patterns:** regex compiled once, cached in `patternCache` Map.
- **Tool type:** tool name matched against configured S3/S2 tool lists.
- **Tool params:** paths extracted from common parameter names (`path`, `file`, `filepath`, `dir`, `target`, etc.), matched against path patterns + sensitive file extensions (`.pem`, `.key`, `.p12`, `.pfx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`).
- **Tool results:** keywords + patterns applied to the result content.

---

## 6. Local Model Detector — `src/local-model.ts`

Key functions:

- `detectByLocalModel()` — Builds a bilingual (EN/CN) classification prompt, calls Ollama, parses JSON `{"level":"S1|S2|S3","reason":"..."}`. Strips `<think>` blocks for reasoning models (MiniCPM, Qwen3).
- `quickPiiScan()` — Regex safety net for file content. If the LLM misclassifies as S1 but the file has PII patterns (phones, SSN, addresses, passwords), bumps to S2/S3.
- `desensitizeWithLocalModel()` — **Two-step PII redaction:**
  1. `extractPiiWithModel()` — completion-style prompt: model outputs JSON array of `{type, value}` PII items
  2. Programmatic `replaceAll()` — sorted by value length (longest first), replaces with `[REDACTED:TYPE]` tags
- `mapPiiTypeToTag()` — Maps 30+ PII type names to normalized `[REDACTED:...]` tags
- `callLocalModelDirect()` — Direct Ollama call for S3 guard responses, with `repeat_penalty: 1.3` and stop sequences to prevent degenerate output
- `callOllamaChat()` — Chat API wrapper with system/user message separation

The detection prompt (bilingual):

```121:153:openclaw/extensions/guardclaw/src/local-model.ts
  const parts: string[] = [
    `[SYSTEM] You are a strict privacy classifier. Output ONLY a single JSON object — nothing else.

Classify by BOTH actual data AND intent. If the user asks to read/analyze a file, classify based on what the file WILL contain.

S3 = PRIVATE (local only, never cloud):
  - Financial: payslip, salary, tax, bank account, SSN, 工资单, 报销单, 税表
  - Medical: health records, diagnoses, prescriptions, lab results, 病历, 体检报告
  - Credentials: passwords, API keys, secrets, tokens, private keys
  ...

S2 = SENSITIVE (redact PII, then send to cloud):
  - Addresses, gate/door codes, pickup codes, delivery tracking numbers
  - Phone numbers, email addresses, real names used as contact PII
  ...

S1 = SAFE: No sensitive data or intent.

Rules:
- Passwords/credentials → ALWAYS S3 (never S2)
- Medical data → ALWAYS S3 (never S2)
- Gate/access/pickup codes → S2 (not S3)
- If file content is provided and contains PII → at least S2
- When unsure → pick higher level

Output format: {"level":"S1|S2|S3","reason":"brief"}`,
```

The PII extraction prompt:

```366:377:openclaw/extensions/guardclaw/src/local-model.ts
  const prompt = `Task: Extract ALL PII (personally identifiable information) from text as a JSON array.

Types: NAME (every person), PHONE, ADDRESS (all variants including shortened), ACCESS_CODE (gate/door/门禁码), DELIVERY (tracking numbers, pickup codes/取件码), ID (SSN/身份证), CARD (bank/medical/insurance), LICENSE_PLATE (plate numbers/车牌), EMAIL, PASSWORD, PAYMENT (Venmo/PayPal/支付宝), BIRTHDAY, TIME (appointment/delivery times), NOTE (private instructions)

Example:
Input: Alex lives at 123 Main St. Li Na phone 13912345678, gate code 1234#, card YB330-123, plate 京A12345, tracking SF123, Venmo @alex99
Output: [{"type":"NAME","value":"Alex"},{"type":"NAME","value":"Li Na"},...]

Input: ${textSnippet}
Output: [`;
```

---

## 7. Hooks (Main Orchestration) — `src/hooks.ts`

This is the heart of the plugin — 792 lines registering 6 hooks.

**Guard Agent System Prompt:**

```46:56:openclaw/extensions/guardclaw/src/hooks.ts
const GUARD_AGENT_SYSTEM_PROMPT = `You are a privacy-aware analyst. Analyze the data the user provides. Do your job.

RULES:
1. Analyze the data directly. Do NOT write code. Do NOT generate programming examples or tutorials.
2. NEVER echo raw sensitive values (exact salary, SSN, bank account, password). Use generic references like "your base salary", "the SSN on file", etc.
3. You MAY discuss percentages, ratios, whether deductions are correct, anomalies, and recommendations.
4. Reply ONCE, then stop. No [message_id:] tags. No multi-turn simulation.
5. **Language rule: Reply in the SAME language the user writes in.** If the user writes in Chinese, reply entirely in Chinese. If the user writes in English, reply entirely in English.
6. Be concise and professional.

语言规则：必须使用与用户相同的语言回复。如果用户用中文提问，你必须用中文回答。`;
```

### Hook 1: `message_received` (lines 71–129)
- Runs `detectSensitivityLevel()` at checkpoint `onUserMessage`
- Records detection, persists to dual session history
- Marks session state as private for S2/S3

### Hook 2: `before_tool_call` (lines 137–223)
- **File-access guard:** blocks cloud models from reading protected paths (`sessions/full/`, `MEMORY-FULL.md`, `memory-full/`)
- **Pre-read file guard:** blocks redundant tool reads for files already desensitized in S2 flow
- Runs detection at `onToolCallProposed`
- **S3 → BLOCKS** the tool call entirely (returns `{block: true}`)
- **S2 → allows** but marks session

### Hook 3: `after_tool_call` (lines 228–272)
- Runs detection on tool results at `onToolCallExecuted`
- Upgrades session state if S2/S3 content found in results

### Hook 4: `tool_result_persist` (lines 277–304)
- For private sessions: writes tool results to dual history (fire-and-forget)

### Hook 5: `session_end` (lines 309–329)
- Syncs `MEMORY-FULL.md` → `MEMORY.md` (filters guard agent content)

### Hook 6: `resolve_model` (lines 338–573) — **The core routing logic**

The main decision flow:

```420:488:openclaw/extensions/guardclaw/src/hooks.ts
      // ── S3: call local model directly with pre-read file content ──
      if (result.level === "S3") {
        const guardCfg = getGuardAgentConfig(privacyConfig);
        // ... mark private, emit UI event ...
        // Build prompt: task + embedded file data (if available)
        // Language detection (Chinese vs English)
        try {
          const directReply = await callLocalModelDirect(
            GUARD_AGENT_SYSTEM_PROMPT,
            userPrompt,
            { endpoint: ollamaEndpoint, model: guardModelName },
          );
          return {
            reason: `GuardClaw: S3 — processed locally by ${guardModelName}`,
            provider: guardProvider,
            model: guardModelName,
            directResponse: isChinese
              ? `🔒 [已由本地隐私模型处理]\n\n${directReply}`
              : `🔒 [Processed locally by privacy guard]\n\n${directReply}`,
          };
        } catch (ollamaErr) { /* fall through */ }
      }

      // ── S2: desensitize content, then forward to cloud model ──
      if (result.level === "S2") {
        // ... mark private ...
        // File reference: desensitize FILE content, keep request intact
        // Inline PII: desensitize message directly  
        // Language-aware instructions (tells cloud model NOT to echo [REDACTED:] tags)
        // Persist ORIGINAL to full history
        // Emit privacy_activated event
        return {
          reason: `GuardClaw: S2 — content desensitized before cloud delivery`,
          userPromptOverride: desensitizedPrompt,
        };
      }
      // ── S1: no intervention ──
```

**Additional helpers in hooks.ts:**
- `tryReadReferencedFile()` — Pre-reads files referenced in messages (supports `.xlsx` via `xlsx2csv`/`openpyxl`, `.docx` via `python-docx`, and plain text). Searches workspace dir, cwd, and parent dir.
- `extractPathValuesFromParams()` — Recursively extracts path-like values from tool params
- `extractMessageText()` — Polymorphic message text extraction (string, or object with `.text`/`.content`/`.body`)

---

## 8. Guard Agent Utilities — `src/guard-agent.ts`

```19:108:openclaw/extensions/guardclaw/src/guard-agent.ts
export function isGuardAgentConfigured(config: PrivacyConfig): boolean {
  return Boolean(config.guardAgent?.id && config.guardAgent?.model && config.guardAgent?.workspace);
}

export function getGuardAgentConfig(config: PrivacyConfig): {
  id: string; model: string; workspace: string; provider: string; modelName: string;
} | null {
  // Splits "ollama/openbmb/minicpm4.1" on FIRST slash only
  // → provider="ollama", modelName="openbmb/minicpm4.1"
}

export function generateGuardSessionKey(parentSessionKey: string): string {
  return `${parentSessionKey}:guard`;  // stable key for history accumulation
}

export function isGuardSessionKey(sessionKey: string): boolean {
  return sessionKey.endsWith(":guard") || sessionKey.includes(":guard:");
}

export function getParentSessionKey(guardSessionKey: string): string | null {
  // Removes ":guard" suffix
}

export function buildMainSessionPlaceholder(level: SensitivityLevel, reason?: string): string {
  // "🔒 [Private message — processed locally (reason)]"
  // "🔑 [Sensitive message — processed locally (reason)]"
}

export function isLocalProvider(provider: string): boolean {
  const localProviders = ["ollama", "llama.cpp", "localai", "llamafile", "lmstudio"];
  return localProviders.includes(provider.toLowerCase());
}
```

---

## 9. Session State — `src/session-state.ts`

In-memory `Map<string, SessionPrivacyState>` tracking per-session privacy:

```16:34:openclaw/extensions/guardclaw/src/session-state.ts
export function markSessionAsPrivate(sessionKey: string, level: SensitivityLevel): void {
  const existing = sessionStates.get(sessionKey);
  
  // Mark as private for S2 or S3 (not S1)
  const shouldBePrivate = level === "S2" || level === "S3";
  
  if (existing) {
    // Once private, always private (don't downgrade)
    existing.isPrivate = existing.isPrivate || shouldBePrivate;
    existing.highestLevel = getHigherLevel(existing.highestLevel, level);
  } else {
    sessionStates.set(sessionKey, {
      sessionKey,
      isPrivate: shouldBePrivate,
      highestLevel: level,
      detectionHistory: [],
    });
  }
}
```

**Key functions:**
- `markSessionAsPrivate()` — Once S2/S3, **never downgrades** back to S1
- `recordDetection()` — Appends to detection history, capped at 50 entries
- `resetSessionPrivacy()` — Explicit reset (clears guard subsession too)
- `markPreReadFiles()` / `isFilePreRead()` — Tracks files already desensitized in S2, blocks tool re-reads

---

## 10. Dual Session Manager — `src/session-manager.ts`

```23:65:openclaw/extensions/guardclaw/src/session-manager.ts
export class DualSessionManager {
  async persistMessage(sessionKey, message, agentId = "main"): Promise<void> {
    // ALWAYS writes to full history
    await this.writeToHistory(sessionKey, message, agentId, "full");
    // Writes to clean history ONLY if not guard agent message
    if (!this.isGuardAgentMessage(message)) {
      await this.writeToHistory(sessionKey, message, agentId, "clean");
    }
  }

  async loadHistory(sessionKey, isCloudModel, agentId = "main", limit?): Promise<SessionMessage[]> {
    const historyType = isCloudModel ? "clean" : "full";
    return await this.readHistory(sessionKey, agentId, historyType, limit);
  }

  private isGuardAgentMessage(message: SessionMessage): boolean {
    // sessionKey contains ":guard", or content has "[Guard Agent]", "guard:", ":guard:"
  }
}
```

**Storage format:** JSONL files at:
```
~/.openclaw/agents/{agentId}/sessions/
  ├── full/{sessionKey}.jsonl     ← everything (local + audit)
  └── clean/{sessionKey}.jsonl    ← guard content stripped (cloud)
```

---

## 11. Memory Isolation — `src/memory-isolation.ts`

```12:192:openclaw/extensions/guardclaw/src/memory-isolation.ts
export class MemoryIsolationManager {
  getMemoryDir(isCloudModel: boolean): string {
    // Cloud → "memory", Local → "memory-full"
  }

  getMemoryFilePath(isCloudModel: boolean): string {
    // Cloud → MEMORY.md, Local → MEMORY-FULL.md
  }

  async syncMemoryToClean(): Promise<void> {
    // Reads MEMORY-FULL.md → filterGuardContent() → writes MEMORY.md
  }

  private filterGuardContent(content: string): string {
    // Strips lines/sections containing "[Guard Agent]", "guard:", "private context:"
    // Resumes at blank lines or new # headers
  }

  async initializeDirectories(): Promise<void> {
    // Creates both memory/ and memory-full/ directories
  }
}
```

---

## 12. Utilities — `src/utils.ts`

```98:229:openclaw/extensions/guardclaw/src/utils.ts
export function redactSensitiveInfo(text: string): string {
  // Phase 1: Pattern-based
  //   SSH private key blocks → [REDACTED:PRIVATE_KEY]
  //   API keys (sk-xxx, key-xxx) → [REDACTED:KEY]
  //   AWS keys (AKIA...) → [REDACTED:AWS_KEY]
  //   DB connection strings → [REDACTED:DB_CONNECTION]
  //   Internal IPs → [REDACTED:INTERNAL_IP]
  //   Emails → [REDACTED:EMAIL]
  //   .env vars → [REDACTED:ENV_VAR]
  //   Credit cards → [REDACTED:CARD_NUMBER]
  //   CN mobile phones → [REDACTED:PHONE]
  //   CN ID cards → [REDACTED:ID]
  //   CN delivery tracking → [REDACTED:DELIVERY]
  //   CN door codes → [REDACTED:ACCESS_CODE]
  //   CN addresses → [REDACTED:ADDRESS]

  // Phase 2: Context-based (keyword + connecting words + value)
  //   STRICT connect (requires verb/delimiter): "credit card", "secret", "ssn", "pin"
  //   LOOSE connect (accepts plain space): "password", "api_key", "token", "credential"
}

export function isProtectedMemoryPath(filePath: string, baseDir: string): boolean {
  // Blocks: */sessions/full/*, */MEMORY-FULL.md, */memory-full/*
}
```

---

## 13. Test Suite

### `test/detector.test.ts`
- S3 from message keywords (`ssh_key`), S2 from tool type (`exec`), S1 for safe content
- Disabled privacy → always S1; minimal config → defaults to S1

### `test/rules.test.ts`
- Keyword detection: S3 (`id_rsa`), S2 (`api_key`), case-insensitive
- Tool type: S3 (`system.run`), S2 (`exec`), S1 (`read_file`)
- Path detection: S3 (`~/.ssh/id_rsa`), S2 (`~/secrets/...`), sensitive extensions (`.pem`)
- Result merging: multiple issues → highest level wins

### `test/session-manager.test.ts`
- Normal messages → both full + clean histories
- Guard messages (`sessionKey` with `:guard:`) → full only, excluded from clean
- Cloud loads clean, local loads full; limit parameter respected

### `test/integration.test.ts`
- E2E: detect S3 → mark private → verify state; multiple detections → highest maintained
- Full hook chain: `onUserMessage` (S2) → `onToolCallProposed` (S3 escalation) → `onToolCallExecuted` (S3 confirmed)
- Edge cases: disabled config, empty config, missing fields, 10,000-word messages

---

## Architecture Summary

```
User Message
     │
     ▼
┌─────────────────────────────────┐
│  resolve_model hook             │
│  1. Pre-read referenced files   │
│  2. detectSensitivityLevel()    │
│     ├─ ruleDetector             │
│     └─ localModelDetector       │
│  3. Route by level:             │
│     S1 → pass-through (cloud)   │
│     S2 → desensitize → cloud    │
│     S3 → local model direct     │
└─────────────────────────────────┘
     │               │
     ▼               ▼
  Cloud Model    Local Guard
  (clean hist)   (full hist)
     │               │
     ▼               ▼
  MEMORY.md      MEMORY-FULL.md
  memory/        memory-full/
  sessions/clean sessions/full
```

**Data never sent to cloud:** S3 content, guard agent messages, full session history, `MEMORY-FULL.md`, `memory-full/` directory. The `before_tool_call` hook actively blocks cloud models from reading these paths.