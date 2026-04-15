import type {
  DreamTraceMutation,
  DreamTraceRecord,
  DreamTraceSnapshotSummary,
  DreamTraceStep,
  MemoryCandidate,
  MemoryFileRecord,
  MemoryManifestEntry,
  MemoryUserSummary,
  ProjectMetaRecord,
  RetrievalPromptDebug,
  RetrievalTraceDetail,
  TraceI18nText,
} from "../types.js";
import type { HeartbeatStats } from "../pipeline/heartbeat.js";
import {
  type LlmDreamFileGlobalPlanOutput,
  type LlmDreamFileProjectMetaInput,
  type LlmDreamFileProjectRewriteInput,
  type LlmDreamFileProjectRewriteOutput,
  type LlmDreamFileProjectRewriteOutputFile,
  type LlmDreamFileRecordInput,
  LlmMemoryExtractor,
} from "../skills/llm-extraction.js";
import { MemoryRepository } from "../storage/sqlite.js";
import { traceI18n } from "../trace-i18n.js";
import { hashText, nowIso } from "../utils/id.js";

type LoggerLike = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

interface DreamReviewRunnerOptions {
  logger?: LoggerLike;
}

export interface DreamRewriteOutcome {
  reviewedFiles: number;
  rewrittenProjects: number;
  deletedProjects: number;
  deletedFiles: number;
  profileUpdated: boolean;
  duplicateTopicCount: number;
  conflictTopicCount: number;
  summary: string;
}

export interface DreamRunResult extends DreamRewriteOutcome {
  prepFlush: HeartbeatStats;
  trigger?: "manual" | "scheduled";
  status?: "success" | "skipped";
  skipReason?: string;
}

interface DreamRecordSnapshot {
  entry: MemoryManifestEntry;
  record: MemoryFileRecord;
  candidate: MemoryCandidate;
  llmRecord: LlmDreamFileRecordInput;
}

interface DreamProjectExecution {
  projectId: string;
  currentMeta: ProjectMetaRecord | null;
  plan: LlmDreamFileGlobalPlanOutput["projects"][number] & { projectId: string };
  sourceSnapshots: DreamRecordSnapshot[];
  rewrite: LlmDreamFileProjectRewriteOutput;
  writtenRelativePaths: string[];
  deletedRelativePaths: string[];
}

const TMP_PROJECT_ID = "_tmp";
const DREAM_ALLOWED_MERGE_REASONS = new Set(["rename", "alias_equivalence", "duplicate_formal_project"]);
const DREAM_GENERIC_PROJECT_FILE_NAMES = new Set([
  "current-stage",
  "current stage",
  "project-note",
  "project note",
  "project-summary",
  "project summary",
  "project",
  "summary",
  "overview",
  "status",
  "current_status",
  "current status",
]);
const DREAM_RENAME_EVIDENCE_RE = /(?:同一个项目|项目改名|改名(?:为|叫)?|也叫|别名|aka|also known as|renamed|same project|new name)/i;

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: readonly string[], max = 20): string[] {
  return Array.from(new Set(
    values
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )).slice(0, max);
}

function isProjectAliasCandidate(value: string | undefined): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (normalized.length > 80) return false;
  if (/[。！？!?]/.test(normalized)) return false;
  if (/(先给|再给|封面文案|正文|标题|汇报时|同步进展|怎么协作|怎么交付|怎么汇报)/i.test(normalized)) {
    return false;
  }
  return true;
}

function sanitizeProjectAliases(values: Array<string | undefined>, fallbackProjectName?: string): string[] {
  return uniqueStrings(
    [...values, fallbackProjectName]
      .filter((value): value is string => typeof value === "string")
      .filter((value) => isProjectAliasCandidate(value)),
    50,
  );
}

function hasUserSummary(summary: MemoryUserSummary): boolean {
  return Boolean(
    normalizeText(summary.profile)
      || summary.preferences.length
      || summary.constraints.length
      || summary.relationships.length,
  );
}

function buildUserProfileCandidate(summary: MemoryUserSummary): MemoryCandidate | null {
  if (!hasUserSummary(summary)) return null;
  return {
    type: "user",
    scope: "global",
    name: "user-profile",
    description: normalizeText(summary.profile || summary.preferences[0] || summary.constraints[0] || summary.relationships[0] || "User profile"),
    profile: normalizeText(summary.profile),
    preferences: summary.preferences,
    constraints: summary.constraints,
    relationships: summary.relationships,
  };
}

function sameUserSummaryContent(summary: MemoryUserSummary, candidate: MemoryCandidate): boolean {
  const candidateProfile = normalizeText(candidate.profile || candidate.description || "");
  const candidatePreferences = uniqueStrings(candidate.preferences ?? [], 50);
  const candidateConstraints = uniqueStrings(candidate.constraints ?? [], 50);
  const candidateRelationships = uniqueStrings(candidate.relationships ?? [], 50);
  return normalizeText(summary.profile) === candidateProfile
    && JSON.stringify(uniqueStrings(summary.preferences, 50)) === JSON.stringify(candidatePreferences)
    && JSON.stringify(uniqueStrings(summary.constraints, 50)) === JSON.stringify(candidateConstraints)
    && JSON.stringify(uniqueStrings(summary.relationships, 50)) === JSON.stringify(candidateRelationships);
}

function buildProjectMetaInput(meta: ProjectMetaRecord): LlmDreamFileProjectMetaInput {
  return {
    projectId: meta.projectId,
    projectName: meta.projectName,
    description: meta.description,
    aliases: meta.aliases,
    status: meta.status,
    updatedAt: meta.updatedAt,
    ...(meta.dreamUpdatedAt ? { dreamUpdatedAt: meta.dreamUpdatedAt } : {}),
  };
}

