import type {
  ActiveTopicBufferRecord,
  IndexingSettings,
  L0SessionRecord,
  L1WindowRecord,
  L2ProjectIndexRecord,
  MemoryMessage,
  ProjectDetail,
} from "../types.js";
import { buildL0IndexId, nowIso } from "../utils/id.js";
import { extractL1FromWindow } from "../indexers/l1-extractor.js";
import { buildL2ProjectFromDetail, buildL2TimeFromL1 } from "../indexers/l2-builder.js";
import { LlmMemoryExtractor } from "../skills/llm-extraction.js";
import { MemoryRepository } from "../storage/sqlite.js";

export interface HeartbeatOptions {
  batchSize?: number;
  source?: string;
  settings: IndexingSettings;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
  };
}

export interface HeartbeatRunOptions {
  batchSize?: number;
  sessionKeys?: string[];
  reason?: string;
}

export interface HeartbeatStats {
  l0Captured: number;
  l1Created: number;
  l2TimeUpdated: number;
  l2ProjectUpdated: number;
  profileUpdated: number;
  failed: number;
}

function sameMessage(left: MemoryMessage | undefined, right: MemoryMessage | undefined): boolean {
  if (!left || !right) return false;
  return left.role === right.role && left.content === right.content;
}

function hasNewContent(previous: MemoryMessage[], incoming: MemoryMessage[]): boolean {
  if (incoming.length === 0) return false;
  if (previous.length === 0) return true;
  if (incoming.length > previous.length) return true;
  for (let index = 0; index < incoming.length; index += 1) {
    if (!sameMessage(previous[index], incoming[index])) return true;
  }
  return false;
}

function normalizeTurn(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function userTurnsFromRecord(record: L0SessionRecord): string[] {
  return record.messages
    .filter((message) => message.role === "user")
    .map((message) => normalizeTurn(message.content))
    .filter(Boolean);
}

function findTurnOverlap(existing: string[], incoming: string[]): number {
  const max = Math.min(existing.length, incoming.length);
  for (let size = max; size > 0; size -= 1) {
    let matched = true;
    for (let index = 0; index < size; index += 1) {
      if (existing[existing.length - size + index] !== incoming[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return size;
  }
  return 0;
}

function extractIncomingUserTurns(record: L0SessionRecord, buffer?: ActiveTopicBufferRecord): string[] {
  const turns = userTurnsFromRecord(record);
  if (!buffer || buffer.userTurns.length === 0) return turns;
  const overlap = findTurnOverlap(buffer.userTurns, turns);
  return turns.slice(overlap);
}

function summarizeTopicSeed(turns: string[]): string {
  const raw = normalizeTurn(turns[turns.length - 1] ?? turns[0] ?? "当前话题");
  return raw.length <= 120 ? raw : raw.slice(0, 120).trim();
}

function mergeUniqueStrings(existing: string[], incoming: string[]): string[] {
  const next = [...existing];
  for (const item of incoming) {
    if (!next.includes(item)) next.push(item);
  }
  return next;
}

function buildLocalDateKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10) || "unknown";
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const PROJECT_STATUS_RANK: Record<ProjectDetail["status"], number> = {
  done: 3,
  in_progress: 2,
  planned: 1,
};

const GENERIC_PROJECT_SUMMARY_PATTERNS = [
  /^(用户|我).{0,12}(正在|目前|继续|开始|还在)/,
  /^(正在|目前).{0,16}(推进|处理|做|写|准备)/,
  /(进展顺利|进展还可以|还可以|持续推进|正在推进|正在处理|目前顺利|目前正常)/,
];

type ProjectRewriteContext = {
  incomingProject: ProjectDetail;
  existingProject: L2ProjectIndexRecord | null;
  recentWindows: L1WindowRecord[];
};

function truncateProjectText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).trim();
}

function normalizeComparableProjectText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。；;、,:：!?！？"'`~\-_/\\()[\]{}]/g, "");
}

function preferProjectStatus(existing: ProjectDetail["status"], incoming: ProjectDetail["status"]): ProjectDetail["status"] {
  return PROJECT_STATUS_RANK[incoming] >= PROJECT_STATUS_RANK[existing] ? incoming : existing;
}

