import type {
  DreamEvidenceRef,
  DreamReviewFinding,
  DreamReviewFocus,
  DreamReviewResult,
  FactCandidate,
  GlobalProfileRecord,
  IntentType,
  L0SessionRecord,
  L1WindowRecord,
  L2ProjectIndexRecord,
  L2TimeIndexRecord,
  MemoryMessage,
  ProjectDetail,
  ProjectStatus,
  RetrievalResult,
  RetrievalPromptDebug,
} from "../types.js";

type LoggerLike = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type ProviderHeaders = Record<string, string> | undefined;
type PromptDebugSink = (debug: RetrievalPromptDebug) => void;

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message));
}

function resolveRequestTimeoutMs(timeoutMs: number | undefined): number | null {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return 15_000;
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

interface RawFactItem {
  category?: unknown;
  subject?: unknown;
  value?: unknown;
  confidence?: unknown;
}

interface RawProjectItem {
  key?: unknown;
  name?: unknown;
  status?: unknown;
  summary?: unknown;
  latest_progress?: unknown;
  confidence?: unknown;
}

interface RawExtractionPayload {
  summary?: unknown;
  situation_time_info?: unknown;
  facts?: unknown;
  projects?: unknown;
}

interface RawProjectResolutionPayload {
  matched_project_key?: unknown;
  canonical_key?: unknown;
  canonical_name?: unknown;
}

interface RawProjectBatchResolutionPayload {
  projects?: unknown;
}

interface RawTopicShiftPayload {
  topic_changed?: unknown;
  topic_summary?: unknown;
}

interface RawDailySummaryPayload {
  summary?: unknown;
}

interface RawProfilePayload {
  profile_text?: unknown;
}

interface RawDreamFindingPayload {
  title?: unknown;
  rationale?: unknown;
  confidence?: unknown;
  target?: unknown;
  evidence_refs?: unknown;
}

interface RawDreamReviewPayload {
  summary?: unknown;
  project_rebuild?: unknown;
  profile_suggestions?: unknown;
  cleanup?: unknown;
  ambiguous?: unknown;
  no_action?: unknown;
}

interface RawDreamProjectPlanItemPayload {
  project_key?: unknown;
  project_name?: unknown;
  current_status?: unknown;
  summary?: unknown;
  latest_progress?: unknown;
  retained_l1_ids?: unknown;
}

interface RawDreamL1IssuePayload {
  issue_type?: unknown;
  title?: unknown;
  l1_ids?: unknown;
  related_project_keys?: unknown;
}

interface RawDreamProjectPlanPayload {
  summary?: unknown;
  duplicate_topic_count?: unknown;
  conflict_topic_count?: unknown;
  projects?: unknown;
  deleted_project_keys?: unknown;
  l1_issues?: unknown;
}

interface RawDreamGlobalProfileRewritePayload {
  profile_text?: unknown;
  source_l1_ids?: unknown;
  conflict_with_existing?: unknown;
}

interface RawReasoningPayload {
  intent?: unknown;
  enough_at?: unknown;
  use_profile?: unknown;
  l2_ids?: unknown;
  l1_ids?: unknown;
  l0_ids?: unknown;
}

interface RawHop1RoutePayload {
  query_scope?: unknown;
  effective_query?: unknown;
  memory_relevant?: unknown;
  base_only?: unknown;
  lookup_queries?: unknown;
}

interface RawHop2L2Payload {
  intent?: unknown;
  evidence_note?: unknown;
  enough_at?: unknown;
}

interface RawHop3L1Payload {
  evidence_note?: unknown;
  enough_at?: unknown;
}

interface RawHop4L0Payload {
  evidence_note?: unknown;
  enough_at?: unknown;
}

interface RawLookupQueryPayload {
  target_types?: unknown;
  lookup_query?: unknown;
  time_range?: unknown;
}

interface RawTimeRangePayload {
  start_date?: unknown;
  end_date?: unknown;
}

export interface SessionExtractionResult {
  summary: string;
  situationTimeInfo: string;
  facts: FactCandidate[];
  projectDetails: ProjectDetail[];
}

export interface LlmProjectResolutionInput {
  project: ProjectDetail;
  existingProjects: L2ProjectIndexRecord[];
  agentId?: string;
}

export interface LlmTopicShiftInput {
  currentTopicSummary: string;
  recentUserTurns: string[];
  incomingUserTurns: string[];
  agentId?: string;
}

export interface LlmTopicShiftDecision {
  topicChanged: boolean;
  topicSummary: string;
}

export interface LlmDailyTimeSummaryInput {
  dateKey: string;
  existingSummary: string;
  l1: L1WindowRecord;
  agentId?: string;
}

export interface LlmGlobalProfileInput {
  existingProfile: string;
  l1: L1WindowRecord;
  agentId?: string;
}

export interface LlmDreamReviewInput {
  focus: DreamReviewFocus;
  profile: GlobalProfileRecord | null;
  l2Projects: L2ProjectIndexRecord[];
  l1Windows: L1WindowRecord[];
  l0Sessions: L0SessionRecord[];
  evidenceRefs: DreamEvidenceRef[];
  timeLayerNotes: DreamReviewFinding[];
  agentId?: string;
}

export type LlmDreamReviewResult = Omit<DreamReviewResult, "timeLayerNotes" | "evidenceRefs">;

export interface LlmDreamProjectClusterInput {
  clusterId: string;
  label: string;
  candidateKeys: string[];
  candidateNames: string[];
  currentProjectKeys: string[];
  l1Ids: string[];
  statuses: ProjectStatus[];
  summaries: string[];
  latestProgresses: string[];
  issueHints: Array<"duplicate" | "conflict" | "isolated">;
  representativeWindows: Array<{
    l1IndexId: string;
    endedAt: string;
    summary: string;
  }>;
}

export interface LlmDreamProjectRebuildInput {
  currentProjects: L2ProjectIndexRecord[];
  profile: GlobalProfileRecord | null;
  l1Windows: L1WindowRecord[];
  l0Sessions: L0SessionRecord[];
  clusters: LlmDreamProjectClusterInput[];
  agentId?: string;
}

export interface LlmDreamL1Issue {
  issueType: "duplicate" | "conflict" | "isolated";
  title: string;
  l1Ids: string[];
  relatedProjectKeys: string[];
}

export interface LlmDreamProjectRebuildOutput {
  summary: string;
  duplicateTopicCount: number;
  conflictTopicCount: number;
  projects: Array<{
    projectKey: string;
    projectName: string;
    currentStatus: ProjectStatus;
    summary: string;
    latestProgress: string;
    retainedL1Ids: string[];
  }>;
  deletedProjectKeys: string[];
  l1Issues: LlmDreamL1Issue[];
}

export interface LlmDreamGlobalProfileRewriteInput {
  existingProfile: GlobalProfileRecord | null;
  l1Windows: L1WindowRecord[];
  currentProjects: L2ProjectIndexRecord[];
  plannedProjects: Array<{
    projectKey: string;
    projectName: string;
    currentStatus: ProjectStatus;
    summary: string;
    latestProgress: string;
    retainedL1Ids: string[];
  }>;
  l1Issues: LlmDreamL1Issue[];
  agentId?: string;
}

export interface LlmDreamGlobalProfileRewriteOutput {
  profileText: string;
  sourceL1Ids: string[];
  conflictWithExisting: boolean;
}

export interface LlmReasoningInput {
  query: string;
  profile: GlobalProfileRecord | null;
  l2Time: L2TimeIndexRecord[];
  l2Projects: L2ProjectIndexRecord[];
  l1Windows: L1WindowRecord[];
  l0Sessions: L0SessionRecord[];
  limits: {
    l2: number;
    l1: number;
    l0: number;
  };
  timeoutMs?: number;
  agentId?: string;
}

export interface LlmReasoningSelection {
  intent: IntentType;
  enoughAt: RetrievalResult["enoughAt"];
  useProfile: boolean;
  l2Ids: string[];
  l1Ids: string[];
  l0Ids: string[];
}

export interface LlmProjectBatchResolutionInput {
  projects: ProjectDetail[];
  existingProjects: L2ProjectIndexRecord[];
  agentId?: string;
}

export interface LlmProjectMemoryRewriteItem {
  incomingProject: ProjectDetail;
  existingProject: L2ProjectIndexRecord | null;
  recentWindows: L1WindowRecord[];
}

export interface LlmProjectMemoryRewriteInput {
  l1: L1WindowRecord;
  projects: LlmProjectMemoryRewriteItem[];
  agentId?: string;
}

export type LookupTargetType = "time" | "project";

export interface LlmMemoryRouteInput {
  query: string;
  profile: GlobalProfileRecord | null;
  recentMessages: MemoryMessage[];
  timeoutMs?: number;
  agentId?: string;
  debugTrace?: PromptDebugSink;
}

export interface LookupQuerySpec {
  targetTypes: LookupTargetType[];
  lookupQuery: string;
  timeRange?: {
    startDate: string;
    endDate: string;
  } | null;
}

export interface Hop1LookupDecision {
  queryScope: "standalone" | "continuation";
  effectiveQuery: string;
  memoryRelevant: boolean;
  baseOnly: boolean;
  lookupQueries: LookupQuerySpec[];
}

export interface L2CatalogEntry {
  id: string;
  type: LookupTargetType;
  label: string;
  lookupKeys: string[];
  compressedContent: string;
}

export interface LlmHop2L2Input {
  query: string;
  profile: GlobalProfileRecord | null;
  lookupQueries: LookupQuerySpec[];
  l2Entries: L2CatalogEntry[];
  catalogTruncated?: boolean;
  timeoutMs?: number;
  agentId?: string;
  debugTrace?: PromptDebugSink;
}

export interface Hop2L2Decision {
  intent: IntentType;
  evidenceNote: string;
  enoughAt: "l2" | "descend_l1" | "none";
}

export interface L0HeaderCandidate {
  l0IndexId: string;
  sessionKey: string;
  timestamp: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

export interface LlmHop3L1Input {
  query: string;
  evidenceNote: string;
  selectedL2Entries: L2CatalogEntry[];
  l1Windows: L1WindowRecord[];
  timeoutMs?: number;
  agentId?: string;
  debugTrace?: PromptDebugSink;
}

export interface Hop3L1Decision {
  evidenceNote: string;
  enoughAt: "l1" | "descend_l0" | "none";
}

export interface LlmHop4L0Input {
  query: string;
  evidenceNote: string;
  selectedL2Entries: L2CatalogEntry[];
  selectedL1Windows: L1WindowRecord[];
  l0Sessions: L0SessionRecord[];
  timeoutMs?: number;
  agentId?: string;
  debugTrace?: PromptDebugSink;
}

export interface Hop4L0Decision {
  evidenceNote: string;
  enoughAt: "l0" | "none";
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

const PROJECT_RESOLUTION_SYSTEM_PROMPT = `
You resolve whether an incoming project memory should merge into an existing project memory.

Rules:
- Prefer merging duplicates caused by wording differences, synonyms, or different granularity of the same effort.
- Match only when the underlying ongoing effort is clearly the same.
- Reuse an existing project when possible.
- If multiple labels refer to the same EMNLP submission, the same health follow-up, or the same long-running effort, merge them.
- Return JSON only.

Use this exact JSON shape:
{
  "matched_project_key": "existing project key or null",
  "canonical_key": "stable lower-kebab-case key",
  "canonical_name": "project name users would recognize"
}
`.trim();

const PROJECT_BATCH_RESOLUTION_SYSTEM_PROMPT = `
You resolve whether each incoming project memory should merge into an existing project memory.

Rules:
- Process all incoming projects together so duplicates inside the same batch can be merged.
- Prefer merging duplicates caused by wording differences, synonyms, or different granularity of the same effort.
- Reuse an existing project when possible.
- Only create a new canonical project when none of the existing projects match.
- Return JSON only.

Use this exact JSON shape:
{
  "projects": [
    {
      "incoming_key": "original incoming project key",
      "matched_project_key": "existing project key or null",
      "canonical_key": "stable lower-kebab-case key",
      "canonical_name": "project name users would recognize"
    }
  ]
}
`.trim();

const PROJECT_COMPLETION_SYSTEM_PROMPT = `
You review an extracted project list and complete any missing ongoing threads from the conversation.

Rules:
- Return the full corrected project list, not just additions.
- Include all independent ongoing threads that are likely to matter in future conversation.
- Health/caregiving/problem-management threads count as projects when the user is actively managing them.
- Resolved but substantial threads from the current window may still be kept with status "done" if they are a meaningful thread the user may refer back to.
- Example pair of separate projects in one window: "friend's stomach illness and medicine follow-up" plus "EMNLP submission preparation".
- Merge duplicates caused by wording differences.
- For each project summary, write a compact 1-2 sentence project memory that explains what the project is, what phase it is in, and the next step / blocker / missing info when available.
- Do not flatten summaries into generic text like "the user is working on something", "progress is okay", or "making progress".
- latest_progress should stay short and only describe the newest concrete update.
- Return JSON only.

Use this exact JSON shape:
{
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

const TOPIC_BOUNDARY_SYSTEM_PROMPT = `
You judge whether new user messages continue the current topic or start a new topic.

Rules:
- Use only semantic meaning, not keyword overlap.
- Treat a topic as the same if the user is still talking about the same underlying problem, project, situation, or intent.
- Treat it as changed only when the new user messages clearly pivot to a different underlying topic.
- You are given only user messages. Do not assume any assistant content.
- Return JSON only.

Use this exact JSON shape:
{
  "topic_changed": true,
  "topic_summary": "short topic summary in the user's language"
}
`.trim();

const DAILY_TIME_SUMMARY_SYSTEM_PROMPT = `
You maintain a single daily episodic memory summary for a user.

Rules:
- Focus on what happened during that day, what the user was dealing with, and the day's situation.
- Do not turn the summary into a long-term profile.
- Do not over-focus on project metadata; describe the day's lived context.
- Merge the existing daily summary with the new L1 window into one concise updated daily summary.
- Natural-language output must follow the language used by the user in the new L1 window.
- Return JSON only.

Use this exact JSON shape:
{
  "summary": "updated daily summary"
}
`.trim();

const PROJECT_MEMORY_REWRITE_SYSTEM_PROMPT = `
You maintain rolling L2 project memories for a conversational memory system.

Rules:
- Rewrite the full project memory for each incoming project using the existing L2 memory, recent linked L1 windows, and the new L1 window.
- Preserve earlier project background and major stage transitions whenever they are still useful.
- The new summary must not overwrite older context with only the newest update.
- summary must be a compact 1-2 sentence rolling project memory that preserves:
  1. what the project is,
  2. important stage progression or milestones so far,
  3. the current phase,
  4. the next step / blocker / missing info when present.
- latest_progress must stay short and only describe the newest meaningful update, blocker, or confirmation state.
- Do not output generic summaries like "the user is working on this project", "progress is going well", "things are okay", or "handling something" unless the project-specific context is explicitly preserved.
- Keep each project's incoming key stable.
- Natural-language output must follow the language used by the user in the new L1 window.
- Return JSON only.

Use this exact JSON shape:
{
  "projects": [
    {
      "key": "same stable english identifier as the incoming project",
      "name": "project name as the user would recognize it",
      "status": "planned | in_progress | done",
      "summary": "rolling 1-2 sentence project memory with background + stage progression + current phase + next step/blocker when known",
      "latest_progress": "short latest meaningful progress or blocker",
      "confidence": 0.0
    }
  ]
}
`.trim();

const GLOBAL_PROFILE_SYSTEM_PROMPT = `
You maintain a single global user profile summary.

Rules:
- Rewrite the whole profile as one concise paragraph.
- Keep only stable user traits, identity, long-term preferences, constraints, relationships, communication style, and long-range goals.
- Do not include temporary daily events, short-lived situations, or project progress updates.
- Use the existing profile plus the new L1 facts as evidence, then rewrite the full profile.
- Natural-language output must follow the user's dominant language in the new L1 window.
- Return JSON only.

Use this exact JSON shape:
{
  "profile_text": "updated stable user profile paragraph"
}
`.trim();

const DREAM_REVIEW_SYSTEM_PROMPT = `
You are a read-only Dream review engine for a layered conversational memory system.

Your job is to review recent memory quality and emit governance findings without modifying memory.

Rules:
- Treat recent L1 windows as the primary source of truth.
- Review whether current L2 project memories still match the recent L1 evidence.
- Review whether stable cross-window signals should be promoted into the global profile, or whether existing profile content now conflicts with recent evidence.
- L2Time is a diary-like time layer. Do not treat it as a semantic rewrite target. Use time-layer integrity notes only as context.
- Use L0 previews only when they help explain why an L1 window may be suspicious or ambiguous.
- Only output findings supported by the provided evidence_refs.
- Each finding must cite only ref ids that appear in the provided evidence set.
- Keep findings concise, concrete, and implementer-friendly.
- If a finding is mainly about rebuilding or merging project memories, use target="l2_project".
- If a finding is mainly about stable profile promotion or profile conflict, use target="global_profile".
- If a finding is about L1 extraction/grouping quality and should not directly rewrite higher layers yet, use target="l1_only".
- Natural-language output should follow the dominant language already used in the supplied evidence.
- Return valid JSON only.

Use this exact JSON shape:
{
  "summary": "short review summary",
  "project_rebuild": [
    {
      "title": "short finding title",
      "rationale": "why this should be reviewed or rebuilt",
      "confidence": 0.0,
      "target": "l2_project | global_profile | l1_only",
      "evidence_refs": ["ref:id"]
    }
  ],
  "profile_suggestions": [
    {
      "title": "short finding title",
      "rationale": "why this stable signal should be promoted or why profile conflicts",
      "confidence": 0.0,
      "target": "global_profile | l1_only",
      "evidence_refs": ["ref:id"]
    }
  ],
  "cleanup": [
    {
      "title": "short finding title",
      "rationale": "duplicate, stale, or noisy memory issue",
      "confidence": 0.0,
      "target": "l2_project | global_profile | l1_only",
      "evidence_refs": ["ref:id"]
    }
  ],
  "ambiguous": [
    {
      "title": "short finding title",
      "rationale": "what remains ambiguous and why more verification is needed",
      "confidence": 0.0,
      "target": "l1_only | l2_project | global_profile",
      "evidence_refs": ["ref:id"]
    }
  ],
  "no_action": [
    {
      "title": "short finding title",
      "rationale": "why this memory looks healthy and should remain as-is",
      "confidence": 0.0,
      "target": "l2_project | global_profile | l1_only",
      "evidence_refs": ["ref:id"]
    }
  ]
}
`.trim();

const DREAM_PROJECT_REBUILD_SYSTEM_PROMPT = `
You are the Dream project reconstruction planner for a layered conversational memory system.

Your job is to inspect all supplied L1 windows, current L2 project memories, and local topic clusters, then output the final L2 project set that should be written back.

Rules:
- L1 windows are the primary evidence source.
- Rebuild project memories from L1. Do not preserve an old L2 project just because it already exists.
- Merge duplicate or overlapping projects when they clearly describe the same ongoing effort.
- If a current L2 project is stale, duplicated, or no longer supported by the supplied L1 evidence, include its key in deleted_project_keys.
- Do not modify, delete, or rewrite L1. Only decide how L1 should map into rebuilt L2 projects.
- Prefer one main project owner for each L1 window. Reuse the same L1 in multiple rebuilt projects only when the overlap is genuinely necessary.
- Each rebuilt project must provide a stable project_key, human-recognizable project_name, current_status, rolling summary, latest_progress, and the retained_l1_ids that justify it.
- retained_l1_ids must only contain ids that appear in the supplied l1_windows.
- Use l1_issues only for duplicate/conflict/isolated L1 topic notes that help explain the rebuild.
- Natural-language output should follow the dominant language already present in the supplied evidence.
- Return valid JSON only.

Use this exact JSON shape:
{
  "summary": "short rebuild summary",
  "duplicate_topic_count": 0,
  "conflict_topic_count": 0,
  "projects": [
    {
      "project_key": "stable lower-kebab-case key",
      "project_name": "project name users would recognize",
      "current_status": "planned | in_progress | done",
      "summary": "compact rolling project memory",
      "latest_progress": "latest meaningful update or blocker",
      "retained_l1_ids": ["l1-1", "l1-2"]
    }
  ],
  "deleted_project_keys": ["old-project-key"],
  "l1_issues": [
    {
      "issue_type": "duplicate | conflict | isolated",
      "title": "short issue title",
      "l1_ids": ["l1-1", "l1-2"],
      "related_project_keys": ["project-key"]
    }
  ]
}
`.trim();

const DREAM_GLOBAL_PROFILE_REWRITE_SYSTEM_PROMPT = `
You are the Dream global profile rewrite engine for a layered conversational memory system.

Your job is to rewrite the global profile using only stable signals supported by the supplied L1 windows and the planned Dream project rebuild.

Rules:
- The global profile stores stable user preferences, identity, habits, constraints, working style, and long-lived relationships.
- Do not include daily events, diary-like time details, or temporary project updates.
- Use only supplied L1 windows as evidence. Do not invent new traits.
- source_l1_ids must be an exact supporting set chosen from the supplied L1 ids.
- Only include signals that are stable across multiple windows, or clearly override an older profile statement with stronger recent evidence.
- If the existing profile is still mostly valid, rewrite it conservatively instead of discarding everything.
- Natural-language output should follow the dominant language already present in the supplied evidence.
- Return valid JSON only.

Use this exact JSON shape:
{
  "profile_text": "rewritten global profile paragraph",
  "source_l1_ids": ["l1-1", "l1-2"],
  "conflict_with_existing": false
}
`.trim();

const REASONING_SYSTEM_PROMPT = `
You are a semantic memory retrieval reasoner.

Your job is to decide which memory records are relevant to the user's query.

Rules:
- Use semantic meaning, not keyword overlap.
- Use high recall for obvious paraphrases and near-synonyms.
- Temporal summary questions asking what the user did today, what happened today, or what they were recently working on should usually select L2 time indexes.
- If there is a current-day or recent-day L2 time summary and the user asks about today/recent activity, prefer that L2 time record even if wording differs.
- For project queries, prefer L2 project indexes when they already capture enough.
- For time queries, prefer L2 time indexes when they already capture enough.
- For profile/fact queries about the user's identity, preferences, habits, or stable traits, set use_profile=true when the global profile is useful.
- Select the smallest set of records needed to answer the query well.
- enough_at only refers to L2/L1/L0 structured memory. The profile is an additional supporting source.
- If L2 already captures enough, set enough_at to "l2".
- If L2 is insufficient but L1 is enough, set enough_at to "l1".
- If detailed raw conversation is needed, set enough_at to "l0".
- Return JSON only.

Use this exact JSON shape:
{
  "intent": "time | project | fact | general",
  "enough_at": "l2 | l1 | l0 | none",
  "use_profile": true,
  "l2_ids": ["l2 index id"],
  "l1_ids": ["l1 index id"],
  "l0_ids": ["l0 index id"]
}
`.trim();

const HOP1_LOOKUP_SYSTEM_PROMPT = `
You are the first-hop planner for a memory retrieval system.

Your job is not to choose concrete record ids. Your job is to decide:
1. whether the current query is standalone or a continuation of the recent conversation,
2. what the effective self-contained query should be,
3. whether this question needs dynamic memory,
4. which index types the next step should search,
5. which lookup query terms should be used for that search.

Rules:
- Use semantic meaning, not surface keyword matching.
- current_local_date is the current local date in YYYY-MM-DD format.
- global_profile is the top-level stable profile.
- recent_messages are the most recent cleaned user/assistant turns from the short-term session context.
- recent_messages are only supporting context for understanding the current query. They are not durable memory evidence.
- First decide query_scope:
  - use "continuation" only when the current query clearly depends on recent_messages to resolve omitted topic, entity, or time anchor.
  - use "standalone" when the current query is already self-contained, or when it clearly starts a new topic and should ignore old context.
- If query_scope="standalone", effective_query should restate the current query faithfully and should not inherit irrelevant topic details from recent_messages.
- If query_scope="continuation", effective_query must rewrite the current query into a short self-contained query using only the needed context from recent_messages.
- effective_query must stay close to the user's intent. Do not add new goals or assumptions.
- If the question can be answered from global_profile alone, you must set base_only=true.
- Typical base_only questions include:
  - user identity, preferences, habits, and long-term traits
  - for example: "What language do I prefer to use?"
  - for example: "What food do I usually like?"
  - for example: "Introduce me."
  - for example: "Who is Liangzi?"
  - for example: "Do you still remember me?"
- If the question asks what happened on a certain day, what happened recently, what the user was busy with today, how a project has progressed recently, or what was recommended earlier, base_only must be false.
- If base_only=false, you must output at least one lookup_queries entry.
- If base_only=true, lookup_queries must be an empty array.
- A mixed question can involve both time and project retrieval, so target_types may be ["time","project"].
- lookup_query should be a short search phrase usable by the retrieval step, not a restatement of the full rule.
- Only output time_range when the question is truly about a time range.
- time_range must be normalized to a local date range in this exact format:
  { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }
- Expressions like "today", "yesterday", "the last week", "last month", or "from March 16 to March 18" should be normalized into explicit date ranges whenever possible.
- If the question is project-related and also time-bounded, a single lookup_query may use target_types=["time","project"] and include time_range.
- Do not choose concrete record ids at this hop.
- Return JSON only. Do not explain.

Examples:
- Query: "What language do I prefer to use?"
  -> memory_relevant=true, base_only=true, lookup_queries=[]
- Query: "Introduce me."
  -> memory_relevant=true, base_only=true, lookup_queries=[]
- Query: "Who is Liangzi?"
  -> memory_relevant=true, base_only=true, lookup_queries=[]
- Query: "What was I busy with today?"
  -> memory_relevant=true, base_only=false, lookup_queries=[{"target_types":["time"],"lookup_query":"what I did today","time_range":{"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"}}]
- Query: "How is my paper progressing today?"
  -> query_scope="standalone", effective_query="How is my paper progressing today?", memory_relevant=true, base_only=false, lookup_queries=[{"target_types":["time","project"],"lookup_query":"today EMNLP paper progress","time_range":{"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"}}]
- Query: "Which Beijing barbecue place did you recommend before?"
  -> query_scope="standalone", effective_query="Which Beijing barbecue place did you recommend before?", memory_relevant=true, base_only=false, lookup_queries=[{"target_types":["project"],"lookup_query":"Beijing barbecue recommendation"}]
- recent_messages include:
    user: "我在西北旺都做了什么"
    assistant: "你主要在西北旺处理了几个工作点。"
  Query: "不够详细"
  -> query_scope="continuation", effective_query="更详细地回忆我在西北旺都做了什么", memory_relevant=true, base_only=false, lookup_queries=[{"target_types":["time","project"],"lookup_query":"西北旺 做了什么 详细回忆"}]
- recent_messages include:
    user: "最近在改 retrieval 路由"
    assistant: "主要在改 Hop1 和 L2 候选构建。"
  Query: "帮我查一下上海天气"
  -> query_scope="standalone", effective_query="帮我查一下上海天气", memory_relevant=false, base_only=false, lookup_queries=[]

Use this exact JSON shape:
{
  "query_scope": "standalone | continuation",
  "effective_query": "self-contained query",
  "memory_relevant": true,
  "base_only": false,
  "lookup_queries": [
    {
      "target_types": ["time", "project"],
      "lookup_query": "short lookup query",
      "time_range": {
        "start_date": "YYYY-MM-DD",
        "end_date": "YYYY-MM-DD"
      }
    }
  ]
}
`.trim();

const HOP2_L2_SYSTEM_PROMPT = `
You are the second-hop planner for a memory retrieval system.

You have already received the real L2 entries selected by code-side retrieval. Your job is to:
1. read the L2 evidence,
2. write an evidence_note directly relevant to the current question,
3. decide whether stopping at L2 is sufficient, or whether the system should descend to L1.

Rules:
- l2_entries are not catalog names. They already contain the compressed real L2 content.
- Use semantic meaning, not surface keyword matching.
- evidence_note must be a compact knowledge note that keeps only information relevant to answering the current query. Do not restate every entry.
- If L2 already answers the query, set enough_at="l2".
- If L2 is relevant but still insufficient and linked L1 windows should be read, set enough_at="descend_l1".
- Only set enough_at="none" when L2 genuinely does not help.
- If the query is about stable profile information, such as language preference, long-term identity, or communication style, and global_profile is already sufficient, leave evidence_note empty and set enough_at="none".
- A mixed question may include both time L2 and project L2 evidence.
- If an exact answer already appears in a project L2 latest_progress or summary, you may stop at L2 instead of forcing a descent.
- catalog_truncated=true only means older entries were omitted for prompt budget reasons; it does not make the current entries unreliable.
- Return JSON only. Do not explain.

Examples:
- Query: "What language do I prefer to use?"
  -> evidence_note="", enough_at="none"
- Query: "What was I busy with today?"
  -> derive an evidence_note from today's time L2 and set enough_at="l2"
- Query: "How is my paper progressing today?"
  -> merge today's time L2 and the related project L2 into one evidence_note
- Query: "Which Beijing barbecue place did you recommend before?"
  -> if the exact venue name already appears in project L2 latest_progress, set enough_at="l2"; otherwise set enough_at="descend_l1"

Use this exact JSON shape:
{
  "intent": "time | project | fact | general",
  "evidence_note": "condensed note from L2 evidence",
  "enough_at": "l2 | descend_l1 | none"
}
`.trim();

const HOP3_L1_SYSTEM_PROMPT = `
You are the L1 evidence-note updater for a memory retrieval system.

Your job is to read the current evidence note, selected L2 evidence, plus linked L1 windows, then update the note and decide whether L1 is enough.

Rules:
- current_evidence_note is the knowledge note produced from previous hops. Refine it instead of discarding it.
- Read the selected L2 entries as higher-level context.
- Read the candidate L1 windows as the next level of evidence.
- Do not choose L0 here.
- evidence_note should preserve only information relevant to the user's query.
- If selected L1 windows already answer the query, set enough_at="l1".
- If lower raw conversation detail is still needed, set enough_at="descend_l0".
- If neither L1 nor lower levels help, set enough_at="none".
- Return JSON only.

Use this exact JSON shape:
{
  "evidence_note": "updated note from L1 evidence",
  "enough_at": "l1 | descend_l0 | none"
}
`.trim();

const HOP4_L0_SYSTEM_PROMPT = `
You are the raw-conversation evidence-note updater for a memory retrieval system.

Your job is to read the current evidence note, selected L2 evidence, selected L1 windows, and linked raw L0 conversations, then update the note and choose whether raw L0 detail is enough.

Rules:
- current_evidence_note is the note produced by earlier hops. Refine it with exact conversation details when useful.
- Use raw L0 only when exact prior wording, exact recommendation, exact names, or other conversation-level detail is needed.
- evidence_note should be the best final note after incorporating L0 detail.
- If one or more selected L0 sessions contain the needed detail, set enough_at="l0".
- Otherwise set enough_at="none".
- Return JSON only.

Use this exact JSON shape:
{
  "evidence_note": "final note from L0 evidence",
  "enough_at": "l0 | none"
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

function parseModelRef(
  modelRef: string | undefined,
  config: Record<string, unknown>,
): { provider: string; model: string } | undefined {
  if (typeof modelRef === "string" && modelRef.includes("/")) {
    const [provider, ...rest] = modelRef.split("/");
    const model = rest.join("/").trim();
    if (provider?.trim() && model) {
      return { provider: provider.trim(), model };
    }
  }

  const modelsConfig = isRecord(config.models) ? config.models : undefined;
  const providers =
    modelsConfig && isRecord(modelsConfig.providers) ? modelsConfig.providers : undefined;
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
    const firstModel = models.find(
      (entry) => isRecord(entry) && typeof entry.id === "string" && entry.id.trim(),
    );
    if (firstModel && isRecord(firstModel)) {
      return { provider, model: String(firstModel.id).trim() };
    }
  }
  return undefined;
}

function resolveAgentPrimaryModel(
  config: Record<string, unknown>,
  agentId?: string,
): string | undefined {
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

function buildPrompt(
  timestamp: string,
  messages: MemoryMessage[],
  extraInstruction?: string,
): string {
  const conversation = messages.map((message, index) => ({
    index,
    role: message.role,
    content: message.content,
  }));
  const preferredLanguage = detectPreferredOutputLanguage(messages);

  const sections = [
    "Conversation timestamp:",
    timestamp,
    "",
    "Visible conversation messages:",
    JSON.stringify(conversation, null, 2),
    "",
    "Remember:",
    "- summary should describe the session at a glance.",
    "- situation_time_info should read like a short progress update anchored to this conversation moment.",
    "- facts should be durable and future-useful, not turn-specific noise.",
    "- projects should only include trackable ongoing efforts.",
    "- if there are two or more unrelated ongoing threads, list them as separate project entries.",
    "- health/caregiving/problem-management threads count as projects when they are ongoing across turns.",
    "- each project summary should explain what the project is, what phase it is in, and the next step or blocker when available.",
    "- avoid generic project summaries that only say progress is fine or ongoing.",
  ];
  if (preferredLanguage) {
    sections.push(`- Write all natural-language output fields in ${preferredLanguage}.`);
  }
  if (extraInstruction) {
    sections.push("", "Additional requirement:", extraInstruction);
  }
  return sections.join("\n");
}

function buildProjectCompletionPrompt(input: {
  timestamp: string;
  messages: MemoryMessage[];
  summary: string;
  facts: FactCandidate[];
  projectDetails: ProjectDetail[];
}): string {
  return JSON.stringify(
    {
      timestamp: input.timestamp,
      messages: input.messages.map((message, index) => ({
        index,
        role: message.role,
        content: truncateForPrompt(message.content, 220),
      })),
      current_summary: input.summary,
      current_facts: input.facts,
      current_projects: input.projectDetails,
      completion_goal:
        "Keep all meaningful ongoing projects. Each summary should preserve project background, current phase, and next step or blocker when available.",
    },
    null,
    2,
  );
}

function buildTopicShiftPrompt(input: LlmTopicShiftInput): string {
  return JSON.stringify(
    {
      current_topic_summary: truncateForPrompt(input.currentTopicSummary, 160),
      recent_user_turns: input.recentUserTurns
        .map((value) => truncateForPrompt(value, 180))
        .slice(-8),
      incoming_user_turns: input.incomingUserTurns
        .map((value) => truncateForPrompt(value, 180))
        .slice(-6),
    },
    null,
    2,
  );
}

function buildDailyTimeSummaryPrompt(input: LlmDailyTimeSummaryInput): string {
  return JSON.stringify(
    {
      date_key: input.dateKey,
      existing_daily_summary: truncateForPrompt(input.existingSummary, 320),
      new_l1: {
        summary: truncateForPrompt(input.l1.summary, 220),
        situation_time_info: truncateForPrompt(input.l1.situationTimeInfo, 220),
        projects: input.l1.projectDetails.map((project) => ({
          name: project.name,
          status: project.status,
          summary: truncateForPrompt(project.summary, 160),
          latest_progress: truncateForPrompt(project.latestProgress, 160),
        })),
        facts: input.l1.facts
          .map((fact) => ({
            key: fact.factKey,
            value: truncateForPrompt(fact.factValue, 120),
          }))
          .slice(0, 10),
      },
    },
    null,
    2,
  );
}

function buildProjectMemoryRewritePrompt(input: LlmProjectMemoryRewriteInput): string {
  return JSON.stringify(
    {
      current_l1: {
        id: input.l1.l1IndexId,
        time_period: input.l1.timePeriod,
        summary: truncateForPrompt(input.l1.summary, 220),
        situation_time_info: truncateForPrompt(input.l1.situationTimeInfo, 220),
        projects: input.l1.projectDetails.map((project) => ({
          key: project.key,
          name: project.name,
          status: project.status,
          summary: truncateForPrompt(project.summary, 220),
          latest_progress: truncateForPrompt(project.latestProgress, 180),
        })),
      },
      incoming_projects: input.projects.map((item) => ({
        incoming_project: {
          key: item.incomingProject.key,
          name: item.incomingProject.name,
          status: item.incomingProject.status,
          summary: truncateForPrompt(item.incomingProject.summary, 240),
          latest_progress: truncateForPrompt(item.incomingProject.latestProgress, 180),
          confidence: item.incomingProject.confidence,
        },
        existing_project_memory: item.existingProject
          ? {
              project_key: item.existingProject.projectKey,
              project_name: item.existingProject.projectName,
              status: item.existingProject.currentStatus,
              summary: truncateForPrompt(item.existingProject.summary, 320),
              latest_progress: truncateForPrompt(item.existingProject.latestProgress, 180),
            }
          : null,
        recent_stage_windows: item.recentWindows.slice(0, 5).map((window) => ({
          id: window.l1IndexId,
          time_period: window.timePeriod,
          summary: truncateForPrompt(window.summary, 180),
          situation_time_info: truncateForPrompt(window.situationTimeInfo, 180),
          matching_project_details: window.projectDetails
            .filter(
              (project) =>
                project.key === item.incomingProject.key ||
                project.name === item.incomingProject.name,
            )
            .slice(0, 2)
            .map((project) => ({
              key: project.key,
              name: project.name,
              status: project.status,
              summary: truncateForPrompt(project.summary, 180),
              latest_progress: truncateForPrompt(project.latestProgress, 160),
            })),
        })),
      })),
    },
    null,
    2,
  );
}

function buildGlobalProfilePrompt(input: LlmGlobalProfileInput): string {
  return JSON.stringify(
    {
      existing_profile: truncateForPrompt(input.existingProfile, 320),
      new_l1: {
        summary: truncateForPrompt(input.l1.summary, 220),
        situation_time_info: truncateForPrompt(input.l1.situationTimeInfo, 160),
        facts: input.l1.facts
          .map((fact) => ({
            key: fact.factKey,
            value: truncateForPrompt(fact.factValue, 140),
            confidence: fact.confidence,
          }))
          .slice(0, 16),
        projects: input.l1.projectDetails
          .map((project) => ({
            name: project.name,
            status: project.status,
            summary: truncateForPrompt(project.summary, 140),
          }))
          .slice(0, 8),
      },
    },
    null,
    2,
  );
}

function buildDreamReviewPrompt(input: LlmDreamReviewInput): string {
  return JSON.stringify(
    {
      review_focus: input.focus,
      governance_scope: {
        source_of_truth: "recent_l1_windows",
        primary_targets: ["l2_project", "global_profile"],
        time_layer_policy: "integrity_notes_only_do_not_rewrite",
        read_only: true,
      },
      current_profile: input.profile
        ? {
            id: input.profile.recordId,
            text: truncateForPrompt(input.profile.profileText, 360),
            source_l1_ids: input.profile.sourceL1Ids.slice(-12),
          }
        : null,
      current_l2_projects: input.l2Projects.map((project) => ({
        id: project.l2IndexId,
        project_key: project.projectKey,
        project_name: project.projectName,
        summary: truncateForPrompt(project.summary, 240),
        current_status: project.currentStatus,
        latest_progress: truncateForPrompt(project.latestProgress, 180),
        l1_source: project.l1Source.slice(-8),
        updated_at: project.updatedAt,
      })),
      recent_l1_windows: input.l1Windows.map((window) => ({
        id: window.l1IndexId,
        session_key: window.sessionKey,
        time_period: window.timePeriod,
        started_at: window.startedAt,
        ended_at: window.endedAt,
        summary: truncateForPrompt(window.summary, 220),
        situation_time_info: truncateForPrompt(window.situationTimeInfo, 180),
        project_details: window.projectDetails.map((project) => ({
          key: project.key,
          name: project.name,
          status: project.status,
          summary: truncateForPrompt(project.summary, 180),
          latest_progress: truncateForPrompt(project.latestProgress, 140),
          confidence: project.confidence,
        })),
        facts: window.facts
          .map((fact) => ({
            key: fact.factKey,
            value: truncateForPrompt(fact.factValue, 140),
            confidence: fact.confidence,
          }))
          .slice(0, 10),
      })),
      suspicious_l0_previews: input.l0Sessions.map((session) => ({
        id: session.l0IndexId,
        session_key: session.sessionKey,
        timestamp: session.timestamp,
        preview_messages: session.messages.slice(-4).map((message) => ({
          role: message.role,
          content: truncateForPrompt(message.content, 180),
        })),
      })),
      time_layer_integrity_notes: input.timeLayerNotes.map((note) => ({
        title: note.title,
        rationale: truncateForPrompt(note.rationale, 220),
        confidence: note.confidence,
        evidence_refs: note.evidenceRefs,
      })),
      evidence_refs: input.evidenceRefs.map((ref) => ({
        ref_id: ref.refId,
        level: ref.level,
        id: ref.id,
        label: truncateForPrompt(ref.label, 120),
        summary: truncateForPrompt(ref.summary, 220),
      })),
    },
    null,
    2,
  );
}

function buildDreamProjectRebuildPrompt(input: LlmDreamProjectRebuildInput): string {
  return JSON.stringify(
    {
      governance_scope: {
        mode: "manual_dream_rebuild",
        primary_truth: "all_l1_windows",
        writable_targets: ["l2_project"],
        read_only_targets: ["l1", "l2_time"],
        profile_context_included: Boolean(input.profile),
      },
      current_profile: input.profile
        ? {
            id: input.profile.recordId,
            text: truncateForPrompt(input.profile.profileText, 360),
            source_l1_ids: input.profile.sourceL1Ids.slice(-16),
          }
        : null,
      current_l2_projects: input.currentProjects.map((project) => ({
        id: project.l2IndexId,
        project_key: project.projectKey,
        project_name: project.projectName,
        current_status: project.currentStatus,
        summary: truncateForPrompt(project.summary, 260),
        latest_progress: truncateForPrompt(project.latestProgress, 180),
        l1_source: project.l1Source.slice(-12),
        updated_at: project.updatedAt,
      })),
      l1_windows: input.l1Windows.map((window) => ({
        id: window.l1IndexId,
        time_period: window.timePeriod,
        started_at: window.startedAt,
        ended_at: window.endedAt,
        summary: truncateForPrompt(window.summary, 220),
        situation_time_info: truncateForPrompt(window.situationTimeInfo, 180),
        facts: window.facts
          .map((fact) => ({
            key: fact.factKey,
            value: truncateForPrompt(fact.factValue, 120),
            confidence: fact.confidence,
          }))
          .slice(0, 8),
        project_details: window.projectDetails
          .map((project) => ({
            key: project.key,
            name: project.name,
            status: project.status,
            summary: truncateForPrompt(project.summary, 160),
            latest_progress: truncateForPrompt(project.latestProgress, 120),
            confidence: project.confidence,
          }))
          .slice(0, 6),
      })),
      suspicious_l0_previews: input.l0Sessions.map((session) => ({
        id: session.l0IndexId,
        session_key: session.sessionKey,
        timestamp: session.timestamp,
        preview_messages: session.messages.slice(-4).map((message) => ({
          role: message.role,
          content: truncateForPrompt(message.content, 180),
        })),
      })),
      local_clusters: input.clusters.map((cluster) => ({
        cluster_id: cluster.clusterId,
        label: truncateForPrompt(cluster.label, 120),
        candidate_keys: cluster.candidateKeys.slice(0, 8),
        candidate_names: cluster.candidateNames
          .map((value) => truncateForPrompt(value, 80))
          .slice(0, 8),
        current_project_keys: cluster.currentProjectKeys.slice(0, 8),
        l1_ids: cluster.l1Ids.slice(0, 16),
        statuses: cluster.statuses,
        summaries: cluster.summaries.map((value) => truncateForPrompt(value, 140)).slice(0, 6),
        latest_progresses: cluster.latestProgresses
          .map((value) => truncateForPrompt(value, 120))
          .slice(0, 6),
        issue_hints: cluster.issueHints,
        representative_windows: cluster.representativeWindows.slice(0, 4).map((window) => ({
          l1_index_id: window.l1IndexId,
          ended_at: window.endedAt,
          summary: truncateForPrompt(window.summary, 140),
        })),
      })),
    },
    null,
    2,
  );
}

function buildDreamGlobalProfileRewritePrompt(input: LlmDreamGlobalProfileRewriteInput): string {
  return JSON.stringify(
    {
      governance_scope: {
        mode: "manual_dream_profile_rewrite",
        stable_only: true,
        exact_source_pruning: true,
      },
      existing_profile: input.existingProfile
        ? {
            id: input.existingProfile.recordId,
            text: truncateForPrompt(input.existingProfile.profileText, 420),
            source_l1_ids: input.existingProfile.sourceL1Ids.slice(-20),
          }
        : null,
      planned_projects: input.plannedProjects.map((project) => ({
        project_key: project.projectKey,
        project_name: project.projectName,
        current_status: project.currentStatus,
        summary: truncateForPrompt(project.summary, 200),
        latest_progress: truncateForPrompt(project.latestProgress, 140),
        retained_l1_ids: project.retainedL1Ids.slice(0, 16),
      })),
      current_projects: input.currentProjects.map((project) => ({
        project_key: project.projectKey,
        project_name: project.projectName,
        current_status: project.currentStatus,
        summary: truncateForPrompt(project.summary, 180),
        l1_source: project.l1Source.slice(-12),
      })),
      l1_windows: input.l1Windows.map((window) => ({
        id: window.l1IndexId,
        ended_at: window.endedAt,
        summary: truncateForPrompt(window.summary, 220),
        situation_time_info: truncateForPrompt(window.situationTimeInfo, 160),
        facts: window.facts
          .map((fact) => ({
            key: fact.factKey,
            value: truncateForPrompt(fact.factValue, 140),
            confidence: fact.confidence,
          }))
          .slice(0, 12),
        project_details: window.projectDetails
          .map((project) => ({
            key: project.key,
            name: project.name,
            status: project.status,
          }))
          .slice(0, 6),
      })),
      l1_issues: input.l1Issues.map((issue) => ({
        issue_type: issue.issueType,
        title: truncateForPrompt(issue.title, 120),
        l1_ids: issue.l1Ids.slice(0, 12),
        related_project_keys: issue.relatedProjectKeys.slice(0, 8),
      })),
    },
    null,
    2,
  );
}

function buildHop1RoutePrompt(input: LlmMemoryRouteInput): string {
  const currentLocalDate = new Date().toLocaleDateString("en-CA");
  return JSON.stringify(
    {
      query: input.query,
      current_local_date: currentLocalDate,
      global_profile: input.profile
        ? {
            id: input.profile.recordId,
            text: truncateForPrompt(input.profile.profileText, 140),
          }
        : null,
      recent_messages: input.recentMessages.map((message) => ({
        role: message.role,
        content: truncateForPrompt(message.content, 160),
      })),
    },
    null,
    2,
  );
}

function buildHop2L2Prompt(input: LlmHop2L2Input): string {
  return JSON.stringify(
    {
      query: input.query,
      global_profile: input.profile
        ? {
            id: input.profile.recordId,
            text: truncateForPrompt(input.profile.profileText, 220),
          }
        : null,
      lookup_queries: input.lookupQueries.map((entry) => ({
        target_types: entry.targetTypes,
        lookup_query: truncateForPrompt(entry.lookupQuery, 120),
        time_range: entry.timeRange
          ? {
              start_date: entry.timeRange.startDate,
              end_date: entry.timeRange.endDate,
            }
          : null,
      })),
      catalog_truncated: Boolean(input.catalogTruncated),
      l2_entries: input.l2Entries.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        lookup_keys: item.lookupKeys.map((value) => truncateForPrompt(value, 80)).slice(0, 6),
        compressed_content: truncateForPrompt(item.compressedContent, 140),
      })),
    },
    null,
    2,
  );
}

function buildHop3L1Prompt(input: LlmHop3L1Input): string {
  return JSON.stringify(
    {
      query: input.query,
      current_evidence_note: truncateForPrompt(input.evidenceNote, 320),
      selected_l2_entries: input.selectedL2Entries.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        lookup_keys: item.lookupKeys.map((value) => truncateForPrompt(value, 80)).slice(0, 6),
        compressed_content: truncateForPrompt(item.compressedContent, 220),
      })),
      l1_windows: input.l1Windows.map((item) => ({
        id: item.l1IndexId,
        session_key: item.sessionKey,
        time_period: item.timePeriod,
        summary: truncateForPrompt(item.summary, 180),
        situation: truncateForPrompt(item.situationTimeInfo, 160),
        projects: item.projectDetails.map((project) => project.name).slice(0, 6),
      })),
    },
    null,
    2,
  );
}

