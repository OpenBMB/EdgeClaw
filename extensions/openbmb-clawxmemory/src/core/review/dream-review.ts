import type {
  DreamEvidenceRef,
  DreamReviewFinding,
  DreamReviewFocus,
  DreamReviewResult,
  GlobalProfileRecord,
  L0SessionRecord,
  L1WindowRecord,
  L2ProjectIndexRecord,
  ProjectStatus,
} from "../types.js";
import type { HeartbeatStats } from "../pipeline/heartbeat.js";
import { LlmMemoryExtractor } from "../skills/llm-extraction.js";
import { buildL2ProjectIndexId, nowIso } from "../utils/id.js";

type LoggerLike = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

interface DreamReviewRunnerOptions {
  logger?: LoggerLike;
  getDreamProjectRebuildTimeoutMs?: () => number;
}

interface DreamEvidencePack {
  focus: DreamReviewFocus;
  profile: GlobalProfileRecord | null;
  l2Projects: L2ProjectIndexRecord[];
  l1Windows: L1WindowRecord[];
  l0Previews: L0SessionRecord[];
  timeLayerNotes: DreamReviewFinding[];
  evidenceRefs: DreamEvidenceRef[];
}

interface DreamProjectCandidate {
  l1IndexId: string;
  endedAt: string;
  projectKey: string;
  projectName: string;
  status: ProjectStatus;
  summary: string;
  latestProgress: string;
  confidence: number;
}

interface DreamProjectCluster {
  clusterId: string;
  label: string;
  candidateKeys: string[];
  candidateNames: string[];
  currentProjectKeys: string[];
  l1Ids: string[];
  statuses: ProjectStatus[];
  summaries: string[];
  latestProgresses: string[];
  issueHints: DreamL1Issue["issueType"][];
  representativeWindows: Array<{
    l1IndexId: string;
    endedAt: string;
    summary: string;
  }>;
}

interface DreamRewriteEvidence {
  currentProjects: L2ProjectIndexRecord[];
  currentProfile: GlobalProfileRecord;
  allL1Windows: L1WindowRecord[];
  l0Previews: L0SessionRecord[];
  projectClusters: DreamProjectCluster[];
}

export interface DreamL1Issue {
  issueType: "duplicate" | "conflict" | "isolated";
  title: string;
  l1Ids: string[];
  relatedProjectKeys: string[];
}

export interface DreamProjectRebuildItem {
  projectKey: string;
  projectName: string;
  currentStatus: ProjectStatus;
  summary: string;
  latestProgress: string;
  retainedL1Ids: string[];
}

export interface DreamProjectRebuildPlan {
  summary: string;
  duplicateTopicCount: number;
  conflictTopicCount: number;
  projects: DreamProjectRebuildItem[];
  deletedProjectKeys: string[];
  l1Issues: DreamL1Issue[];
}

export interface DreamGlobalProfileRewrite {
  profileText: string;
  sourceL1Ids: string[];
  conflictWithExisting: boolean;
}

export interface DreamRewriteOutcome {
  reviewedL1: number;
  rewrittenProjects: number;
  deletedProjects: number;
  profileUpdated: boolean;
  duplicateTopicCount: number;
  conflictTopicCount: number;
  prunedProjectL1Refs: number;
  prunedProfileL1Refs: number;
  summary: string;
}

export interface DreamRunResult extends DreamRewriteOutcome {
  prepFlush: HeartbeatStats;
  trigger?: "manual" | "scheduled";
  status?: "success" | "skipped";
  skipReason?: string;
}

const DREAM_RECENT_L1_LIMIT = 12;
const DREAM_MAX_PROJECTS = 12;
const DREAM_MAX_L0_SPOTCHECK = 4;
const DREAM_MAX_TIME_NOTES = 6;
const DREAM_MAX_REWRITE_L0_SPOTCHECK = 6;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildRefId(level: DreamEvidenceRef["level"], id: string): string {
  return `${level}:${id}`;
}

function buildL0Preview(record: L0SessionRecord): string {
  const preview = record.messages
    .slice(-4)
    .map((message) => `${message.role}: ${normalizeWhitespace(message.content)}`)
    .filter((value) => value !== ":")
    .join(" | ");
  return truncate(preview, 220);
}

function formatDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "unknown-day";
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function emptyDreamReview(summary: string, evidenceRefs: DreamEvidenceRef[] = [], timeLayerNotes: DreamReviewFinding[] = []): DreamReviewResult {
  return {
    summary,
    projectRebuild: [],
    profileSuggestions: [],
    cleanup: [],
    ambiguous: [],
    noAction: [],
    timeLayerNotes,
    evidenceRefs,
  };
}

function normalizeProjectIdentity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

function tokenizeForSimilarity(value: string): string[] {
  const normalized = normalizeWhitespace(value).toLowerCase();
  const tokens = normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]/g) ?? [];
  return Array.from(new Set(tokens));
}

function similarityScore(left: string, right: string): number {
  const leftTokens = tokenizeForSimilarity(left);
  const rightTokens = tokenizeForSimilarity(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightSet.has(token)) overlap += 1;
  }
  return overlap / new Set([...leftTokens, ...rightTokens]).size;
}

function resolveProjectStatus(statuses: ProjectStatus[]): ProjectStatus {
  const values = new Set(statuses);
  if (values.has("in_progress")) return "in_progress";
  if (values.size === 1 && values.has("done")) return "done";
  if (values.has("done") && values.size > 1) return "in_progress";
  return "planned";
}

function countProjectSourceRefs(projects: readonly L2ProjectIndexRecord[]): number {
  return projects.reduce((total, project) => total + project.l1Source.length, 0);
}