function chooseProjectName(existingName: string, incomingName: string): string {
  return incomingName.length >= existingName.length ? incomingName : existingName;
}

function isWeakProjectSummary(summary: string, projectName: string, latestProgress: string): boolean {
  const normalized = normalizeComparableProjectText(summary);
  if (!normalized) return true;

  const normalizedName = normalizeComparableProjectText(projectName);
  const normalizedLatest = normalizeComparableProjectText(latestProgress);
  if (normalized.length <= Math.max(10, normalizedName.length + 4)) return true;
  if (normalizedLatest && (normalized === normalizedLatest || normalized.endsWith(normalizedLatest))) return true;
  if (GENERIC_PROJECT_SUMMARY_PATTERNS.some((pattern) => pattern.test(summary)) && !summary.includes(projectName)) return true;
  return false;
}

function chooseRicherProjectSummary(existingSummary: string, incomingSummary: string, projectName: string, latestProgress: string): string {
  const normalizedExisting = truncateProjectText(existingSummary, 360);
  const normalizedIncoming = truncateProjectText(incomingSummary, 360);
  const existingWeak = isWeakProjectSummary(normalizedExisting, projectName, latestProgress);
  const incomingWeak = isWeakProjectSummary(normalizedIncoming, projectName, latestProgress);

  if (normalizedExisting && !existingWeak && (incomingWeak || normalizedExisting.length >= normalizedIncoming.length)) {
    return normalizedExisting;
  }
  if (normalizedIncoming && !incomingWeak) return normalizedIncoming;
  return normalizedIncoming || normalizedExisting;
}

function mergeDistinctProjectText(base: string, addition: string, maxLength = 360): string {
  const normalizedBase = truncateProjectText(base, maxLength);
  const normalizedAddition = truncateProjectText(addition, maxLength);
  if (!normalizedAddition) return normalizedBase;
  if (!normalizedBase) return normalizedAddition;

  const comparableBase = normalizeComparableProjectText(normalizedBase);
  const comparableAddition = normalizeComparableProjectText(normalizedAddition);
  if (!comparableAddition || comparableBase.includes(comparableAddition) || comparableAddition.includes(comparableBase)) {
    return normalizedBase;
  }

  const separator = /[。！？.!?]$/.test(normalizedBase) ? " " : "；";
  return truncateProjectText(`${normalizedBase}${separator}${normalizedAddition}`, maxLength);
}

function chooseLatestProgress(existingProgress: string, incomingProgress: string, l1: L1WindowRecord): string {
  return truncateProjectText(incomingProgress || existingProgress || l1.situationTimeInfo || l1.summary, 220);
}

function fallbackRewriteProjectDetail(context: ProjectRewriteContext, l1: L1WindowRecord, rewritten?: ProjectDetail): ProjectDetail {
  const { incomingProject, existingProject } = context;
  const latestProgress = chooseLatestProgress(
    existingProject?.latestProgress ?? "",
    rewritten?.latestProgress || incomingProject.latestProgress,
    l1,
  );
  let summary = chooseRicherProjectSummary(
    existingProject?.summary ?? "",
    rewritten?.summary || incomingProject.summary,
    incomingProject.name,
    latestProgress,
  );
  summary = mergeDistinctProjectText(summary, incomingProject.summary, 360);
  summary = mergeDistinctProjectText(summary, latestProgress, 360);
  if (isWeakProjectSummary(summary, incomingProject.name, latestProgress)) {
    summary = mergeDistinctProjectText(summary, l1.summary, 360);
  }
  summary = truncateProjectText(summary || incomingProject.summary || existingProject?.summary || incomingProject.name, 360);

  return {
    ...incomingProject,
    name: chooseProjectName(existingProject?.projectName ?? "", rewritten?.name || incomingProject.name),
    status: rewritten?.status ?? incomingProject.status ?? existingProject?.currentStatus ?? "planned",
    summary,
    latestProgress,
    confidence: Math.max(incomingProject.confidence, rewritten?.confidence ?? 0),
  };
}

