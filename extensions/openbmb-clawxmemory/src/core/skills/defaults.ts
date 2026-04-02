import type { ExtractionRulesFile, IntentRulesFile, ProjectStatusRulesFile } from "./types.js";

export const DEFAULT_INTENT_RULES: IntentRulesFile = {
  timeKeywords: ["今天", "昨天", "最近", "本周", "时间", "日期", "timeline", "when", "day"],
  projectKeywords: ["项目", "进展", "里程碑", "roadmap", "project", "status", "ultrarag"],
  factKeywords: ["偏好", "事实", "画像", "profile", "fact", "习惯", "喜欢", "不喜欢"],
};

export const DEFAULT_EXTRACTION_RULES: ExtractionRulesFile = {
  projectPatterns: [
    { pattern: "(?:项目|project)\\s*[:：]?\\s*([A-Za-z][A-Za-z0-9_-]{1,48})", flags: "gi" },
    { pattern: "\\b([A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+)\\b", flags: "g" },
  ],
  factRules: [
    {
      name: "techStack",
      pattern: "(?:我在用|我使用|使用的是|技术栈是)\\s*([A-Za-z0-9.+#_-]{2,40})",
      flags: "gi",
      keyPrefix: "tech",
      confidence: 0.82,
      maxLength: 120,
    },
    {
      name: "activity",
      pattern: "(?:我正在|我在)\\s*([^，。,.!?]{2,60})",
      flags: "gi",
      keyPrefix: "activity",
      confidence: 0.68,
      maxLength: 120,
    },
    {
      name: "preference",
      pattern: "(?:喜欢|偏好)\\s*([^，。,.!?]{2,40})",
      flags: "gi",
      keyPrefix: "preference",
      confidence: 0.72,
      maxLength: 120,
    },
    {
      name: "plan",
      pattern: "(?:计划|准备)\\s*([^，。,.!?]{2,40})",
      flags: "gi",
      keyPrefix: "plan",
      confidence: 0.65,
      maxLength: 120,
    },
  ],
  maxProjectTags: 8,
  maxFacts: 16,
  projectTagMinLength: 2,
  projectTagMaxLength: 50,
  summaryLimits: {
    head: 80,
    tail: 80,
    assistant: 80,
  },
};

export const DEFAULT_PROJECT_STATUS_RULES: ProjectStatusRulesFile = {
  defaultStatus: "in_progress",
  rules: [
    {
      status: "done",
      keywords: ["完成", "done", "已上线"],
    },
    {
      status: "planned",
      keywords: ["计划", "准备"],
    },
    {
      status: "in_progress",
      keywords: ["推进", "进行中", "跟进"],
    },
  ],
};

export const DEFAULT_CONTEXT_TEMPLATE = `You are using multi-level memory indexes for this turn.
intent={{intent}}
enoughAt={{enoughAt}}

{{profileBlock}}

{{evidenceNoteBlock}}

{{l2Block}}

{{l1Block}}

{{l0Block}}

Only use the above as supporting context; prioritize the user's latest request.`;
