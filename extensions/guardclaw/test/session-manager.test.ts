/**
 * GuardClaw Session Manager Tests
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { DualSessionManager } from "../src/session-manager.js";

describe("Dual Session Manager", () => {
  const testBaseDir = path.join(process.cwd(), ".test-guardclaw");
  let manager: DualSessionManager;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(testBaseDir)) {
      fs.mkdirSync(testBaseDir, { recursive: true });
    }
    manager = new DualSessionManager(testBaseDir);
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  describe("Message Persistence", () => {
    test("should write to both full and clean history for normal messages", async () => {
      const sessionKey = "test-session";
      const message = {
        role: "user" as const,
        content: "Hello world",
        timestamp: Date.now(),
      };

      await manager.persistMessage(sessionKey, message);

      const fullHistory = await manager.loadHistory(sessionKey, false);
      const cleanHistory = await manager.loadHistory(sessionKey, true);

      expect(fullHistory).toHaveLength(1);
      expect(cleanHistory).toHaveLength(1);
      expect(fullHistory[0].content).toBe("Hello world");
      expect(cleanHistory[0].content).toBe("Hello world");
    });

    test("should write only to full history for guard agent messages", async () => {
      const sessionKey = "test-session";
      const guardMessage = {
        role: "assistant" as const,
        content: "[Guard Agent] Processing sensitive data",
        timestamp: Date.now(),
        sessionKey: "main:guard:123",
      };

      await manager.persistMessage(sessionKey, guardMessage);

      const fullHistory = await manager.loadHistory(sessionKey, false);
      const cleanHistory = await manager.loadHistory(sessionKey, true);

      expect(fullHistory).toHaveLength(1);
      expect(cleanHistory).toHaveLength(0); // Guard message excluded
    });
  });

  describe("History Loading", () => {
    test("should load full history for local models", async () => {
      const sessionKey = "test-session";

      await manager.persistMessage(sessionKey, {
        role: "user" as const,
        content: "Normal message",
        timestamp: Date.now(),
      });

      await manager.persistMessage(sessionKey, {
        role: "assistant" as const,
        content: "[Guard Agent] Secret operation",
        sessionKey: "main:guard:123",
        timestamp: Date.now(),
      });

      const history = await manager.loadHistory(sessionKey, false);

      expect(history).toHaveLength(2);
    });

    test("should load clean history for cloud models", async () => {
      const sessionKey = "test-session";

      await manager.persistMessage(sessionKey, {
        role: "user" as const,
        content: "Normal message",
        timestamp: Date.now(),
      });

      await manager.persistMessage(sessionKey, {
        role: "assistant" as const,
        content: "[Guard Agent] Secret operation",
        sessionKey: "main:guard:123",
        timestamp: Date.now(),
      });

      const history = await manager.loadHistory(sessionKey, true);

      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("Normal message");
    });

    test("should respect limit parameter", async () => {
      const sessionKey = "test-session";

      for (let i = 0; i < 10; i++) {
        await manager.persistMessage(sessionKey, {
          role: "user" as const,
          content: `Message ${i}`,
          timestamp: Date.now(),
        });
      }

      const history = await manager.loadHistory(sessionKey, false, "main", 5);

      expect(history).toHaveLength(5);
    });
  });

  describe("History Statistics", () => {
    test("should report accurate stats", async () => {
      const sessionKey = "test-session";

      await manager.persistMessage(sessionKey, {
        role: "user" as const,
        content: "Normal",
        timestamp: Date.now(),
      });

      await manager.persistMessage(sessionKey, {
        role: "assistant" as const,
        content: "[Guard Agent] Private",
        sessionKey: "main:guard:123",
        timestamp: Date.now(),
      });

      const stats = await manager.getHistoryStats(sessionKey);

      expect(stats.fullCount).toBe(2);
      expect(stats.cleanCount).toBe(1);
      expect(stats.difference).toBe(1);
    });
  });

  describe("Clear History", () => {
    test("should clear both histories", async () => {
      const sessionKey = "test-session";

      await manager.persistMessage(sessionKey, {
        role: "user" as const,
        content: "Test",
        timestamp: Date.now(),
      });

      await manager.clearHistory(sessionKey);

      const fullHistory = await manager.loadHistory(sessionKey, false);
      const cleanHistory = await manager.loadHistory(sessionKey, true);

      expect(fullHistory).toHaveLength(0);
      expect(cleanHistory).toHaveLength(0);
    });
  });
});