function mergeProjectDetail(existing: ProjectDetail, incoming: ProjectDetail): ProjectDetail {
  const preferredStatus = preferProjectStatus(existing.status, incoming.status);
  return {
    ...existing,
    name: chooseProjectName(existing.name, incoming.name),
    status: preferredStatus,
    summary: chooseRicherProjectSummary(existing.summary, incoming.summary, incoming.name, incoming.latestProgress),
    latestProgress: incoming.latestProgress || existing.latestProgress,
    confidence: Math.max(existing.confidence, incoming.confidence),
  };
}

async function canonicalizeL1Projects(
  projects: Awaited<ReturnType<typeof extractL1FromWindow>>["projectDetails"],
  repository: MemoryRepository,
  extractor: LlmMemoryExtractor,
): Promise<Awaited<ReturnType<typeof extractL1FromWindow>>["projectDetails"]> {
  if (projects.length === 0) return projects;
  const catalog = new Map<string, {
    projectKey: string;
    projectName: string;
    summary: string;
    currentStatus: ProjectDetail["status"];
    latestProgress: string;
  }>();
  for (const item of repository.listRecentL2Projects(60)) {
    catalog.set(item.projectKey, {
      projectKey: item.projectKey,
      projectName: item.projectName,
      summary: item.summary,
      currentStatus: item.currentStatus,
      latestProgress: item.latestProgress,
    });
  }

  const existingProjects = Array.from(catalog.values()).map((item) => ({
    l2IndexId: `catalog:${item.projectKey}`,
    projectKey: item.projectKey,
    projectName: item.projectName,
    summary: item.summary,
    currentStatus: item.currentStatus,
    latestProgress: item.latestProgress,
    l1Source: [],
    createdAt: "",
    updatedAt: "",
  }));
  const normalizedProjects = await extractor.resolveProjectIdentities({
    projects,
    existingProjects,
  });
  const resolved = new Map<string, ProjectDetail>();
  for (const normalized of normalizedProjects) {
    const merged = resolved.has(normalized.key)
      ? mergeProjectDetail(resolved.get(normalized.key)!, normalized)
      : normalized;
    resolved.set(merged.key, merged);
    catalog.set(merged.key, {
      projectKey: merged.key,
      projectName: merged.name,
      summary: merged.summary,
      currentStatus: merged.status,
      latestProgress: merged.latestProgress,
    });
  }

  return Array.from(resolved.values());
}

async function rewriteRollingProjectMemories(
  projects: ProjectDetail[],
  l1: L1WindowRecord,
  repository: MemoryRepository,
  extractor: LlmMemoryExtractor,
): Promise<ProjectDetail[]> {
  if (projects.length === 0) return projects;

  const contexts: ProjectRewriteContext[] = projects.map((incomingProject) => {
    const existingProject = repository.getL2ProjectByKey(incomingProject.key) ?? null;
    const recentWindowIds = existingProject?.l1Source.slice(-4) ?? [];
    const recentWindows = recentWindowIds.length > 0 ? repository.getL1ByIds(recentWindowIds).slice(0, 4) : [];
    return {
      incomingProject,
      existingProject,
      recentWindows,
    };
  });

  try {
    const rewrittenProjects = await extractor.rewriteProjectMemories({
      l1,
      projects: contexts,
    });
    const rewrittenByKey = new Map(rewrittenProjects.map((project) => [project.key, project]));
    return contexts.map((context) => {
      const rewritten = rewrittenByKey.get(context.incomingProject.key);
      if (!rewritten) return fallbackRewriteProjectDetail(context, l1);
      const merged = fallbackRewriteProjectDetail(context, l1, rewritten);
      if (isWeakProjectSummary(merged.summary, merged.name, merged.latestProgress)) {
        return fallbackRewriteProjectDetail(context, l1);
      }
      return merged;
    });
  } catch {
    return contexts.map((context) => fallbackRewriteProjectDetail(context, l1));
  }
}

export class HeartbeatIndexer {
  private readonly batchSize: number;
  private readonly source: string;
  private readonly logger: HeartbeatOptions["logger"];
  private settings: IndexingSettings;

  constructor(
    private readonly repository: MemoryRepository,
    private readonly extractor: LlmMemoryExtractor,
    options: HeartbeatOptions,
  ) {
    this.batchSize = options.batchSize ?? 30;
    this.source = options.source ?? "openclaw";
    this.settings = options.settings;
    this.logger = options.logger;
  }

