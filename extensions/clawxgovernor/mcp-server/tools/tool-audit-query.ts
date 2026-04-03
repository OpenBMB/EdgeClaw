import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const AUDIT_FILE = path.join(os.homedir(), ".openclaw", "cc-tool-governor", "audit.jsonl");

interface AuditEntry {
  timestamp: string;
  toolName: string;
  riskLevel?: string;
  action?: string;
  phase?: string;
  reason?: string;
  durationMs?: number;
  resultSize?: number;
  summarized?: boolean;
  params?: string;
}

function readAuditLog(): AuditEntry[] {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const lines = fs.readFileSync(AUDIT_FILE, "utf-8").trim().split("\n").filter(Boolean);
    return lines
      .map((line: string) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e: AuditEntry | null): e is AuditEntry => e !== null);
  } catch {
    return [];
  }
}

export function toolAuditQuery(filters: {
  toolName?: string;
  riskLevel?: string;
  action?: string;
  since?: string;
  limit?: number;
}): { status: string; entries: AuditEntry[]; total: number; filtered: number } {
  const limit = filters.limit ?? 20;
  let entries = readAuditLog();
  const total = entries.length;

  if (filters.toolName)
    entries = entries.filter((e) =>
      e.toolName?.toLowerCase().includes(filters.toolName!.toLowerCase()),
    );
  if (filters.riskLevel) entries = entries.filter((e) => e.riskLevel === filters.riskLevel);
  if (filters.action) entries = entries.filter((e) => e.action === filters.action);
  if (filters.since) entries = entries.filter((e) => e.timestamp >= filters.since!);

  const filtered = entries.length;
  return { status: "ok", entries: entries.slice(-limit), total, filtered };
}
