import type {
  MemoryCandidate,
  MemoryManifestEntry,
  MemoryMessage,
  MemoryRoute,
  MemoryUserSummary,
  ProjectMetaRecord,
  ProjectShortlistCandidate,
  RecallHeaderEntry,
  RetrievalPromptDebug,
} from "../types.js";

type LoggerLike = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type ProviderHeaders = Record<string, string> | undefined;
type PromptDebugSink = (debug: RetrievalPromptDebug) => void;

const REQUEST_RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const DEFAULT_REQUEST_MAX_ATTEMPTS = 3;
const DEFAULT_REQUEST_RETRY_BASE_DELAY_MS = 1_000;

export interface FileMemoryExtractionDiscardedCandidate {
  reason: string;
  candidateType?: "user" | "feedback" | "project";
  candidateName?: string;
  summary?: string;
}

export interface FileMemoryExtractionDebug {
  parsedItems: unknown[];
  normalizedCandidates: MemoryCandidate[];
  discarded: FileMemoryExtractionDiscardedCandidate[];
  finalCandidates: MemoryCandidate[];
  fallbackApplied?: string;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatusCode(error: unknown): number | null {
  if (
    error
    && typeof error === "object"
    && "status" in error
    && typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return null;
}

function isTransientRequestError(error: unknown): boolean {
  const status = getErrorStatusCode(error);
  if (status !== null) return REQUEST_RETRYABLE_STATUS_CODES.has(status);
  if (isTimeoutError(error)) return true;
  if (!(error instanceof Error)) return false;
  return /(fetch failed|network|econnreset|econnrefused|etimedout|socket hang up|temporar|rate limit|too many requests)/i
    .test(error.message);
}

function computeRetryDelayMs(attemptIndex: number): number {
  return DEFAULT_REQUEST_RETRY_BASE_DELAY_MS * (2 ** attemptIndex);
}

function resolveRequestTimeoutMs(timeoutMs: number | undefined): number | null {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return 30_000;
  if (timeoutMs <= 0) return null;
  return timeoutMs;
}

interface ModelSelection {
  provider: string;
  model: string;
  api: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
}

interface RawUserProfilePayload {
  profile?: unknown;
  preferences?: unknown;
  constraints?: unknown;
  relationships?: unknown;
}

interface RawDreamFileGlobalPlanProjectPayload {
  plan_key?: unknown;
  target_project_id?: unknown;
  project_name?: unknown;
  description?: unknown;
  aliases?: unknown;
  status?: unknown;
  merge_reason?: unknown;
  evidence_entry_ids?: unknown;
  retained_entry_ids?: unknown;
}

interface RawDreamFileGlobalPlanPayload {
  summary?: unknown;
  duplicate_topic_count?: unknown;
  conflict_topic_count?: unknown;
  projects?: unknown;
  deleted_project_ids?: unknown;
  deleted_entry_ids?: unknown;
}

interface RawDreamFileProjectRewriteFilePayload {
  type?: unknown;
  name?: unknown;
  description?: unknown;
  source_entry_ids?: unknown;
  stage?: unknown;
  decisions?: unknown;
  constraints?: unknown;
  next_steps?: unknown;
  blockers?: unknown;
  timeline?: unknown;
  notes?: unknown;
  rule?: unknown;
  why?: unknown;
  how_to_apply?: unknown;
}

interface RawDreamFileProjectRewritePayload {
  summary?: unknown;
  project_meta?: unknown;
  files?: unknown;
  deleted_entry_ids?: unknown;
}

const DEFAULT_DREAM_FILE_PLAN_TIMEOUT_MS = 600_000;
const DEFAULT_DREAM_FILE_PROJECT_REWRITE_TIMEOUT_MS = 300_000;
const DEFAULT_USER_PROFILE_REWRITE_TIMEOUT_MS = 45_000;
const DEFAULT_FILE_MEMORY_GATE_TIMEOUT_MS = 45_000;
const DEFAULT_FILE_MEMORY_PROJECT_SELECTION_TIMEOUT_MS = 45_000;
const DEFAULT_FILE_MEMORY_SELECTION_TIMEOUT_MS = 45_000;
const DEFAULT_FILE_MEMORY_EXTRACTION_TIMEOUT_MS = 75_000;

export interface LlmDreamFileProjectMetaInput {
  projectId: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
  updatedAt: string;
  dreamUpdatedAt?: string;
}

export interface LlmDreamFileRecordInput {
  entryId: string;
  relativePath: string;
  type: "project" | "feedback";
  scope: "project";
  projectId?: string;
  isTmp: boolean;
  name: string;
  description: string;
  updatedAt: string;
  capturedAt?: string;
  sourceSessionKey?: string;
  content: string;
  project?: {
    stage: string;
    decisions: string[];
    constraints: string[];
    nextSteps: string[];
    blockers: string[];
    timeline: string[];
    notes: string[];
  };
  feedback?: {
    rule: string;
    why: string;
    howToApply: string;
    notes: string[];
  };
}

export interface LlmDreamFileGlobalPlanInput {
  currentProjects: LlmDreamFileProjectMetaInput[];
  records: LlmDreamFileRecordInput[];
  agentId?: string;
  timeoutMs?: number;
  debugTrace?: PromptDebugSink;
}

export interface LlmDreamFileGlobalPlanProject {
  planKey: string;
  targetProjectId?: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
  mergeReason?: "rename" | "alias_equivalence" | "duplicate_formal_project";
  evidenceEntryIds: string[];
  retainedEntryIds: string[];
}

export interface LlmDreamFileGlobalPlanOutput {
  summary: string;
  duplicateTopicCount: number;
  conflictTopicCount: number;
  projects: LlmDreamFileGlobalPlanProject[];
  deletedProjectIds: string[];
  deletedEntryIds: string[];
}

export interface LlmDreamFileProjectRewriteInput {
  project: LlmDreamFileGlobalPlanProject & { projectId: string };
  currentMeta: LlmDreamFileProjectMetaInput | null;
  records: LlmDreamFileRecordInput[];
  agentId?: string;
  timeoutMs?: number;
  debugTrace?: PromptDebugSink;
}

export interface LlmDreamFileProjectRewriteOutputFile {
  type: "project" | "feedback";
  name: string;
  description: string;
  sourceEntryIds: string[];
  stage?: string;
  decisions?: string[];
  constraints?: string[];
  nextSteps?: string[];
  blockers?: string[];
  timeline?: string[];
  notes?: string[];
  rule?: string;
  why?: string;
  howToApply?: string;
}

export interface LlmDreamFileProjectRewriteOutput {
  summary: string;
  projectMeta: {
    projectName: string;
    description: string;
    aliases: string[];
    status: string;
  };
  files: LlmDreamFileProjectRewriteOutputFile[];
  deletedEntryIds: string[];
}

const EXTRACTION_SYSTEM_PROMPT = `
You are a memory indexing engine for a conversational assistant.

Your job is to convert a visible user/assistant conversation into durable memory indexes.

Rules:
- Only use information explicitly present in the conversation.
- Ignore system prompts, tool scaffolding, hidden reasoning, formatting artifacts, and operational chatter.
- Be conservative. If something is ambiguous, omit it.
- Track projects only when they look like a real ongoing effort, task stream, research topic, implementation effort, or recurring problem worth revisiting later.
- "Project" here is broad: it can be a workstream, submission, research effort, health/problem thread, or other ongoing topic the user is likely to revisit.
- If the conversation contains multiple independent ongoing threads, return multiple project items instead of collapsing them into one.
- Repeated caregiving, illness handling, symptom tracking, recovery follow-up, or other ongoing real-world problem-solving threads should be treated as projects when the user is actively managing them.
- Example: "friend has diarrhea / user buys medicine / later reports recovery" is a project-like thread.
- Example: "preparing an EMNLP submission" is another independent project-like thread.
- Do not treat casual one-off mentions as projects.
- Extract facts only when they are likely to matter in future conversations: preferences, constraints, goals, identity, long-lived context, stable relationships, or durable project context.
- The facts are intermediate material for a later global profile rewrite, so prefer stable facts over temporary situation notes.
- Natural-language output fields must use the dominant language of the user messages. If user messages are mixed, prefer the most recent user language. Keys and enums must stay in English.
- Each project summary must be a compact 1-2 sentence project memory, not a generic status line.
- A good project summary should preserve: what the project is, what stage it is in now, and the next step / blocker / missing info when available.
- Do not output vague summaries like "the user is working on this project", "progress is going well", "things are okay", or "handling something" unless the project-specific context is also included.
- latest_progress must stay short and only capture the newest meaningful update, newest blocker, or newest confirmation state.
- Return valid JSON only. No markdown fences, no commentary.

Use this exact JSON shape:
{
  "summary": "short session summary",
  "situation_time_info": "short time-aware progress line",
  "facts": [
    {
      "category": "preference | profile | goal | constraint | relationship | project | context | other",
      "subject": "stable english key fragment",
      "value": "durable fact text",
      "confidence": 0.0
    }
  ],
  "projects": [
    {
      "key": "stable english identifier, lower-kebab-case",
      "name": "project name as the user would recognize it",
      "status": "planned | in_progress | done",
      "summary": "rolling 1-2 sentence summary: what this project is + current phase + next step/blocker when known",
      "latest_progress": "short latest meaningful progress or blocker, without repeating the full project background",
      "confidence": 0.0
    }
  ]
}
`.trim();

const USER_PROFILE_REWRITE_SYSTEM_PROMPT = `
You rewrite a global user profile for a conversational memory system.

Rules:
- Return JSON only.
- Keep only durable user information that should persist across future sessions.
- Preserve durable incoming facts. Do not drop a newly supplied stable preference, constraint, relationship, or identity detail unless it clearly conflicts with an older fact.
- "profile" should be a compact paragraph about the user's stable identity/background.
- "preferences" should contain long-lived personal preferences.
- "constraints" should contain durable personal boundaries, objective limits, or stable context.
- "relationships" should contain stable people/team relationships that matter later.
- Do not include project progress, project-specific collaboration rules, deadlines, blockers, or temporary tasks.
- If a field has no durable content, return an empty string or empty array.
- Keep the language aligned with the user's language in the incoming content.

Use this exact JSON shape:
{
  "profile": "compact user profile paragraph",
  "preferences": ["..."],
  "constraints": ["..."],
  "relationships": ["..."]
}
`.trim();

const STABLE_FORMAL_PROJECT_ID_PATTERN = /^project_[a-z0-9]+$/;

const DREAM_FILE_GLOBAL_PLAN_SYSTEM_PROMPT = `
You are the Dream global audit planner for a file-memory system.

Your job is to inspect existing formal and temporary project memory files, then produce a single executable reorganization plan.

Rules:
- Use only the supplied project meta files and memory file snapshots as evidence.
- Do not invent projects, files, facts, or merges that are not supported by the provided memory files.
- Decide final project boundaries globally before any rewrite happens.
- Natural-language output fields must follow the dominant language already present in the supplied records and project metas.
- If the supplied evidence is mainly Chinese, write summaries, project_name, description, aliases, and any other natural-language output in Chinese.
- Keys and enums must remain in English.
- Different explicit user-named projects must remain separate by default.
- Similar project names, shared prefixes, or small wording differences do NOT imply the same project.
- Shared domain, shared workflow, shared delivery rules, or the same user are NOT sufficient evidence for a merge.
- Do not create a broader umbrella project that absorbs multiple more specific user-named projects.
- If two explicit project names can both stand on their own as valid user projects, keep them separate unless the evidence explicitly shows rename, alias equivalence, or duplicate formal identity.
- duplicate_formal_project is only for multiple already-existing formal project identities that are actually duplicates. Do not use duplicate_formal_project for two tmp-only project groups.
- If two tmp project groups have different explicit project names, keep them separate unless the evidence explicitly proves rename or alias equivalence.
- Example of keep-separate: "城市咖啡探店爆文" and "城市咖啡馆探店爆文" are two different projects unless the supplied files explicitly say one was renamed from the other or that they are aliases of the same project.
- You may:
  - attach tmp files to an existing formal project
  - merge two formal projects into one surviving formal project
  - keep a tmp-only group as a brand-new formal project
  - delete an old formal project only when its surviving content is fully absorbed elsewhere
- If you merge entries from multiple distinct explicit project names into one final project, you must provide:
  - merge_reason: one of rename, alias_equivalence, duplicate_formal_project
  - evidence_entry_ids: retained entry ids that directly support the merge
- evidence_entry_ids must point to explicit rename, alias, or duplicate-identity evidence, not merely overlapping topics, same domain, shared workflow, or shared feedback.
- If you are not fully sure a merge is warranted, keep the projects separate.
- Each retained entry id must appear in exactly one output project.
- deleted_entry_ids should only include files that are redundant, superseded, or absorbed by other rewritten files.
- deleted_project_ids should only include existing formal project ids that are fully absorbed.
- Keep project names user-recognizable and aliases concise.
- Return valid JSON only.

Use this exact JSON shape:
{
  "summary": "short audit summary",
  "duplicate_topic_count": 0,
  "conflict_topic_count": 0,
  "projects": [
    {
      "plan_key": "stable planner-local key",
      "target_project_id": "existing formal project id or empty string",
      "project_name": "final project name",
      "description": "final project description",
      "aliases": ["alias 1", "alias 2"],
      "status": "active",
      "merge_reason": "",
      "evidence_entry_ids": ["projects/project_x/Project/current-stage.md"],
      "retained_entry_ids": ["projects/_tmp/Project/foo.md", "projects/project_x/Feedback/bar.md"]
    }
  ],
  "deleted_project_ids": ["project_old"],
  "deleted_entry_ids": ["projects/_tmp/Feedback/old.md"]
}
`.trim();

const DREAM_FILE_PROJECT_REWRITE_SYSTEM_PROMPT = `
You are the Dream project rewrite engine for a file-memory system.

Your job is to rewrite one final project from the supplied project and feedback memory files.

Rules:
- Use only the supplied records as evidence.
- Do not create a project-level summary file.
- Preserve atomic memory granularity: output a small set of project files and feedback files.
- Merge only when files are clearly redundant or conflicting enough that one cleaner file is better.
- Keep the supplied final project boundary and final project name. Do not broaden it into a more abstract umbrella project.
- Natural-language output fields must follow the dominant language already present in the supplied records and current project meta.
- If the supplied evidence is mainly Chinese, write project_meta fields and all project/feedback body fields in Chinese.
- Keys and enums must remain in English.
- Project files must describe project state: stage, decisions, constraints, next steps, blockers, timeline, notes.
- Feedback files must describe collaboration rules: rule, why, how_to_apply, notes.
- deleted_entry_ids should only include source files that are fully absorbed by rewritten files or are redundant.
- Every rewritten file must cite at least one source_entry_id from the supplied records.
- Return valid JSON only.

Use this exact JSON shape:
{
  "summary": "short rewrite summary",
  "project_meta": {
    "project_name": "final project name",
    "description": "final project description",
    "aliases": ["alias 1", "alias 2"],
    "status": "active"
  },
  "files": [
    {
      "type": "project",
      "name": "current-stage",
      "description": "current project state",
      "source_entry_ids": ["projects/_tmp/Project/a.md"],
      "stage": "current stage",
      "decisions": ["decision"],
      "constraints": ["constraint"],
      "next_steps": ["next step"],
      "blockers": ["blocker"],
      "timeline": ["timeline item"],
      "notes": ["note"]
    },
    {
      "type": "feedback",
      "name": "delivery-rule",
      "description": "delivery preference",
      "source_entry_ids": ["projects/_tmp/Feedback/b.md"],
      "rule": "the rule",
      "why": "why it matters",
      "how_to_apply": "when to apply it",
      "notes": ["note"]
    }
  ],
  "deleted_entry_ids": ["projects/_tmp/Project/obsolete.md"]
}
`.trim();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sanitizeHeaders(headers: unknown): ProviderHeaders {
  if (!isRecord(headers)) return undefined;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string" && value.trim()) next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function parseModelRef(modelRef: string | undefined, config: Record<string, unknown>): { provider: string; model: string } | undefined {
  if (typeof modelRef === "string" && modelRef.includes("/")) {
    const [provider, ...rest] = modelRef.split("/");
    const model = rest.join("/").trim();
    if (provider?.trim() && model) {
      return { provider: provider.trim(), model };
    }
  }

  const modelsConfig = isRecord(config.models) ? config.models : undefined;
  const providers = modelsConfig && isRecord(modelsConfig.providers) ? modelsConfig.providers : undefined;
  if (!providers) return undefined;

  if (typeof modelRef === "string" && modelRef.trim()) {
    const providerEntries = Object.entries(providers);
    if (providerEntries.length === 1) {
      return { provider: providerEntries[0]![0], model: modelRef.trim() };
    }
  }

  for (const [provider, providerConfig] of Object.entries(providers)) {
    if (!isRecord(providerConfig)) continue;
    const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];
    const firstModel = models.find((entry) => isRecord(entry) && typeof entry.id === "string" && entry.id.trim());
    if (firstModel && isRecord(firstModel)) {
      return { provider, model: String(firstModel.id).trim() };
    }
  }
  return undefined;
}

function resolveAgentPrimaryModel(config: Record<string, unknown>, agentId?: string): string | undefined {
  const agents = isRecord(config.agents) ? config.agents : undefined;
  const defaults = agents && isRecord(agents.defaults) ? agents.defaults : undefined;
  const defaultsModel = defaults && isRecord(defaults.model) ? defaults.model : undefined;

  if (agentId && agents && isRecord(agents[agentId])) {
    const agentConfig = agents[agentId] as Record<string, unknown>;
    const agentModel = isRecord(agentConfig.model) ? agentConfig.model : undefined;
    if (typeof agentModel?.primary === "string" && agentModel.primary.trim()) {
      return agentModel.primary.trim();
    }
  }

  if (typeof defaultsModel?.primary === "string" && defaultsModel.primary.trim()) {
    return defaultsModel.primary.trim();
  }

  return undefined;
}

function detectPreferredOutputLanguage(messages: MemoryMessage[]): string | undefined {
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  if (/[\u4e00-\u9fff]/.test(userText)) return "Simplified Chinese";
  return undefined;
}

function buildUserProfileRewritePrompt(input: {
  existingProfile: MemoryUserSummary | null;
  candidates: MemoryCandidate[];
}): string {
  return JSON.stringify({
    existing_user_profile: input.existingProfile
      ? {
          profile: truncateForPrompt(input.existingProfile.profile, 320),
          preferences: input.existingProfile.preferences.map((item) => truncateForPrompt(item, 120)).slice(0, 20),
          constraints: input.existingProfile.constraints.map((item) => truncateForPrompt(item, 120)).slice(0, 20),
          relationships: input.existingProfile.relationships.map((item) => truncateForPrompt(item, 120)).slice(0, 20),
        }
      : null,
    incoming_user_candidates: input.candidates.map((candidate) => ({
      description: truncateForPrompt(candidate.description, 180),
      profile: truncateForPrompt(candidate.profile || candidate.summary || candidate.description, 260),
      preferences: (candidate.preferences ?? []).map((item) => truncateForPrompt(item, 120)).slice(0, 10),
      constraints: (candidate.constraints ?? []).map((item) => truncateForPrompt(item, 120)).slice(0, 10),
      relationships: (candidate.relationships ?? []).map((item) => truncateForPrompt(item, 120)).slice(0, 10),
      captured_at: candidate.capturedAt ?? "",
      source_session_key: candidate.sourceSessionKey ?? "",
    })),
  }, null, 2);
}

function buildDreamFileGlobalPlanPrompt(input: LlmDreamFileGlobalPlanInput): string {
  const formalProjectNames = Array.from(new Set(
    input.currentProjects
      .map((project) => normalizeWhitespace(project.projectName))
      .filter(Boolean),
  ));
  const tmpProjectNames = Array.from(new Set(
    input.records
      .filter((record) => record.isTmp && record.type === "project")
      .map((record) => normalizeWhitespace(record.name))
      .filter(Boolean),
  ));
  return JSON.stringify({
    governance_scope: {
      mode: "dream_file_global_plan",
      primary_truth: "existing_file_memories_only",
      writable_targets: ["project.meta.md", "Project/*.md", "Feedback/*.md"],
      forbidden_outputs: ["new project-level summary file", "new summary layer"],
    },
    merge_constraints: {
      formal_project_names: formalProjectNames,
      tmp_project_names: tmpProjectNames,
      duplicate_formal_project_requires_multiple_formal_identities: true,
      distinct_tmp_project_names_remain_separate_by_default: true,
    },
    current_projects: input.currentProjects.map((project) => ({
      project_id: project.projectId,
      project_name: project.projectName,
      description: truncateForPrompt(project.description, 220),
      aliases: project.aliases.slice(0, 12),
      status: project.status,
      updated_at: project.updatedAt,
      dream_updated_at: project.dreamUpdatedAt ?? "",
    })),
    records: input.records.map((record) => ({
      entry_id: record.entryId,
      relative_path: record.relativePath,
      type: record.type,
      scope: record.scope,
      project_id: record.projectId ?? "",
      is_tmp: record.isTmp,
      name: record.name,
      description: truncateForPrompt(record.description, 220),
      updated_at: record.updatedAt,
      captured_at: record.capturedAt ?? "",
      source_session_key: record.sourceSessionKey ?? "",
      content: truncateForPrompt(record.content, 1200),
      project: record.project
        ? {
            stage: truncateForPrompt(record.project.stage, 220),
            decisions: record.project.decisions.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            constraints: record.project.constraints.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            next_steps: record.project.nextSteps.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            blockers: record.project.blockers.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            timeline: record.project.timeline.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            notes: record.project.notes.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
          }
        : undefined,
      feedback: record.feedback
        ? {
            rule: truncateForPrompt(record.feedback.rule, 220),
            why: truncateForPrompt(record.feedback.why, 220),
            how_to_apply: truncateForPrompt(record.feedback.howToApply, 220),
            notes: record.feedback.notes.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
          }
        : undefined,
    })),
  }, null, 2);
}

function buildDreamFileProjectRewritePrompt(input: LlmDreamFileProjectRewriteInput): string {
  return JSON.stringify({
    governance_scope: {
      mode: "dream_file_project_rewrite",
      primary_truth: "supplied_project_and_feedback_files",
      forbidden_outputs: ["new project-level summary file", "new summary layer"],
      final_project_id: input.project.projectId,
    },
    project: {
      project_id: input.project.projectId,
      plan_key: input.project.planKey,
      project_name: input.project.projectName,
      description: truncateForPrompt(input.project.description, 220),
      aliases: input.project.aliases.slice(0, 12),
      status: input.project.status,
      merge_reason: input.project.mergeReason ?? "",
      evidence_entry_ids: input.project.evidenceEntryIds,
      retained_entry_ids: input.project.retainedEntryIds,
    },
    current_meta: input.currentMeta
      ? {
          project_id: input.currentMeta.projectId,
          project_name: input.currentMeta.projectName,
          description: truncateForPrompt(input.currentMeta.description, 220),
          aliases: input.currentMeta.aliases.slice(0, 12),
          status: input.currentMeta.status,
          updated_at: input.currentMeta.updatedAt,
        }
      : null,
    records: input.records.map((record) => ({
      entry_id: record.entryId,
      relative_path: record.relativePath,
      type: record.type,
      is_tmp: record.isTmp,
      name: record.name,
      description: truncateForPrompt(record.description, 220),
      content: truncateForPrompt(record.content, 1200),
      project: record.project
        ? {
            stage: truncateForPrompt(record.project.stage, 220),
            decisions: record.project.decisions.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            constraints: record.project.constraints.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            next_steps: record.project.nextSteps.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            blockers: record.project.blockers.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            timeline: record.project.timeline.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
            notes: record.project.notes.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
          }
        : undefined,
      feedback: record.feedback
        ? {
            rule: truncateForPrompt(record.feedback.rule, 220),
            why: truncateForPrompt(record.feedback.why, 220),
            how_to_apply: truncateForPrompt(record.feedback.howToApply, 220),
            notes: record.feedback.notes.map((item) => truncateForPrompt(item, 140)).slice(0, 12),
          }
        : undefined,
    })),
  }, null, 2);
}

function extractFirstJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty extraction response");
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  if (start < 0) throw new Error("No JSON object found in extraction response");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }

  throw new Error("Incomplete JSON object in extraction response");
}

function slugifyKeyPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeDreamFileProjectId(value: unknown, allowedProjectIds: ReadonlySet<string>): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeWhitespace(value);
  return normalized && allowedProjectIds.has(normalized) ? normalized : undefined;
}

function normalizeDreamFileEntryIds(items: unknown, allowedEntryIds: ReadonlySet<string>, maxItems = 200): string[] {
  if (!Array.isArray(items)) return [];
  return Array.from(new Set(
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeWhitespace(item))
      .filter((item) => item && allowedEntryIds.has(item)),
  )).slice(0, maxItems);
}

function normalizeDreamFileProjectStatus(value: unknown): string {
  const normalized = typeof value === "string" ? normalizeWhitespace(value) : "";
  return truncate(normalized || "active", 80);
}

function normalizeDreamFileMergeReason(
  value: unknown,
): "rename" | "alias_equivalence" | "duplicate_formal_project" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeWhitespace(value).toLowerCase();
  switch (normalized) {
    case "rename":
    case "alias_equivalence":
    case "duplicate_formal_project":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeDreamFileGlobalPlanProject(
  item: unknown,
  allowedEntryIds: ReadonlySet<string>,
  allowedProjectIds: ReadonlySet<string>,
  fallbackIndex: number,
): LlmDreamFileGlobalPlanProject | null {
  if (!isRecord(item)) return null;
  const retainedEntryIds = normalizeDreamFileEntryIds(item.retained_entry_ids, allowedEntryIds, 400);
  if (retainedEntryIds.length === 0) return null;
  const planKey = typeof item.plan_key === "string"
    ? truncate(normalizeWhitespace(item.plan_key), 120)
    : `dream-plan-${fallbackIndex + 1}`;
  const projectName = typeof item.project_name === "string"
    ? truncate(normalizeWhitespace(item.project_name), 120)
    : "";
  const description = typeof item.description === "string"
    ? truncate(normalizeWhitespace(item.description), 320)
    : "";
  if (!projectName || !description) return null;
  const targetProjectId = normalizeDreamFileProjectId(item.target_project_id, allowedProjectIds);
  const mergeReason = normalizeDreamFileMergeReason(item.merge_reason);
  return {
    planKey,
    ...(targetProjectId ? { targetProjectId } : {}),
    projectName,
    description,
    aliases: uniqueStrings(normalizeStringArray(item.aliases, 24), 24),
    status: normalizeDreamFileProjectStatus(item.status),
    ...(mergeReason ? { mergeReason } : {}),
    evidenceEntryIds: normalizeDreamFileEntryIds(item.evidence_entry_ids, allowedEntryIds, 80),
    retainedEntryIds,
  };
}

function normalizeDreamFileProjectMetaPayload(
  value: unknown,
  fallback: { projectName: string; description: string; aliases: string[]; status: string },
): { projectName: string; description: string; aliases: string[]; status: string } {
  if (!isRecord(value)) return fallback;
  const projectName = typeof value.project_name === "string"
    ? truncate(normalizeWhitespace(value.project_name), 120)
    : fallback.projectName;
  const description = typeof value.description === "string"
    ? truncate(normalizeWhitespace(value.description), 320)
    : fallback.description;
  return {
    projectName: projectName || fallback.projectName,
    description: description || fallback.description,
    aliases: uniqueStrings(normalizeStringArray(value.aliases, 24), 24),
    status: normalizeDreamFileProjectStatus(value.status ?? fallback.status),
  };
}

function normalizeDreamFileProjectRewriteFile(
  item: unknown,
  allowedEntryIds: ReadonlySet<string>,
): LlmDreamFileProjectRewriteOutputFile | null {
  if (!isRecord(item)) return null;
  const type = item.type === "project" || item.type === "feedback" ? item.type : null;
  if (!type) return null;
  const sourceEntryIds = normalizeDreamFileEntryIds(item.source_entry_ids, allowedEntryIds, 200);
  if (sourceEntryIds.length === 0) return null;
  const name = typeof item.name === "string" ? truncate(normalizeWhitespace(item.name), 120) : "";
  const description = typeof item.description === "string" ? truncate(normalizeWhitespace(item.description), 320) : "";
  if (!name || !description) return null;
  if (type === "project") {
    const stage = typeof item.stage === "string" ? truncate(normalizeWhitespace(item.stage), 220) : "";
    return {
      type,
      name,
      description,
      sourceEntryIds,
      ...(stage ? { stage } : {}),
      decisions: uniqueStrings(normalizeStringArray(item.decisions, 20), 20),
      constraints: uniqueStrings(normalizeStringArray(item.constraints, 20), 20),
      nextSteps: uniqueStrings(normalizeStringArray(item.next_steps, 20), 20),
      blockers: uniqueStrings(normalizeStringArray(item.blockers, 20), 20),
      timeline: uniqueStrings(normalizeStringArray(item.timeline, 20), 20),
      notes: uniqueStrings(normalizeStringArray(item.notes, 20), 20),
    };
  }
  const rule = typeof item.rule === "string" ? truncate(normalizeWhitespace(item.rule), 320) : "";
  if (!rule) return null;
  return {
    type,
    name,
    description,
    sourceEntryIds,
    rule,
    ...(typeof item.why === "string" && normalizeWhitespace(item.why)
      ? { why: truncate(normalizeWhitespace(item.why), 320) }
      : {}),
    ...(typeof item.how_to_apply === "string" && normalizeWhitespace(item.how_to_apply)
      ? { howToApply: truncate(normalizeWhitespace(item.how_to_apply), 320) }
      : {}),
    notes: uniqueStrings(normalizeStringArray(item.notes, 20), 20),
  };
}

function truncateForPrompt(value: string, maxLength: number): string {
  return truncate(normalizeWhitespace(value), maxLength);
}

function normalizeStringArray(items: unknown, maxItems: number): string[] {
  if (typeof items === "string" && items.trim()) {
    return [items.trim()].slice(0, maxItems);
  }
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueStrings(items: readonly string[], maxItems: number): string[] {
  return Array.from(new Set(
    items
      .map((item) => item.trim())
      .filter(Boolean),
  )).slice(0, maxItems);
}

function pickLongest(left: string, right: string): string {
  const a = normalizeWhitespace(left);
  const b = normalizeWhitespace(right);
  if (!a) return b;
  if (!b) return a;
  return b.length >= a.length ? b : a;
}

function stripExplicitRememberLead(text: string): string {
  return normalizeWhitespace(text).replace(
    /^(?:记住(?:这些长期信息|这个长期信息|这件事|一下)?|帮我记住|请记住|另外记住|再记一个长期信息|再记一条长期信息|补充一个长期信息|补充一条长期信息)[，,:：]?\s*/i,
    "",
  ).trim();
}

function splitPreferenceHints(text: string): string[] {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/[：:]/g, "\n")
    .replace(/[；;]/g, "\n")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  return Array.from(new Set(
    normalized
      .map((line) => stripExplicitRememberLead(line))
      .filter(Boolean)
      .filter((line) => line.length >= 4),
  )).slice(0, 10);
}

function splitProfileFacts(text: string): string[] {
  return uniqueStrings(
    text
      .replace(/\r/g, "\n")
      .split(/\n|[，,；;。.!?]/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length >= 2),
    20,
  );
}

function isStableFormalProjectId(value: string | undefined): boolean {
  return STABLE_FORMAL_PROJECT_ID_PATTERN.test((value ?? "").trim());
}

function canonicalizeUserFact(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[，。；;,:：.!?]/g, "")
    .replace(/^技术栈常用/, "常用")
    .replace(/^主要使用/, "使用")
    .replace(/^我(?:现在)?常用/, "常用")
    .replace(/^我(?:平时)?更?习惯(?:使用)?/, "习惯")
    .replace(/^习惯(?:使用)?/, "习惯")
    .replace(/^使用/, "")
    .replace(/\s+/g, "");
}