  getSettings(): IndexingSettings {
    return { ...this.settings };
  }

  setSettings(settings: IndexingSettings): void {
    this.settings = { ...settings };
  }

  captureL0Session(input: {
    sessionKey: string;
    timestamp?: string;
    messages: MemoryMessage[];
    source?: string;
  }): L0SessionRecord | undefined {
    const timestamp = input.timestamp ?? nowIso();
    const recent = this.repository.listRecentL0(1)[0];
    if (recent?.sessionKey === input.sessionKey && !hasNewContent(recent.messages, input.messages)) {
      this.logger?.info?.(`[clawxmemory] skip duplicate l0 capture for session=${input.sessionKey}`);
      return undefined;
    }
    const payload = JSON.stringify(input.messages);
    const l0IndexId = buildL0IndexId(input.sessionKey, timestamp, payload);
    const record: L0SessionRecord = {
      l0IndexId,
      sessionKey: input.sessionKey,
      timestamp,
      messages: input.messages,
      source: input.source ?? this.source,
      indexed: false,
      createdAt: nowIso(),
    };
    this.repository.insertL0Session(record);
    return record;
  }

  private createTopicBuffer(record: L0SessionRecord, incomingUserTurns: string[], topicSummary?: string): ActiveTopicBufferRecord {
    const seedTurns = incomingUserTurns.length > 0 ? incomingUserTurns : userTurnsFromRecord(record);
    const now = nowIso();
    return {
      sessionKey: record.sessionKey,
      startedAt: record.timestamp,
      updatedAt: record.timestamp,
      topicSummary: topicSummary?.trim() || summarizeTopicSeed(seedTurns),
      userTurns: seedTurns,
      l0Ids: [record.l0IndexId],
      lastL0Id: record.l0IndexId,
      createdAt: now,
    };
  }

  private createTopicBufferFromBatch(
    records: L0SessionRecord[],
    incomingUserTurns: string[],
    topicSummary?: string,
  ): ActiveTopicBufferRecord {
    const first = records[0]!;
    const last = records[records.length - 1]!;
    const seedTurns = incomingUserTurns.length > 0
      ? incomingUserTurns
      : records.flatMap((record) => userTurnsFromRecord(record));
    return {
      sessionKey: first.sessionKey,
      startedAt: first.timestamp,
      updatedAt: last.timestamp,
      topicSummary: topicSummary?.trim() || summarizeTopicSeed(seedTurns),
      userTurns: seedTurns,
      l0Ids: records.map((record) => record.l0IndexId),
      lastL0Id: last.l0IndexId,
      createdAt: nowIso(),
    };
  }

  private extendTopicBuffer(
    buffer: ActiveTopicBufferRecord,
    record: L0SessionRecord,
    incomingUserTurns: string[],
    topicSummary?: string,
  ): ActiveTopicBufferRecord {
    return {
      ...buffer,
      updatedAt: record.timestamp,
      topicSummary: topicSummary?.trim() || buffer.topicSummary || summarizeTopicSeed(buffer.userTurns),
      userTurns: mergeUniqueStrings(buffer.userTurns, incomingUserTurns),
      l0Ids: mergeUniqueStrings(buffer.l0Ids, [record.l0IndexId]),
      lastL0Id: record.l0IndexId,
    };
  }