function sortL1IdsByEndedAt(ids: string[], windowsById: ReadonlyMap<string, L1WindowRecord>): string[] {
  return Array.from(new Set(ids))
    .filter((id) => windowsById.has(id))
    .sort((left, right) => {
      const leftWindow = windowsById.get(left)!;
      const rightWindow = windowsById.get(right)!;
      return rightWindow.endedAt.localeCompare(leftWindow.endedAt);
    });
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class DreamReviewRunner {
  constructor(
    private readonly repository: {
      listRecentL1(limit?: number, offset?: number): L1WindowRecord[];
      getL2ProjectByKey(projectKey: string): L2ProjectIndexRecord | undefined;
      getGlobalProfileRecord(): GlobalProfileRecord;
      getL0ByL1Ids(l1Ids: string[], limit?: number): L0SessionRecord[];
      getL2TimeByDate(dateKey: string): { l2IndexId: string; dateKey: string; summary: string; l1Source: string[] } | undefined;
    },
    private readonly extractor: LlmMemoryExtractor,
    private readonly options: DreamReviewRunnerOptions = {},
  ) {}

  async review(focus: DreamReviewFocus): Promise<DreamReviewResult> {
    const evidence = this.buildEvidencePack(focus);
    if (
      evidence.l1Windows.length === 0
      && evidence.l2Projects.length === 0
      && !evidence.profile?.profileText.trim()
      && evidence.timeLayerNotes.length === 0
    ) {
      return emptyDreamReview("Not enough indexed memory evidence to run Dream review yet.", evidence.evidenceRefs);
    }

    const llmResult = await this.extractor.reviewDream({
      focus,
      profile: evidence.profile,
      l2Projects: evidence.l2Projects,
      l1Windows: evidence.l1Windows,
      l0Sessions: evidence.l0Previews,
      evidenceRefs: evidence.evidenceRefs,
      timeLayerNotes: evidence.timeLayerNotes,
    });

    return {
      ...llmResult,
      timeLayerNotes: evidence.timeLayerNotes,
      evidenceRefs: evidence.evidenceRefs,
    };
  }

  private buildEvidencePack(focus: DreamReviewFocus): DreamEvidencePack {
    const rawRecentL1 = this.repository.listRecentL1(DREAM_RECENT_L1_LIMIT, 0);
    const l1Windows = focus === "profile"
      ? rawRecentL1
      : (() => {
          const projectWindows = rawRecentL1.filter((window) => window.projectDetails.length > 0);
          return projectWindows.length > 0 ? projectWindows : rawRecentL1;
        })();

    const profileRecord = this.repository.getGlobalProfileRecord();
    const profile = focus === "projects"
      ? null
      : (profileRecord.profileText.trim() ? profileRecord : null);

    const projectKeys = Array.from(
      new Set(
        l1Windows.flatMap((window) => window.projectDetails.map((project) => project.key)).filter(Boolean),
      ),
    ).slice(0, DREAM_MAX_PROJECTS);
    const l2Projects = projectKeys
      .map((projectKey) => this.repository.getL2ProjectByKey(projectKey))
      .filter((item): item is L2ProjectIndexRecord => Boolean(item));

    const suspiciousL1Ids = l1Windows
      .filter((window) => (
        window.projectDetails.length > 1
        || window.projectDetails.some((project) =>
          project.confidence < 0.6 || !project.summary.trim() || !project.latestProgress.trim()
        )
      ))
      .map((window) => window.l1IndexId)
      .slice(0, DREAM_MAX_L0_SPOTCHECK);
    const l0Previews = suspiciousL1Ids.length > 0
      ? this.repository.getL0ByL1Ids(suspiciousL1Ids, DREAM_MAX_L0_SPOTCHECK)
      : [];

    const evidenceRefs: DreamEvidenceRef[] = [];
    const addRef = (ref: DreamEvidenceRef): void => {
      if (evidenceRefs.some((existing) => existing.refId === ref.refId)) return;
      evidenceRefs.push(ref);
    };

    if (profile) {
      addRef({
        refId: buildRefId("profile", profile.recordId),
        level: "profile",
        id: profile.recordId,
        label: "Global Profile",
        summary: truncate(profile.profileText, 220),
      });
    }

    for (const project of l2Projects) {
      addRef({
        refId: buildRefId("l2_project", project.l2IndexId),
        level: "l2_project",
        id: project.l2IndexId,
        label: project.projectName || project.projectKey,
        summary: truncate(`${project.summary} | latest: ${project.latestProgress}`.trim(), 220),
      });
    }

    for (const window of l1Windows) {
      const projectSummary = window.projectDetails
        .map((project) => `${project.name}(${project.status})`)
        .slice(0, 3)
        .join(", ");
      addRef({
        refId: buildRefId("l1", window.l1IndexId),
        level: "l1",
        id: window.l1IndexId,
        label: window.timePeriod || window.endedAt,
        summary: truncate([window.summary, projectSummary].filter(Boolean).join(" | "), 220),
      });
    }

    for (const session of l0Previews) {
      addRef({
        refId: buildRefId("l0", session.l0IndexId),
        level: "l0",
        id: session.l0IndexId,
        label: `${session.sessionKey} @ ${session.timestamp}`,
        summary: buildL0Preview(session),
      });
    }

    const timeLayerNotes = this.buildTimeLayerNotes(l1Windows, addRef);

    return {
      focus,
      profile,
      l2Projects,
      l1Windows,
      l0Previews,
      timeLayerNotes,
      evidenceRefs,
    };
  }

  private buildTimeLayerNotes(
    l1Windows: L1WindowRecord[],
    addRef: (ref: DreamEvidenceRef) => void,
  ): DreamReviewFinding[] {
    const notes: DreamReviewFinding[] = [];
    const byDate = new Map<string, string[]>();
    for (const window of l1Windows) {
      const dateKey = formatDateKey(window.startedAt || window.endedAt || window.createdAt);
      const current = byDate.get(dateKey) ?? [];
      current.push(window.l1IndexId);
      byDate.set(dateKey, current);
    }

    for (const [dateKey, l1Ids] of Array.from(byDate.entries()).slice(0, DREAM_MAX_TIME_NOTES)) {
      const timeIndex = this.repository.getL2TimeByDate(dateKey);
      if (timeIndex) {
        addRef({
          refId: buildRefId("l2_time", timeIndex.l2IndexId),
          level: "l2_time",
          id: timeIndex.l2IndexId,
          label: timeIndex.dateKey,
          summary: truncate(timeIndex.summary, 220),
        });
      }

      const evidenceRefs = [
        ...(timeIndex ? [buildRefId("l2_time", timeIndex.l2IndexId)] : []),
        ...l1Ids.map((id) => buildRefId("l1", id)),
      ];

      if (!timeIndex) {
        notes.push({
          title: `Missing L2Time summary for ${dateKey}`,
          rationale: `Recent L1 windows exist for ${dateKey}, but no daily L2Time summary was found. Dream should only note this gap; it should not rebuild the time layer semantically.`,
          confidence: 0.85,
          target: "time_note",
          evidenceRefs,
        });
        continue;
      }

      if (!timeIndex.summary.trim()) {
        notes.push({
          title: `Empty L2Time summary for ${dateKey}`,
          rationale: `The day bucket exists but the summary is empty. This is a time-layer integrity issue, not a Dream rewrite target.`,
          confidence: 0.88,
          target: "time_note",
          evidenceRefs,
        });
      } else if (timeIndex.l1Source.length === 0) {
        notes.push({
          title: `Unlinked L2Time summary for ${dateKey}`,
          rationale: `The daily summary has no linked L1 sources. Keep the time layer read-only for Dream, but flag the missing linkage.`,
          confidence: 0.82,
          target: "time_note",
          evidenceRefs,
        });
      } else {
        const missingL1 = l1Ids.filter((id) => !timeIndex.l1Source.includes(id));
        if (missingL1.length > 0) {
          notes.push({
            title: `L2Time source coverage looks incomplete for ${dateKey}`,
            rationale: `Some recent L1 windows for this day are not linked from the L2Time record. Record the integrity gap, but do not treat it as a Dream semantic rewrite.`,
            confidence: 0.7,
            target: "time_note",
            evidenceRefs,
          });
        }
      }
    }

    return notes.slice(0, DREAM_MAX_TIME_NOTES).map((note) => ({
      ...note,
      confidence: clampConfidence(note.confidence),
    }));
  }
}

export class DreamRewriteRunner {
  constructor(
    private readonly repository: {
      listAllL1(): L1WindowRecord[];
      listAllL2Projects(): L2ProjectIndexRecord[];
      getGlobalProfileRecord(): GlobalProfileRecord;
      getL0ByL1Ids(l1Ids: string[], limit?: number): L0SessionRecord[];
      applyDreamRewrite(input: {
        projects: L2ProjectIndexRecord[];
        profileText: string;
        profileSourceL1Ids: string[];
      }): void;
    },
    private readonly extractor: LlmMemoryExtractor,
    private readonly options: DreamReviewRunnerOptions = {},
  ) {}

  async run(): Promise<DreamRewriteOutcome> {
    const evidence = this.buildRewriteEvidence();
    if (evidence.allL1Windows.length === 0) {
      return {
        reviewedL1: 0,
        rewrittenProjects: 0,
        deletedProjects: 0,
        profileUpdated: false,
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        prunedProjectL1Refs: 0,
        prunedProfileL1Refs: 0,
        summary: "No L1 windows are available for Dream reconstruction.",
      };
    }

    const plan = await this.buildProjectPlan(evidence);
    const profileRewrite = await this.buildProfileRewrite(evidence, plan);

    const currentProjectsByKey = new Map(evidence.currentProjects.map((project) => [project.projectKey, project]));
    const finalProjects = plan.projects.map((item) => {
      const existing = currentProjectsByKey.get(item.projectKey);
      const timestamp = nowIso();
      return {
        l2IndexId: existing?.l2IndexId ?? buildL2ProjectIndexId(item.projectKey),
        projectKey: item.projectKey,
        projectName: item.projectName,
        summary: item.summary,
        currentStatus: item.currentStatus,
        latestProgress: item.latestProgress,
        l1Source: sortL1IdsByEndedAt(item.retainedL1Ids, new Map(evidence.allL1Windows.map((window) => [window.l1IndexId, window]))),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      } satisfies L2ProjectIndexRecord;
    });

    const currentProjectSourceRefs = countProjectSourceRefs(evidence.currentProjects);
    const nextProjectSourceRefs = countProjectSourceRefs(finalProjects);
    const prunedProjectL1Refs = Math.max(0, currentProjectSourceRefs - nextProjectSourceRefs);
    const profileUpdated = profileRewrite.profileText !== evidence.currentProfile.profileText
      || !arraysEqual(profileRewrite.sourceL1Ids, evidence.currentProfile.sourceL1Ids);
    const prunedProfileL1Refs = Math.max(0, evidence.currentProfile.sourceL1Ids.length - profileRewrite.sourceL1Ids.length);
    const deletedProjectKeys = Array.from(
      new Set(
        [
          ...plan.deletedProjectKeys,
          ...evidence.currentProjects
            .map((project) => project.projectKey)
            .filter((projectKey) => !finalProjects.some((item) => item.projectKey === projectKey)),
        ],
      ),
    );

    this.repository.applyDreamRewrite({
      projects: finalProjects,
      profileText: profileRewrite.profileText,
      profileSourceL1Ids: profileRewrite.sourceL1Ids,
    });

    return {
      reviewedL1: evidence.allL1Windows.length,
      rewrittenProjects: finalProjects.length,
      deletedProjects: deletedProjectKeys.length,
      profileUpdated,
      duplicateTopicCount: plan.duplicateTopicCount,
      conflictTopicCount: plan.conflictTopicCount,
      prunedProjectL1Refs,
      prunedProfileL1Refs,
      summary: truncate(plan.summary || "Dream reconstruction completed.", 280),
    };
  }

  private buildRewriteEvidence(): DreamRewriteEvidence {
    const allL1Windows = this.repository.listAllL1();
    const currentProjects = this.repository.listAllL2Projects();
    const currentProfile = this.repository.getGlobalProfileRecord();
    const clusters = this.clusterProjects(allL1Windows, currentProjects);
    const suspiciousL1Ids = clusters
      .filter((cluster) => cluster.issueHints.length > 0 || cluster.currentProjectKeys.length !== 1)
      .flatMap((cluster) => cluster.l1Ids)
      .slice(0, DREAM_MAX_REWRITE_L0_SPOTCHECK);
    const l0Previews = suspiciousL1Ids.length > 0
      ? this.repository.getL0ByL1Ids(suspiciousL1Ids, DREAM_MAX_REWRITE_L0_SPOTCHECK)
      : [];
    return {
      currentProjects,
      currentProfile,
      allL1Windows,
      l0Previews,
      projectClusters: clusters,
    };
  }

  private clusterProjects(
    l1Windows: L1WindowRecord[],
    currentProjects: L2ProjectIndexRecord[],
  ): DreamProjectCluster[] {
    const clusters: Array<DreamProjectCluster & { anchorText: string }> = [];
    const currentByKey = new Map(currentProjects.map((project) => [project.projectKey, project]));

    const candidates: DreamProjectCandidate[] = l1Windows.flatMap((window) =>
      window.projectDetails.map((project) => ({
        l1IndexId: window.l1IndexId,
        endedAt: window.endedAt,
        projectKey: project.key,
        projectName: project.name,
        status: project.status,
        summary: project.summary,
        latestProgress: project.latestProgress,
        confidence: project.confidence,
      })),
    );

    for (const candidate of candidates) {
      const identity = normalizeProjectIdentity(candidate.projectKey || candidate.projectName);
      const text = `${candidate.projectName} ${candidate.summary} ${candidate.latestProgress}`;
      const cluster = clusters.find((item) => {
        const sameIdentity = item.candidateKeys.includes(candidate.projectKey)
          || item.candidateNames.some((name) => normalizeProjectIdentity(name) === normalizeProjectIdentity(candidate.projectName))
          || identity === normalizeProjectIdentity(item.label);
        if (sameIdentity) return true;
        return similarityScore(item.anchorText, text) >= 0.45;
      });

      if (cluster) {
        cluster.candidateKeys.push(candidate.projectKey);
        cluster.candidateNames.push(candidate.projectName);
        cluster.l1Ids.push(candidate.l1IndexId);
        cluster.statuses.push(candidate.status);
        cluster.summaries.push(candidate.summary);
        cluster.latestProgresses.push(candidate.latestProgress);
        cluster.representativeWindows.push({
          l1IndexId: candidate.l1IndexId,
          endedAt: candidate.endedAt,
          summary: truncate(candidate.summary || candidate.latestProgress, 180),
        });
        if (candidate.summary.trim()) {
          cluster.anchorText = `${cluster.anchorText} ${candidate.summary}`.trim();
        }
        continue;
      }

      clusters.push({
        clusterId: `cluster-${clusters.length + 1}`,
        label: candidate.projectName || candidate.projectKey,
        candidateKeys: [candidate.projectKey],
        candidateNames: [candidate.projectName],
        currentProjectKeys: currentByKey.has(candidate.projectKey) ? [candidate.projectKey] : [],
        l1Ids: [candidate.l1IndexId],
        statuses: [candidate.status],
        summaries: [candidate.summary],
        latestProgresses: [candidate.latestProgress],
        issueHints: [],
        representativeWindows: [{
          l1IndexId: candidate.l1IndexId,
          endedAt: candidate.endedAt,
          summary: truncate(candidate.summary || candidate.latestProgress, 180),
        }],
        anchorText: text,
      });
    }

    return clusters.map((cluster) => {
      const candidateKeySet = Array.from(new Set(cluster.candidateKeys.filter(Boolean)));
      const candidateNameSet = Array.from(new Set(cluster.candidateNames.filter(Boolean)));
      const statusSet = Array.from(new Set(cluster.statuses));
      const currentProjectKeys = Array.from(new Set([
        ...cluster.currentProjectKeys,
        ...currentProjects
          .filter((project) =>
            candidateKeySet.includes(project.projectKey)
            || candidateNameSet.some((name) => normalizeProjectIdentity(name) === normalizeProjectIdentity(project.projectName))
            || project.l1Source.some((id) => cluster.l1Ids.includes(id)),
          )
          .map((project) => project.projectKey),
      ]));
      const issueHints: DreamL1Issue["issueType"][] = [];
      if (currentProjectKeys.length > 1 || candidateKeySet.length > 1 || candidateNameSet.length > 1) {
        issueHints.push("duplicate");
      }
      if (statusSet.includes("done") && statusSet.includes("in_progress")) {
        issueHints.push("conflict");
      }
      if (cluster.l1Ids.length === 1 && currentProjectKeys.length === 0) {
        issueHints.push("isolated");
      }
      return {
        clusterId: cluster.clusterId,
        label: cluster.label,
        candidateKeys: candidateKeySet,
        candidateNames: candidateNameSet,
        currentProjectKeys,
        l1Ids: Array.from(new Set(cluster.l1Ids)),
        statuses: cluster.statuses,
        summaries: cluster.summaries.map((summary) => truncate(summary, 180)).filter(Boolean),
        latestProgresses: cluster.latestProgresses.map((value) => truncate(value, 140)).filter(Boolean),
        issueHints,
        representativeWindows: cluster.representativeWindows
          .sort((left, right) => right.endedAt.localeCompare(left.endedAt))
          .slice(0, 4),
      };
    });
  }

  private buildFallbackProjectPlan(evidence: DreamRewriteEvidence): DreamProjectRebuildPlan {
    const windowsById = new Map(evidence.allL1Windows.map((window) => [window.l1IndexId, window]));
    const fallbackProjects = evidence.projectClusters
      .filter((cluster) => cluster.l1Ids.length > 0)
      .map((cluster) => {
        const retainedL1Ids = sortL1IdsByEndedAt(cluster.l1Ids, windowsById);
        const mostRecentWindow = retainedL1Ids.length > 0 ? windowsById.get(retainedL1Ids[0]!) : undefined;
        const mostRecentProject = mostRecentWindow?.projectDetails.find((project) =>
          cluster.candidateKeys.includes(project.key)
          || cluster.candidateNames.includes(project.name),
        );
        return {
          projectKey: (
            cluster.currentProjectKeys[0]
            ?? cluster.candidateKeys[0]
            ?? normalizeProjectIdentity(cluster.candidateNames[0] ?? cluster.label).replace(/\s+/g, "-")
          ) || `dream-project-${cluster.clusterId}`,
          projectName: cluster.currentProjectKeys[0]
            ? (evidence.currentProjects.find((project) => project.projectKey === cluster.currentProjectKeys[0])?.projectName ?? cluster.label)
            : (cluster.candidateNames[0] ?? cluster.label),
          currentStatus: mostRecentProject?.status ?? resolveProjectStatus(cluster.statuses),
          summary: mostRecentProject?.summary
            || cluster.summaries.find(Boolean)
            || mostRecentWindow?.summary
            || cluster.label,
          latestProgress: mostRecentProject?.latestProgress
            || cluster.latestProgresses.find(Boolean)
            || mostRecentWindow?.situationTimeInfo
            || cluster.label,
          retainedL1Ids,
        } satisfies DreamProjectRebuildItem;
      });

    const existingKeys = new Set(evidence.currentProjects.map((project) => project.projectKey));
    const finalKeys = new Set(fallbackProjects.map((project) => project.projectKey));
    return {
      summary: "Dream fallback rebuilt project memory from current L1 clusters.",
      duplicateTopicCount: evidence.projectClusters.filter((cluster) => cluster.issueHints.includes("duplicate")).length,
      conflictTopicCount: evidence.projectClusters.filter((cluster) => cluster.issueHints.includes("conflict")).length,
      projects: fallbackProjects,
      deletedProjectKeys: Array.from(existingKeys).filter((key) => !finalKeys.has(key)),
      l1Issues: evidence.projectClusters.flatMap((cluster) =>
        cluster.issueHints.map((issueType) => ({
          issueType,
          title: `${cluster.label} ${issueType}`,
          l1Ids: cluster.l1Ids,
          relatedProjectKeys: cluster.currentProjectKeys.length > 0 ? cluster.currentProjectKeys : cluster.candidateKeys,
        })),
      ),
    };
  }

  private async buildProjectPlan(
    evidence: DreamRewriteEvidence,
  ): Promise<DreamProjectRebuildPlan> {
    const planned = await this.extractor.planDreamProjectRebuild({
      currentProjects: evidence.currentProjects,
      profile: evidence.currentProfile,
      l1Windows: evidence.allL1Windows,
      l0Sessions: evidence.l0Previews,
      clusters: evidence.projectClusters,
      ...(this.options.getDreamProjectRebuildTimeoutMs
        ? { timeoutMs: this.options.getDreamProjectRebuildTimeoutMs() }
        : {}),
    });
    if (planned.projects.length === 0) {
      throw new Error("Dream project rebuild returned no valid projects.");
    }
    const explainedCurrentKeys = new Set([
      ...planned.projects.map((project) => project.projectKey),
      ...planned.deletedProjectKeys,
    ]);
    const unexplainedCurrentKeys = evidence.currentProjects
      .map((project) => project.projectKey)
      .filter((projectKey) => !explainedCurrentKeys.has(projectKey));
    if (unexplainedCurrentKeys.length > 0) {
      throw new Error(`Dream project rebuild did not explain current projects: ${unexplainedCurrentKeys.join(", ")}`);
    }
    return planned;
  }

  private async buildProfileRewrite(
    evidence: DreamRewriteEvidence,
    plan: DreamProjectRebuildPlan,
  ): Promise<DreamGlobalProfileRewrite> {
    const rewritten = await this.extractor.rewriteDreamGlobalProfile({
      existingProfile: evidence.currentProfile,
      l1Windows: evidence.allL1Windows,
      currentProjects: evidence.currentProjects,
      plannedProjects: plan.projects,
      l1Issues: plan.l1Issues,
    });
    const normalizedIds = sortL1IdsByEndedAt(
      rewritten.sourceL1Ids,
      new Map(evidence.allL1Windows.map((window) => [window.l1IndexId, window])),
    );
    if (!(normalizedIds.length >= 2 || (rewritten.conflictWithExisting && normalizedIds.length >= 1))) {
      throw new Error("Dream global profile rewrite did not satisfy the source support gate.");
    }
    return {
      profileText: rewritten.profileText.trim() || evidence.currentProfile.profileText,
      sourceL1Ids: normalizedIds,
      conflictWithExisting: rewritten.conflictWithExisting,
    };
  }

  private buildFallbackProfileRewrite(evidence: DreamRewriteEvidence): DreamGlobalProfileRewrite {
    const groupedFacts = new Map<string, { value: string; l1Ids: string[] }>();
    for (const window of evidence.allL1Windows) {
      for (const fact of window.facts) {
        const existing = groupedFacts.get(fact.factKey);
        if (existing) {
          existing.l1Ids.push(window.l1IndexId);
          continue;
        }
        groupedFacts.set(fact.factKey, {
          value: fact.factValue,
          l1Ids: [window.l1IndexId],
        });
      }
    }
    const stableFacts = Array.from(groupedFacts.values())
      .filter((entry) => new Set(entry.l1Ids).size >= 2)
      .sort((left, right) => new Set(right.l1Ids).size - new Set(left.l1Ids).size)
      .slice(0, 8);
    if (stableFacts.length === 0) {
      return {
        profileText: evidence.currentProfile.profileText,
        sourceL1Ids: evidence.currentProfile.sourceL1Ids,
        conflictWithExisting: false,
      };
    }
    const sourceL1Ids = sortL1IdsByEndedAt(
      stableFacts.flatMap((entry) => entry.l1Ids),
      new Map(evidence.allL1Windows.map((window) => [window.l1IndexId, window])),
    );
    return {
      profileText: truncate(stableFacts.map((entry) => entry.value).join("；"), 420),
      sourceL1Ids,
      conflictWithExisting: false,
    };
  }
}