function looksLikeRelationshipFact(value: string): boolean {
  return /(合作|同事|导师|朋友|家人|产品经理|团队|搭档|partner|manager)/i.test(normalizeWhitespace(value));
}

function looksLikeStrongConstraint(value: string): boolean {
  return /(必须|只能|无法|不能|受限|限制|预算|截止|deadline|过敏|禁忌|不吃|不方便|设备限制|长期使用|只用)/i
    .test(normalizeWhitespace(value));
}

function looksLikePreferenceFact(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized || looksLikeRelationshipFact(normalized)) return false;
  if (/(^| )(我是|从事|住在|居住在|来自|长期住)/i.test(normalized)) return false;
  return /(喜欢|偏好|习惯|常用|主要使用|技术栈|语言|交流|设备|Mac|Windows|Linux|TypeScript|Node\.js|Python|JavaScript)/i
    .test(normalized);
}

function dedupeFactsAgainstSection(items: string[], excluded: string[]): string[] {
  const excludedKeys = new Set(excluded.map((item) => canonicalizeUserFact(item)).filter(Boolean));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of items) {
    const normalized = normalizeWhitespace(item);
    const key = canonicalizeUserFact(normalized);
    if (!normalized || !key || excludedKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

function cleanUserProfileSections(input: {
  profile: string;
  preferences: string[];
  constraints: string[];
  relationships: string[];
}): {
  profile: string;
  preferences: string[];
  constraints: string[];
  relationships: string[];
} {
  const profile = normalizeWhitespace(input.profile);
  const profileFacts = splitProfileFacts(profile);
  const relationships = dedupeFactsAgainstSection(uniqueStrings(input.relationships, 20), []);
  const constraints = dedupeFactsAgainstSection(uniqueStrings(input.constraints, 20), relationships);
  const preferences = dedupeFactsAgainstSection(
    uniqueStrings(input.preferences, 20),
    [...relationships, ...constraints, profile, ...profileFacts],
  );
  return {
    profile,
    preferences,
    constraints,
    relationships,
  };
}

function looksLikeCollaborationRuleText(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  return /(以后回答|回答时|回复时|同步进展|代码示例|先给结论|先说完成了什么|不要写成|怎么和我协作|怎么交付|怎么汇报|请你|交付时|汇报|review|评审|写法|输出格式|回复格式|格式化输出)/i
    .test(normalized)
    || /((给我|你|请按|每次).{0,12}(交付|输出|回复|汇报).{0,20}(标题|正文|封面文案))|((先给|再给).{0,12}(标题|正文|封面文案))/i
      .test(normalized);
}

function deriveFeedbackCandidateName(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (/(交付|标题|正文|封面文案)/i.test(normalized)) return "delivery-rule";
  if (/(汇报|同步进展|风险|完成了什么)/i.test(normalized)) return "reporting-rule";
  if (/(格式|风格|写法|回复时|回答时)/i.test(normalized)) return "format-rule";
  return "collaboration-rule";
}

function looksLikeDurableUserProfileText(text: string): boolean {
  return /(我是|我来自|我住在|我长期|我平时|我一般|我更喜欢|我偏好|我习惯|我(?:现在)?常用|我的身份|我的专业|我在做|我的技术栈|长期使用|我(?:做[^，。；;\n]+时)?很在意|我比较在意|我特别在意)/i
    .test(normalizeWhitespace(text));
}

function looksLikeConcreteProjectMemoryText(text: string): boolean {
  return /(目标是|当前卡点|里程碑|要出可演示版本|要给团队试用|阶段|进展|deadline|blocker|next step|版本|试用|发布|第一版|只做|先做|不碰|约束|限制)/i
    .test(normalizeWhitespace(text));
}

function looksLikeProjectFollowUpText(text: string): boolean {
  const normalized = normalizeWhitespace(stripExplicitRememberLead(text));
  if (!normalized) return false;
  return /(接下来|下一步|下个阶段|最该补|还差|先做|先把|优先|先补|最优先|当前卡点|卡点|阻塞|受众|定位|内容角度|角度|约束|限制|不要碰|别碰|统一成|模板化|目标人群|适合打给|更适合打给|核心约束|镜头顺序|标题锚点|开头三秒)/i
    .test(normalized);
}

function looksLikeProjectNextStepText(text: string): boolean {
  return /(接下来|下一步|最该补|还差|先做|先把|优先|先补|最优先)/i.test(normalizeWhitespace(text));
}

function looksLikeProjectConstraintText(text: string): boolean {
  return /(约束|限制|不要|别碰|统一成|模板化|必须|只能|先别|不碰)/i.test(normalizeWhitespace(text));
}

function looksLikeProjectBlockerText(text: string): boolean {
  return /(卡点|阻塞|难点|问题在于|麻烦是|还差)/i.test(normalizeWhitespace(text));
}

function extractUniqueBatchProjectName(messages: MemoryMessage[]): string {
  const names = new Map<string, string>();
  for (const message of messages.filter((entry) => entry.role === "user")) {
    const value = extractProjectNameHint(message.content);
    if (!value) continue;
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, value);
  }
  return names.size === 1 ? Array.from(names.values())[0] ?? "" : "";
}

function extractProjectDescriptorHint(text: string): string {
  const patterns = [
    /(?:它|这个项目|该项目|项目)\s*是(?:一个)?\s*([^。；;\n，,]+)/i,
    /(?:这是|这会是)(?:一个)?\s*([^。；;\n，,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match?.[1] ? normalizeWhitespace(match[1]) : "";
    if (value) return truncateForPrompt(value, 220);
  }
  return "";
}

function extractProjectStageHint(text: string): string {
  const normalized = normalizeWhitespace(stripExplicitRememberLead(text));
  if (!normalized) return "";
  const patterns = [
    /((?:目前|现在|当前)[^。；;\n，,]*?(?:设计阶段|开发阶段|测试阶段|规划阶段|调研阶段|原型阶段|实现阶段|上线阶段))/i,
    /((?:还在|正在|处于)[^。；;\n，,]*?(?:设计阶段|开发阶段|测试阶段|规划阶段|调研阶段|原型阶段|实现阶段|上线阶段))/i,
    /((?:目前|现在|当前|还在|正在|处于)[^。；;\n，,]*?(?:验证阶段|摸索阶段|试水阶段))/i,
    /((?:[^。；;\n，,]{0,24})(?:验证阶段|摸索阶段|试水阶段))/i,
    /((?:设计阶段|开发阶段|测试阶段|规划阶段|调研阶段|原型阶段|实现阶段|上线阶段))/i,
    /((?:验证阶段|摸索阶段|试水阶段))/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const value = match?.[1] ? truncateForPrompt(normalizeWhitespace(match[1]), 220) : "";
    if (value) return value;
  }
  return "";
}

function extractProjectNameHint(text: string): string {
  const patterns = [
    /(?:先叫它|先叫|叫它|叫做|项目名(?:字)?(?:先)?叫(?:做)?)\s*[“"'《]?([^。；;\n，,：:（）()]{2,80})/i,
    /项目[，, ]*(?:先)?叫(?:做)?\s*[“"'《]?([^。；;\n，,：:（）()]{2,80})/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match?.[1] ? normalizeWhitespace(match[1]) : "";
    if (value) return truncate(value, 80);
  }
  return "";
}

function extractProjectAliasHints(text: string): string[] {
  const aliases: string[] = [];
  const patterns = [
    /(?:也可以把它记成|也可以记成|也叫做|也叫|别名(?:是|为)?|又叫)\s*[“"'《]?([^。；;\n，,：:（）()]{2,80})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match?.[1] ? normalizeWhitespace(match[1]) : "";
      if (value) aliases.push(truncate(value, 80));
    }
  }
  return uniqueStrings(aliases, 10);
}

function hasGenericProjectAnchor(text: string): boolean {
  return /(?:这个项目|该项目|本项目|这个东西|这件事)/i.test(normalizeWhitespace(text));
}

function isGenericProjectCandidateName(name: string): boolean {
  const normalized = normalizeWhitespace(name).toLowerCase();
  return normalized === "" || ["overview", "project", "project-item", "memory-item"].includes(normalized);
}

function isLikelyHumanReadableProjectIdentifier(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (isStableFormalProjectId(normalized)) return false;
  if (isGenericProjectCandidateName(normalized)) return false;
  return normalized.length >= 2 && normalized.length <= 80;
}

function extractProjectNameFromContent(content: string): string {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return "";
  const patterns = [
    /(?:项目名称|项目名|名称)\s*[:：]\s*([^\n。；;，,（）()]{2,80})/i,
    /(?:项目是|项目叫|先叫)\s*[“"'《]?([^。；;\n，,：:（）()]{2,80})/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const value = match?.[1] ? normalizeWhitespace(match[1]) : "";
    if (value) return truncate(value, 80);
  }
  return "";
}

function sanitizeProjectDescriptionText(text: string, projectName: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  let next = normalized
    .replace(/^(?:项目名称|项目名|名称)\s*[:：]\s*/i, "")
    .replace(/^(?:项目叫|项目是|先叫)\s*/i, "");
  if (projectName) {
    const escaped = projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next
      .replace(new RegExp(`^${escaped}\\s*[（(][^)）]+[)）]?[:：]?\\s*`), "")
      .replace(new RegExp(`^${escaped}[:：]?\\s*`), "");
  }
  next = next.replace(/^[：:，,。；;\s]+/, "");
  return truncateForPrompt(normalizeWhitespace(next), 180);
}

function extractTimelineHints(text: string): string[] {
  const lines = text
    .replace(/\r/g, "\n")
    .split(/\n|(?<=[。！？!?])/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  return Array.from(new Set(lines.filter((line) => /\b20\d{2}-\d{2}-\d{2}\b/.test(line)))).slice(0, 10);
}

function extractSingleHint(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match?.[1] ? truncateForPrompt(match[1], 220) : "";
}

function sanitizeFeedbackSectionText(value: string | undefined): string {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) return "";
  if ([
    /explicit project collaboration preference captured from the user/i,
    /project anchor is not formalized yet/i,
    /project-local collaboration instruction without a formal project id yet/i,
    /project-local collaboration rule rather than a standalone project memory/i,
    /follow this collaboration rule in future project replies unless the user overrides it/i,
    /apply this rule only after dream attaches it to a formal project context/i,
    /keep it in temporary project memory until dream can attach it to the right project/i,
  ].some((pattern) => pattern.test(normalized))) {
    return "";
  }
  return normalized;
}

function buildSyntheticProjectFollowUpCandidate(input: {
  focusText: string;
  timestamp: string;
  sessionKey?: string;
  uniqueBatchProjectName: string;
  explicitProjectName: string;
  explicitProjectAliases: string[];
  explicitProjectDescriptor: string;
  explicitProjectStage: string;
  explicitTimeline: string[];
  explicitGoal: string;
  explicitBlocker: string;
}): MemoryCandidate | null {
  const normalizedFocus = truncateForPrompt(normalizeWhitespace(stripExplicitRememberLead(input.focusText)), 220);
  if (!normalizedFocus) return null;
  const projectName = truncateForPrompt(input.explicitProjectName || input.uniqueBatchProjectName, 80);
  if (!projectName || isGenericProjectCandidateName(projectName)) return null;
  const description = truncateForPrompt(
    input.explicitProjectDescriptor
      || input.explicitGoal
      || input.explicitProjectStage
      || normalizedFocus,
    180,
  );
  return {
    type: "project",
    scope: "project",
    name: projectName,
    description,
    ...(input.explicitProjectAliases.length > 0
      ? { aliases: uniqueStrings(input.explicitProjectAliases.filter((alias) => alias !== projectName), 10) }
      : {}),
    ...(input.sessionKey ? { sourceSessionKey: input.sessionKey } : {}),
    capturedAt: input.timestamp,
    ...(input.explicitProjectStage ? { stage: input.explicitProjectStage } : {}),
    ...(looksLikeProjectConstraintText(normalizedFocus) ? { constraints: [normalizedFocus] } : {}),
    ...(looksLikeProjectNextStepText(normalizedFocus) ? { nextSteps: [normalizedFocus] } : {}),
    ...(input.explicitBlocker || looksLikeProjectBlockerText(normalizedFocus)
      ? { blockers: uniqueStrings([input.explicitBlocker, normalizedFocus].filter(Boolean), 4) }
      : {}),
    ...(input.explicitTimeline.length > 0 ? { timeline: input.explicitTimeline } : {}),
    notes: [],
  };
}

function normalizeMemoryRoute(value: unknown): MemoryRoute {
  if (value === "user" || value === "project_memory" || value === "none") {
    return value;
  }
  return "none";
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function uniqueById<T>(items: T[], getId: (item: T) => string): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(item);
  }
  return next;
}

function fallbackEvidenceNote(lines: string[], fallback = ""): string {
  const normalized = lines
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, 8);
  const joined = normalized.join("\n");
  return truncate(joined || normalizeWhitespace(fallback), 800);
}

function extractChatCompletionsText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("Invalid chat completions payload");
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("Missing chat completion message");
  }
  const content = firstChoice.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  throw new Error("Unsupported chat completion content shape");
}

function extractResponsesText(payload: unknown): string {
  if (!isRecord(payload)) throw new Error("Invalid responses payload");
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload.output)) throw new Error("Responses payload missing output");

  const chunks: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && typeof part.text === "string") chunks.push(part.text);
    }
  }
  const text = chunks.join("\n").trim();
  if (!text) throw new Error("Responses payload did not contain text");
  return text;
}

