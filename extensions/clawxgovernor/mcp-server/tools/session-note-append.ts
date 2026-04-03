import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NOTES_DIR = path.join(os.homedir(), ".openclaw", "cc-session-memory", "notes");

export function sessionNoteAppend(
  sessionId: string,
  note: string,
  turnIndex?: number,
): { success: boolean; totalNotes: number; file: string } {
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
    const noteFile = path.join(NOTES_DIR, `${sessionId}.md`);
    const timestamp = new Date().toISOString();

    let idx: number = turnIndex ?? 0;
    if (!idx) {
      idx = 1;
      try {
        if (fs.existsSync(noteFile)) {
          const matches = fs.readFileSync(noteFile, "utf-8").match(/^## Turn \d+/gm);
          if (matches) idx = matches.length + 1;
        }
      } catch {
        /* start at 1 */
      }
    }
    fs.appendFileSync(noteFile, `\n## Turn ${idx} (${timestamp})\n${note}\n`);

    let totalNotes = idx;
    try {
      const matches = fs.readFileSync(noteFile, "utf-8").match(/^## Turn \d+/gm);
      if (matches) totalNotes = matches.length;
    } catch {
      /* use idx */
    }
    return { success: true, totalNotes, file: noteFile };
  } catch {
    return { success: false, totalNotes: 0, file: "" };
  }
}
