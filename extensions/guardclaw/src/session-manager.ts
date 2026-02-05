/**
 * GuardClaw Session Manager
 * 
 * Manages dual session histories (full vs clean) for privacy isolation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isGuardSessionKey } from "./guard-agent.js";

export type SessionMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  sessionKey?: string;
};

/**
 * Dual session manager that maintains separate full and clean histories
 */
export class DualSessionManager {
  private baseDir: string;

  constructor(baseDir: string = "~/.openclaw") {
    // Expand ~ to home directory
    this.baseDir = baseDir.startsWith("~")
      ? path.join(process.env.HOME || process.env.USERPROFILE || "~", baseDir.slice(2))
      : baseDir;
  }

  /**
   * Persist a message to session history
   * - Full history: includes all messages (including guard agent interactions)
   * - Clean history: excludes guard agent interactions (for cloud models)
   */
  async persistMessage(
    sessionKey: string,
    message: SessionMessage,
    agentId: string = "main"
  ): Promise<void> {
    // Always write to full history
    await this.writeToHistory(sessionKey, message, agentId, "full");

    // Write to clean history only if not a guard agent message
    if (!this.isGuardAgentMessage(message)) {
      await this.writeToHistory(sessionKey, message, agentId, "clean");
    }
  }

  /**
   * Load session history based on model type
   * - Cloud models: get clean history only
   * - Local models: get full history
   */
  async loadHistory(
    sessionKey: string,
    isCloudModel: boolean,
    agentId: string = "main",
    limit?: number
  ): Promise<SessionMessage[]> {
    const historyType = isCloudModel ? "clean" : "full";
    return await this.readHistory(sessionKey, agentId, historyType, limit);
  }

  /**
   * Check if a message is from guard agent interactions
   */
  private isGuardAgentMessage(message: SessionMessage): boolean {
    // Check if the message is part of a guard agent session
    if (message.sessionKey && isGuardSessionKey(message.sessionKey)) {
      return true;
    }

    // Check if the message content mentions guard agent
    const content = message.content.toLowerCase();
    if (
      content.includes("[guard agent]") ||
      content.includes("guard:") ||
      content.includes(":guard:")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Write message to history file
   */
  private async writeToHistory(
    sessionKey: string,
    message: SessionMessage,
    agentId: string,
    historyType: "full" | "clean"
  ): Promise<void> {
    try {
      const historyPath = this.getHistoryPath(sessionKey, agentId, historyType);

      // Ensure directory exists
      const dir = path.dirname(historyPath);
      await fs.promises.mkdir(dir, { recursive: true });

      // Append message as JSONL
      const line = JSON.stringify({
        ...message,
        timestamp: message.timestamp ?? Date.now(),
      });

      await fs.promises.appendFile(historyPath, line + "\n", "utf-8");
    } catch (err) {
      console.error(
        `[GuardClaw] Failed to write to ${historyType} history for ${sessionKey}:`,
        err
      );
    }
  }

  /**
   * Read messages from history file
   */
  private async readHistory(
    sessionKey: string,
    agentId: string,
    historyType: "full" | "clean",
    limit?: number
  ): Promise<SessionMessage[]> {
    try {
      const historyPath = this.getHistoryPath(sessionKey, agentId, historyType);

      // Check if file exists
      if (!fs.existsSync(historyPath)) {
        return [];
      }

      // Read file and parse JSONL
      const content = await fs.promises.readFile(historyPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      const messages = lines
        .map((line) => {
          try {
            return JSON.parse(line) as SessionMessage;
          } catch {
            return null;
          }
        })
        .filter((msg): msg is SessionMessage => msg !== null);

      // Apply limit if specified
      if (limit && messages.length > limit) {
        return messages.slice(-limit);
      }

      return messages;
    } catch (err) {
      console.error(
        `[GuardClaw] Failed to read ${historyType} history for ${sessionKey}:`,
        err
      );
      return [];
    }
  }

  /**
   * Get history file path
   */
  private getHistoryPath(
    sessionKey: string,
    agentId: string,
    historyType: "full" | "clean"
  ): string {
    // Sanitize session key for file name
    const safeSessionKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");

    const fileName = `${safeSessionKey}.jsonl`;

    return path.join(
      this.baseDir,
      "agents",
      agentId,
      "sessions",
      historyType,
      fileName
    );
  }

  /**
   * Clear history for a session
   */
  async clearHistory(
    sessionKey: string,
    agentId: string = "main",
    historyType?: "full" | "clean"
  ): Promise<void> {
    const types = historyType ? [historyType] : ["full", "clean"];

    for (const type of types) {
      try {
        const historyPath = this.getHistoryPath(sessionKey, agentId, type);

        if (fs.existsSync(historyPath)) {
          await fs.promises.unlink(historyPath);
        }
      } catch (err) {
        console.error(
          `[GuardClaw] Failed to clear ${type} history for ${sessionKey}:`,
          err
        );
      }
    }
  }

  /**
   * Get history statistics
   */
  async getHistoryStats(
    sessionKey: string,
    agentId: string = "main"
  ): Promise<{
    fullCount: number;
    cleanCount: number;
    difference: number;
  }> {
    const full = await this.readHistory(sessionKey, agentId, "full");
    const clean = await this.readHistory(sessionKey, agentId, "clean");

    return {
      fullCount: full.length,
      cleanCount: clean.length,
      difference: full.length - clean.length,
    };
  }
}

// Export a singleton instance
let defaultManager: DualSessionManager | null = null;

export function getDefaultSessionManager(): DualSessionManager {
  if (!defaultManager) {
    defaultManager = new DualSessionManager();
  }
  return defaultManager;
}