function looksLikeEnvVarName(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value);
}

export class LlmMemoryExtractor {
  constructor(
    private readonly config: Record<string, unknown>,
    private readonly runtime: Record<string, unknown> | undefined,
    private readonly logger?: LoggerLike,
  ) {}

  private resolveSelection(agentId?: string): ModelSelection {
    const modelRef = resolveAgentPrimaryModel(this.config, agentId);
    const parsed = parseModelRef(modelRef, this.config);
    if (!parsed) throw new Error("Could not resolve an OpenClaw model for memory extraction");

    const modelsConfig = isRecord(this.config.models) ? this.config.models : undefined;
    const providers = modelsConfig && isRecord(modelsConfig.providers) ? modelsConfig.providers : undefined;
    const providerConfig = providers && isRecord(providers[parsed.provider])
      ? providers[parsed.provider] as Record<string, unknown>
      : undefined;
    const configuredModel = Array.isArray(providerConfig?.models)
      ? providerConfig.models.find((item) => isRecord(item) && item.id === parsed.model)
      : undefined;
    const modelConfig = isRecord(configuredModel) ? configuredModel : undefined;

    const api = typeof modelConfig?.api === "string"
      ? modelConfig.api
      : typeof providerConfig?.api === "string"
        ? providerConfig.api
        : "openai-completions";
    const baseUrl = typeof modelConfig?.baseUrl === "string"
      ? modelConfig.baseUrl
      : typeof providerConfig?.baseUrl === "string"
        ? providerConfig.baseUrl
        : undefined;
    const headers = {
      ...sanitizeHeaders(providerConfig?.headers),
      ...sanitizeHeaders(modelConfig?.headers),
    };

    const selection: ModelSelection = {
      provider: parsed.provider,
      model: parsed.model,
      api,
    };
    if (baseUrl?.trim()) selection.baseUrl = stripTrailingSlash(baseUrl.trim());
    if (Object.keys(headers).length > 0) selection.headers = headers;
    return selection;
  }

