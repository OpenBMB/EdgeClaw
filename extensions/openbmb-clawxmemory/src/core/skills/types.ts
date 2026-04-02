export interface IntentRulesFile {
  timeKeywords: string[];
  projectKeywords: string[];
  factKeywords: string[];
}

export interface ExtractionPatternFile {
  pattern: string;
  flags?: string;
}

export interface ExtractionFactRuleFile {
  name?: string;
  pattern: string;
  flags?: string;
  keyPrefix: string;
  confidence: number;
  maxLength?: number;
}

export interface ExtractionRulesFile {
  projectPatterns: ExtractionPatternFile[];
  factRules: ExtractionFactRuleFile[];
  maxProjectTags?: number;
  maxFacts?: number;
  projectTagMinLength?: number;
  projectTagMaxLength?: number;
  summaryLimits?: {
    head: number;
    tail: number;
    assistant: number;
  };
}

export interface ProjectStatusRulesFile {
  defaultStatus: string;
  rules: Array<{
    status: string;
    keywords: string[];
  }>;
}

export interface RuntimeFactRule {
  name: string;
  regex: RegExp;
  keyPrefix: string;
  confidence: number;
  maxLength: number;
}

export interface SkillsRuntime {
  intentRules: IntentRulesFile;
  extractionRules: {
    projectPatterns: RegExp[];
    factRules: RuntimeFactRule[];
    maxProjectTags: number;
    maxFacts: number;
    projectTagMinLength: number;
    projectTagMaxLength: number;
    summaryLimits: {
      head: number;
      tail: number;
      assistant: number;
    };
  };
  projectStatusRules: ProjectStatusRulesFile;
  contextTemplate: string;
  metadata: {
    source: "files" | "fallback";
    skillsDir: string;
    errors: string[];
  };
}

export interface SkillLoaderLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}
