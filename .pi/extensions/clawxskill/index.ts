import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { EmbeddingSearch } from "./engines/embedding-search.js";
import { InvertedIndex, tokenize } from "./engines/inverted-index.js";
import { ModelJudge } from "./engines/model-judge.js";
import { SkillBackup } from "./skill-backup.js";
import type { SearchResult, SkillMeta } from "./types.js";
import { createSkillWatcher, extractSkillName } from "./watcher.js";

const MIN_SKILL_COUNT = 2;

// ---- Config ----

export interface SkillDiscoveryConfig {
  enabled?: boolean;
  embedding?: {
    provider?: "google" | "openai" | "custom";
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  modelJudge?: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  logLevel?: "debug" | "info" | "warn" | "error" | "silent";
}

const CONFIG_PATH = path.join(os.homedir(), ".openclaw", "clawxskill.json");

const CONFIG_TEMPLATE = `{
  // Master switch — set to false to disable the entire extension
  "enabled": true,

  // -- Semantic search engines (optional, BM25 keyword search is always on) --

  // Engine 2: Embedding vector search
  // "embedding": {
  //   "provider": "google",          // "google" | "openai" | "custom"
  //   "apiKey": "AIzaSy...",         // your API key
  //   "model": "text-embedding-004", // optional, auto-selected by provider
  //   "baseUrl": ""                  // required for "custom" provider only
  // },

  // Engine 3: Small model judge
  // "modelJudge": {
  //   "provider": "openai",          // any OpenAI-compatible provider
  //   "apiKey": "sk-...",            // your API key
  //   "model": "gpt-4.1-nano",      // cheap models: gpt-4.1-nano / gemini-2.0-flash-lite
  //   "baseUrl": ""                  // optional, custom endpoint
  // },

  // Log level: debug | info | warn | error | silent
  "logLevel": "info"
}
`;

function loadConfig(): SkillDiscoveryConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      // Strip single-line comments so JSON.parse works
      const cleaned = raw.replace(/\/\/.*$/gm, "");
      return JSON.parse(cleaned);
    }
  } catch {
    // Malformed config — fall through to generate template
  }

  // First run: auto-generate config template
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, CONFIG_TEMPLATE, "utf-8");
  } catch {
    // Read-only filesystem, skip
  }
  return {};
}

const config = loadConfig();

// ---- Logger ----

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function createLogger(tag: string) {
  const envLevel = (
    process.env.SKILL_DISCOVERY_LOG ??
    config.logLevel ??
    "info"
  ).toLowerCase() as LogLevel;
  const threshold = LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;

  const logDir = path.join(os.homedir(), ".openclaw", "logs");
  let logStream: fs.WriteStream | null = null;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    logStream = fs.createWriteStream(path.join(logDir, "clawxskill.log"), { flags: "a" });
  } catch {
    // Filesystem error — console only
  }

  function write(level: LogLevel, msg: string, data?: unknown) {
    if (LOG_LEVELS[level] < threshold) return;
    const ts = new Date().toISOString();
    const line =
      data !== undefined
        ? `${ts} [${tag}] ${level.toUpperCase()} ${msg} ${JSON.stringify(data)}`
        : `${ts} [${tag}] ${level.toUpperCase()} ${msg}`;
    logStream?.write(line + "\n");
    if (level === "error" || level === "warn") {
      console.error(`[${tag}] ${msg}`);
    }
  }

  return {
    debug: (msg: string, data?: unknown) => write("debug", msg, data),
    info: (msg: string, data?: unknown) => write("info", msg, data),
    warn: (msg: string, data?: unknown) => write("warn", msg, data),
    error: (msg: string, data?: unknown) => write("error", msg, data),
    close: () => logStream?.end(),
  };
}

const log = createLogger("clawxskill");

// ---- Name normalization ----
// pi.getCommands() returns "skill:think-base", watcher returns "think-base".
// Normalize to bare name for consistent indexing and dedup.
function normalizeSkillName(raw: string): string {
  return raw.replace(/^skill:/, "");
}

// ---- Extension entry point ----