  private async resolveApiKey(provider: string): Promise<string> {
    const modelsConfig = isRecord(this.config.models) ? this.config.models : undefined;
    const providers = modelsConfig && isRecord(modelsConfig.providers) ? modelsConfig.providers : undefined;
    const providerConfig = providers && isRecord(providers[provider])
      ? providers[provider] as Record<string, unknown>
      : undefined;
    const configured = typeof providerConfig?.apiKey === "string" ? providerConfig.apiKey.trim() : "";
    if (configured) {
      if (looksLikeEnvVarName(configured) && typeof process.env[configured] === "string" && process.env[configured]?.trim()) {
        return process.env[configured]!.trim();
      }
      return configured;
    }

    const modelAuth = this.runtime && isRecord(this.runtime.modelAuth)
      ? this.runtime.modelAuth as Record<string, unknown>
      : undefined;
    const resolver = typeof modelAuth?.resolveApiKeyForProvider === "function"
      ? modelAuth.resolveApiKeyForProvider as (params: { provider: string; cfg?: Record<string, unknown> }) => Promise<{ apiKey?: string }>
      : undefined;
    if (resolver) {
      const auth = await resolver({ provider, cfg: this.config });
      if (auth?.apiKey && String(auth.apiKey).trim()) {
        return String(auth.apiKey).trim();
      }
    }

    throw new Error(`No API key resolved for extraction provider "${provider}"`);
  }

