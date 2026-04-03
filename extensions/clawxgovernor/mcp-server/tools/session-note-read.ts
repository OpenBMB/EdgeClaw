import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NOTES_DIR = path.join(os.homedir(), ".openclaw", "cc-session-memory", "notes");

export function sessionNoteRead(sessionId: string, lastN?: number): string {
  const noteFile = path.join(NOTES_DIR, `${sessionId}.md`);
  try {
    if (!fs.existsSync(noteFile)) return `No session notes found for session "${sessionId}".`;
    const content = fs.readFileSync(noteFile, "utf-8").trim();
    if (!content) return `Session notes file exists but is empty for session "${sessionId}".`;
    if (!lastN) return content;
    const turns = content.split(/(?=^## Turn \d+)/m).filter(Boolean);
    return turns.slice(-lastN).join("\n").trim();
  } catch {
    return `Error reading session notes for session "${sessionId}".`;
  }
}
