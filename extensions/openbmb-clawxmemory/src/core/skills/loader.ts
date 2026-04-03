import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CONTEXT_TEMPLATE,
  DEFAULT_EXTRACTION_RULES,
  DEFAULT_INTENT_RULES,
  DEFAULT_PROJECT_STATUS_RULES,
} from "./defaults.js";
import type {
  ExtractionPatternFile,
  ExtractionRulesFile,
  IntentRulesFile,
  ProjectStatusRulesFile,
  SkillLoaderLogger,
  SkillsRuntime,
} from "./types.js";

function safeJsonParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function resolveDefaultSkillsDir(): string {
  return fileURLToPath(new URL("../../../skills/", import.meta.url));
}

function readJsonWithFallback<T>(
  path: string,
  fallback: T,
  errors: string[],
): T {
  if (!existsSync(path)) {
    errors.push(`missing file: ${path}`);
    return fallback;
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = safeJsonParse<T>(raw);
  if (!parsed) {
    errors.push(`invalid json: ${path}`);
    return fallback;
  }
  return parsed;
}

function ensureKeywords(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  const cleaned = values.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : fallback;
}

function normalizeIntentRules(input: IntentRulesFile): IntentRulesFile {
  return {
    timeKeywords: ensureKeywords(input.timeKeywords, DEFAULT_INTENT_RULES.timeKeywords),
    projectKeywords: ensureKeywords(input.projectKeywords, DEFAULT_INTENT_RULES.projectKeywords),
    factKeywords: ensureKeywords(input.factKeywords, DEFAULT_INTENT_RULES.factKeywords),
  };
}

function toRegExp(pattern: string, flags: string | undefined, fallback: RegExp): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return fallback;
  }
}

function normalizePattern(item: ExtractionPatternFile, fallback: ExtractionPatternFile): RegExp {
  return toRegExp(item.pattern, item.flags, toRegExp(fallback.pattern, fallback.flags, /(?:)/g));
}

function normalizeExtractionRules(input: ExtractionRulesFile): SkillsRuntime["extractionRules"] {
  const projectPatterns = (Array.isArray(input.projectPatterns) && input.projectPatterns.length > 0
    ? input.projectPatterns
    : DEFAULT_EXTRACTION_RULES.projectPatterns).map((item, index) => {
      const fallback = DEFAULT_EXTRACTION_RULES.projectPatterns[index] ?? DEFAULT_EXTRACTION_RULES.projectPatterns[0]!;
      return normalizePattern(item, fallback);
    });

  const factRulesRaw = Array.isArray(input.factRules) && input.factRules.length > 0
    ? input.factRules
    : DEFAULT_EXTRACTION_RULES.factRules;

  const factRules = factRulesRaw.map((item, index) => {
    const fallback = DEFAULT_EXTRACTION_RULES.factRules[index] ?? DEFAULT_EXTRACTION_RULES.factRules[0]!;
    return {
      name: item.name || fallback.name || `rule_${index}`,
      regex: toRegExp(item.pattern, item.flags, toRegExp(fallback.pattern, fallback.flags, /(?:)/g)),
      keyPrefix: item.keyPrefix || fallback.keyPrefix,
      confidence: Number.isFinite(item.confidence) ? item.confidence : fallback.confidence,
      maxLength: Number.isFinite(item.maxLength) ? item.maxLength! : (fallback.maxLength ?? 120),
    };
  });

  const summaryLimits = input.summaryLimits ?? DEFAULT_EXTRACTION_RULES.summaryLimits!;

  return {
    projectPatterns,
    factRules,
    maxProjectTags: Number.isFinite(input.maxProjectTags) ? input.maxProjectTags! : (DEFAULT_EXTRACTION_RULES.maxProjectTags ?? 8),
    maxFacts: Number.isFinite(input.maxFacts) ? input.maxFacts! : (DEFAULT_EXTRACTION_RULES.maxFacts ?? 16),
    projectTagMinLength: Number.isFinite(input.projectTagMinLength)
      ? input.projectTagMinLength!
      : (DEFAULT_EXTRACTION_RULES.projectTagMinLength ?? 2),
    projectTagMaxLength: Number.isFinite(input.projectTagMaxLength)
      ? input.projectTagMaxLength!
      : (DEFAULT_EXTRACTION_RULES.projectTagMaxLength ?? 50),
    summaryLimits: {
      head: Number.isFinite(summaryLimits.head) ? summaryLimits.head : 80,
      tail: Number.isFinite(summaryLimits.tail) ? summaryLimits.tail : 80,
      assistant: Number.isFinite(summaryLimits.assistant) ? summaryLimits.assistant : 80,
    },
  };
}

