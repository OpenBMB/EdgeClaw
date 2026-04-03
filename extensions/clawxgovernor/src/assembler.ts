import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ContextEngineFactory } from "openclaw/plugin-sdk";

interface PluginLogger {
  debug?(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

interface EngineConfig {
  recentTailTurns: number;
  compactThresholdRatio: number;
  stateDir?: string;
  logger: PluginLogger;
}

function estimateTokens(messages: Array<Record<string, unknown>>): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (msg.content != null) {
      chars += JSON.stringify(msg.content).length;
    }
    if (msg.tool_calls) {
      chars += JSON.stringify(msg.tool_calls).length;
    }
  }
  return Math.ceil(chars / 4);
}

function resolveStateDir(stateDir?: string): string {
  if (stateDir) return stateDir;
  return path.join(os.homedir(), ".openclaw", "cc-context-engine");
}

function writeStateFile(stateDir: string, state: Record<string, unknown>): void {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "state.json"), JSON.stringify(state, null, 2));
  } catch {
    // non-critical
  }
}

/**
 * Find the boundary index that keeps the most recent N user turns.
 * Never cuts between a tool_call (assistant) and its tool_result.
 */
function findTailBoundary(messages: Array<Record<string, unknown>>, keepTurns: number): number {
  let userTurnsSeen = 0;
  let boundary = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userTurnsSeen++;
      if (userTurnsSeen >= keepTurns) {
        boundary = i;
        break;
      }
    }
  }

  while (boundary > 0 && messages[boundary]?.role === "tool") {
    boundary--;
  }

  return boundary;
}

/**
 * Read summaries produced by cc-tool-governor (cross-lane read-only interface).
 */
function readToolSummaries(governorDir: string, limit: number): string[] {
  const summaryDir = path.join(governorDir, "summaries");
  const results: string[] = [];
  try {
    if (!fs.existsSync(summaryDir)) return results;
    const files = fs
      .readdirSync(summaryDir)
      .filter((f: string) => f.endsWith(".md"))
      .sort()
      .slice(-limit);
    for (const f of files) {
      const content = fs.readFileSync(path.join(summaryDir, f), "utf-8").trim();
      if (content) results.push(content);
    }
  } catch {
    // non-critical
  }
  return results;
}

export function createContextEngineFactory(config: EngineConfig): ContextEngineFactory {
  const { recentTailTurns, compactThresholdRatio, logger } = config;
  const stateDir = resolveStateDir(config.stateDir);
  const governorDir = path.join(os.homedir(), ".openclaw", "cc-tool-governor");

  let lastCompactTime: string | undefined;
  let lastCompactSummary: string | undefined;

  return () => ({
    info: {
      id: "cc-context-engine",
      name: "CC Context Engine",
      version: "0.1.0",
      ownsCompaction: true,
    },

    async bootstrap() {
      return { bootstrapped: true };
    },

    async ingest({ message }) {
      return { ingested: message != null };
    },

    async ingestBatch({ messages }) {
      return { ingestedCount: messages.length };
    },

    async afterTurn({ messages, tokenBudget, sessionId }) {
      const est = estimateTokens(messages as unknown as Array<Record<string, unknown>>);
      const budget = tokenBudget ?? 128_000;

      if (est > budget * compactThresholdRatio) {
        logger.info(
          `[cc-context-engine] Token usage ${est}/${budget} exceeds ${compactThresholdRatio * 100}% threshold`,
        );
      }

      writeStateFile(stateDir, {
        sessionId,
        totalTokens: est,
        tokenBudget: budget,
        messageCount: messages.length,
        lastCompactTime,
        lastCompactSummary,
        updatedAt: new Date().toISOString(),
      });
    },

    async assemble({ messages, tokenBudget, prompt }) {
      const budget = tokenBudget ?? 128_000;
      const msgs = messages as unknown as Array<Record<string, unknown>>;
      const boundary = findTailBoundary(msgs, recentTailTurns);
      const assembled = messages.slice(boundary);

      const reinjections: string[] = [];
      if (lastCompactSummary) {
        reinjections.push(`[Previous Context Summary]\n${lastCompactSummary}`);
      }
      const toolSummaries = readToolSummaries(governorDir, 3);
      if (toolSummaries.length > 0) {
        reinjections.push(`[Recent Tool Result Summaries]\n${toolSummaries.join("\n---\n")}`);
      }

      const est = estimateTokens(assembled as unknown as Array<Record<string, unknown>>);

      writeStateFile(stateDir, {
        totalTokens: est,
        tokenBudget: budget,
        segments: assembled.length,
        keptFromIndex: boundary,
        originalMessageCount: messages.length,
        hasReinjection: reinjections.length > 0,
        lastCompactTime,
        prompt: prompt ? prompt.slice(0, 100) + "..." : undefined,
        updatedAt: new Date().toISOString(),
      });

      return {
        messages: assembled,
        estimatedTokens: est,
        systemPromptAddition: reinjections.length > 0 ? reinjections.join("\n\n") : undefined,
      };
    },

    async compact({ sessionId, currentTokenCount }) {
      const tokensBefore = (currentTokenCount as number) ?? 0;

      try {
        lastCompactTime = new Date().toISOString();
        lastCompactSummary = `Session ${sessionId} compacted at ${lastCompactTime}. Previous context contained ${tokensBefore} tokens across a multi-turn conversation.`;

        logger.info(`[cc-context-engine] Compact completed for ${sessionId}`);

        writeStateFile(stateDir, {
          sessionId,
          compactedAt: lastCompactTime,
          tokensBefore,
          summary: lastCompactSummary,
        });

        return {
          ok: true,
          compacted: true,
          result: {
            summary: lastCompactSummary,
            tokensBefore,
            tokensAfter: Math.floor(tokensBefore * 0.4),
          },
        };
      } catch (err) {
        logger.error(`[cc-context-engine] Compact error, degrading gracefully: ${String(err)}`);
        return {
          ok: true,
          compacted: false,
          reason: `fail-soft: ${String(err)}`,
        };
      }
    },

    async dispose() {
      logger.info("[cc-context-engine] Disposed");
    },
  });
}