function buildHop4L0Prompt(input: LlmHop4L0Input): string {
  return JSON.stringify(
    {
      query: input.query,
      current_evidence_note: truncateForPrompt(input.evidenceNote, 360),
      selected_l2_entries: input.selectedL2Entries.map((item) => ({
        id: item.id,
        type: item.type,
        label: item.label,
        lookup_keys: item.lookupKeys.map((value) => truncateForPrompt(value, 80)).slice(0, 6),
        compressed_content: truncateForPrompt(item.compressedContent, 220),
      })),
      selected_l1_windows: input.selectedL1Windows.map((item) => ({
        id: item.l1IndexId,
        session_key: item.sessionKey,
        time_period: item.timePeriod,
        summary: truncateForPrompt(item.summary, 180),
        situation: truncateForPrompt(item.situationTimeInfo, 160),
        projects: item.projectDetails.map((project) => project.name).slice(0, 6),
      })),
      l0_sessions: input.l0Sessions.map((item) => ({
        id: item.l0IndexId,
        session_key: item.sessionKey,
        timestamp: item.timestamp,
        messages: item.messages.slice(-8).map((message) => ({
          role: message.role,
          content: truncateForPrompt(message.content, 220),
        })),
      })),
    },
    null,
    2,
  );
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
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
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
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeDreamTarget(
  value: unknown,
  fallback: DreamReviewFinding["target"],
): DreamReviewFinding["target"] {
  if (
    value === "l2_project" ||
    value === "global_profile" ||
    value === "l1_only" ||
    value === "time_note"
  ) {
    return value;
  }
  return fallback;
}

function normalizeDreamEvidenceRefs(items: unknown, allowedRefs: ReadonlySet<string>): string[] {
  if (!Array.isArray(items)) return [];
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item && allowedRefs.has(item)),
    ),
  ).slice(0, 8);
}

