import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

function resolveNotesDir(stateDir: string): string {
  return path.join(stateDir, "notes");
}

function readLatestSessionHint(
  notesDir: string,
  sessionId: string | undefined,
  maxLines: number,
): string | null {
  if (!sessionId) return null;
  const noteFile = path.join(notesDir, `${sessionId}.md`);
  try {
    if (!fs.existsSync(noteFile)) return null;
    const content = fs.readFileSync(noteFile, "utf-8").trim();
    if (!content) return null;
    const lines = content.split("\n").filter((l) => l.trim());
    return lines.slice(-maxLines).join("\n");
  } catch {
    return null;
  }
}

function appendDeltaNote(notesDir: string, sessionId: string, note: string): void {
  try {
    fs.mkdirSync(notesDir, { recursive: true });
    const noteFile = path.join(notesDir, `${sessionId}.md`);
    const timestamp = new Date().toISOString();

    let turnIndex = 1;
    try {
      if (fs.existsSync(noteFile)) {
        const existing = fs.readFileSync(noteFile, "utf-8");
        const turnMatches = existing.match(/^## Turn \d+/gm);
        if (turnMatches) turnIndex = turnMatches.length + 1;
      }
    } catch {
      /* start at 1 */
    }

    const entry = `\n## Turn ${turnIndex} (${timestamp})\n${note}\n`;
    fs.appendFileSync(noteFile, entry);
  } catch {
    /* non-critical */
  }
}

function extractDeltaNote(text: string): string {
  if (!text || text.length < 10) return "";
  const lines = text.split("\n").filter((l) => l.trim());
  const keyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("-") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("1.") ||
      trimmed.startsWith("2.") ||
      trimmed.startsWith("3.") ||
      /^(完成|发现|创建|修改|删除|读取|分析|确认|结论|总结|建议)/u.test(trimmed) ||
      /^(Done|Found|Created|Modified|Deleted|Read|Analyzed|Confirmed|Conclusion|Summary|Suggest)/i.test(
        trimmed,
      )
    ) {
      keyLines.push(`- ${trimmed.replace(/^[-*]\s*/, "")}`);
    }
  }

  if (keyLines.length === 0) {
    return lines
      .slice(0, 3)
      .map((l) => `- ${l.trim()}`)
      .join("\n");
  }
  return keyLines.slice(0, 10).join("\n");
}

export function registerSessionMemory(
  api: OpenClawPluginApi,
  pluginConfig: Record<string, unknown>,
): void {
  const stateDir =
    (pluginConfig.memoryStateDir as string) ??
    path.join(os.homedir(), ".openclaw", "cc-session-memory");
  const notesDir = resolveNotesDir(stateDir);
  const maxHintLines = (pluginConfig.maxHintLines as number) ?? 5;

  api.on(
    "before_prompt_build",
    async (_event, ctx) => {
      const sessionId = (ctx as Record<string, unknown>).sessionId as string | undefined;
      const hint = readLatestSessionHint(notesDir, sessionId, maxHintLines);
      if (!hint) return {};
      return {
        prependContext: `[Session Memory Hint — recent session notes, use as clues not absolute facts]\n${hint}\n[/Session Memory Hint]`,
      };
    },
    { priority: 30 },
  );

  api.on("message_sending", async (event, ctx) => {
    const sessionId = (ctx as Record<string, unknown>).sessionId as string | undefined;
    if (!sessionId) return;

    const payload = event as Record<string, unknown>;
    let text = "";
    if (typeof payload.text === "string") {
      text = payload.text;
    } else if (typeof payload.content === "string") {
      text = payload.content;
    } else if (payload.payloads && Array.isArray(payload.payloads)) {
      for (const p of payload.payloads) {
        if (typeof (p as Record<string, unknown>).text === "string") {
          text += (p as Record<string, unknown>).text + "\n";
        }
      }
    }

    if (!text.trim()) return;
    const deltaNote = extractDeltaNote(text);
    if (deltaNote) appendDeltaNote(notesDir, sessionId, deltaNote);
  });
}
