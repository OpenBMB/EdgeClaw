import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NOTES_DIR = path.join(os.homedir(), ".openclaw", "cc-session-memory", "notes");

interface SearchResult {
  sessionId: string;
  turn: string;
  snippet: string;
}

export function sessionNoteSearch(
  query: string,
  sessionId?: string,
): { status: string; query: string; results: SearchResult[]; totalMatches: number } {
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();
  try {
    if (!fs.existsSync(NOTES_DIR)) return { status: "ok", query, results: [], totalMatches: 0 };
    const files = sessionId
      ? [`${sessionId}.md`]
      : fs.readdirSync(NOTES_DIR).filter((f: string) => f.endsWith(".md"));

    for (const file of files) {
      const filePath = path.join(NOTES_DIR, file);
      if (!fs.existsSync(filePath)) continue;
      const sid = file.replace(/\.md$/, "");
      const turns = fs
        .readFileSync(filePath, "utf-8")
        .split(/(?=^## Turn \d+)/m)
        .filter(Boolean);
      for (const turn of turns) {
        if (turn.toLowerCase().includes(queryLower)) {
          const firstLine = turn.split("\n")[0] ?? "";
          const matchLine =
            turn.split("\n").find((l: string) => l.toLowerCase().includes(queryLower)) ?? "";
          results.push({
            sessionId: sid,
            turn: firstLine.replace(/^## /, "").trim(),
            snippet: matchLine.trim().slice(0, 200),
          });
        }
      }
    }
  } catch {
    return { status: "error", query, results: [], totalMatches: 0 };
  }
  return { status: "ok", query, results, totalMatches: results.length };
}