export default function skillDiscoveryExtension(pi: ExtensionAPI) {
  // Honor the enabled flag — if explicitly false, skip all registration
  if (config.enabled === false) {
    log.info("extension disabled via config (enabled: false)");
    return;
  }

  const bm25 = new InvertedIndex();
  const embeddingEngine = new EmbeddingSearch(config.embedding);
  const modelJudge = new ModelJudge(config.modelJudge);
  const skillBackup = new SkillBackup();

  const alreadyRecommended = new Set<string>();
  let pendingRecommendations: SkillMeta[] = [];
  let writeDetected = false;
  let cleanupWatcher: (() => void) | null = null;
  let initialized = false;

  // ---- E0: Index build + chokidar hot-reload ----

  // Extract "When to use" section and trigger words from SKILL.md body
  function extractSearchableContent(raw: string): string {
    const parts: string[] = [];

    // 1. Extract "When to use" / "When to Use This Skill" sections
    const whenMatch = raw.match(/##\s*When\s+to\s+[Uu]se[\s\S]*?\n([\s\S]*?)(?=\n##\s|\n---|\Z)/);
    if (whenMatch) {
      parts.push(whenMatch[1].slice(0, 500));
    }

    // 2. Extract trigger words from description (quoted strings in CN/EN)
    const triggerMatches = raw.match(/[""「]([^""」\n]+)[""」]/g);
    if (triggerMatches) {
      parts.push(triggerMatches.map((t) => t.replace(/[""「」]/g, "")).join(" "));
    }

    // 3. First 500 chars after frontmatter as fallback context
    const frontmatterEnd = raw.indexOf("---", raw.indexOf("---") + 3);
    if (frontmatterEnd > 0) {
      parts.push(raw.slice(frontmatterEnd + 3, frontmatterEnd + 503));
    }

    return parts.join(" ");
  }

  // Parse <available_skills> from System Prompt to discover OpenClaw built-in skills
  // that are not exposed via pi.getCommands().
  // Requires ExtensionContext (ctx) because getSystemPrompt() is on ctx, not pi.
  function parseSkillsFromSystemPrompt(
    ctx: any,
  ): Array<{ name: string; description: string; filePath: string }> {
    try {
      const prompt = ctx?.getSystemPrompt?.();
      if (!prompt) return [];
      const block = prompt.match(/<available_skills>([\s\S]*?)<\/available_skills>/);
      if (!block) return [];
      const results: Array<{ name: string; description: string; filePath: string }> = [];
      const skillRegex =
        /<skill>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>([\s\S]*?)<\/location>\s*<\/skill>/g;
      let m;
      while ((m = skillRegex.exec(block[1])) !== null) {
        results.push({
          name: m[1].trim(),
          description: m[2].trim(),
          filePath: m[3].trim(),
        });
      }
      return results;
    } catch {
      return [];
    }
  }

  function loadSkillMetadata(): SkillMeta[] {
    const seen = new Set<string>();
    const skills: SkillMeta[] = [];

    function addSkill(name: string, description: string, filePath: string) {
      const normalized = normalizeSkillName(name);
      if (seen.has(normalized)) return;
      seen.add(normalized);

      let extraTokenSource = "";
      if (filePath && fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          extraTokenSource = extractSearchableContent(raw);
        } catch {
          // Unreadable file, skip extra tokens
        }
      }

      skills.push({
        name: normalized,
        description,
        filePath,
        tokens: tokenize(`${normalized} ${description} ${extraTokenSource}`),
      });
    }

    // Source 1: Pi slash commands (user skills from ~/.agents/skills/)
    try {
      for (const cmd of pi.getCommands()) {
        if (cmd.source !== "skill") continue;
        addSkill(cmd.name, cmd.description || "", cmd.path || "");
      }
    } catch {
      // getCommands may not be available
    }

    return skills;
  }

  function parseSkillFile(filePath: string): SkillMeta | null {
    const name = extractSkillName(filePath);
    if (!name) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      let description = "";

      const descMatch = raw.match(/(?:^|\n)description:\s*["']?([^\n"']+)["']?\s*(?:\n|$)/);
      if (descMatch) description = descMatch[1].trim();

      const extraTokenSource = extractSearchableContent(raw);

      return {
        name: normalizeSkillName(name),
        description,
        filePath,
        tokens: tokenize(`${name} ${description} ${extraTokenSource}`),
      };
    } catch {
      return null;
    }
  }

  // Lazy init: only set initialized=true after successfully loading skills.
  // If getCommands() fails or returns 0 skills, retry on next input event.
  // Accepts ctx (ExtensionContext) to also parse skills from System Prompt.
  function ensureInitialized(cwd?: string, ctx?: any) {
    if (initialized) return;

    let skills: SkillMeta[];
    try {
      skills = loadSkillMetadata();
    } catch {
      log.warn("init failed: getCommands() threw, will retry next turn");
      return;
    }

    // Supplement with OpenClaw built-in skills from System Prompt
    if (ctx) {
      const seen = new Set(skills.map((s) => s.name));
      for (const s of parseSkillsFromSystemPrompt(ctx)) {
        const name = normalizeSkillName(s.name);
        if (seen.has(name)) continue;
        seen.add(name);

        let extraTokenSource = "";
        if (s.filePath && fs.existsSync(s.filePath)) {
          try {
            const raw = fs.readFileSync(s.filePath, "utf-8");
            extraTokenSource = extractSearchableContent(raw);
          } catch {
            /* skip */
          }
        }

        skills.push({
          name,
          description: s.description,
          filePath: s.filePath,
          tokens: tokenize(`${name} ${s.description} ${extraTokenSource}`),
        });
      }
    }

    if (skills.length === 0) {
      log.debug("init deferred: 0 skills found, will retry next turn");
      return;
    }

    initialized = true;
    bm25.build(skills);
    log.info(
      `init: indexed ${skills.length} skills`,
      skills.map((s) => s.name),
    );

    if (cwd) {
      cleanupWatcher?.();
      cleanupWatcher = createSkillWatcher(cwd, (changedPath, event) => {
        switch (event) {
          case "add":
          case "change": {
            const meta = parseSkillFile(changedPath);
            if (meta) {
              bm25.removeSkill(meta.name);
              bm25.addSkill(meta);
              log.debug(`watcher: ${event} ${meta.name}`);
            }
            break;
          }
          case "unlink": {
            const name = extractSkillName(changedPath);
            if (name) {
              bm25.removeSkill(normalizeSkillName(name));
              log.debug(`watcher: unlink ${name}`);
            }
            break;
          }
        }
      });
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    ensureInitialized(ctx.cwd, ctx);
  });

  pi.on("session_shutdown", async () => {
    log.info("session shutdown, cleaning up");
    cleanupWatcher?.();
    cleanupWatcher = null;
  });

  // ---- E1: Turn 0 discovery ----
  // Also captures /skill:xxx for SkillBackup before Pi expands the command.

  pi.on("input", async (event, ctx) => {
    ensureInitialized(ctx.cwd, ctx);

    if (event.source === "extension") return { action: "continue" as const };

    // Backup trigger 2: slash command — intercept before Pi expands /skill:xxx
    if (event.text?.startsWith("/skill:")) {
      const spaceIdx = event.text.indexOf(" ");
      const skillName = spaceIdx === -1 ? event.text.slice(7) : event.text.slice(7, spaceIdx);
      if (skillName) {
        const skill = bm25.getSkill(normalizeSkillName(skillName));
        if (skill?.filePath) {
          try {
            const content = fs.readFileSync(skill.filePath, "utf-8");
            skillBackup.record(normalizeSkillName(skillName), content);
            log.info(`backup[slash]: ${skillName}`);
          } catch {
            // File unreadable, skip backup
          }
        }
      }
    }

    if (bm25.getSkillCount() < MIN_SKILL_COUNT) {
      log.debug(`input skipped: ${bm25.getSkillCount()} skills < ${MIN_SKILL_COUNT}`);
      return { action: "continue" as const };
    }

    log.debug(`input search: "${event.text?.slice(0, 80)}"`);
    const matches = await multiEngineSearch(event.text);
    const newMatches = matches.filter((r) => !alreadyRecommended.has(r.skill.name));
    if (newMatches.length > 0) {
      pendingRecommendations = newMatches.map((r) => r.skill);
      log.info(
        `turn-0 found ${newMatches.length} matches`,
        newMatches.map((r) => `${r.skill.name}(${r.score.toFixed(2)})`),
      );
    }

    return { action: "continue" as const };
  });

  // ---- E4: Inter-turn discovery (write pivot guard) ----
  // ---- E6: SkillBackup triggers from tool_result ----

  pi.on("tool_result", async (event) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      writeDetected = true;
      log.debug(`write pivot: ${event.toolName}`);
    }

    // Never backup error results
    if (event.isError) return;

    const textContent = event.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    if (!textContent) return;

    // Backup trigger 1: model reads a SKILL.md file
    if (event.toolName === "read" && event.input?.path) {
      const filePath = String(event.input.path);
      if (/SKILL\.md$/i.test(filePath)) {
        const skillName = extractSkillName(filePath);
        if (skillName) {
          skillBackup.record(normalizeSkillName(skillName), textContent);
          log.info(`backup[read]: ${skillName}`);
        }
      }
    }

    // Backup trigger 3: heuristic — content looks like a SKILL.md body
    if (!event.input?.path && textContent.length > 200) {
      const looksLikeSkill =
        /^---\s*\n[\s\S]*?^---\s*\n/m.test(textContent) &&
        /\b(description|when.?to.?use|allowed.?tools)\b/i.test(textContent);
      if (looksLikeSkill) {
        const nameMatch = textContent.match(/(?:^|\n)name:\s*["']?([^\n"']+)/);
        if (nameMatch) {
          const skillName = normalizeSkillName(nameMatch[1].trim());
          if (!skillBackup.has(skillName)) {
            skillBackup.record(skillName, textContent);
            log.info(`backup[heuristic]: ${skillName}`);
          }
        }
      }
    }
  });

  // ---- E2 + E3: Dynamic injection + deduplication ----

  pi.on("context", async (event) => {
    let newRecommendations: SkillMeta[] = [];

    if (pendingRecommendations.length > 0) {
      newRecommendations.push(...pendingRecommendations);
      pendingRecommendations = [];
    }

    // Inter-turn: only search after a write/edit pivot (~5ms BM25)
    if (writeDetected && bm25.getSkillCount() >= MIN_SKILL_COUNT) {
      const recentContext = extractRecentContext(event.messages, 3);
      if (recentContext) {
        const interResults = bm25.searchSync(recentContext);
        newRecommendations.push(...interResults.map((r) => r.skill));
      }
      writeDetected = false;
    }

    const filtered = newRecommendations.filter((s) => !alreadyRecommended.has(s.name));

    if (filtered.length > 0) {
      filtered.forEach((s) => alreadyRecommended.add(s.name));
      log.info(
        `injecting ${filtered.length} recommendations`,
        filtered.map((s) => s.name),
      );

      const skillList = filtered
        .map((s) => `- **${s.name}**: ${s.description || "(no description)"}`)
        .join("\n");

      event.messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "<system-reminder>",
              "Skills relevant to your current task have been discovered:",
              "",
              skillList,
              "",
              "Use the `read` tool to load the skill's SKILL.md file for detailed instructions.",
              "When a skill matches the task, load it BEFORE generating other responses.",
              "</system-reminder>",
            ].join("\n"),
          },
        ],
        timestamp: Date.now(),
      } as any);
    }

    return { messages: event.messages };
  });

  // ---- E6: Compression recovery ----

  pi.on("session_compact", async () => {
    const toRestore = skillBackup.getRestorationPayload();
    if (toRestore.length === 0) return;
    log.info(
      `compact recovery: restoring ${toRestore.length} skills`,
      toRestore.map((s) => s.name),
    );

    for (const skill of toRestore) {
      pi.sendMessage(
        {
          customType: "skill_restore",
          content: `Previously loaded skill "${skill.name}" (restored after compaction):\n\n${skill.content}`,
          display: "info" as any,
        },
        { triggerTurn: false },
      );
    }
  });

  // ---- E5: Multi-engine search orchestration ----

  async function multiEngineSearch(query: string): Promise<SearchResult[]> {
    const engines: Promise<SearchResult[]>[] = [];

    engines.push(Promise.resolve(bm25.searchSync(query)));

    if (embeddingEngine.available) {
      engines.push(
        Promise.race([
          embeddingEngine.search(query),
          new Promise<SearchResult[]>((resolve) => setTimeout(() => resolve([]), 3000)),
        ]).catch(() => []),
      );
    }

    if (modelJudge.available) {
      engines.push(
        Promise.race([
          modelJudge.search(query),
          new Promise<SearchResult[]>((resolve) => setTimeout(() => resolve([]), 3000)),
        ]).catch(() => []),
      );
    }

    const results = await Promise.allSettled(engines);
    const allMatches = results
      .filter((r): r is PromiseFulfilledResult<SearchResult[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    return dedupeAndRank(allMatches);
  }

  function dedupeAndRank(matches: SearchResult[]): SearchResult[] {
    const hitCount = new Map<string, number>();
    const bestScore = new Map<string, SearchResult>();

    for (const m of matches) {
      hitCount.set(m.skill.name, (hitCount.get(m.skill.name) || 0) + 1);
      const existing = bestScore.get(m.skill.name);
      if (!existing || m.score > existing.score) {
        bestScore.set(m.skill.name, m);
      }
    }

    return [...bestScore.values()]
      .sort(
        (a, b) =>
          (hitCount.get(b.skill.name) || 0) - (hitCount.get(a.skill.name) || 0) ||
          b.score - a.score,
      )
      .slice(0, 3);
  }

  function extractRecentContext(messages: any[], count: number): string | null {
    const recent = messages.slice(-count);
    const texts: string[] = [];

    for (const msg of recent) {
      if (typeof msg.content === "string") {
        texts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text" && part.text) {
            texts.push(part.text);
          }
        }
      }
    }

    const joined = texts.join(" ").slice(0, 500);
    return joined.length > 0 ? joined : null;
  }
}