function buildRecordInput(record: MemoryFileRecord, candidate: MemoryCandidate): LlmDreamFileRecordInput {
  return {
    entryId: record.relativePath,
    relativePath: record.relativePath,
    type: record.type as "project" | "feedback",
    scope: "project",
    ...(record.projectId ? { projectId: record.projectId } : {}),
    isTmp: record.projectId === TMP_PROJECT_ID,
    name: record.name,
    description: record.description,
    updatedAt: record.updatedAt,
    ...(record.capturedAt ? { capturedAt: record.capturedAt } : {}),
    ...(record.sourceSessionKey ? { sourceSessionKey: record.sourceSessionKey } : {}),
    content: record.content,
    ...(candidate.type === "project"
      ? {
          project: {
            stage: normalizeText(candidate.stage || record.description),
            decisions: uniqueStrings(candidate.decisions ?? [], 20),
            constraints: uniqueStrings(candidate.constraints ?? [], 20),
            nextSteps: uniqueStrings(candidate.nextSteps ?? [], 20),
            blockers: uniqueStrings(candidate.blockers ?? [], 20),
            timeline: uniqueStrings(candidate.timeline ?? [], 20),
            notes: uniqueStrings(candidate.notes ?? [], 20),
          },
        }
      : {}),
    ...(candidate.type === "feedback"
      ? {
          feedback: {
            rule: normalizeText(candidate.rule || record.description),
            why: normalizeText(candidate.why),
            howToApply: normalizeText(candidate.howToApply),
            notes: uniqueStrings(candidate.notes ?? [], 20),
          },
        }
      : {}),
  };
}

function buildSnapshot(record: MemoryFileRecord, repository: MemoryRepository): DreamRecordSnapshot {
  const candidate = repository.getFileMemoryStore().toCandidate(record);
  return {
    entry: record,
    record,
    candidate,
    llmRecord: buildRecordInput(record, candidate),
  };
}

function buildCandidateFromRewriteFile(
  projectId: string,
  file: LlmDreamFileProjectRewriteOutputFile,
): MemoryCandidate {
  if (file.type === "feedback") {
    return {
      type: "feedback",
      scope: "project",
      projectId,
      name: file.name,
      description: file.description,
      rule: file.rule || file.description,
      ...(normalizeText(file.why) ? { why: normalizeText(file.why) } : {}),
      ...(normalizeText(file.howToApply) ? { howToApply: normalizeText(file.howToApply) } : {}),
      ...(file.notes && file.notes.length > 0 ? { notes: uniqueStrings(file.notes, 20) } : {}),
    };
  }
  return {
    type: "project",
    scope: "project",
    projectId,
    name: file.name,
    description: file.description,
    ...(normalizeText(file.stage) ? { stage: normalizeText(file.stage) } : {}),
    decisions: uniqueStrings(file.decisions ?? [], 20),
    constraints: uniqueStrings(file.constraints ?? [], 20),
    nextSteps: uniqueStrings(file.nextSteps ?? [], 20),
    blockers: uniqueStrings(file.blockers ?? [], 20),
    timeline: uniqueStrings(file.timeline ?? [], 20),
    notes: uniqueStrings(file.notes ?? [], 20),
  };
}

function normalizeProjectIdentityLabel(value: string | undefined): string {
  return normalizeText(value).toLowerCase();
}

function isGenericProjectFileName(value: string | undefined): boolean {
  return DREAM_GENERIC_PROJECT_FILE_NAMES.has(normalizeProjectIdentityLabel(value));
}

function extractExplicitProjectIdentity(
  snapshot: DreamRecordSnapshot,
  formalMetaById: ReadonlyMap<string, ProjectMetaRecord>,
): { name: string; key: string; source: "formal" | "tmp"; projectId?: string } | null {
  if (snapshot.record.projectId && snapshot.record.projectId !== TMP_PROJECT_ID) {
    const meta = formalMetaById.get(snapshot.record.projectId);
    const projectName = normalizeText(meta?.projectName);
    if (!projectName) return null;
    return {
      name: projectName,
      key: normalizeProjectIdentityLabel(projectName),
      source: "formal",
      projectId: snapshot.record.projectId,
    };
  }
  if (snapshot.candidate.type !== "project") return null;
  const projectName = normalizeText(snapshot.candidate.name || snapshot.record.name);
  if (!projectName || isGenericProjectFileName(projectName)) return null;
  return {
    name: projectName,
    key: normalizeProjectIdentityLabel(projectName),
    source: "tmp",
  };
}

function countMentionedProjectNames(text: string, names: readonly string[]): number {
  const haystack = normalizeProjectIdentityLabel(text);
  return new Set(
    names.filter((name) => {
      const needle = normalizeProjectIdentityLabel(name);
      return needle.length > 0 && haystack.includes(needle);
    }),
  ).size;
}

function validateExplicitNameMerge(
  project: LlmDreamFileGlobalPlanOutput["projects"][number],
  sourceSnapshots: DreamRecordSnapshot[],
  formalMetaById: ReadonlyMap<string, ProjectMetaRecord>,
): void {
  const explicitIdentities = sourceSnapshots
    .map((snapshot) => extractExplicitProjectIdentity(snapshot, formalMetaById))
    .filter((identity): identity is NonNullable<typeof identity> => Boolean(identity));
  const distinctIdentityKeys = Array.from(new Set(explicitIdentities.map((identity) => identity.key)));
  if (distinctIdentityKeys.length <= 1) return;

  if (!project.mergeReason || !DREAM_ALLOWED_MERGE_REASONS.has(project.mergeReason)) {
    throw new Error(
      `Dream global plan tried to merge distinct explicit projects without an allowed merge reason: ${distinctIdentityKeys.join(", ")}`,
    );
  }
  if (project.evidenceEntryIds.length === 0) {
    throw new Error(
      `Dream global plan tried to merge distinct explicit projects without evidence_entry_ids: ${distinctIdentityKeys.join(", ")}`,
    );
  }
  if (project.evidenceEntryIds.some((entryId) => !project.retainedEntryIds.includes(entryId))) {
    throw new Error(
      `Dream global plan used evidence_entry_ids outside the retained files for ${project.projectName}.`,
    );
  }

  if (project.mergeReason === "duplicate_formal_project") {
    const formalProjectIds = new Set(
      explicitIdentities
        .filter((identity) => identity.source === "formal" && identity.projectId)
        .map((identity) => identity.projectId as string),
    );
    if (formalProjectIds.size < 2) {
      throw new Error(
        `Dream global plan used duplicate_formal_project without multiple formal project identities: ${distinctIdentityKeys.join(", ")}`,
      );
    }
    return;
  }

  const distinctNames = Array.from(new Set(explicitIdentities.map((identity) => identity.name)));
  const evidenceTexts = project.evidenceEntryIds
    .map((entryId) => sourceSnapshots.find((snapshot) => snapshot.record.relativePath === entryId))
    .filter((snapshot): snapshot is DreamRecordSnapshot => Boolean(snapshot))
    .map((snapshot) => normalizeText([
      snapshot.record.name,
      snapshot.record.description,
      snapshot.record.content,
    ].filter(Boolean).join("\n")));
  const combinedEvidence = evidenceTexts.join("\n");
  const strongTextEvidence = evidenceTexts.some((text) => countMentionedProjectNames(text, distinctNames) >= 2);
  const targetMeta = project.targetProjectId ? formalMetaById.get(project.targetProjectId) ?? null : null;
  const aliasEvidence = targetMeta
    ? countMentionedProjectNames([targetMeta.projectName, ...targetMeta.aliases].join("\n"), distinctNames) >= 2
    : false;
  const renameCueEvidence = DREAM_RENAME_EVIDENCE_RE.test(combinedEvidence)
    && countMentionedProjectNames(combinedEvidence, distinctNames) >= 2;
  if (!strongTextEvidence && !aliasEvidence && !renameCueEvidence) {
    throw new Error(
      `Dream global plan tried to merge distinct explicit projects without strong rename/alias evidence: ${distinctIdentityKeys.join(", ")}`,
    );
  }
}