  private async closeTopicBuffer(sessionKey: string, stats: HeartbeatStats, reason: string): Promise<void> {
    const buffer = this.repository.getActiveTopicBuffer(sessionKey);
    if (!buffer || buffer.l0Ids.length === 0) {
      if (buffer) this.repository.deleteActiveTopicBuffer(sessionKey);
      return;
    }

    const records = this.repository.getL0ByIds(buffer.l0Ids);
    if (records.length === 0) {
      this.repository.deleteActiveTopicBuffer(sessionKey);
      return;
    }

    const extracted = await extractL1FromWindow(records, this.extractor);
    const canonicalProjects = await canonicalizeL1Projects(extracted.projectDetails, this.repository, this.extractor);
    const l1 = {
      ...extracted,
      projectDetails: canonicalProjects,
      projectTags: canonicalProjects.map((project) => project.name),
    };
    this.repository.insertL1Window(l1);
    for (const l0 of records) {
      this.repository.insertLink("l1", l1.l1IndexId, "l0", l0.l0IndexId);
    }
    stats.l1Created += 1;

    const dateKey = buildLocalDateKey(l1.endedAt);
    const existingDay = this.repository.getL2TimeByDate(dateKey);
    const daySummary = await this.extractor.rewriteDailyTimeSummary({
      dateKey,
      existingSummary: existingDay?.summary ?? "",
      l1,
    });
    const l2Time = buildL2TimeFromL1(l1, daySummary);
    this.repository.upsertL2TimeIndex(l2Time);
    this.repository.insertLink("l2", l2Time.l2IndexId, "l1", l1.l1IndexId);
    stats.l2TimeUpdated += 1;

    const rollingProjects = await rewriteRollingProjectMemories(l1.projectDetails, l1, this.repository, this.extractor);
    const projectIndexes = rollingProjects.map((project) => buildL2ProjectFromDetail(project, l1.l1IndexId));
    for (const l2Project of projectIndexes) {
      this.repository.upsertL2ProjectIndex(l2Project);
      this.repository.insertLink("l2", l2Project.l2IndexId, "l1", l1.l1IndexId);
      stats.l2ProjectUpdated += 1;
    }

    const currentProfile = this.repository.getGlobalProfileRecord();
    const nextProfileText = await this.extractor.rewriteGlobalProfile({
      existingProfile: currentProfile.profileText,
      l1,
    });
    this.repository.upsertGlobalProfile(nextProfileText, [l1.l1IndexId]);
    stats.profileUpdated += 1;

    this.repository.deleteActiveTopicBuffer(sessionKey);
    this.logger?.info?.(
      `[clawxmemory] closed topic session=${sessionKey} reason=${reason} l1=${l1.l1IndexId} l0=${records.length}`,
    );
  }

  private async closeOtherSessionBuffers(currentSessionKey: string, stats: HeartbeatStats, reason: string): Promise<void> {
    const openBuffers = this.repository.listActiveTopicBuffers();
    for (const buffer of openBuffers) {
      if (buffer.sessionKey === currentSessionKey) continue;
      await this.closeTopicBuffer(buffer.sessionKey, stats, `${reason}:session_boundary`);
    }
  }

  private async processPendingRecord(record: L0SessionRecord, stats: HeartbeatStats, reason: string): Promise<void> {
    await this.closeOtherSessionBuffers(record.sessionKey, stats, reason);

    const buffer = this.repository.getActiveTopicBuffer(record.sessionKey);
    const incomingUserTurns = extractIncomingUserTurns(record, buffer);
    if (!buffer) {
      this.repository.upsertActiveTopicBuffer(this.createTopicBuffer(record, incomingUserTurns));
      return;
    }

    if (incomingUserTurns.length === 0) {
      this.repository.upsertActiveTopicBuffer(this.extendTopicBuffer(buffer, record, incomingUserTurns));
      return;
    }

    const decision = await this.extractor.judgeTopicShift({
      currentTopicSummary: buffer.topicSummary,
      recentUserTurns: buffer.userTurns.slice(-8),
      incomingUserTurns,
    });

    if (decision.topicChanged) {
      await this.closeTopicBuffer(record.sessionKey, stats, `${reason}:topic_shift`);
      this.repository.upsertActiveTopicBuffer(this.createTopicBuffer(record, incomingUserTurns, decision.topicSummary));
      return;
    }

    this.repository.upsertActiveTopicBuffer(
      this.extendTopicBuffer(buffer, record, incomingUserTurns, decision.topicSummary),
    );
  }