function normalizeProjectStatusRules(input: ProjectStatusRulesFile): ProjectStatusRulesFile {
  const rules = Array.isArray(input.rules) ? input.rules : DEFAULT_PROJECT_STATUS_RULES.rules;
  const normalizedRules = rules
    .map((rule, index) => {
      const fallback = DEFAULT_PROJECT_STATUS_RULES.rules[index] ?? DEFAULT_PROJECT_STATUS_RULES.rules[0]!;
      const keywords = ensureKeywords(rule.keywords, fallback.keywords);
      return {
        status: rule.status || fallback.status,
        keywords,
      };
    })
    .filter((rule) => rule.status && rule.keywords.length > 0);
  return {
    defaultStatus: input.defaultStatus || DEFAULT_PROJECT_STATUS_RULES.defaultStatus,
    rules: normalizedRules.length > 0 ? normalizedRules : DEFAULT_PROJECT_STATUS_RULES.rules,
  };
}

export interface LoadSkillsOptions {
  skillsDir?: string;
  logger?: SkillLoaderLogger;
}

function tryLoadSkillsFromDir(skillsDir: string): SkillsRuntime {
  const errors: string[] = [];

  const intentPath = join(skillsDir, "intent-rules.json");
  const extractionPath = join(skillsDir, "extraction-rules.json");
  const projectStatusPath = join(skillsDir, "project-status-rules.json");
  const contextPath = join(skillsDir, "context-template.md");

  const intentRaw = readJsonWithFallback(intentPath, DEFAULT_INTENT_RULES, errors);
  const extractionRaw = readJsonWithFallback(extractionPath, DEFAULT_EXTRACTION_RULES, errors);
  const projectStatusRaw = readJsonWithFallback(projectStatusPath, DEFAULT_PROJECT_STATUS_RULES, errors);

  let contextTemplate = DEFAULT_CONTEXT_TEMPLATE;
  if (!existsSync(contextPath)) {
    errors.push(`missing file: ${contextPath}`);
  } else {
    const raw = readFileSync(contextPath, "utf-8").trim();
    contextTemplate = raw || DEFAULT_CONTEXT_TEMPLATE;
  }

  const runtime: SkillsRuntime = {
    intentRules: normalizeIntentRules(intentRaw),
    extractionRules: normalizeExtractionRules(extractionRaw),
    projectStatusRules: normalizeProjectStatusRules(projectStatusRaw),
    contextTemplate,
    metadata: {
      source: errors.length > 0 ? "fallback" : "files",
      skillsDir,
      errors,
    },
  };
  return runtime;
}

export function loadSkillsRuntime(options: LoadSkillsOptions = {}): SkillsRuntime {
  const logger = options.logger ?? console;
  const defaultSkillsDir = resolveDefaultSkillsDir();
  const candidateDirs = options.skillsDir
    ? [resolve(options.skillsDir), defaultSkillsDir]
    : [defaultSkillsDir];

  let runtime: SkillsRuntime | undefined;
  for (const skillsDir of candidateDirs) {
    const loaded = tryLoadSkillsFromDir(skillsDir);
    if (loaded.metadata.source === "files") {
      logger.info?.(`[clawxmemory] skills loaded from ${skillsDir}`);
      return loaded;
    }
    runtime = loaded;
  }

  const fallback = runtime ?? tryLoadSkillsFromDir(defaultSkillsDir);
  if (options.skillsDir && fallback.metadata.skillsDir !== defaultSkillsDir) {
    const builtIn = tryLoadSkillsFromDir(defaultSkillsDir);
    if (builtIn.metadata.source === "files") {
      logger.warn?.(
        `[clawxmemory] custom skillsDir unavailable (${resolve(options.skillsDir)}); falling back to built-in skills at ${defaultSkillsDir}`,
      );
      return builtIn;
    }
  }

  logger.warn?.(`[clawxmemory] skills loaded with fallback. errors=${fallback.metadata.errors.join(" | ")}`);
  return fallback;
}
