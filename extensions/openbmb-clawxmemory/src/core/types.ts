export type ChatRole = "user" | "assistant" | "system" | string;

export interface MemoryMessage {
  msgId?: string;
  role: ChatRole;
  content: string;
}

export type MemoryRoute = "none" | "user" | "project_memory";
export type MemoryRecordType = "user" | "feedback" | "project";
export type MemoryScope = "global" | "project";

export interface MemoryFileFrontmatter {
  name: string;
  description: string;
  type: MemoryRecordType;
  scope: MemoryScope;
  projectId?: string;
  updatedAt: string;
  capturedAt?: string;
  sourceSessionKey?: string;
  deprecated?: boolean;
  dreamAttempts?: number;
}

export interface MemoryManifestEntry extends MemoryFileFrontmatter {
  file: string;
  relativePath: string;
  absolutePath: string;
}

export interface MemoryFileRecord extends MemoryManifestEntry {
  content: string;
  preview: string;
}

export interface RecallHeaderEntry {
  name: string;
  description: string;
  type: MemoryRecordType;
  scope: MemoryScope;
  projectId?: string;
  updatedAt: string;
  deprecated?: boolean;
  file: string;
  relativePath: string;
  absolutePath: string;
}

export interface ProjectShortlistCandidate {
  projectId: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
  updatedAt: string;
  score: number;
  exact: number;
  source: "query" | "recent";
  matchedText: string;
}

export interface MemoryUserSummary {
  profile: string;
  preferences: string[];
  constraints: string[];
  relationships: string[];
  files: MemoryManifestEntry[];
}

export type ManagedWorkspaceFileName = "USER.md" | "MEMORY.md";
export type ManagedWorkspaceFileStateStatus = "isolated" | "restored" | "conflict";

export interface ManagedWorkspaceFileState {
  name: ManagedWorkspaceFileName;
  originalPath: string;
  managedPath: string;
  hash: string;
  isolatedAt: string;
  status: ManagedWorkspaceFileStateStatus;
  restoredAt?: string;
  conflictPath?: string;
}

export interface ManagedWorkspaceBoundaryState {
  version: 1;
  workspaceDir: string;
  updatedAt: string;
  lastAction: string;
  files: ManagedWorkspaceFileState[];
}

export type ManagedBoundaryStatus = "ready" | "isolated" | "conflict" | "warning";

export interface MemoryCandidate {
  type: MemoryRecordType;
  scope: MemoryScope;
  projectId?: string;
  name: string;
  description: string;
  aliases?: string[];
  capturedAt?: string;
  sourceSessionKey?: string;
  profile?: string;
  summary?: string;
  preferences?: string[];
  constraints?: string[];
  relationships?: string[];
  rule?: string;
  why?: string;
  howToApply?: string;
  stage?: string;
  decisions?: string[];
  nextSteps?: string[];
  blockers?: string[];
  timeline?: string[];
  notes?: string[];
}

export interface ProjectMetaRecord {
  projectId: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  dreamUpdatedAt?: string;
  relativePath: string;
  absolutePath: string;
}

export interface L0SessionRecord {
  l0IndexId: string;
  sessionKey: string;
  timestamp: string;
  messages: MemoryMessage[];
  source: string;
  indexed: boolean;
  createdAt: string;
}

export interface FactCandidate {
  factKey: string;
  factValue: string;
  confidence: number;
}

export type ProjectStatus = "planned" | "in_progress" | "done";
export type ReasoningMode = "answer_first" | "accuracy_first";
export type DreamPipelineStatus = "running" | "success" | "skipped" | "failed";

export interface IndexingSettings {
  reasoningMode: ReasoningMode;
  autoIndexIntervalMinutes: number;
  autoDreamIntervalMinutes: number;
}

export type MemoryActionType =
  | "edit_project_meta"
  | "edit_entry"
  | "delete_entries"
  | "deprecate_entries"
  | "restore_entries"
  | "archive_tmp";

export interface EditProjectMetaActionRequest {
  action: "edit_project_meta";
  projectId: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
}