function normalizeDreamFinding(
  item: unknown,
  allowedRefs: ReadonlySet<string>,
  fallbackTarget: DreamReviewFinding["target"],
): DreamReviewFinding | null {
  if (!isRecord(item)) return null;
  const title = typeof item.title === "string" ? normalizeWhitespace(item.title) : "";
  const rationale = typeof item.rationale === "string" ? normalizeWhitespace(item.rationale) : "";
  if (!title || !rationale) return null;
  return {
    title: truncate(title, 120),
    rationale: truncate(rationale, 320),
    confidence: clampConfidence(item.confidence, 0.65),
    target: normalizeDreamTarget(item.target, fallbackTarget),
    evidenceRefs: normalizeDreamEvidenceRefs(item.evidence_refs, allowedRefs),
  };
}

function normalizeDreamFindings(
  items: unknown,
  allowedRefs: ReadonlySet<string>,
  fallbackTarget: DreamReviewFinding["target"],
): DreamReviewFinding[] {
  if (!Array.isArray(items)) return [];
  const findings: DreamReviewFinding[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeDreamFinding(item, allowedRefs, fallbackTarget);
    if (!normalized) continue;
    const dedupeKey = `${normalized.target}:${normalized.title}:${normalized.rationale}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    findings.push(normalized);
    if (findings.length >= 8) break;
  }
  return findings;
}

function passesDreamProfileGate(
  finding: DreamReviewFinding,
  evidenceRefs: ReadonlyMap<string, DreamEvidenceRef>,
): boolean {
  const l1Count = finding.evidenceRefs.reduce((count, refId) => {
    const ref = evidenceRefs.get(refId);
    return ref?.level === "l1" ? count + 1 : count;
  }, 0);
  if (l1Count >= 2) return true;
  const hasProfileConflictContext = finding.evidenceRefs.some(
    (refId) => evidenceRefs.get(refId)?.level === "profile",
  );
  return hasProfileConflictContext && l1Count >= 1;
}

function normalizeDreamProjectKey(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? normalizeWhitespace(value) : "";
  if (!candidate) return fallback;
  return slugifyKeyPart(candidate);
}

function normalizeDreamProjectName(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? normalizeWhitespace(value) : "";
  return truncate(candidate || fallback || "Dream Project", 120);
}

function normalizeDreamL1Ids(items: unknown, allowedIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(items)) return [];
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item && allowedIds.has(item)),
    ),
  ).slice(0, 32);
}

function normalizeDreamProjectKeys(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return Array.from(
    new Set(
      items
        .filter((item): item is string => typeof item === "string")
        .map((item) => slugifyKeyPart(item))
        .filter(Boolean),
    ),
  ).slice(0, 24);
}

function normalizeDreamL1IssueType(value: unknown): LlmDreamL1Issue["issueType"] {
  if (value === "duplicate" || value === "conflict" || value === "isolated") return value;
  return "isolated";
}

function normalizeDreamProjectPlanItem(
  item: unknown,
  allowedL1Ids: ReadonlySet<string>,
): LlmDreamProjectRebuildOutput["projects"][number] | null {
  if (!isRecord(item)) return null;
  const retainedL1Ids = normalizeDreamL1Ids(item.retained_l1_ids, allowedL1Ids);
  if (retainedL1Ids.length === 0) return null;
  const projectKey = normalizeDreamProjectKey(
    item.project_key,
    retainedL1Ids[0] ?? "dream-project",
  );
  const projectName = normalizeDreamProjectName(item.project_name, projectKey);
  const summary =
    typeof item.summary === "string" ? truncate(normalizeWhitespace(item.summary), 320) : "";
  const latestProgress =
    typeof item.latest_progress === "string"
      ? truncate(normalizeWhitespace(item.latest_progress), 220)
      : "";
  return {
    projectKey,
    projectName,
    currentStatus: normalizeStatus(item.current_status),
    summary: summary || projectName,
    latestProgress: latestProgress || summary || projectName,
    retainedL1Ids,
  };
}

function normalizeDreamL1Issue(
  item: unknown,
  allowedL1Ids: ReadonlySet<string>,
): LlmDreamL1Issue | null {
  if (!isRecord(item)) return null;
  const l1Ids = normalizeDreamL1Ids(item.l1_ids, allowedL1Ids);
  if (l1Ids.length === 0) return null;
  const title =
    typeof item.title === "string" ? truncate(normalizeWhitespace(item.title), 160) : "";
  return {
    issueType: normalizeDreamL1IssueType(item.issue_type),
    title: title || `Dream issue for ${l1Ids[0]}`,
    l1Ids,
    relatedProjectKeys: normalizeDreamProjectKeys(item.related_project_keys),
  };
}

function normalizeStatus(value: unknown): ProjectStatus {
  if (typeof value !== "string") return "planned";
  const normalized = value.trim().toLowerCase();
  if (normalized === "planned") return "planned";
  if (normalized === "in_progress" || normalized === "in progress") return "in_progress";
  if (normalized === "blocked") return "in_progress";
  if (normalized === "on_hold" || normalized === "on hold") return "in_progress";
  if (normalized === "unknown") return "planned";
  if (normalized === "done" || normalized === "completed" || normalized === "complete")
    return "done";
  return "planned";
}

function buildFallbackSituationTimeInfo(timestamp: string, summary: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return summary;
  const yyyyMmDd = date.toISOString().slice(0, 10);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${yyyyMmDd} ${hour}:${minute} ${summary}`.trim();
}

function normalizeFacts(items: unknown): FactCandidate[] {
  if (!Array.isArray(items)) return [];
  const facts = new Map<string, FactCandidate>();

  for (const item of items) {
    const raw = item as RawFactItem;
    const category = typeof raw.category === "string" ? slugifyKeyPart(raw.category) : "context";
    const subject =
      typeof raw.subject === "string" && raw.subject.trim()
        ? slugifyKeyPart(raw.subject)
        : slugifyKeyPart(typeof raw.value === "string" ? raw.value : "item");
    const value = typeof raw.value === "string" ? normalizeWhitespace(raw.value) : "";
    if (!value) continue;
    const factKey = `${category}:${subject}`;
    facts.set(factKey, {
      factKey,
      factValue: truncate(value, 180),
      confidence: clampConfidence(raw.confidence, 0.65),
    });
  }

  return Array.from(facts.values()).slice(0, 12);
}

function normalizeProjectDetails(items: unknown): ProjectDetail[] {
  if (!Array.isArray(items)) return [];
  const projects = new Map<string, ProjectDetail>();

  for (const item of items) {
    const raw = item as RawProjectItem;
    const key = typeof raw.key === "string" && raw.key.trim() ? slugifyKeyPart(raw.key) : "";
    const name = typeof raw.name === "string" ? normalizeWhitespace(raw.name) : "";
    if (!name) continue;
    const stableKey = key || slugifyKeyPart(name);
    if (projects.has(stableKey)) continue;
    projects.set(stableKey, {
      key: stableKey,
      name: truncate(name, 80),
      status: normalizeStatus(raw.status),
      summary: truncate(
        typeof raw.summary === "string" ? normalizeWhitespace(raw.summary) : "",
        360,
      ),
      latestProgress: truncate(
        typeof raw.latest_progress === "string" ? normalizeWhitespace(raw.latest_progress) : "",
        220,
      ),
      confidence: clampConfidence(raw.confidence, 0.7),
    });
  }

  return Array.from(projects.values()).slice(0, 8);
}

function truncateForPrompt(value: string, maxLength: number): string {
  return truncate(normalizeWhitespace(value), maxLength);
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeTimeRange(value: unknown): { startDate: string; endDate: string } | null {
  if (!isRecord(value)) return null;
  const startDate = normalizeDateKey(value.start_date);
  const endDate = normalizeDateKey(value.end_date);
  if (!startDate || !endDate) return null;
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

function normalizeStringArray(items: unknown, maxItems: number): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeIntent(value: unknown): IntentType {
  if (value === "time" || value === "project" || value === "fact" || value === "general")
    return value;
  return "general";
}

function normalizeEnoughAt(value: unknown): RetrievalResult["enoughAt"] {
  if (value === "l2" || value === "l1" || value === "l0" || value === "none") return value;
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

function normalizeQueryScope(value: unknown): "standalone" | "continuation" {
  return value === "continuation" ? "continuation" : "standalone";
}

function normalizeEffectiveQuery(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const normalized = truncateForPrompt(value, 180);
    if (normalized) return normalized;
  }
  return fallback;
}

function normalizeLookupTargetTypes(value: unknown): LookupTargetType[] {
  if (!Array.isArray(value)) return [];
  return uniqueById(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item): item is LookupTargetType => item === "time" || item === "project"),
    (item) => item,
  );
}

function normalizeLookupQueries(
  value: unknown,
  defaultQuery: string,
  maxItems = 4,
): LookupQuerySpec[] {
  if (!Array.isArray(value)) {
    return [
      {
        targetTypes: ["time", "project"],
        lookupQuery: defaultQuery,
        timeRange: null,
      },
    ];
  }
  const normalized = value
    .filter(isRecord)
    .map((item): LookupQuerySpec | undefined => {
      const targetTypes = normalizeLookupTargetTypes(item.target_types);
      const lookupQuery =
        typeof item.lookup_query === "string" ? truncateForPrompt(item.lookup_query, 120) : "";
      if (targetTypes.length === 0 || !lookupQuery) return undefined;
      return {
        targetTypes,
        lookupQuery,
        timeRange: normalizeTimeRange(item.time_range),
      };
    })
    .filter((item): item is LookupQuerySpec => Boolean(item));
  if (normalized.length > 0) return normalized.slice(0, maxItems);
  return [
    {
      targetTypes: ["time", "project"],
      lookupQuery: defaultQuery,
      timeRange: null,
    },
  ];
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
  if (typeof payload.output_text === "string" && payload.output_text.trim())
    return payload.output_text;
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
    const providers =
      modelsConfig && isRecord(modelsConfig.providers) ? modelsConfig.providers : undefined;
    const providerConfig =
      providers && isRecord(providers[parsed.provider])
        ? (providers[parsed.provider] as Record<string, unknown>)
        : undefined;
    const configuredModel = Array.isArray(providerConfig?.models)
      ? providerConfig.models.find((item) => isRecord(item) && item.id === parsed.model)
      : undefined;
    const modelConfig = isRecord(configuredModel) ? configuredModel : undefined;

    const api =
      typeof modelConfig?.api === "string"
        ? modelConfig.api
        : typeof providerConfig?.api === "string"
          ? providerConfig.api
          : "openai-completions";
    const baseUrl =
      typeof modelConfig?.baseUrl === "string"
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
    const providers =
      modelsConfig && isRecord(modelsConfig.providers) ? modelsConfig.providers : undefined;
    const providerConfig =
      providers && isRecord(providers[provider])
        ? (providers[provider] as Record<string, unknown>)
        : undefined;
    const configured =
      typeof providerConfig?.apiKey === "string" ? providerConfig.apiKey.trim() : "";
    if (configured) {
      if (
        looksLikeEnvVarName(configured) &&
        typeof process.env[configured] === "string" &&
        process.env[configured]?.trim()
      ) {
        return process.env[configured]!.trim();
      }
      return configured;
    }

    const modelAuth =
      this.runtime && isRecord(this.runtime.modelAuth)
        ? (this.runtime.modelAuth as Record<string, unknown>)
        : undefined;
    const resolver =
      typeof modelAuth?.resolveApiKeyForProvider === "function"
        ? (modelAuth.resolveApiKeyForProvider as (params: {
            provider: string;
            cfg?: Record<string, unknown>;
          }) => Promise<{ apiKey?: string }>)
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
      throw new Error(
        `${input.requestLabel} provider "${selection.provider}" does not have a baseUrl`,
      );
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

    const execute = async (payloadBody: Record<string, unknown>): Promise<Response> => {
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

    let response = await execute(body);
    if (!response.ok && "response_format" in body) {
      const fallbackBody = { ...body };
      delete fallbackBody.response_format;
      response = await execute(fallbackBody);
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${input.requestLabel} request failed (${response.status}): ${truncate(errorText, 300)}`,
      );
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
        timedOut:
          isTimeoutError(error) || (error instanceof Error && /timed out/i.test(error.message)),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async extract(input: {
    timestamp: string;
    messages: MemoryMessage[];
    agentId?: string;
  }): Promise<SessionExtractionResult> {
    let parsed: RawExtractionPayload | undefined;
    let lastError: unknown;
    for (const extraInstruction of [
      undefined,
      "Return one complete JSON object only. Do not use ellipses, placeholders, comments, markdown fences, or trailing commas.",
    ]) {
      try {
        const rawText = await this.callStructuredJson({
          systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          userPrompt: buildPrompt(input.timestamp, input.messages, extraInstruction),
          requestLabel: "Extraction",
          timeoutMs: 20_000,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        });
        parsed = JSON.parse(extractFirstJsonObject(rawText)) as RawExtractionPayload;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!parsed) throw lastError;
    const summary = truncate(
      typeof parsed.summary === "string" ? normalizeWhitespace(parsed.summary) : "",
      280,
    );
    if (!summary) {
      throw new Error("Extraction payload did not include a usable summary");
    }

    let projectDetails = normalizeProjectDetails(parsed.projects);
    const facts = normalizeFacts(parsed.facts);
    projectDetails = await this.completeProjectDetails({
      timestamp: input.timestamp,
      messages: input.messages,
      summary,
      facts,
      projectDetails,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    const situationTimeInfoRaw =
      typeof parsed.situation_time_info === "string"
        ? normalizeWhitespace(parsed.situation_time_info)
        : "";
    const situationTimeInfo = truncate(
      situationTimeInfoRaw || buildFallbackSituationTimeInfo(input.timestamp, summary),
      220,
    );

    this.logger?.info?.(
      `[clawxmemory] llm extraction complete summary=${summary.slice(0, 60)} projects=${projectDetails.length} facts=${facts.length}`,
    );

    return {
      summary,
      situationTimeInfo,
      facts,
      projectDetails,
    };
  }

  private async completeProjectDetails(input: {
    timestamp: string;
    messages: MemoryMessage[];
    summary: string;
    facts: FactCandidate[];
    projectDetails: ProjectDetail[];
    agentId?: string;
  }): Promise<ProjectDetail[]> {
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: PROJECT_COMPLETION_SYSTEM_PROMPT,
        userPrompt: buildProjectCompletionPrompt(input),
        requestLabel: "Project completion",
        timeoutMs: 20_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawExtractionPayload;
      const completed = normalizeProjectDetails(parsed.projects);
      return completed.length > 0 ? completed : input.projectDetails;
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] project completion fallback: ${String(error)}`);
      return input.projectDetails;
    }
  }

  async judgeTopicShift(input: LlmTopicShiftInput): Promise<LlmTopicShiftDecision> {
    const fallbackSummary = truncate(
      normalizeWhitespace(
        input.currentTopicSummary ||
          input.incomingUserTurns[input.incomingUserTurns.length - 1] ||
          input.recentUserTurns[input.recentUserTurns.length - 1] ||
          "current topic",
      ),
      120,
    );
    if (input.incomingUserTurns.length === 0) {
      return { topicChanged: false, topicSummary: fallbackSummary };
    }
    if (!input.currentTopicSummary.trim() && input.recentUserTurns.length === 0) {
      return {
        topicChanged: false,
        topicSummary:
          truncate(
            input.incomingUserTurns.map((item) => normalizeWhitespace(item)).join(" / "),
            120,
          ) || fallbackSummary,
      };
    }

    try {
      const raw = await this.callStructuredJson({
        systemPrompt: TOPIC_BOUNDARY_SYSTEM_PROMPT,
        userPrompt: buildTopicShiftPrompt(input),
        requestLabel: "Topic shift",
        timeoutMs: 8_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawTopicShiftPayload;
      return {
        topicChanged: normalizeBoolean(parsed.topic_changed, false),
        topicSummary: truncate(
          typeof parsed.topic_summary === "string" && parsed.topic_summary.trim()
            ? normalizeWhitespace(parsed.topic_summary)
            : fallbackSummary,
          120,
        ),
      };
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] topic shift fallback: ${String(error)}`);
      return { topicChanged: false, topicSummary: fallbackSummary };
    }
  }

  async resolveProjectIdentity(input: LlmProjectResolutionInput): Promise<ProjectDetail> {
    if (input.existingProjects.length === 0) return input.project;
    const candidates = input.existingProjects.slice(0, 24).map((project) => ({
      project_key: project.projectKey,
      project_name: project.projectName,
      summary: truncateForPrompt(project.summary, 160),
      latest_progress: truncateForPrompt(project.latestProgress, 160),
      status: project.currentStatus,
    }));
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: PROJECT_RESOLUTION_SYSTEM_PROMPT,
        userPrompt: JSON.stringify(
          {
            incoming_project: {
              key: input.project.key,
              name: input.project.name,
              summary: input.project.summary,
              latest_progress: input.project.latestProgress,
              status: input.project.status,
            },
            existing_projects: candidates,
          },
          null,
          2,
        ),
        requestLabel: "Project resolution",
        timeoutMs: 15_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawProjectResolutionPayload;
      const matchedProjectKey =
        typeof parsed.matched_project_key === "string" ? parsed.matched_project_key.trim() : "";
      const matched = matchedProjectKey
        ? input.existingProjects.find((project) => project.projectKey === matchedProjectKey)
        : undefined;
      return {
        ...input.project,
        key:
          matched?.projectKey ??
          (typeof parsed.canonical_key === "string" && parsed.canonical_key.trim()
            ? slugifyKeyPart(parsed.canonical_key)
            : input.project.key),
        name:
          matched?.projectName ??
          (typeof parsed.canonical_name === "string" && parsed.canonical_name.trim()
            ? truncateForPrompt(parsed.canonical_name, 80)
            : input.project.name),
      };
    } catch (error) {
      this.logger?.warn?.(
        `[clawxmemory] project resolution fallback for ${input.project.key}: ${String(error)}`,
      );
      return input.project;
    }
  }

  async resolveProjectIdentities(input: LlmProjectBatchResolutionInput): Promise<ProjectDetail[]> {
    if (input.projects.length === 0 || input.existingProjects.length === 0) return input.projects;
    const candidates = input.existingProjects.slice(0, 40).map((project) => ({
      project_key: project.projectKey,
      project_name: project.projectName,
      summary: truncateForPrompt(project.summary, 140),
      latest_progress: truncateForPrompt(project.latestProgress, 140),
      status: project.currentStatus,
    }));
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: PROJECT_BATCH_RESOLUTION_SYSTEM_PROMPT,
        userPrompt: JSON.stringify(
          {
            incoming_projects: input.projects.map((project) => ({
              incoming_key: project.key,
              key: project.key,
              name: project.name,
              summary: truncateForPrompt(project.summary, 160),
              latest_progress: truncateForPrompt(project.latestProgress, 160),
              status: project.status,
            })),
            existing_projects: candidates,
          },
          null,
          2,
        ),
        requestLabel: "Project batch resolution",
        timeoutMs: 15_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawProjectBatchResolutionPayload;
      const resolutions = Array.isArray(parsed.projects) ? parsed.projects : [];
      const byIncomingKey = new Map<
        string,
        { matched?: string; canonicalKey?: string; canonicalName?: string }
      >();
      for (const item of resolutions) {
        if (!isRecord(item) || typeof item.incoming_key !== "string") continue;
        const normalized: { matched?: string; canonicalKey?: string; canonicalName?: string } = {};
        if (typeof item.matched_project_key === "string" && item.matched_project_key.trim()) {
          normalized.matched = item.matched_project_key.trim();
        }
        if (typeof item.canonical_key === "string" && item.canonical_key.trim()) {
          normalized.canonicalKey = item.canonical_key.trim();
        }
        if (typeof item.canonical_name === "string" && item.canonical_name.trim()) {
          normalized.canonicalName = item.canonical_name.trim();
        }
        byIncomingKey.set(item.incoming_key.trim(), normalized);
      }

      return input.projects.map((project) => {
        const resolution = byIncomingKey.get(project.key);
        const matched = resolution?.matched
          ? input.existingProjects.find((existing) => existing.projectKey === resolution.matched)
          : undefined;
        return {
          ...project,
          key:
            matched?.projectKey ??
            (resolution?.canonicalKey ? slugifyKeyPart(resolution.canonicalKey) : project.key),
          name:
            matched?.projectName ??
            (resolution?.canonicalName
              ? truncateForPrompt(resolution.canonicalName, 80)
              : project.name),
        };
      });
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] project batch resolution fallback: ${String(error)}`);
      return input.projects;
    }
  }

  async rewriteDailyTimeSummary(input: LlmDailyTimeSummaryInput): Promise<string> {
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: DAILY_TIME_SUMMARY_SYSTEM_PROMPT,
        userPrompt: buildDailyTimeSummaryPrompt(input),
        requestLabel: "Daily summary",
        timeoutMs: 15_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawDailySummaryPayload;
      const summary = typeof parsed.summary === "string" ? normalizeWhitespace(parsed.summary) : "";
      if (summary) return truncate(summary, 280);
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] daily summary fallback: ${String(error)}`);
    }
    return truncate(input.l1.situationTimeInfo || input.l1.summary || input.existingSummary, 280);
  }

  async rewriteProjectMemories(input: LlmProjectMemoryRewriteInput): Promise<ProjectDetail[]> {
    if (input.projects.length === 0) return [];

    const fallbackProjects = input.projects.map((item) => item.incomingProject);
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: PROJECT_MEMORY_REWRITE_SYSTEM_PROMPT,
        userPrompt: buildProjectMemoryRewritePrompt(input),
        requestLabel: "Project memory rewrite",
        timeoutMs: 20_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawExtractionPayload;
      const rewritten = normalizeProjectDetails(parsed.projects);
      if (rewritten.length === 0) throw new Error("Project memory rewrite returned no projects");

      const rewrittenByKey = new Map(rewritten.map((project) => [project.key, project]));
      return fallbackProjects.map((project) => {
        const next = rewrittenByKey.get(project.key);
        if (!next) return project;
        return {
          ...project,
          name: next.name || project.name,
          status: next.status,
          summary: next.summary || project.summary,
          latestProgress: next.latestProgress || project.latestProgress,
          confidence: Math.max(project.confidence, next.confidence),
        };
      });
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] project memory rewrite fallback: ${String(error)}`);
      throw error;
    }
  }

  async rewriteGlobalProfile(input: LlmGlobalProfileInput): Promise<string> {
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: GLOBAL_PROFILE_SYSTEM_PROMPT,
        userPrompt: buildGlobalProfilePrompt(input),
        requestLabel: "Global profile",
        timeoutMs: 15_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawProfilePayload;
      const profileText =
        typeof parsed.profile_text === "string" ? normalizeWhitespace(parsed.profile_text) : "";
      if (profileText) return truncate(profileText, 420);
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] global profile fallback: ${String(error)}`);
    }

    const fallbackFacts = input.l1.facts
      .map((fact) => fact.factValue)
      .filter(Boolean)
      .slice(0, 8)
      .join("；");
    return truncate(input.existingProfile || fallbackFacts || input.l1.summary, 420);
  }

  async reviewDream(input: LlmDreamReviewInput): Promise<LlmDreamReviewResult> {
    const emptySummary =
      input.evidenceRefs.length === 0
        ? "Not enough indexed memory evidence to run Dream review yet."
        : "No reliable Dream findings were produced from the selected evidence.";
    const emptyResult = (): LlmDreamReviewResult => ({
      summary: emptySummary,
      projectRebuild: [],
      profileSuggestions: [],
      cleanup: [],
      ambiguous: [],
      noAction: [],
    });

    if (input.evidenceRefs.length === 0) return emptyResult();

    const allowedRefs = new Set(input.evidenceRefs.map((ref) => ref.refId));
    const evidenceRefsById = new Map(input.evidenceRefs.map((ref) => [ref.refId, ref] as const));
    try {
      const raw = await this.callStructuredJson({
        systemPrompt: DREAM_REVIEW_SYSTEM_PROMPT,
        userPrompt: buildDreamReviewPrompt(input),
        requestLabel: "Dream review",
        timeoutMs: 20_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawDreamReviewPayload;
      const summary =
        typeof parsed.summary === "string"
          ? truncate(normalizeWhitespace(parsed.summary), 280)
          : emptySummary;
      const profileSuggestions = normalizeDreamFindings(
        parsed.profile_suggestions,
        allowedRefs,
        "global_profile",
      ).filter((finding) => passesDreamProfileGate(finding, evidenceRefsById));
      return {
        summary: summary || emptySummary,
        projectRebuild: normalizeDreamFindings(parsed.project_rebuild, allowedRefs, "l2_project"),
        profileSuggestions,
        cleanup: normalizeDreamFindings(parsed.cleanup, allowedRefs, "l1_only"),
        ambiguous: normalizeDreamFindings(parsed.ambiguous, allowedRefs, "l1_only"),
        noAction: normalizeDreamFindings(parsed.no_action, allowedRefs, "l1_only"),
      };
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] dream review fallback: ${String(error)}`);
      return emptyResult();
    }
  }

  async planDreamProjectRebuild(
    input: LlmDreamProjectRebuildInput,
  ): Promise<LlmDreamProjectRebuildOutput> {
    if (input.l1Windows.length === 0) {
      throw new Error("No L1 windows are available for Dream reconstruction.");
    }

    const allowedL1Ids = new Set(input.l1Windows.map((window) => window.l1IndexId));
    const currentProjectKeys = new Set(input.currentProjects.map((project) => project.projectKey));
    const clusterProjectKeys = new Set(
      input.clusters
        .flatMap((cluster) => [...cluster.candidateKeys, ...cluster.currentProjectKeys])
        .filter(Boolean),
    );
    const raw = await this.callStructuredJson({
      systemPrompt: DREAM_PROJECT_REBUILD_SYSTEM_PROMPT,
      userPrompt: buildDreamProjectRebuildPrompt(input),
      requestLabel: "Dream project rebuild",
      timeoutMs: 30_000,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawDreamProjectPlanPayload;
    const normalizedProjects = Array.isArray(parsed.projects)
      ? parsed.projects
          .map((item) => normalizeDreamProjectPlanItem(item, allowedL1Ids))
          .filter((item): item is LlmDreamProjectRebuildOutput["projects"][number] => Boolean(item))
      : [];

    const dedupedProjects: LlmDreamProjectRebuildOutput["projects"] = [];
    const seenProjectKeys = new Set<string>();
    for (const item of normalizedProjects) {
      if (seenProjectKeys.has(item.projectKey)) continue;
      seenProjectKeys.add(item.projectKey);
      dedupedProjects.push(item);
      if (dedupedProjects.length >= 20) break;
    }
    if (dedupedProjects.length === 0) {
      throw new Error("Dream project rebuild returned no valid projects.");
    }

    const deletedProjectKeys = Array.from(
      new Set(
        normalizeDreamProjectKeys(parsed.deleted_project_keys).filter(
          (key) => currentProjectKeys.has(key) || clusterProjectKeys.has(key),
        ),
      ),
    );

    const l1Issues = Array.isArray(parsed.l1_issues)
      ? parsed.l1_issues
          .map((item) => normalizeDreamL1Issue(item, allowedL1Ids))
          .filter((item): item is LlmDreamL1Issue => Boolean(item))
          .slice(0, 20)
      : [];

    return {
      summary:
        typeof parsed.summary === "string"
          ? truncate(normalizeWhitespace(parsed.summary), 320)
          : "Dream project rebuild completed.",
      duplicateTopicCount: Math.max(
        0,
        Math.floor(
          typeof parsed.duplicate_topic_count === "number"
            ? parsed.duplicate_topic_count
            : l1Issues.filter((item) => item.issueType === "duplicate").length,
        ),
      ),
      conflictTopicCount: Math.max(
        0,
        Math.floor(
          typeof parsed.conflict_topic_count === "number"
            ? parsed.conflict_topic_count
            : l1Issues.filter((item) => item.issueType === "conflict").length,
        ),
      ),
      projects: dedupedProjects,
      deletedProjectKeys,
      l1Issues,
    };
  }

  async rewriteDreamGlobalProfile(
    input: LlmDreamGlobalProfileRewriteInput,
  ): Promise<LlmDreamGlobalProfileRewriteOutput> {
    if (input.l1Windows.length === 0) {
      throw new Error("No L1 windows are available for Dream profile rewrite.");
    }

    const allowedL1Ids = new Set(input.l1Windows.map((window) => window.l1IndexId));
    const raw = await this.callStructuredJson({
      systemPrompt: DREAM_GLOBAL_PROFILE_REWRITE_SYSTEM_PROMPT,
      userPrompt: buildDreamGlobalProfileRewritePrompt(input),
      requestLabel: "Dream global profile rewrite",
      timeoutMs: 20_000,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawDreamGlobalProfileRewritePayload;
    const profileText =
      typeof parsed.profile_text === "string"
        ? truncate(normalizeWhitespace(parsed.profile_text), 420)
        : "";
    if (!profileText) {
      throw new Error("Dream global profile rewrite returned an empty profile.");
    }
    const sourceL1Ids = normalizeDreamL1Ids(parsed.source_l1_ids, allowedL1Ids);
    return {
      profileText,
      sourceL1Ids,
      conflictWithExisting: normalizeBoolean(parsed.conflict_with_existing, false),
    };
  }

  async decideMemoryLookup(input: LlmMemoryRouteInput): Promise<Hop1LookupDecision> {
    const defaultQuery = truncateForPrompt(input.query, 120);
    const systemPrompt = HOP1_LOOKUP_SYSTEM_PROMPT;
    const userPrompt = buildHop1RoutePrompt(input);
    try {
      const parsed = await this.callStructuredJsonWithDebug<RawHop1RoutePayload>({
        systemPrompt,
        userPrompt,
        requestLabel: "Hop1 lookup",
        timeoutMs: input.timeoutMs ?? 4_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawHop1RoutePayload,
      });
      const baseOnly = normalizeBoolean(parsed.base_only, false);
      const queryScope = normalizeQueryScope(parsed.query_scope);
      const effectiveQuery = normalizeEffectiveQuery(parsed.effective_query, defaultQuery);
      return {
        queryScope,
        effectiveQuery,
        memoryRelevant: normalizeBoolean(parsed.memory_relevant, true),
        baseOnly,
        lookupQueries: baseOnly
          ? []
          : normalizeLookupQueries(parsed.lookup_queries, effectiveQuery),
      };
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] hop1 lookup fallback: ${String(error)}`);
      return {
        queryScope: "standalone",
        effectiveQuery: defaultQuery,
        memoryRelevant: true,
        baseOnly: false,
        lookupQueries: [
          {
            targetTypes: ["time", "project"],
            lookupQuery: defaultQuery,
            timeRange: null,
          },
        ],
      };
    }
  }

  private async runL2SelectionOnce(input: LlmHop2L2Input): Promise<Hop2L2Decision> {
    try {
      const parsed = await this.callStructuredJsonWithDebug<RawHop2L2Payload>({
        systemPrompt: HOP2_L2_SYSTEM_PROMPT,
        userPrompt: buildHop2L2Prompt(input),
        requestLabel: "Hop2 L2 selection",
        timeoutMs: input.timeoutMs ?? 5_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawHop2L2Payload,
      });
      const enoughAt =
        parsed.enough_at === "l2" ||
        parsed.enough_at === "descend_l1" ||
        parsed.enough_at === "none"
          ? parsed.enough_at
          : "none";
      return {
        intent: normalizeIntent(parsed.intent),
        evidenceNote:
          typeof parsed.evidence_note === "string"
            ? truncate(normalizeWhitespace(parsed.evidence_note), 800)
            : "",
        enoughAt,
      };
    } catch (error) {
      throw error;
    }
  }

  async selectL2FromCatalog(input: LlmHop2L2Input): Promise<Hop2L2Decision> {
    if (input.l2Entries.length === 0) {
      return {
        intent: input.profile ? "fact" : "general",
        evidenceNote: "",
        enoughAt: "none",
      };
    }
    try {
      return await this.runL2SelectionOnce(input);
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] hop2 l2 fallback: ${String(error)}`);
      const hasTime = input.l2Entries.some((entry) => entry.type === "time");
      const hasProject = input.l2Entries.some((entry) => entry.type === "project");
      const intent =
        hasTime && hasProject
          ? "general"
          : hasTime
            ? "time"
            : hasProject
              ? "project"
              : input.profile
                ? "fact"
                : "general";
      return {
        intent,
        evidenceNote: fallbackEvidenceNote(
          input.l2Entries.map((entry) => `${entry.label}: ${entry.compressedContent}`),
          input.query,
        ),
        enoughAt: "none",
      };
    }
  }

  async selectL1FromEvidence(input: LlmHop3L1Input): Promise<Hop3L1Decision> {
    if (input.l1Windows.length === 0) {
      return {
        evidenceNote: input.evidenceNote,
        enoughAt: "none",
      };
    }
    try {
      const parsed = await this.callStructuredJsonWithDebug<RawHop3L1Payload>({
        systemPrompt: HOP3_L1_SYSTEM_PROMPT,
        userPrompt: buildHop3L1Prompt(input),
        requestLabel: "Hop3 L1 selection",
        timeoutMs: input.timeoutMs ?? 5_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawHop3L1Payload,
      });
      const enoughAt =
        parsed.enough_at === "l1" ||
        parsed.enough_at === "descend_l0" ||
        parsed.enough_at === "none"
          ? parsed.enough_at
          : "none";
      return {
        evidenceNote:
          typeof parsed.evidence_note === "string"
            ? truncate(normalizeWhitespace(parsed.evidence_note), 800)
            : input.evidenceNote,
        enoughAt,
      };
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] hop3 l1 fallback: ${String(error)}`);
      return {
        evidenceNote: fallbackEvidenceNote(
          [
            input.evidenceNote,
            ...input.l1Windows.map(
              (item) => `${item.timePeriod}: ${item.summary} ${item.situationTimeInfo}`,
            ),
          ],
          input.query,
        ),
        enoughAt: "none",
      };
    }
  }

  async selectL0FromEvidence(input: LlmHop4L0Input): Promise<Hop4L0Decision> {
    if (input.l0Sessions.length === 0) {
      return {
        evidenceNote: input.evidenceNote,
        enoughAt: "none",
      };
    }
    try {
      const parsed = await this.callStructuredJsonWithDebug<RawHop4L0Payload>({
        systemPrompt: HOP4_L0_SYSTEM_PROMPT,
        userPrompt: buildHop4L0Prompt(input),
        requestLabel: "Hop4 L0 selection",
        timeoutMs: input.timeoutMs ?? 5_000,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        ...(input.debugTrace ? { debugTrace: input.debugTrace } : {}),
        parse: (raw) => JSON.parse(extractFirstJsonObject(raw)) as RawHop4L0Payload,
      });
      const enoughAt =
        parsed.enough_at === "l0" || parsed.enough_at === "none" ? parsed.enough_at : "none";
      return {
        evidenceNote:
          typeof parsed.evidence_note === "string"
            ? truncate(normalizeWhitespace(parsed.evidence_note), 800)
            : input.evidenceNote,
        enoughAt,
      };
    } catch (error) {
      this.logger?.warn?.(`[clawxmemory] hop4 l0 fallback: ${String(error)}`);
      return {
        evidenceNote: fallbackEvidenceNote(
          [
            input.evidenceNote,
            ...input.l0Sessions.map((item) => {
              const preview = item.messages
                .slice(-3)
                .map((message) => `${message.role}: ${message.content}`)
                .join(" | ");
              return `${item.timestamp}: ${preview}`;
            }),
          ],
          input.query,
        ),
        enoughAt: "none",
      };
    }
  }

  async reasonOverMemory(input: LlmReasoningInput): Promise<LlmReasoningSelection> {
    if (
      !input.profile &&
      input.l2Time.length === 0 &&
      input.l2Projects.length === 0 &&
      input.l1Windows.length === 0 &&
      input.l0Sessions.length === 0
    ) {
      return {
        intent: "general",
        enoughAt: "none",
        useProfile: false,
        l2Ids: [],
        l1Ids: [],
        l0Ids: [],
      };
    }

    const raw = await this.callStructuredJson({
      systemPrompt: REASONING_SYSTEM_PROMPT,
      userPrompt: JSON.stringify(
        {
          query: input.query,
          profile: input.profile
            ? {
                id: input.profile.recordId,
                text: truncateForPrompt(input.profile.profileText, 260),
              }
            : null,
          l2_time: input.l2Time.map((item) => ({
            id: item.l2IndexId,
            date_key: item.dateKey,
            summary: truncateForPrompt(item.summary, 180),
          })),
          l2_project: input.l2Projects.map((item) => ({
            id: item.l2IndexId,
            project_key: item.projectKey,
            project_name: item.projectName,
            summary: truncateForPrompt(item.summary, 180),
            latest_progress: truncateForPrompt(item.latestProgress, 180),
            status: item.currentStatus,
          })),
          l1_windows: input.l1Windows.map((item) => ({
            id: item.l1IndexId,
            session_key: item.sessionKey,
            time_period: item.timePeriod,
            summary: truncateForPrompt(item.summary, 180),
            situation: truncateForPrompt(item.situationTimeInfo, 160),
            projects: item.projectDetails.map((project) => project.name),
          })),
          l0_sessions: input.l0Sessions.map((item) => ({
            id: item.l0IndexId,
            session_key: item.sessionKey,
            timestamp: item.timestamp,
            messages: item.messages
              .filter((message) => message.role === "user")
              .slice(-2)
              .map((message) => truncateForPrompt(message.content, 160)),
          })),
          limits: input.limits,
        },
        null,
        2,
      ),
      requestLabel: "Reasoning",
      timeoutMs: input.timeoutMs ?? 8_000,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
    const parsed = JSON.parse(extractFirstJsonObject(raw)) as RawReasoningPayload;
    return {
      intent: normalizeIntent(parsed.intent),
      enoughAt: normalizeEnoughAt(parsed.enough_at),
      useProfile: normalizeBoolean(parsed.use_profile, false),
      l2Ids: normalizeStringArray(parsed.l2_ids, input.limits.l2),
      l1Ids: normalizeStringArray(parsed.l1_ids, input.limits.l1),
      l0Ids: normalizeStringArray(parsed.l0_ids, input.limits.l0),
    };
  }
}