function validateGlobalPlan(
  plan: LlmDreamFileGlobalPlanOutput,
  snapshots: DreamRecordSnapshot[],
  formalMetas: ProjectMetaRecord[],
): void {
  const knownEntryIds = new Set(snapshots.map((snapshot) => snapshot.record.relativePath));
  const knownProjectIds = new Set(formalMetas.map((meta) => meta.projectId));
  const formalMetaById = new Map(formalMetas.map((meta) => [meta.projectId, meta] as const));
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.record.relativePath, snapshot] as const));
  const retained = new Set<string>();
  for (const project of plan.projects) {
    if (!project.projectName || !project.description) {
      throw new Error("Dream global plan returned a project without a stable name or description.");
    }
    if (project.targetProjectId && !knownProjectIds.has(project.targetProjectId)) {
      throw new Error(`Dream global plan referenced an unknown formal project: ${project.targetProjectId}`);
    }
    for (const entryId of project.retainedEntryIds) {
      if (!knownEntryIds.has(entryId)) {
        throw new Error(`Dream global plan referenced an unknown memory file: ${entryId}`);
      }
      if (retained.has(entryId)) {
        throw new Error(`Dream global plan assigned one memory file to multiple final projects: ${entryId}`);
      }
      retained.add(entryId);
    }
    const sourceSnapshots = project.retainedEntryIds
      .map((entryId) => snapshotById.get(entryId))
      .filter((snapshot): snapshot is DreamRecordSnapshot => Boolean(snapshot));
    validateExplicitNameMerge(project, sourceSnapshots, formalMetaById);
  }
  for (const deletedEntryId of plan.deletedEntryIds) {
    if (!knownEntryIds.has(deletedEntryId)) {
      throw new Error(`Dream global plan tried to delete an unknown memory file: ${deletedEntryId}`);
    }
    if (retained.has(deletedEntryId)) {
      throw new Error(`Dream global plan marked a retained memory file for deletion: ${deletedEntryId}`);
    }
  }
  for (const deletedProjectId of plan.deletedProjectIds) {
    if (!knownProjectIds.has(deletedProjectId)) {
      throw new Error(`Dream global plan tried to delete an unknown formal project: ${deletedProjectId}`);
    }
    if (plan.projects.some((project) => project.targetProjectId === deletedProjectId)) {
      throw new Error(`Dream global plan tried to keep and delete the same formal project: ${deletedProjectId}`);
    }
  }
}

function validateProjectRewrite(
  input: LlmDreamFileProjectRewriteInput,
  rewrite: LlmDreamFileProjectRewriteOutput,
): void {
  const sourceIds = new Set(input.records.map((record) => record.entryId));
  if (rewrite.files.length === 0) {
    throw new Error(`Dream project rewrite returned no rewritten files for ${input.project.projectName}.`);
  }
  for (const file of rewrite.files) {
    if (!file.name || !file.description) {
      throw new Error(`Dream project rewrite returned a file without name/description for ${input.project.projectName}.`);
    }
    if (file.type === "feedback" && !normalizeText(file.rule)) {
      throw new Error(`Dream project rewrite returned a feedback file without a rule for ${input.project.projectName}.`);
    }
    if (file.sourceEntryIds.length === 0) {
      throw new Error(`Dream project rewrite returned a file without source ids for ${input.project.projectName}.`);
    }
    for (const sourceEntryId of file.sourceEntryIds) {
      if (!sourceIds.has(sourceEntryId)) {
        throw new Error(`Dream project rewrite referenced an unknown source file: ${sourceEntryId}`);
      }
    }
  }
  for (const deletedEntryId of rewrite.deletedEntryIds) {
    if (!sourceIds.has(deletedEntryId)) {
      throw new Error(`Dream project rewrite tried to delete an unknown source file: ${deletedEntryId}`);
    }
  }
}

function chooseTargetRelativePath(
  store: ReturnType<MemoryRepository["getFileMemoryStore"]>,
  projectId: string,
  file: LlmDreamFileProjectRewriteOutputFile,
  sourceSnapshots: DreamRecordSnapshot[],
  deletedProjectIds: ReadonlySet<string>,
): string {
  const preferredSource = sourceSnapshots.find((snapshot) => {
    if (!file.sourceEntryIds.includes(snapshot.record.relativePath)) return false;
    if (snapshot.record.projectId !== projectId) return false;
    if (snapshot.record.projectId && deletedProjectIds.has(snapshot.record.projectId)) return false;
    return snapshot.record.type === file.type;
  });
  if (preferredSource) return preferredSource.record.relativePath;
  return store.buildFormalCandidateRelativePath(projectId, buildCandidateFromRewriteFile(projectId, file));
}

function buildExecutionSummary(
  reviewedFiles: number,
  repairedSummary: string,
  plan: LlmDreamFileGlobalPlanOutput,
  executedProjects: DreamProjectExecution[],
  deletedProjects: number,
  deletedFiles: number,
  profileUpdated: boolean,
  userSummary: MemoryUserSummary,
  untouchedTmpCount: number,
): string {
  const parts = [
    `Dream reviewed ${reviewedFiles} memory files.`,
    repairedSummary,
    plan.summary || "Dream completed a global project audit.",
    executedProjects.length > 0
      ? `Rewrote ${executedProjects.length} final formal projects from the current file memories.`
      : "No formal projects needed a Dream rewrite.",
    deletedProjects > 0
      ? `Deleted ${deletedProjects} superseded formal projects.`
      : "No formal projects were deleted.",
    deletedFiles > 0
      ? `Deleted ${deletedFiles} superseded project memory files.`
      : "No superseded project memory files needed deletion.",
    profileUpdated
      ? "Rewrote the global user profile from current file-based memory."
      : hasUserSummary(userSummary)
        ? "Global user profile did not need a Dream rewrite."
        : "No global user profile was available for Dream rewrite.",
    untouchedTmpCount > 0
      ? `Left ${untouchedTmpCount} unresolved temporary memory files untouched for a later Dream pass.`
      : "No temporary memory was left unresolved.",
  ];
  return parts.join(" ");
}