export interface MemoryEntryEditFields {
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

export interface EditEntryActionRequest {
  action: "edit_entry";
  id: string;
  name: string;
  description: string;
  fields?: MemoryEntryEditFields;
}

export interface DeleteEntriesActionRequest {
  action: "delete_entries";
  ids: string[];
}

export interface DeprecateEntriesActionRequest {
  action: "deprecate_entries";
  ids: string[];
}

export interface RestoreEntriesActionRequest {
  action: "restore_entries";
  ids: string[];
}

export interface ArchiveTmpActionRequest {
  action: "archive_tmp";
  ids: string[];
  targetProjectId?: string;
  newProjectName?: string;
}

export type MemoryActionRequest =
  | EditProjectMetaActionRequest
  | EditEntryActionRequest
  | DeleteEntriesActionRequest
  | DeprecateEntriesActionRequest
  | RestoreEntriesActionRequest
  | ArchiveTmpActionRequest;
export const MEMORY_EXPORT_FORMAT_VERSION = "clawxmemory-memory-snapshot.v3" as const;

export interface MemoryFileExportRecord extends MemoryFileFrontmatter {
  file: string;
  relativePath: string;
  content: string;
}

export interface ProjectMetaExportRecord {
  projectId: string;
  projectName: string;
  description: string;
  aliases: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  dreamUpdatedAt?: string;
  relativePath: string;
}

export interface MemoryBundleMetadata {
  exportedAt: string;
  lastIndexedAt?: string;
  lastDreamAt?: string;
  lastDreamStatus?: DreamPipelineStatus;
  lastDreamSummary?: string;
  recentCaseTraces?: CaseTraceRecord[];
  recentIndexTraces?: IndexTraceRecord[];
  recentDreamTraces?: DreamTraceRecord[];
}

export interface MemorySnapshotFileRecord {
  relativePath: string;
  content: string;
}

export interface MemoryExportBundle extends MemoryBundleMetadata {
  formatVersion: typeof MEMORY_EXPORT_FORMAT_VERSION;
  files: MemorySnapshotFileRecord[];
}

export type MemoryImportableBundle = MemoryExportBundle;

export interface MemoryTransferCounts {
  managedFiles: number;
  memoryFiles: number;
  project: number;
  feedback: number;
  user: number;
  tmp: number;
  projectMetas: number;
}

export interface MemoryImportResult {
  formatVersion: typeof MEMORY_EXPORT_FORMAT_VERSION;
  imported: MemoryTransferCounts;
  importedAt: string;
  lastIndexedAt?: string;
  lastDreamAt?: string;
  lastDreamStatus?: DreamPipelineStatus;
  lastDreamSummary?: string;
  recentCaseTraces?: CaseTraceRecord[];
  recentIndexTraces?: IndexTraceRecord[];
  recentDreamTraces?: DreamTraceRecord[];
}

export interface RetrievalTraceKvEntry {
  label: string;
  value: string;
}

export interface TraceI18nText {
  key: string;
  args?: string[];
  fallback: string;
}

interface RetrievalTraceDetailBase {
  key: string;
  label: string;
  labelI18n?: TraceI18nText;
}

export type RetrievalTraceDetail =
  | (RetrievalTraceDetailBase & {
      kind: "text" | "note";
      text: string;
    })
  | (RetrievalTraceDetailBase & {
      kind: "list";
      items: string[];
    })
  | (RetrievalTraceDetailBase & {
      kind: "kv";
      entries: RetrievalTraceKvEntry[];
    })
  | (RetrievalTraceDetailBase & {
      kind: "json";
      json: unknown;
    });

interface TraceStepI18nFields {
  titleI18n?: TraceI18nText;
  inputSummaryI18n?: TraceI18nText;
  outputSummaryI18n?: TraceI18nText;
}

export interface RetrievalPromptDebug {
  requestLabel: string;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
  parsedResult?: unknown;
  timedOut?: boolean;
  errored?: boolean;
  errorMessage?: string;
}

export type IndexTraceTrigger = "explicit_remember" | "manual_sync" | "scheduled";
export type IndexTraceStatus = "running" | "completed" | "error";
export type IndexTraceStorageKind =
  | "global_user"
  | "tmp_project"
  | "tmp_feedback"
  | "formal_project"
  | "formal_feedback";

export interface IndexTraceBatchSummary {
  l0Ids: string[];
  segmentCount: number;
  focusUserTurnCount: number;
  fromTimestamp: string;
  toTimestamp: string;
}

export interface IndexTraceStoredResult {
  candidateType: MemoryRecordType;
  candidateName: string;
  scope: MemoryScope;
  projectId?: string;
  relativePath: string;
  storageKind: IndexTraceStorageKind;
}

export type IndexTraceStepKind =
  | "index_start"
  | "batch_loaded"
  | "focus_turns_selected"
  | "turn_classified"
  | "candidate_validated"
  | "candidate_grouped"
  | "candidate_persisted"
  | "user_profile_rewritten"
  | "index_finished";

export interface IndexTraceStep extends TraceStepI18nFields {
  stepId: string;
  kind: IndexTraceStepKind;
  title: string;
  status: "info" | "success" | "warning" | "error" | "skipped";
  inputSummary: string;
  outputSummary: string;
  refs?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  details?: RetrievalTraceDetail[];
  promptDebug?: RetrievalPromptDebug;
}

export interface IndexTraceRecord {
  indexTraceId: string;
  sessionKey: string;
  trigger: IndexTraceTrigger;
  startedAt: string;
  finishedAt?: string;
  status: IndexTraceStatus;
  batchSummary: IndexTraceBatchSummary;
  steps: IndexTraceStep[];
  storedResults: IndexTraceStoredResult[];
}

export type DreamTraceTrigger = "manual" | "scheduled";
export type DreamTraceStatus = "running" | "completed" | "skipped" | "error";
export type DreamTraceMutationAction = "write" | "delete" | "delete_project" | "rewrite_user_profile";

export interface DreamTraceSnapshotSummary {
  formalProjectCount: number;
  tmpProjectCount: number;
  tmpFeedbackCount: number;
  formalProjectFileCount: number;
  formalFeedbackFileCount: number;
  hasUserProfile: boolean;
}

export interface DreamTraceMutation {
  mutationId: string;
  action: DreamTraceMutationAction;
  relativePath?: string;
  projectId?: string;
  projectName?: string;
  candidateType?: MemoryRecordType;
  name?: string;
  description?: string;
  preview?: string;
}

export type DreamTraceStepKind =
  | "dream_start"
  | "snapshot_loaded"
  | "global_plan_generated"
  | "global_plan_validated"
  | "project_rewrite_generated"
  | "project_mutations_applied"
  | "user_profile_rewritten"
  | "manifests_repaired"
  | "dream_finished";

export interface DreamTraceStep extends TraceStepI18nFields {
  stepId: string;
  kind: DreamTraceStepKind;
  title: string;
  status: "info" | "success" | "warning" | "error" | "skipped";
  inputSummary: string;
  outputSummary: string;
  refs?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  details?: RetrievalTraceDetail[];
  promptDebug?: RetrievalPromptDebug;
}

export interface DreamTraceOutcome {
  rewrittenProjects: number;
  deletedProjects: number;
  deletedFiles: number;
  profileUpdated: boolean;
  summary: string;
  summaryI18n?: TraceI18nText;
}

export interface DreamTraceRecord {
  dreamTraceId: string;
  trigger: DreamTraceTrigger;
  startedAt: string;
  finishedAt?: string;
  status: DreamTraceStatus;
  snapshotSummary: DreamTraceSnapshotSummary;
  steps: DreamTraceStep[];
  mutations: DreamTraceMutation[];
  outcome: DreamTraceOutcome;
  skipReason?: string;
}

export type RetrievalTraceStepKind =
  | "recall_start"
  | "cache_hit"
  | "memory_gate"
  | "user_base_loaded"
  | "project_shortlist_built"
  | "project_selected"
  | "manifest_scanned"
  | "manifest_selected"
  | "files_loaded"
  | "context_rendered"
  | "fallback_applied"
  | "recall_skipped";

export interface RetrievalTraceStep extends TraceStepI18nFields {
  stepId: string;
  kind: RetrievalTraceStepKind;
  title: string;
  status: "info" | "success" | "warning" | "error" | "skipped";
  inputSummary: string;
  outputSummary: string;
  refs?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  details?: RetrievalTraceDetail[];
  promptDebug?: RetrievalPromptDebug;
}

export interface RetrievalTrace {
  traceId: string;
  query: string;
  mode: "auto" | "explicit";
  startedAt: string;
  finishedAt: string;
  steps: RetrievalTraceStep[];
}

export interface CaseToolEvent {
  eventId: string;
  phase: "start" | "result";
  toolName: string;
  toolCallId?: string;
  occurredAt: string;
  status: "running" | "success" | "error";
  summary: string;
  summaryI18n?: TraceI18nText;
  paramsPreview?: string;
  resultPreview?: string;
  durationMs?: number;
}

export interface CaseTraceRecord {
  caseId: string;
  sessionKey: string;
  query: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "interrupted" | "error";
  retrieval?: {
    intent?: MemoryRoute;
    injected: boolean;
    contextPreview: string;
    trace: RetrievalTrace | null;
  };
  toolEvents: CaseToolEvent[];
  assistantReply: string;
}

export interface RetrievalResult {
  query: string;
  intent: MemoryRoute;
  context: string;
  trace?: RetrievalTrace;
  debug?: {
    mode: "llm" | "local_fallback" | "none";
    elapsedMs: number;
    cacheHit: boolean;
    path?: "auto" | "explicit" | "shadow";
    resolvedProjectId?: string;
    corrections?: string[];
    route?: MemoryRoute;
    manifestCount?: number;
    selectedFileIds?: string[];
  };
}

export type RecallMode = "llm" | "local_fallback" | "none";
export type StartupRepairStatus = "idle" | "running" | "failed";
export type DashboardStatus = "healthy" | "warning" | "conflict";

export interface DashboardConflictingFile {
  name: ManagedWorkspaceFileName;
  conflictPath?: string;
}

export interface DashboardDiagnostics {
  issues: string[];
  conflictingFiles: DashboardConflictingFile[];
  startupRepairMessage?: string;
}

export interface DashboardOverview {
  pendingSessions: number;
  formalProjectCount?: number;
  userProfileCount?: number;
  tmpTotalFiles?: number;
  recentRecallTraceCount?: number;
  recentIndexTraceCount?: number;
  recentDreamTraceCount?: number;
  lastIndexedAt?: string;
  lastDreamAt?: string;
  lastDreamStatus?: DreamPipelineStatus;
  lastDreamSummary?: string;
  dashboardStatus?: DashboardStatus;
  dashboardWarning?: string | null;
  dashboardDiagnostics?: DashboardDiagnostics | null;
}

export interface MemoryActionResult {
  ok: true;
  action: MemoryActionType;
  updatedOverview: DashboardOverview;
  mutatedIds: string[];
  deletedProjectIds: string[];
  messages: string[];
}

export interface MemoryUiSnapshot {
  overview: DashboardOverview;
  settings: IndexingSettings;
  recentMemoryFiles?: MemoryManifestEntry[];
}