  private async processPendingSession(records: L0SessionRecord[], stats: HeartbeatStats, reason: string): Promise<void> {
    if (records.length === 0) return;
    const sessionKey = records[0]!.sessionKey;
    await this.closeOtherSessionBuffers(sessionKey, stats, reason);

    const buffer = this.repository.getActiveTopicBuffer(sessionKey);
    if (!buffer) {
      const mergedTurns = records.flatMap((record) => userTurnsFromRecord(record));
      this.repository.upsertActiveTopicBuffer(this.createTopicBufferFromBatch(records, mergedTurns));
      return;
    }

    let scratch = buffer;
    let mergedIncomingTurns: string[] = [];
    for (const record of records) {
      const incomingUserTurns = extractIncomingUserTurns(record, scratch);
      if (incomingUserTurns.length > 0) {
        mergedIncomingTurns = mergeUniqueStrings(mergedIncomingTurns, incomingUserTurns);
      }
      scratch = this.extendTopicBuffer(scratch, record, incomingUserTurns);
    }

    if (mergedIncomingTurns.length === 0) {
      this.repository.upsertActiveTopicBuffer(scratch);
      return;
    }

    const decision = await this.extractor.judgeTopicShift({
      currentTopicSummary: buffer.topicSummary,
      recentUserTurns: buffer.userTurns.slice(-8),
      incomingUserTurns: mergedIncomingTurns,
    });

    if (decision.topicChanged) {
      await this.closeTopicBuffer(sessionKey, stats, `${reason}:topic_shift`);
      this.repository.upsertActiveTopicBuffer(
        this.createTopicBufferFromBatch(records, mergedIncomingTurns, decision.topicSummary),
      );
      return;
    }

    this.repository.upsertActiveTopicBuffer({
      ...scratch,
      topicSummary: decision.topicSummary?.trim() || scratch.topicSummary,
    });
  }

  async runHeartbeat(options: HeartbeatRunOptions = {}): Promise<HeartbeatStats> {
    const stats: HeartbeatStats = {
      l0Captured: 0,
      l1Created: 0,
      l2TimeUpdated: 0,
      l2ProjectUpdated: 0,
      profileUpdated: 0,
      failed: 0,
    };

    const batchSize = options.batchSize ?? this.batchSize;
    const sessionKeys = Array.isArray(options.sessionKeys) && options.sessionKeys.length > 0
      ? Array.from(new Set(options.sessionKeys))
      : undefined;
    const reason = options.reason ?? "heartbeat";

    while (true) {
      const pending = this.repository.listUnindexedL0Sessions(batchSize, sessionKeys);
      if (pending.length === 0) break;
      stats.l0Captured += pending.length;

      const indexedIds: string[] = [];
      const grouped = new Map<string, L0SessionRecord[]>();
      for (const record of pending) {
        const list = grouped.get(record.sessionKey) ?? [];
        list.push(record);
        grouped.set(record.sessionKey, list);
      }
      for (const records of grouped.values()) {
        try {
          await this.processPendingSession(records, stats, reason);
          indexedIds.push(...records.map((record) => record.l0IndexId));
        } catch (error) {
          stats.failed += 1;
          this.logger?.warn?.(
            `[clawxmemory] heartbeat failed reason=${reason} session=${records[0]?.sessionKey ?? "unknown"} l0=${records[0]?.l0IndexId ?? "unknown"}: ${String(error)}`,
          );
        }
      }

      this.repository.markL0Indexed(indexedIds);
      if (indexedIds.length === 0) break;
      if (pending.length < batchSize) break;
    }

    if (reason === "session_boundary" && sessionKeys && sessionKeys.length > 0) {
      for (const sessionKey of sessionKeys) {
        try {
          await this.closeTopicBuffer(sessionKey, stats, reason);
        } catch (error) {
          stats.failed += 1;
          this.logger?.warn?.(
            `[clawxmemory] close topic failed reason=${reason} session=${sessionKey}: ${String(error)}`,
          );
        }
      }
    }

    if (reason === "manual") {
      for (const buffer of this.repository.listActiveTopicBuffers()) {
        try {
          await this.closeTopicBuffer(buffer.sessionKey, stats, reason);
        } catch (error) {
          stats.failed += 1;
          this.logger?.warn?.(
            `[clawxmemory] close topic failed reason=${reason} session=${buffer.sessionKey}: ${String(error)}`,
          );
        }
      }
    }

    if (stats.l1Created > 0 || stats.l2TimeUpdated > 0 || stats.l2ProjectUpdated > 0 || stats.profileUpdated > 0) {
      this.repository.setPipelineState("lastIndexedAt", nowIso());
    }
    return stats;
  }
}