  private async callStructuredJson(input: {
    systemPrompt: string;
    userPrompt: string;
    agentId?: string;
    requestLabel: string;
    timeoutMs?: number;
  }): Promise<string> {
    const selection = this.resolveSelection(input.agentId);
    if (!selection.baseUrl) {
      throw new Error(`${input.requestLabel} provider "${selection.provider}" does not have a baseUrl`);
    }
    const apiKey = await this.resolveApiKey(selection.provider);
    const headers = new Headers(selection.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${apiKey}`);
    const apiType = selection.api.trim().toLowerCase();
    let url = "";
    let body: Record<string, unknown>;

    if (apiType === "openai-responses" || apiType === "responses") {
      url = `${selection.baseUrl}/responses`;
      body = {
        model: selection.model,
        temperature: 0,
        input: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      };
    } else {
      url = `${selection.baseUrl}/chat/completions`;
      body = {
        model: selection.model,
        temperature: 0,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      };
    }

    const executeOnce = async (payloadBody: Record<string, unknown>): Promise<Response> => {
      const controller = new AbortController();
      const timeoutMs = resolveRequestTimeoutMs(input.timeoutMs);
      const timeoutId = timeoutMs === null ? null : setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payloadBody),
          signal: controller.signal,
        });
      } catch (error) {
        if (timeoutMs !== null && error instanceof Error && error.name === "AbortError") {
          throw new Error(`${input.requestLabel} request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    const executeWithRetry = async (payloadBody: Record<string, unknown>): Promise<Response> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < DEFAULT_REQUEST_MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await executeOnce(payloadBody);
          if (response.ok) return response;
          const errorText = await response.text();
          const error = Object.assign(
            new Error(`${input.requestLabel} request failed (${response.status}): ${truncate(errorText, 300)}`),
            { status: response.status },
          );
          lastError = error;
          if (!REQUEST_RETRYABLE_STATUS_CODES.has(response.status) || attempt >= DEFAULT_REQUEST_MAX_ATTEMPTS - 1) {
            throw error;
          }
        } catch (error) {
          lastError = error;
          if (!isTransientRequestError(error) || attempt >= DEFAULT_REQUEST_MAX_ATTEMPTS - 1) {
            throw error;
          }
        }
        await sleep(computeRetryDelayMs(attempt));
      }
      throw lastError instanceof Error ? lastError : new Error(`${input.requestLabel} request failed`);
    };

    let response: Response;
    try {
      response = await executeWithRetry(body);
    } catch (error) {
      if (!("response_format" in body)) throw error;
      const fallbackBody = { ...body };
      delete fallbackBody.response_format;
      response = await executeWithRetry(fallbackBody);
    }

    const payload = await response.json();
    return apiType === "openai-responses" || apiType === "responses"
      ? extractResponsesText(payload)
      : extractChatCompletionsText(payload);
  }

  private async callStructuredJsonWithDebug<T>(input: {
    systemPrompt: string;
    userPrompt: string;
    agentId?: string;
    requestLabel: string;
    timeoutMs?: number;
    debugTrace?: PromptDebugSink;
    parse: (raw: string) => T;
  }): Promise<T> {
    let rawResponse = "";
    try {
      rawResponse = await this.callStructuredJson(input);
      const parsedResult = input.parse(rawResponse);
      input.debugTrace?.({
        requestLabel: input.requestLabel,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        rawResponse,
        parsedResult,
      });
      return parsedResult;
    } catch (error) {
      input.debugTrace?.({
        requestLabel: input.requestLabel,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        rawResponse,
        errored: true,
        timedOut: isTimeoutError(error) || (error instanceof Error && /timed out/i.test(error.message)),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async rewriteUserProfile(input: {
    existingProfile: MemoryUserSummary | null;
    candidates: MemoryCandidate[];
    agentId?: string;
    timeoutMs?: number;
    debugTrace?: PromptDebugSink;
  }): Promise<MemoryCandidate | null> {
    const userCandidates = input.candidates.filter((candidate) => candidate.type === "user");
    if (userCandidates.length === 0) return null;

    const latestCandidate = userCandidates[userCandidates.length - 1];
    const fallbackProfile = truncate(
      pickLongest(
        input.existingProfile?.profile ?? "",
        uniqueStrings(
          userCandidates.map((candidate) => candidate.profile || candidate.summary || candidate.description),
          6,
        ).join("；"),
      ),
      400,
    );
    const fallbackPreferences = uniqueStrings([
      ...(input.existingProfile?.preferences ?? []),
      ...userCandidates.flatMap((candidate) => candidate.preferences ?? []),
    ], 20);
    const fallbackConstraints = uniqueStrings([
      ...(input.existingProfile?.constraints ?? []),
      ...userCandidates.flatMap((candidate) => candidate.constraints ?? []),
    ], 20);
    const fallbackRelationships = uniqueStrings([
      ...(input.existingProfile?.relationships ?? []),
      ...userCandidates.flatMap((candidate) => candidate.relationships ?? []),
    ], 20);

    const buildCandidate = (next: {
      profile: string;
      preferences: string[];
      constraints: string[];
      relationships: string[];
    }): MemoryCandidate | null => {
      const cleaned = cleanUserProfileSections(next);
      const profile = cleaned.profile;
      const preferences = cleaned.preferences;
      const constraints = cleaned.constraints;
      const relationships = cleaned.relationships;
      if (!profile && preferences.length === 0 && constraints.length === 0 && relationships.length === 0) {
        return null;
      }
      return {
        type: "user",
        scope: "global",
        name: "user-profile",
        description: truncateForPrompt(profile || preferences[0] || constraints[0] || relationships[0] || "User profile", 120),
        ...(latestCandidate?.capturedAt ? { capturedAt: latestCandidate.capturedAt } : {}),
        ...(latestCandidate?.sourceSessionKey ? { sourceSessionKey: latestCandidate.sourceSessionKey } : {}),
        profile,
        preferences,
        constraints,
      relationships,
      };
    };

    const mergeWithFallback = (next: {
      profile: string;
      preferences: string[];
      constraints: string[];
      relationships: string[];
    }): {
      profile: string;
      preferences: string[];
      constraints: string[];
      relationships: string[];
    } => cleanUserProfileSections({
      profile: normalizeWhitespace(next.profile) || fallbackProfile,
      preferences: uniqueStrings([...next.preferences, ...fallbackPreferences], 20),
      constraints: uniqueStrings([...next.constraints, ...fallbackConstraints], 20),
      relationships: uniqueStrings([...next.relationships, ...fallbackRelationships], 20),
    });

    try {
      const parsed = await this.callStructuredJsonWithDebug<RawUserProfilePayload>({
        systemPrompt: USER_PROFILE_REWRITE_SYSTEM_PROMPT,
        userPrompt: buildUserProfileRewritePrompt(input),
        requestLabel: "User profile rewrite",
        timeoutMs: input.timeoutMs ?? DEFAULT_USER_PROFILE_REWRITE_TIMEOUT_MS,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawUserProfilePayload,
      });
      const rewritten = buildCandidate(mergeWithFallback({
        profile: typeof parsed.profile === "string" ? truncateForPrompt(parsed.profile, 400) : "",
        preferences: normalizeStringArray(parsed.preferences, 20),
        constraints: normalizeStringArray(parsed.constraints, 20),
        relationships: normalizeStringArray(parsed.relationships, 20),
      }));
      if (rewritten) return rewritten;
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] user profile rewrite fallback: ${String(error)}`);
    }

    return buildCandidate(mergeWithFallback({
      profile: fallbackProfile,
      preferences: fallbackPreferences,
      constraints: fallbackConstraints,
      relationships: fallbackRelationships,
    }));
  }

  async planDreamFileMemory(input: LlmDreamFileGlobalPlanInput): Promise<LlmDreamFileGlobalPlanOutput> {
    if (input.records.length === 0) {
      return {
        summary: "No project memory files were available for Dream planning.",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [],
        deletedProjectIds: [],
        deletedEntryIds: [],
      };
    }

    const allowedEntryIds = new Set(input.records.map((record) => record.entryId));
    const allowedProjectIds = new Set(input.currentProjects.map((project) => project.projectId));
    const parsed = await this.callStructuredJsonWithDebug<RawDreamFileGlobalPlanPayload>({
      systemPrompt: DREAM_FILE_GLOBAL_PLAN_SYSTEM_PROMPT,
      userPrompt: buildDreamFileGlobalPlanPrompt(input),
      requestLabel: "Dream file global plan",
      timeoutMs: input.timeoutMs ?? DEFAULT_DREAM_FILE_PLAN_TIMEOUT_MS,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
      parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawDreamFileGlobalPlanPayload,
    });
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects
          .map((item, index) => normalizeDreamFileGlobalPlanProject(item, allowedEntryIds, allowedProjectIds, index))
          .filter((item): item is LlmDreamFileGlobalPlanProject => Boolean(item))
      : [];
    const deletedProjectIds = Array.from(new Set(
      normalizeStringArray(parsed.deleted_project_ids, 200)
        .map((item) => normalizeWhitespace(item))
        .filter((item) => allowedProjectIds.has(item)),
    ));
    const deletedEntryIds = normalizeDreamFileEntryIds(parsed.deleted_entry_ids, allowedEntryIds, 400);
    return {
      summary: typeof parsed.summary === "string"
        ? truncate(normalizeWhitespace(parsed.summary), 320)
        : "Dream file global plan completed.",
      duplicateTopicCount: Math.max(
        0,
        Math.floor(typeof parsed.duplicate_topic_count === "number" ? parsed.duplicate_topic_count : 0),
      ),
      conflictTopicCount: Math.max(
        0,
        Math.floor(typeof parsed.conflict_topic_count === "number" ? parsed.conflict_topic_count : 0),
      ),
      projects,
      deletedProjectIds,
      deletedEntryIds,
    };
  }

  async rewriteDreamFileProject(input: LlmDreamFileProjectRewriteInput): Promise<LlmDreamFileProjectRewriteOutput> {
    if (input.records.length === 0) {
      throw new Error("No memory files were supplied for Dream project rewrite.");
    }
    const allowedEntryIds = new Set(input.records.map((record) => record.entryId));
    const parsed = await this.callStructuredJsonWithDebug<RawDreamFileProjectRewritePayload>({
      systemPrompt: DREAM_FILE_PROJECT_REWRITE_SYSTEM_PROMPT,
      userPrompt: buildDreamFileProjectRewritePrompt(input),
      requestLabel: "Dream file project rewrite",
      timeoutMs: input.timeoutMs ?? DEFAULT_DREAM_FILE_PROJECT_REWRITE_TIMEOUT_MS,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
      parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawDreamFileProjectRewritePayload,
    });
    const files = Array.isArray(parsed.files)
      ? parsed.files
          .map((item) => normalizeDreamFileProjectRewriteFile(item, allowedEntryIds))
          .filter((item): item is LlmDreamFileProjectRewriteOutputFile => Boolean(item))
      : [];
    const fallbackMeta = {
      projectName: input.project.projectName,
      description: input.project.description,
      aliases: input.project.aliases,
      status: input.project.status,
    };
    return {
      summary: typeof parsed.summary === "string"
        ? truncate(normalizeWhitespace(parsed.summary), 320)
        : `Dream rewrite completed for ${input.project.projectName}.`,
      projectMeta: normalizeDreamFileProjectMetaPayload(parsed.project_meta, fallbackMeta),
      files,
      deletedEntryIds: normalizeDreamFileEntryIds(parsed.deleted_entry_ids, allowedEntryIds, 400),
    };
  }

  async decideFileMemoryRoute(input: {
    query: string;
    recentMessages?: MemoryMessage[];
    agentId?: string;
    timeoutMs?: number;
    debugTrace?: PromptDebugSink;
  }): Promise<MemoryRoute> {
    try {
      const parsed = await this.callStructuredJsonWithDebug<{ route?: unknown }>({
        systemPrompt: [
          "You decide whether the current query should trigger long-term memory recall.",
          "Return JSON only with a single field route.",
          "Valid route values: none, user, project_memory.",
          "Use none unless the query clearly needs long-term memory.",
          "Use user when the query is only asking about stable user preferences, profile, constraints, or relationships.",
          "Use project_memory when the query needs any project memory at all, including project status, project facts, collaboration rules, delivery style, or both.",
        ].join("\n"),
        userPrompt: JSON.stringify({
          query: input.query,
          recent_messages: (input.recentMessages ?? []).slice(-4).map((message) => ({
            role: message.role,
            content: truncateForPrompt(message.content, 220),
          })),
        }, null, 2),
        requestLabel: "File memory gate",
        timeoutMs: input.timeoutMs ?? DEFAULT_FILE_MEMORY_GATE_TIMEOUT_MS,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as { route?: unknown },
      });
      return normalizeMemoryRoute(parsed.route) || "none";
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] file memory gate fallback: ${String(error)}`);
      return "none";
    }
  }

  async selectRecallProject(input: {
    query: string;
    recentUserMessages?: MemoryMessage[];
    shortlist: ProjectShortlistCandidate[];
    agentId?: string;
    timeoutMs?: number;
    debugTrace?: PromptDebugSink;
  }): Promise<{ projectId?: string; reason?: string }> {
    if (input.shortlist.length === 0) return {};
    try {
      const parsed = await this.callStructuredJsonWithDebug<{ selected_project_id?: unknown; reason?: unknown }>({
        systemPrompt: [
          "You choose the single most relevant formal project for long-term memory recall.",
          "Return JSON only with selected_project_id and reason.",
          "Select at most one project from the provided shortlist.",
          "Use the current query first, then recent user messages only for continuation/disambiguation.",
          "Do not infer a project from assistant wording.",
          "Similar project names are distinct by default; shared domain, shared workflow, or shared feedback do not make them the same project.",
          "If the query explicitly names one shortlist project, prefer that exact project instead of broadening to a nearby or umbrella project.",
          "If multiple shortlist projects remain plausible and the evidence is not decisive, return an empty selected_project_id.",
          "If no shortlist project is clearly relevant, return an empty selected_project_id.",
        ].join("\n"),
        userPrompt: JSON.stringify({
          query: input.query,
          recent_user_messages: (input.recentUserMessages ?? []).slice(-4).map((message) => truncateForPrompt(message.content, 220)),
          shortlist: input.shortlist.map((project) => ({
            project_id: project.projectId,
            project_name: project.projectName,
            description: truncateForPrompt(project.description, 180),
            aliases: project.aliases.slice(0, 12),
            status: project.status,
            updated_at: project.updatedAt,
            shortlist_score: project.score,
            shortlist_exact: project.exact,
            shortlist_source: project.source,
            matched_text: truncateForPrompt(project.matchedText, 180),
          })),
        }, null, 2),
        requestLabel: "File memory project selection",
        timeoutMs: input.timeoutMs ?? DEFAULT_FILE_MEMORY_PROJECT_SELECTION_TIMEOUT_MS,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as { selected_project_id?: unknown; reason?: unknown },
      });
      const selectedProjectId = typeof parsed.selected_project_id === "string"
        ? parsed.selected_project_id.trim()
        : "";
      const matched = input.shortlist.find((project) => project.projectId === selectedProjectId);
      return {
        ...(matched ? { projectId: matched.projectId } : {}),
        ...(typeof parsed.reason === "string" && parsed.reason.trim()
          ? { reason: truncateForPrompt(parsed.reason, 220) }
          : {}),
      };
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] file memory project selection fallback: ${String(error)}`);
      return {};
    }
  }

  async selectFileManifestEntries(input: {
    query: string;
    route: MemoryRoute;
    recentUserMessages?: MemoryMessage[];
    projectMeta?: ProjectMetaRecord;
    manifest: RecallHeaderEntry[];
    limit?: number;
    agentId?: string;
    timeoutMs?: number;
    debugTrace?: PromptDebugSink;
  }): Promise<string[]> {
    try {
      const parsed = await this.callStructuredJsonWithDebug<{ selected_ids?: unknown }>({
        systemPrompt: [
          "You select a small number of memory files from a compact manifest.",
          "Return JSON only with selected_ids.",
          "Select at most 5 ids and prefer recent items that are directly useful for the query.",
        ].join("\n"),
        userPrompt: JSON.stringify({
          query: input.query,
          route: input.route,
          recent_user_messages: (input.recentUserMessages ?? []).slice(-4).map((message) => truncateForPrompt(message.content, 220)),
          project: input.projectMeta
            ? {
                project_id: input.projectMeta.projectId,
                project_name: input.projectMeta.projectName,
                description: truncateForPrompt(input.projectMeta.description, 180),
                aliases: input.projectMeta.aliases.slice(0, 12),
                status: input.projectMeta.status,
              }
            : null,
          manifest: input.manifest.slice(0, 200).map((entry) => ({
            id: entry.relativePath,
            type: entry.type,
            scope: entry.scope,
            project_id: entry.projectId ?? null,
            updated_at: entry.updatedAt,
            description: truncateForPrompt(entry.description, 200),
          })),
          limit: Math.max(1, Math.min(5, input.limit ?? 5)),
        }, null, 2),
        requestLabel: "File memory selection",
        timeoutMs: input.timeoutMs ?? DEFAULT_FILE_MEMORY_SELECTION_TIMEOUT_MS,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as { selected_ids?: unknown },
      });
      const selected = normalizeStringArray(parsed.selected_ids, Math.max(1, Math.min(5, input.limit ?? 5)));
      return selected;
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] file memory selection fallback: ${String(error)}`);
      return [];
    }
  }

  async extractFileMemoryCandidates(input: {
    timestamp: string;
    sessionKey?: string;
    messages: MemoryMessage[];
    batchContextMessages?: MemoryMessage[];
    explicitRemember?: boolean;
    agentId?: string;
    timeoutMs?: number;
    debugTrace?: PromptDebugSink;
    decisionTrace?: (debug: FileMemoryExtractionDebug) => void;
  }): Promise<MemoryCandidate[]> {
    const focusMessages = input.messages.filter((message) => message.role === "user");
    if (focusMessages.length === 0) return [];
    const batchContextMessages = input.batchContextMessages?.length
      ? input.batchContextMessages
      : input.messages;
    const focusText = focusMessages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");
    const explicitProjectName = extractProjectNameHint(focusText);
    const explicitProjectDescriptor = extractProjectDescriptorHint(focusText);
    const explicitProjectStage = extractProjectStageHint(focusText);
    const explicitProjectAliases = extractProjectAliasHints(focusText);
    const explicitTimeline = extractTimelineHints(focusText);
    const explicitGoal = extractSingleHint(focusText, /目标(?:是|为|:|：)?\s*([^。；;\n]+)/i);
    const explicitBlocker = extractSingleHint(focusText, /当前卡点(?:是|为)?([^。；;\n]+)/i);
    const genericProjectAnchor = hasGenericProjectAnchor(focusText);
    const uniqueBatchProjectName = extractUniqueBatchProjectName(batchContextMessages);
    const projectFollowUpSignal = looksLikeProjectFollowUpText(focusText);
    const projectDefinitionSignal = Boolean(
      explicitProjectName
      || explicitProjectDescriptor
      || explicitProjectStage
      || explicitGoal
      || explicitBlocker
      || explicitTimeline.length > 0
      || looksLikeConcreteProjectMemoryText(focusText)
    );
    const feedbackInstructionSignal = looksLikeCollaborationRuleText(focusText);

    try {
      const parsed = await this.callStructuredJsonWithDebug<{ items?: unknown[] }>({
        systemPrompt: [
          "You extract long-term memory candidates for one focus conversation turn using recent session context since the last indexing cursor.",
          "Return JSON only with an items array.",
          "Allowed item.type values: user, feedback, project.",
          "Discard anything that is too transient or not useful across future sessions.",
          "Use the batch context to interpret ambiguous references in the focus turn, but only emit memories justified by the focus user turn itself.",
          "The assistant replies in the batch context are supporting context only. Never create a memory candidate from assistant wording alone.",
          "For user items only keep stable identity, preferences, constraints, or durable relationships. Never place project state or task details inside user memory.",
          "First-person statements about the user's own long-term taste or quality bar are user memory, not feedback. Example: '我做文案时很在意标题和封面文案的一致性。' => user.",
          "If the focus turn tells the assistant how to collaborate, deliver, report, format, or structure outputs, that is feedback, not project.",
          "If the focus turn says how outputs should be delivered, such as title count, body order, cover copy, progress update order, or reply structure, you must classify it as feedback rather than project.",
          "For feedback items always provide rule, why, and how_to_apply.",
          "For feedback items: why means why the user gave this feedback, usually a past incident, strong preference, or explicit dissatisfaction. Do not invent a reason if the transcript does not contain one.",
          "For feedback items: how_to_apply means when or where this guidance should be applied, such as during progress updates, reviews, or project replies. Do not restate the rule verbatim if the application context is unclear.",
          "If the transcript gives a rule but not enough evidence for why or how_to_apply, return an empty string for those fields.",
          "Feedback belongs to a project workflow; if project_id is unclear you may omit it so the system can stage it in temporary project memory.",
          "If the batch context contains exactly one matching project identity, attach project_id to the feedback item. Otherwise leave project_id empty.",
          "For project items always prefer name plus description. project_id is optional and only for an already-known formal id such as project_xxx.",
          "If you only know the project's human-readable title, put it in name and leave project_id empty.",
          "Do not put a human-readable project title only inside project_id.",
          "For project items provide stage, decisions, constraints, next_steps, blockers, and absolute-date timeline entries when dates are mentioned. You may omit project_id when the project identity is still unclear.",
          "A project-definition turn is about project name, what the project is, its stage, goals, blockers, milestones, or timeline. A delivery rule alone is never a project item.",
          "Treat explicit project-definition statements as project memory even without a remember command. Examples: '这个项目先叫 Boreal', '它是一个本地知识库整理工具', '目前还在设计阶段'.",
          "Natural follow-up turns can still be project memory even when they do not repeat the project name.",
          "If the batch context already contains exactly one project identity, and the focus turn says things like '这个项目接下来最该补的是...', '这个方向还差...', '先把镜头顺序模板化', or mentions stage, priorities, blockers, constraints, target audience, or content angle, emit a project item for that unique project.",
          "Do not require the focus turn to repeat the project name when the batch context already makes the project identity unique.",
          "Treat explicit collaboration instructions as feedback. Example: '在这个项目里，每次给我交付时都先给3个标题，再给正文，再给封面文案。'",
          "When a transcript names a project, describes what the project is, or states its current stage, emit a project item unless the content is obviously too transient.",
          "Do not create placeholder project names like overview, project, or memory-item.",
          "Generic anchors such as '这个项目' only become project memory when the batch context provides a unique project identity.",
          "If no durable memory should be saved, return {\"items\":[]}.",
        ].join("\n"),
        userPrompt: JSON.stringify({
          timestamp: input.timestamp,
          explicit_remember: Boolean(input.explicitRemember),
          batch_context: batchContextMessages.map((message) => ({
            role: message.role,
            content: truncateForPrompt(message.content, 260),
          })),
          focus_user_turn: focusMessages.map((message) => ({
            role: message.role,
            content: truncateForPrompt(message.content, 320),
          })),
        }, null, 2),
        requestLabel: "File memory extraction",
        timeoutMs: input.timeoutMs ?? DEFAULT_FILE_MEMORY_EXTRACTION_TIMEOUT_MS,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as { items?: unknown[] },
      });
      if (!Array.isArray(parsed.items)) {
        input.decisionTrace?.({
          parsedItems: [],
          normalizedCandidates: [],
          discarded: [{
            reason: "invalid_schema",
            summary: "Model output did not contain an items array.",
          }],
          finalCandidates: [],
        });
        return [];
      }
      const discarded: FileMemoryExtractionDiscardedCandidate[] = [];
      const parsedItems = parsed.items.filter(isRecord);
      const items = parsedItems
        .map((item): MemoryCandidate | null => {
          const type = item.type === "feedback" || item.type === "project" ? item.type : item.type === "user" ? "user" : null;
          if (!type) {
            discarded.push({
              reason: "invalid_schema",
              summary: typeof item.type === "string" ? `Unsupported type: ${item.type}` : "Missing candidate type.",
            });
            return null;
          }
          const rawName = typeof item.name === "string" ? truncateForPrompt(item.name, 80) : "";
          const rawProjectName = typeof item.project_name === "string" ? truncateForPrompt(item.project_name, 80) : "";
          const rawProjectId = typeof item.project_id === "string" ? truncateForPrompt(item.project_id, 80) : "";
          const rawContent = typeof item.content === "string"
            ? truncateForPrompt(normalizeWhitespace(item.content), 280)
            : "";
          const feedbackRule = typeof item.rule === "string"
            ? truncateForPrompt(normalizeWhitespace(item.rule), 220)
            : "";
          const rawDescription = typeof item.description === "string"
            ? truncateForPrompt(item.description, 180)
            : "";
          const rawSummary = typeof item.summary === "string"
            ? truncateForPrompt(item.summary, 180)
            : "";
          const rawStage = typeof item.stage === "string"
            ? truncateForPrompt(item.stage, 220)
            : "";
          const rawGoal = typeof item.goal === "string"
            ? truncateForPrompt(normalizeWhitespace(item.goal), 180)
            : "";
          const decisions = normalizeStringArray(item.decisions, 10);
          const constraints = normalizeStringArray(item.constraints, 10);
          const nextSteps = normalizeStringArray(item.next_steps, 10);
          const blockers = normalizeStringArray(item.blockers, 10);
          const timeline = normalizeStringArray(item.timeline, 10);
          const notes = normalizeStringArray(item.notes, 10);
          const structuredProjectSummary = truncateForPrompt(
            decisions[0]
            || constraints[0]
            || nextSteps[0]
            || blockers[0]
            || timeline[0]
            || notes[0]
            || "",
            180,
          );
          if (type === "feedback" && !feedbackRule) {
            discarded.push({
              reason: "invalid_schema",
              candidateType: type,
              ...((rawName || typeof item.name === "string") ? { candidateName: rawName || String(item.name).trim() } : {}),
              summary: "Feedback candidate missing a non-empty rule.",
            });
            return null;
          }
          const recastFeedbackAsUser = type === "feedback"
            && !feedbackInstructionSignal
            && !projectDefinitionSignal
            && looksLikeDurableUserProfileText(focusText);
          const candidateType = recastFeedbackAsUser ? "user" : type;
          const projectAliases = candidateType === "project"
            ? uniqueStrings([
              ...normalizeStringArray(item.aliases, 10),
              ...explicitProjectAliases,
            ].filter((alias) => alias && alias !== explicitProjectName), 10)
            : [];
          const projectNameFallback = candidateType === "project"
            ? truncateForPrompt(
              explicitProjectName
              || rawName
              || rawProjectName
              || (isLikelyHumanReadableProjectIdentifier(rawProjectId) ? rawProjectId : "")
              || extractProjectNameFromContent(rawContent)
              || uniqueBatchProjectName,
              80,
            )
            : "";
          const description = rawDescription
            || (typeof item.profile === "string"
              ? truncateForPrompt(item.profile, 180)
              : rawContent
                ? sanitizeProjectDescriptionText(rawContent, projectNameFallback)
              : rawSummary
                ? rawSummary
                : feedbackRule
                  ? truncateForPrompt(feedbackRule, 180)
                  : rawGoal
                    ? rawGoal
                    : explicitProjectDescriptor
                      ? explicitProjectDescriptor
                    : explicitGoal
                        ? explicitGoal
                        : rawStage
                          ? truncateForPrompt(rawStage, 180)
                          : explicitProjectStage
                            ? truncateForPrompt(explicitProjectStage, 180)
                            : structuredProjectSummary);
          const normalizedProjectDescription = candidateType === "project"
            && structuredProjectSummary
            && (!description || description === explicitProjectDescriptor || description === explicitGoal)
            ? structuredProjectSummary
            : description;
          const name = candidateType === "user"
            ? "user-profile"
            : candidateType === "feedback"
              ? truncateForPrompt(rawName || deriveFeedbackCandidateName(feedbackRule), 80)
              : projectNameFallback;
          const preferences = normalizeStringArray(item.preferences, 10);
          const relationships = normalizeStringArray(item.relationships, 10);
          const hasUserPayload = Boolean(
            normalizedProjectDescription
            || rawContent
            || (typeof item.profile === "string" && normalizeWhitespace(item.profile))
            || (typeof item.summary === "string" && normalizeWhitespace(item.summary))
            || preferences.length > 0
            || constraints.length > 0
            || relationships.length > 0,
          );
          if (candidateType === "project" && (!name || !description)) {
            discarded.push({
              reason: "invalid_schema",
              candidateType,
              ...((name || rawName) ? { candidateName: name || rawName } : {}),
              summary: "Candidate missing a stable name or description.",
            });
            return null;
          }
          if (candidateType === "user" && (!name || !hasUserPayload)) {
            discarded.push({
              reason: "invalid_schema",
              candidateType,
              candidateName: "user-profile",
              summary: "User candidate did not contain any durable profile content.",
            });
            return null;
          }
          if (candidateType === "project" && isGenericProjectCandidateName(name)) {
            discarded.push({
              reason: "generic_project_name",
              candidateType,
              candidateName: name,
              summary: description,
            });
            return null;
          }
          return {
            type: candidateType,
            scope: candidateType === "user" ? "global" : "project",
            ...((candidateType === "project" || candidateType === "feedback") && typeof item.project_id === "string" && isStableFormalProjectId(item.project_id)
              ? { projectId: item.project_id.trim() }
              : {}),
            name,
            description: normalizedProjectDescription,
            ...(candidateType === "project" && projectAliases.length > 0 ? { aliases: projectAliases } : {}),
            ...(input.sessionKey ? { sourceSessionKey: input.sessionKey } : {}),
            capturedAt: input.timestamp,
            ...(typeof item.profile === "string"
              ? { profile: truncateForPrompt(item.profile, 280) }
              : rawContent
                ? { profile: rawContent }
                : candidateType === "user" && feedbackRule
                  ? { profile: feedbackRule }
                : {}),
            ...(typeof item.summary === "string" ? { summary: truncateForPrompt(item.summary, 280) } : {}),
            preferences,
            constraints,
            relationships,
            ...(candidateType === "feedback" && feedbackRule ? { rule: feedbackRule } : {}),
            ...(typeof item.why === "string" && sanitizeFeedbackSectionText(item.why)
              && candidateType === "feedback"
              ? { why: truncateForPrompt(sanitizeFeedbackSectionText(item.why), 280) }
              : {}),
            ...(typeof item.how_to_apply === "string" && sanitizeFeedbackSectionText(item.how_to_apply)
              && candidateType === "feedback"
              ? { howToApply: truncateForPrompt(sanitizeFeedbackSectionText(item.how_to_apply), 280) }
              : {}),
            ...(candidateType === "project" && rawStage ? { stage: rawStage } : {}),
            decisions,
            nextSteps,
            blockers,
            timeline,
            notes,
          };
        })
        .filter((item): item is MemoryCandidate => Boolean(item));
      const filtered = items.filter((item) => {
        const hasStructuredProjectEvidence = item.type === "project"
          && Boolean(
            item.stage
            || item.constraints?.length
            || item.decisions?.length
            || item.nextSteps?.length
            || item.blockers?.length
            || item.timeline?.length
            || item.notes?.length,
          );
        const text = [
          item.description,
          item.summary ?? "",
          item.rule ?? "",
          item.stage ?? "",
          ...(item.preferences ?? []),
          ...(item.notes ?? []),
          ...(item.nextSteps ?? []),
          ...(item.blockers ?? []),
          ...(item.timeline ?? []),
        ].join(" ");
        if (item.type === "user") {
          const keep = !looksLikeCollaborationRuleText(text) || looksLikeDurableUserProfileText(text);
          if (!keep) {
            discarded.push({
              reason: "violates_user_boundary",
              candidateType: item.type,
              candidateName: item.name,
              summary: item.description,
            });
          }
          return keep;
        }
        if (item.type === "project") {
          if (feedbackInstructionSignal && !projectDefinitionSignal) {
            discarded.push({
              reason: "violates_feedback_project_boundary",
              candidateType: item.type,
              candidateName: item.name,
              summary: item.description,
            });
            return false;
          }
          if (genericProjectAnchor && !projectDefinitionSignal && !uniqueBatchProjectName) {
            discarded.push({
              reason: "generic_anchor_without_unique_project",
              candidateType: item.type,
              candidateName: item.name,
              summary: item.description,
            });
            return false;
          }
          if (
            genericProjectAnchor
            && !projectDefinitionSignal
            && uniqueBatchProjectName
            && !hasStructuredProjectEvidence
            && !projectFollowUpSignal
            && !looksLikeConcreteProjectMemoryText(text)
            && !looksLikeProjectFollowUpText(text)
          ) {
            discarded.push({
              reason: "generic_anchor_without_project_definition",
              candidateType: item.type,
              candidateName: item.name,
              summary: item.description,
            });
            return false;
          }
        }
        if (item.type === "feedback" && projectDefinitionSignal && !feedbackInstructionSignal) {
          discarded.push({
            reason: "violates_feedback_project_boundary",
            candidateType: item.type,
            candidateName: item.name,
            summary: item.description,
          });
          return false;
        }
        return true;
      });
      const syntheticProjectFallback = filtered.length === 0
        && !feedbackInstructionSignal
        && uniqueBatchProjectName
        && (projectFollowUpSignal || (genericProjectAnchor && looksLikeConcreteProjectMemoryText(focusText)))
        ? buildSyntheticProjectFollowUpCandidate({
            focusText,
            timestamp: input.timestamp,
            ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
            uniqueBatchProjectName,
            explicitProjectName,
            explicitProjectAliases,
            explicitProjectDescriptor,
            explicitProjectStage,
            explicitTimeline,
            explicitGoal,
            explicitBlocker,
          })
        : null;
      const finalCandidates = syntheticProjectFallback ? [syntheticProjectFallback] : filtered;
      input.decisionTrace?.({
        parsedItems,
        normalizedCandidates: items,
        discarded,
        finalCandidates,
      });
      return finalCandidates;
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] file memory extraction fallback: ${String(error)}`);
      input.decisionTrace?.({
        parsedItems: [],
        normalizedCandidates: [],
        discarded: [{
          reason: "extract_error",
          summary: error instanceof Error ? error.message : String(error),
        }],
        finalCandidates: [],
      });
      return [];
    }
  }
}