function previewText(value: string | undefined, max = 220): string {
  const normalized = normalizeText(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function buildDreamTraceId(trigger: DreamTraceRecord["trigger"], startedAt: string): string {
  return `dream_trace_${hashText(`${trigger}:${startedAt}:${Math.random().toString(36).slice(2, 10)}`)}`;
}

function buildDreamStepId(traceId: string, kind: DreamTraceStep["kind"], suffix?: string): string {
  return `${traceId}_${kind}${suffix ? `_${hashText(suffix)}` : ""}`;
}

function listDetail(key: string, label: string, items: string[], labelI18n?: TraceI18nText): RetrievalTraceDetail {
  return { key, label, ...(labelI18n ? { labelI18n } : {}), kind: "list", items };
}

function kvDetail(
  key: string,
  label: string,
  entries: Array<{ label: string; value: unknown }>,
  labelI18n?: TraceI18nText,
): RetrievalTraceDetail {
  return {
    key,
    label,
    ...(labelI18n ? { labelI18n } : {}),
    kind: "kv",
    entries: entries.map((entry) => ({
      label: entry.label,
      value: String(entry.value ?? ""),
    })),
  };
}

function jsonDetail(key: string, label: string, json: unknown, labelI18n?: TraceI18nText): RetrievalTraceDetail {
  return { key, label, ...(labelI18n ? { labelI18n } : {}), kind: "json", json };
}

function mutationPreview(record: MemoryFileRecord): string {
  return previewText(record.preview || record.content || record.description, 220);
}

function buildSnapshotSummary(
  store: ReturnType<MemoryRepository["getFileMemoryStore"]>,
): DreamTraceSnapshotSummary {
  const formalEntries = store.listMemoryEntries({
    scope: "project",
    kinds: ["project", "feedback"],
    limit: 2000,
  });
  const tmpEntries = store.listTmpEntries(2000);
  return {
    formalProjectCount: store.listProjectMetas().length,
    tmpProjectCount: tmpEntries.filter((entry) => entry.type === "project").length,
    tmpFeedbackCount: tmpEntries.filter((entry) => entry.type === "feedback").length,
    formalProjectFileCount: formalEntries.filter((entry) => entry.type === "project").length,
    formalFeedbackFileCount: formalEntries.filter((entry) => entry.type === "feedback").length,
    hasUserProfile: hasUserSummary(store.getUserSummary()),
  };
}

function createDreamTrace(
  trigger: DreamTraceRecord["trigger"],
  snapshotSummary: DreamTraceSnapshotSummary,
  startedAt = nowIso(),
): DreamTraceRecord {
  return {
    dreamTraceId: buildDreamTraceId(trigger, startedAt),
    trigger,
    startedAt,
    status: "running",
    snapshotSummary,
    steps: [],
    mutations: [],
    outcome: {
      rewrittenProjects: 0,
      deletedProjects: 0,
      deletedFiles: 0,
      profileUpdated: false,
      summary: "",
    },
  };
}

function pushDreamStep(
  trace: DreamTraceRecord,
  step: Omit<DreamTraceStep, "stepId"> & { stepId?: string; suffix?: string },
): void {
  trace.steps.push({
    stepId: step.stepId || buildDreamStepId(trace.dreamTraceId, step.kind, step.suffix),
    kind: step.kind,
    title: step.title,
    status: step.status,
    inputSummary: step.inputSummary,
    outputSummary: step.outputSummary,
    ...(step.titleI18n ? { titleI18n: step.titleI18n } : {}),
    ...(step.inputSummaryI18n ? { inputSummaryI18n: step.inputSummaryI18n } : {}),
    ...(step.outputSummaryI18n ? { outputSummaryI18n: step.outputSummaryI18n } : {}),
    ...(step.refs ? { refs: step.refs } : {}),
    ...(step.metrics ? { metrics: step.metrics } : {}),
    ...(step.details ? { details: step.details } : {}),
    ...(step.promptDebug ? { promptDebug: step.promptDebug } : {}),
  });
}

function pushMutation(trace: DreamTraceRecord, mutation: Omit<DreamTraceMutation, "mutationId">): void {
  trace.mutations.push({
    mutationId: `dream_mutation_${hashText(JSON.stringify({ ...mutation, index: trace.mutations.length }))}`,
    ...mutation,
  });
}

function finalizeDreamTrace(
  trace: DreamTraceRecord,
  status: DreamTraceRecord["status"],
  outcome: DreamTraceRecord["outcome"],
  options: { finishedAt?: string; skipReason?: string } = {},
): DreamTraceRecord {
  trace.status = status;
  trace.finishedAt = options.finishedAt || nowIso();
  trace.outcome = outcome;
  if (options.skipReason) trace.skipReason = options.skipReason;
  return trace;
}

export class DreamRewriteRunner {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly extractor: LlmMemoryExtractor,
    private readonly options: DreamReviewRunnerOptions = {},
  ) {}

  async run(trigger: DreamTraceRecord["trigger"] = "manual"): Promise<DreamRewriteOutcome> {
    const store = this.repository.getFileMemoryStore();
    const startedAt = nowIso();
    const trace = createDreamTrace(trigger, buildSnapshotSummary(store), startedAt);
    const persistTrace = () => this.repository.saveDreamTrace(trace);

    pushDreamStep(trace, {
      kind: "dream_start",
      title: "Dream Start",
      titleI18n: traceI18n("trace.step.dream_start", "Dream Start"),
      status: "info",
      inputSummary: `${trigger} Dream run started.`,
      inputSummaryI18n: traceI18n("trace.text.dream_start.input", "{0} Dream run started.", trigger),
      outputSummary: "Preparing current indexed file-memory snapshot.",
      outputSummaryI18n: traceI18n("trace.text.dream_start.output.preparing_snapshot", "Preparing current indexed file-memory snapshot."),
      details: [
        kvDetail("trigger", "Run Trigger", [
          { label: "trigger", value: trigger },
          { label: "startedAt", value: startedAt },
        ], traceI18n("trace.detail.run_trigger", "Run Trigger")),
      ],
    });
    persistTrace();

    try {
      store.mergeDuplicateEntries(store.listTmpEntries(2000));
      trace.snapshotSummary = buildSnapshotSummary(store);
      const before = store.listMemoryEntries({ limit: 1000, includeTmp: true });
      if (before.length === 0) {
        pushDreamStep(trace, {
          kind: "snapshot_loaded",
          title: "Snapshot Loaded",
          titleI18n: traceI18n("trace.step.snapshot_loaded", "Snapshot Loaded"),
          status: "success",
          inputSummary: "Loaded an empty file-memory snapshot.",
          inputSummaryI18n: traceI18n("trace.text.snapshot_loaded.input.empty", "Loaded an empty file-memory snapshot."),
          outputSummary: "No indexed file-memory exists yet.",
          outputSummaryI18n: traceI18n("trace.text.snapshot_loaded.output.no_memory", "No indexed file-memory exists yet."),
          details: [
            kvDetail("snapshot", "Dream Snapshot", [
              { label: "formalProjects", value: trace.snapshotSummary.formalProjectCount },
              { label: "tmpProjects", value: trace.snapshotSummary.tmpProjectCount },
              { label: "tmpFeedback", value: trace.snapshotSummary.tmpFeedbackCount },
              { label: "formalProjectFiles", value: trace.snapshotSummary.formalProjectFileCount },
              { label: "formalFeedbackFiles", value: trace.snapshotSummary.formalFeedbackFileCount },
              { label: "hasUserProfile", value: trace.snapshotSummary.hasUserProfile ? "yes" : "no" },
            ], traceI18n("trace.detail.dream_snapshot", "Dream Snapshot")),
          ],
        });
        const summary = "No file-based memory exists yet, so Dream had nothing to organize.";
        pushDreamStep(trace, {
          kind: "dream_finished",
          title: "Dream Finished",
          titleI18n: traceI18n("trace.step.dream_finished", "Dream Finished"),
          status: "success",
          inputSummary: "Finished Dream without any indexed file-memory.",
          inputSummaryI18n: traceI18n("trace.text.dream_finished.input.no_memory", "Finished Dream without any indexed file-memory."),
          outputSummary: summary,
          outputSummaryI18n: traceI18n("trace.text.dream_finished.output.no_memory", summary),
        });
        finalizeDreamTrace(trace, "completed", {
          rewrittenProjects: 0,
          deletedProjects: 0,
          deletedFiles: 0,
          profileUpdated: false,
          summary,
          summaryI18n: traceI18n("trace.text.dream_finished.output.no_memory", summary),
        });
        persistTrace();
        return {
          reviewedFiles: 0,
          rewrittenProjects: 0,
          deletedProjects: 0,
          deletedFiles: 0,
          profileUpdated: false,
          duplicateTopicCount: 0,
          conflictTopicCount: 0,
          summary,
        };
      }

      const repaired = store.repairManifests();
      const projectEntries = store.listMemoryEntries({
        scope: "project",
        kinds: ["project", "feedback"],
        includeTmp: true,
        limit: 1000,
      });
      const projectRecords = store.getMemoryRecordsByIds(projectEntries.map((entry) => entry.relativePath), 5000);
      const snapshots = projectRecords.map((record) => buildSnapshot(record, this.repository));
      const formalMetas = store.listProjectMetas();
      pushDreamStep(trace, {
        kind: "snapshot_loaded",
        title: "Snapshot Loaded",
        titleI18n: traceI18n("trace.step.snapshot_loaded", "Snapshot Loaded"),
        status: "success",
        inputSummary: `Loaded ${before.length} current memory files for Dream.`,
        inputSummaryI18n: traceI18n("trace.text.snapshot_loaded.input.loaded_files", "Loaded {0} current memory files for Dream.", before.length),
        outputSummary: `${snapshots.length} project memory files and ${formalMetas.length} formal projects are ready for Dream planning.`,
        outputSummaryI18n: traceI18n(
          "trace.text.snapshot_loaded.output.ready_for_planning",
          "{0} project memory files and {1} formal projects are ready for Dream planning.",
          snapshots.length,
          formalMetas.length,
        ),
        metrics: {
          totalFiles: before.length,
          projectFiles: snapshots.length,
          formalProjects: formalMetas.length,
        },
        details: [
          kvDetail("snapshot", "Dream Snapshot", [
            { label: "formalProjects", value: formalMetas.length },
            { label: "tmpProjects", value: trace.snapshotSummary.tmpProjectCount },
            { label: "tmpFeedback", value: trace.snapshotSummary.tmpFeedbackCount },
            { label: "formalProjectFiles", value: trace.snapshotSummary.formalProjectFileCount },
            { label: "formalFeedbackFiles", value: trace.snapshotSummary.formalFeedbackFileCount },
            { label: "hasUserProfile", value: trace.snapshotSummary.hasUserProfile ? "yes" : "no" },
          ], traceI18n("trace.detail.dream_snapshot", "Dream Snapshot")),
          jsonDetail(
            "records",
            "Project Memory Snapshot",
            snapshots.map((snapshot) => ({
              entryId: snapshot.record.relativePath,
              type: snapshot.record.type,
              projectId: snapshot.record.projectId,
              isTmp: snapshot.record.projectId === TMP_PROJECT_ID,
              name: snapshot.record.name,
              description: snapshot.record.description,
              preview: mutationPreview(snapshot.record),
            })),
            traceI18n("trace.detail.project_memory_snapshot", "Project Memory Snapshot"),
          ),
        ],
      });
      persistTrace();

      let plan: LlmDreamFileGlobalPlanOutput = {
        summary: "No project memory files were available for Dream planning.",
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        projects: [],
        deletedProjectIds: [],
        deletedEntryIds: [],
      };
      let globalPlanDebug: RetrievalPromptDebug | undefined;
      if (snapshots.length > 0) {
        plan = await this.extractor.planDreamFileMemory({
          currentProjects: formalMetas.map((meta) => buildProjectMetaInput(meta)),
          records: snapshots.map((snapshot) => snapshot.llmRecord),
          debugTrace: (debug) => {
            globalPlanDebug = debug;
          },
        });
      }

      pushDreamStep(trace, {
        kind: "global_plan_generated",
        title: "Global Plan Generated",
        titleI18n: traceI18n("trace.step.global_plan_generated", "Global Plan Generated"),
        status: "success",
        inputSummary: `Asked the model to audit ${snapshots.length} project memory files across ${formalMetas.length} formal projects.`,
        inputSummaryI18n: traceI18n(
          "trace.text.global_plan_generated.input",
          "Asked the model to audit {0} project memory files across {1} formal projects.",
          snapshots.length,
          formalMetas.length,
        ),
        outputSummary: plan.summary || "Dream generated a global reorganization plan.",
        ...(!plan.summary
          ? { outputSummaryI18n: traceI18n("trace.text.global_plan_generated.output.fallback", "Dream generated a global reorganization plan.") }
          : {}),
        metrics: {
          duplicateTopicCount: plan.duplicateTopicCount,
          conflictTopicCount: plan.conflictTopicCount,
          finalProjectCount: plan.projects.length,
          deletedProjectCount: plan.deletedProjectIds.length,
          deletedEntryCount: plan.deletedEntryIds.length,
        },
        details: [
          jsonDetail(
            "projects",
            "Final Project Plan",
            plan.projects.map((project) => ({
              targetProjectId: project.targetProjectId,
              projectName: project.projectName,
              description: project.description,
              aliases: project.aliases,
              status: project.status,
              mergeReason: project.mergeReason,
              evidenceEntryIds: project.evidenceEntryIds,
              retainedEntryIds: project.retainedEntryIds,
            })),
            traceI18n("trace.detail.final_project_plan", "Final Project Plan"),
          ),
          listDetail("deleted-projects", "Deleted Formal Projects", plan.deletedProjectIds, traceI18n("trace.detail.deleted_formal_projects", "Deleted Formal Projects")),
          listDetail("deleted-entries", "Deleted Memory Files", plan.deletedEntryIds, traceI18n("trace.detail.deleted_memory_files", "Deleted Memory Files")),
        ],
        ...(globalPlanDebug ? { promptDebug: globalPlanDebug } : {}),
      });
      persistTrace();

      validateGlobalPlan(plan, snapshots, formalMetas);
      pushDreamStep(trace, {
        kind: "global_plan_validated",
        title: "Global Plan Validated",
        titleI18n: traceI18n("trace.step.global_plan_validated", "Global Plan Validated"),
        status: "success",
        inputSummary: "Validated the global Dream plan against current file-memory.",
        inputSummaryI18n: traceI18n("trace.text.global_plan_validated.input", "Validated the global Dream plan against current file-memory."),
        outputSummary: `Validated ${plan.projects.length} final projects, ${plan.deletedProjectIds.length} deleted projects, and ${plan.deletedEntryIds.length} deleted files.`,
        outputSummaryI18n: traceI18n(
          "trace.text.global_plan_validated.output",
          "Validated {0} final projects, {1} deleted projects, and {2} deleted files.",
          plan.projects.length,
          plan.deletedProjectIds.length,
          plan.deletedEntryIds.length,
        ),
      });
      persistTrace();

      const deletedProjectIds = new Set(plan.deletedProjectIds);
      const executionPlans: DreamProjectExecution[] = [];
      const formalMetaById = new Map(formalMetas.map((meta) => [meta.projectId, meta] as const));
      for (const projectPlan of plan.projects) {
        const currentMeta = projectPlan.targetProjectId ? formalMetaById.get(projectPlan.targetProjectId) ?? null : null;
        const projectId = currentMeta?.projectId
          ?? store.createStableProjectId([projectPlan.projectName, projectPlan.description, ...projectPlan.aliases].join(" "));
        const sourceSnapshots = projectPlan.retainedEntryIds
          .map((entryId) => snapshots.find((snapshot) => snapshot.record.relativePath === entryId))
          .filter((snapshot): snapshot is DreamRecordSnapshot => Boolean(snapshot));
        let rewriteDebug: RetrievalPromptDebug | undefined;
        const rewriteInput: LlmDreamFileProjectRewriteInput = {
          project: { ...projectPlan, projectId },
          currentMeta: currentMeta ? buildProjectMetaInput(currentMeta) : null,
          records: sourceSnapshots.map((snapshot) => snapshot.llmRecord),
          debugTrace: (debug) => {
            rewriteDebug = debug;
          },
        };
        const rewrite = await this.extractor.rewriteDreamFileProject(rewriteInput);
        validateProjectRewrite(rewriteInput, rewrite);
        const execution: DreamProjectExecution = {
          projectId,
          currentMeta,
          plan: { ...projectPlan, projectId },
          sourceSnapshots,
          rewrite,
          writtenRelativePaths: [],
          deletedRelativePaths: [],
        };
        executionPlans.push(execution);
        pushDreamStep(trace, {
          kind: "project_rewrite_generated",
          title: `Project Rewrite · ${projectPlan.projectName}`,
          titleI18n: traceI18n("trace.text.project_rewrite_generated.title", "Project Rewrite · {0}", projectPlan.projectName),
          status: "success",
          inputSummary: `Rewriting ${sourceSnapshots.length} retained files for ${projectPlan.projectName}.`,
          inputSummaryI18n: traceI18n(
            "trace.text.project_rewrite_generated.input",
            "Rewriting {0} retained files for {1}.",
            sourceSnapshots.length,
            projectPlan.projectName,
          ),
          outputSummary: rewrite.summary || `Prepared rewritten files for ${projectPlan.projectName}.`,
          ...(!rewrite.summary
            ? {
                outputSummaryI18n: traceI18n(
                  "trace.text.project_rewrite_generated.output.fallback",
                  "Prepared rewritten files for {0}.",
                  projectPlan.projectName,
                ),
              }
            : {}),
          details: [
            kvDetail("meta", "Project Meta Before/After", [
              { label: "fromProjectId", value: currentMeta?.projectId || "new formal project" },
              { label: "fromName", value: currentMeta?.projectName || projectPlan.projectName },
              { label: "toProjectId", value: projectId },
              { label: "toName", value: rewrite.projectMeta.projectName || projectPlan.projectName },
              { label: "toStatus", value: rewrite.projectMeta.status || projectPlan.status },
            ], traceI18n("trace.detail.project_meta_before_after", "Project Meta Before/After")),
            listDetail(
              "retained",
              "Retained Source Files",
              sourceSnapshots.map((snapshot) => `${snapshot.record.relativePath} · ${snapshot.record.type}:${snapshot.record.name}`),
              traceI18n("trace.detail.retained_source_files", "Retained Source Files"),
            ),
            jsonDetail(
              "rewritten-files",
              "Rewritten Files",
              rewrite.files.map((file) => ({
                type: file.type,
                name: file.name,
                description: file.description,
                sourceEntryIds: file.sourceEntryIds,
              })),
              traceI18n("trace.detail.rewritten_files", "Rewritten Files"),
            ),
            listDetail("deleted", "Deleted Source Files", rewrite.deletedEntryIds, traceI18n("trace.detail.deleted_source_files", "Deleted Source Files")),
          ],
          ...(rewriteDebug ? { promptDebug: rewriteDebug } : {}),
        });
        persistTrace();
      }

      const deletedRelativePaths = new Set<string>();
      for (const execution of executionPlans) {
        const mergedMeta = store.upsertProjectMeta({
          projectId: execution.projectId,
          projectName: execution.rewrite.projectMeta.projectName || execution.plan.projectName,
          description: execution.rewrite.projectMeta.description || execution.plan.description,
          aliases: sanitizeProjectAliases(
            [
              ...(execution.currentMeta?.aliases ?? []),
              ...execution.plan.aliases,
              ...execution.rewrite.projectMeta.aliases,
            ],
            execution.rewrite.projectMeta.projectName || execution.plan.projectName,
          ),
          status: normalizeText(execution.rewrite.projectMeta.status || execution.plan.status || "active") || "active",
          dreamUpdatedAt: nowIso(),
        });

        const keptPaths = new Set<string>();
        for (const file of execution.rewrite.files) {
          const targetRelativePath = chooseTargetRelativePath(
            store,
            execution.projectId,
            file,
            execution.sourceSnapshots,
            deletedProjectIds,
          );
          if (keptPaths.has(targetRelativePath)) {
            throw new Error(`Dream project rewrite produced multiple rewritten files targeting the same path: ${targetRelativePath}`);
          }
          keptPaths.add(targetRelativePath);
          execution.writtenRelativePaths.push(targetRelativePath);
          const nextRecord = store.writeCandidateToRelativePath(targetRelativePath, buildCandidateFromRewriteFile(execution.projectId, file));
          pushMutation(trace, {
            action: "write",
            relativePath: targetRelativePath,
            projectId: execution.projectId,
            projectName: mergedMeta.projectName,
            candidateType: nextRecord.type,
            name: nextRecord.name,
            description: nextRecord.description,
            preview: mutationPreview(nextRecord),
          });
        }

        const rewriteDeleted = new Set(execution.rewrite.deletedEntryIds);
        for (const snapshot of execution.sourceSnapshots) {
          if (keptPaths.has(snapshot.record.relativePath)) continue;
          if (rewriteDeleted.has(snapshot.record.relativePath) || execution.plan.retainedEntryIds.includes(snapshot.record.relativePath)) {
            deletedRelativePaths.add(snapshot.record.relativePath);
            execution.deletedRelativePaths.push(snapshot.record.relativePath);
          }
        }
        for (const relativePath of rewriteDeleted) {
          if (!keptPaths.has(relativePath)) {
            deletedRelativePaths.add(relativePath);
            execution.deletedRelativePaths.push(relativePath);
          }
        }

        pushDreamStep(trace, {
          kind: "project_mutations_applied",
          title: `Project Mutations Applied · ${mergedMeta.projectName}`,
          titleI18n: traceI18n("trace.text.project_mutations_applied.title", "Project Mutations Applied · {0}", mergedMeta.projectName),
          status: "success",
          inputSummary: `Applied Dream writes and deletions for ${mergedMeta.projectName}.`,
          inputSummaryI18n: traceI18n(
            "trace.text.project_mutations_applied.input",
            "Applied Dream writes and deletions for {0}.",
            mergedMeta.projectName,
          ),
          outputSummary: `Wrote ${execution.writtenRelativePaths.length} files and marked ${execution.deletedRelativePaths.length} files for deletion.`,
          outputSummaryI18n: traceI18n(
            "trace.text.project_mutations_applied.output",
            "Wrote {0} files and marked {1} files for deletion.",
            execution.writtenRelativePaths.length,
            execution.deletedRelativePaths.length,
          ),
          details: [
            listDetail("writes", "Written Files", execution.writtenRelativePaths, traceI18n("trace.detail.written_files", "Written Files")),
            jsonDetail(
              "deletes",
              "Deleted File Previews",
              execution.deletedRelativePaths
                .map((relativePath) => {
                  const snapshot = execution.sourceSnapshots.find((item) => item.record.relativePath === relativePath);
                  if (!snapshot) return null;
                  return {
                    relativePath,
                    type: snapshot.record.type,
                    name: snapshot.record.name,
                    description: snapshot.record.description,
                    preview: mutationPreview(snapshot.record),
                  };
                })
                .filter(Boolean),
              traceI18n("trace.detail.deleted_file_previews", "Deleted File Previews"),
            ),
          ],
        });
        persistTrace();
      }

      for (const relativePath of plan.deletedEntryIds) {
        deletedRelativePaths.add(relativePath);
      }
      const deletedPathArray = Array.from(deletedRelativePaths);
      const deletedFileSnapshots = deletedPathArray
        .map((relativePath) => store.getMemoryRecord(relativePath, 5000))
        .filter((record): record is MemoryFileRecord => Boolean(record));
      const deletedFiles = store.deleteRecords(deletedPathArray);
      for (const record of deletedFileSnapshots) {
        pushMutation(trace, {
          action: "delete",
          relativePath: record.relativePath,
          ...(record.projectId ? { projectId: record.projectId } : {}),
          candidateType: record.type,
          name: record.name,
          description: record.description,
          preview: mutationPreview(record),
        });
      }

      let deletedProjects = 0;
      for (const projectId of deletedProjectIds) {
        const meta = store.getProjectMeta(projectId);
        if (store.deleteProject(projectId)) {
          deletedProjects += 1;
          pushMutation(trace, {
            action: "delete_project",
            projectId,
            projectName: meta?.projectName || projectId,
            ...(meta?.description ? { description: meta.description } : {}),
            preview: previewText(meta?.description),
          });
        }
      }
      let userProfileRewritten = false;
      let userRewriteDebug: RetrievalPromptDebug | undefined;
      const userSummary = store.getUserSummary();
      const beforeUserRecord = store.getMemoryRecord("global/User/user-profile.md", 5000);
      const userCandidate = buildUserProfileCandidate(userSummary);
      const rewriteUserProfile = (this.extractor as Partial<LlmMemoryExtractor>).rewriteUserProfile?.bind(this.extractor);
      if (userCandidate && rewriteUserProfile) {
        const rewritten = await rewriteUserProfile({
          existingProfile: userSummary,
          candidates: [userCandidate],
          debugTrace: (debug) => {
            userRewriteDebug = debug;
          },
        });
        if (rewritten && !sameUserSummaryContent(userSummary, rewritten)) {
          const nextRecord = store.upsertCandidate(rewritten);
          userProfileRewritten = !beforeUserRecord
            || beforeUserRecord.content.trim() !== nextRecord.content.trim()
            || beforeUserRecord.description !== nextRecord.description;
          if (userProfileRewritten) {
            pushMutation(trace, {
              action: "rewrite_user_profile",
              relativePath: nextRecord.relativePath,
              candidateType: "user",
              name: nextRecord.name,
              description: nextRecord.description,
              preview: mutationPreview(nextRecord),
            });
          }
        }
      }

      pushDreamStep(trace, {
        kind: "user_profile_rewritten",
        title: "User Profile Rewritten",
        titleI18n: traceI18n("trace.step.user_profile_rewritten", "User Profile Rewritten"),
        status: userCandidate ? (userProfileRewritten ? "success" : "info") : "skipped",
        inputSummary: userCandidate
          ? "Reviewed the global user profile against current file-based user memory."
          : "No global user profile was available for Dream rewrite.",
        ...(userCandidate
          ? {
              inputSummaryI18n: traceI18n(
                "trace.text.dream_user_profile_rewritten.input.reviewed",
                "Reviewed the global user profile against current file-based user memory.",
              ),
            }
          : {
              inputSummaryI18n: traceI18n(
                "trace.text.dream_user_profile_rewritten.input.none",
                "No global user profile was available for Dream rewrite.",
              ),
            }),
        outputSummary: userCandidate
          ? (userProfileRewritten ? "Rewrote the global user profile." : "Global user profile did not need a Dream rewrite.")
          : "Skipped user profile rewrite.",
        ...(userCandidate
          ? {
              outputSummaryI18n: userProfileRewritten
                ? traceI18n("trace.text.dream_user_profile_rewritten.output.rewritten", "Rewrote the global user profile.")
                : traceI18n("trace.text.dream_user_profile_rewritten.output.unchanged", "Global user profile did not need a Dream rewrite."),
            }
          : {
              outputSummaryI18n: traceI18n("trace.text.dream_user_profile_rewritten.output.skipped", "Skipped user profile rewrite."),
            }),
        details: [
          jsonDetail("before", "User Profile Before", {
            profile: userSummary.profile,
            preferences: userSummary.preferences,
            constraints: userSummary.constraints,
            relationships: userSummary.relationships,
          }, traceI18n("trace.detail.user_profile_before", "User Profile Before")),
          jsonDetail("after", "User Profile After", store.getUserSummary(), traceI18n("trace.detail.user_profile_after", "User Profile After")),
        ],
        ...(userRewriteDebug ? { promptDebug: userRewriteDebug } : {}),
      });
      persistTrace();

      const finalRepair = store.repairManifests();
      pushDreamStep(trace, {
        kind: "manifests_repaired",
        title: "Manifests Repaired",
        titleI18n: traceI18n("trace.step.manifests_repaired", "Manifests Repaired"),
        status: "success",
        inputSummary: "Repaired manifests after Dream writes and deletions.",
        inputSummaryI18n: traceI18n("trace.text.manifests_repaired.input", "Repaired manifests after Dream writes and deletions."),
        outputSummary: finalRepair.summary || repaired.summary,
        outputSummaryI18n: traceI18n(
          "trace.text.manifests_repaired.output",
          "Rebuilt manifests for {0} memory files.",
          finalRepair.memoryFileCount,
        ),
      });
      persistTrace();

      const unresolvedTmpCount = store.listTmpEntries(1000).length;
      const summary = buildExecutionSummary(
        before.length,
        finalRepair.summary || repaired.summary,
        plan,
        executionPlans,
        deletedProjects,
        deletedFiles.length,
        userProfileRewritten,
        store.getUserSummary(),
        unresolvedTmpCount,
      );
      pushDreamStep(trace, {
        kind: "dream_finished",
        title: "Dream Finished",
        titleI18n: traceI18n("trace.step.dream_finished", "Dream Finished"),
        status: "success",
        inputSummary: "Completed Dream organization, rewriting, and cleanup.",
        inputSummaryI18n: traceI18n("trace.text.dream_finished.input.completed", "Completed Dream organization, rewriting, and cleanup."),
        outputSummary: summary,
        outputSummaryI18n: traceI18n(
          "trace.text.dream_finished.output.completed_summary",
          "Dream reviewed {0} memory files, rewrote {1} projects, deleted {2} projects, deleted {3} files, unresolved tmp={4}.",
          before.length,
          executionPlans.length,
          deletedProjects,
          deletedFiles.length,
          unresolvedTmpCount,
        ),
      });

      const outcome = {
        reviewedFiles: before.length,
        rewrittenProjects: executionPlans.length,
        deletedProjects,
        deletedFiles: deletedFiles.length,
        profileUpdated: userProfileRewritten,
        duplicateTopicCount: plan.duplicateTopicCount,
        conflictTopicCount: plan.conflictTopicCount,
        summary,
      };
      finalizeDreamTrace(trace, "completed", {
        rewrittenProjects: outcome.rewrittenProjects,
        deletedProjects: outcome.deletedProjects,
        deletedFiles: deletedFiles.length,
        profileUpdated: outcome.profileUpdated,
        summary: outcome.summary,
        summaryI18n: traceI18n(
          "trace.text.dream_finished.output.completed_summary",
          "Dream reviewed {0} memory files, rewrote {1} projects, deleted {2} projects, deleted {3} files, unresolved tmp={4}.",
          before.length,
          executionPlans.length,
          deletedProjects,
          deletedFiles.length,
          unresolvedTmpCount,
        ),
      });
      persistTrace();
      this.options.logger?.info?.(`[clawxmemory] ${summary}`);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushDreamStep(trace, {
        kind: "dream_finished",
        title: "Dream Finished",
        titleI18n: traceI18n("trace.step.dream_finished", "Dream Finished"),
        status: "error",
        inputSummary: "Dream failed before it could finish all stages.",
        inputSummaryI18n: traceI18n("trace.text.dream_finished.input.failed", "Dream failed before it could finish all stages."),
        outputSummary: message,
      });
      finalizeDreamTrace(trace, "error", {
        rewrittenProjects: trace.outcome.rewrittenProjects,
        deletedProjects: trace.outcome.deletedProjects,
        deletedFiles: trace.outcome.deletedFiles,
        profileUpdated: trace.outcome.profileUpdated,
        summary: message,
      });
      persistTrace();
      throw error;
    }
  }
}
