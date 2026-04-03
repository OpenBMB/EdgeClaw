import type {
  L1WindowRecord,
  L2ProjectIndexRecord,
  L2TimeIndexRecord,
  ProjectDetail,
} from "../types.js";
import { buildL2ProjectIndexId, buildL2TimeIndexId, nowIso } from "../utils/id.js";

function formatLocalDayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "unknown-day";
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildL2TimeFromL1(
  l1: L1WindowRecord,
  summary: string,
): L2TimeIndexRecord {
  const dateKey = formatLocalDayKey(l1.startedAt || l1.endedAt || l1.createdAt);
  const now = nowIso();
  return {
    l2IndexId: buildL2TimeIndexId(dateKey),
    dateKey,
    summary,
    l1Source: [l1.l1IndexId],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildL2ProjectFromDetail(
  project: ProjectDetail,
  l1IndexId: string,
): L2ProjectIndexRecord {
  const now = nowIso();
  return {
    l2IndexId: buildL2ProjectIndexId(project.key),
    projectKey: project.key,
    projectName: project.name,
    summary: project.summary,
    currentStatus: project.status,
    latestProgress: project.latestProgress,
    l1Source: [l1IndexId],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildL2ProjectsFromL1(l1: L1WindowRecord): L2ProjectIndexRecord[] {
  return l1.projectDetails.map((project) => buildL2ProjectFromDetail(project, l1.l1IndexId));
}
