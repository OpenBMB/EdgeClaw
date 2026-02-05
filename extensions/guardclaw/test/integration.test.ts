/**
 * GuardClaw Integration Tests
 * 
 * Tests the complete flow of detection, hook invocation, and session management.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { detectSensitivityLevel } from "../src/detector.js";
import {
  markSessionAsPrivate,
  isSessionMarkedPrivate,
  getSessionHighestLevel,
  recordDetection,
  clearSessionState,
} from "../src/session-state.js";
import type { DetectionContext } from "../src/types.js";

describe("GuardClaw Integration", () => {
  const testConfig = {
    privacy: {
      enabled: true,
      checkpoints: {
        onUserMessage: ["ruleDetector" as const],
        onToolCallProposed: ["ruleDetector" as const],
        onToolCallExecuted: ["ruleDetector" as const],
      },
      rules: {
        keywords: {
          S2: ["password", "api_key"],
          S3: ["ssh", "id_rsa"],
        },
        tools: {
          S2: { tools: ["exec"], paths: [] },
          S3: { tools: ["system.run"], paths: ["~/.ssh"] },
        },
      },
    },
  };

  beforeEach(() => {
    // Clean up session state before each test
    clearSessionState("test-session");
  });

  describe("End-to-End Detection Flow", () => {
    test("should detect S3, mark session as private, and record detection", async () => {
      const sessionKey = "test-session";
      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "Read my ~/.ssh/id_rsa file",
        sessionKey,
      };

      // Perform detection
      const result = await detectSensitivityLevel(context, testConfig);

      // Verify detection result
      expect(result.level).toBe("S3");
      expect(result.reason).toBeDefined();

      // Mark session based on result
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        recordDetection(sessionKey, result.level, context.checkpoint, result.reason);
      }

      // Verify session state
      expect(isSessionMarkedPrivate(sessionKey)).toBe(true);
      expect(getSessionHighestLevel(sessionKey)).toBe("S3");
    });

    test("should handle multiple detections and maintain highest level", async () => {
      const sessionKey = "test-session-2";

      // First detection: S2
      const context1: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "Here is my api_key",
        sessionKey,
      };

      const result1 = await detectSensitivityLevel(context1, testConfig);
      expect(result1.level).toBe("S2");

      markSessionAsPrivate(sessionKey, result1.level);
      recordDetection(sessionKey, result1.level, context1.checkpoint, result1.reason);

      // Second detection: S3
      const context2: DetectionContext = {
        checkpoint: "onToolCallProposed",
        toolName: "read",
        toolParams: { path: "~/.ssh/config" },
        sessionKey,
      };

      const result2 = await detectSensitivityLevel(context2, testConfig);
      expect(result2.level).toBe("S3");

      markSessionAsPrivate(sessionKey, result2.level);
      recordDetection(sessionKey, result2.level, context2.checkpoint, result2.reason);

      // Verify highest level is maintained
      expect(isSessionMarkedPrivate(sessionKey)).toBe(true);
      expect(getSessionHighestLevel(sessionKey)).toBe("S3");
    });

    test("should not mark session as private for S1 or S2", async () => {
      const sessionKey = "test-session-3";

      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "What is the weather today?",
        sessionKey,
      };

      const result = await detectSensitivityLevel(context, testConfig);
      expect(result.level).toBe("S1");

      // Don't mark as private for S1
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
      }

      expect(isSessionMarkedPrivate(sessionKey)).toBe(false);
    });
  });

  describe("Hook Chain Simulation", () => {
    test("should process message through all checkpoints", async () => {
      const sessionKey = "test-session-4";

      // Checkpoint 1: onUserMessage
      const messageContext: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "Execute system command with my password",
        sessionKey,
      };

      const messageResult = await detectSensitivityLevel(messageContext, testConfig);
      expect(messageResult.level).toBe("S2"); // Detects "password"

      recordDetection(
        sessionKey,
        messageResult.level,
        messageContext.checkpoint,
        messageResult.reason
      );

      // Checkpoint 2: onToolCallProposed
      const toolContext: DetectionContext = {
        checkpoint: "onToolCallProposed",
        toolName: "system.run",
        toolParams: { command: "rm -rf /" },
        sessionKey,
      };

      const toolResult = await detectSensitivityLevel(toolContext, testConfig);
      expect(toolResult.level).toBe("S3"); // Detects "system.run"

      markSessionAsPrivate(sessionKey, toolResult.level);
      recordDetection(sessionKey, toolResult.level, toolContext.checkpoint, toolResult.reason);

      // Checkpoint 3: onToolCallExecuted
      const resultContext: DetectionContext = {
        checkpoint: "onToolCallExecuted",
        toolName: "system.run",
        toolResult: "Command output with ssh keys",
        sessionKey,
      };

      const executedResult = await detectSensitivityLevel(resultContext, testConfig);
      expect(executedResult.level).toBe("S3"); // Detects "ssh" in result

      recordDetection(
        sessionKey,
        executedResult.level,
        resultContext.checkpoint,
        executedResult.reason
      );

      // Verify final state
      expect(isSessionMarkedPrivate(sessionKey)).toBe(true);
      expect(getSessionHighestLevel(sessionKey)).toBe("S3");
    });
  });

  describe("Configuration Scenarios", () => {
    test("should respect disabled privacy", async () => {
      const disabledConfig = {
        privacy: { enabled: false },
      };

      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "ssh id_rsa password",
        sessionKey: "test-session-5",
      };

      const result = await detectSensitivityLevel(context, disabledConfig);

      expect(result.level).toBe("S1");
      expect(result.reason).toContain("disabled");
    });

    test("should handle empty configuration gracefully", async () => {
      const emptyConfig = {};

      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "test message",
        sessionKey: "test-session-6",
      };

      const result = await detectSensitivityLevel(context, emptyConfig);

      expect(result).toBeDefined();
      expect(result.level).toBe("S1");
    });
  });

  describe("Edge Cases", () => {
    test("should handle missing context fields gracefully", async () => {
      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        sessionKey: "test-session-7",
        // message is missing
      };

      const result = await detectSensitivityLevel(context, testConfig);

      expect(result).toBeDefined();
      expect(result.level).toBe("S1");
    });

    test("should handle very long messages", async () => {
      const longMessage = "safe text ".repeat(1000) + "password at the end";

      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: longMessage,
        sessionKey: "test-session-8",
      };

      const result = await detectSensitivityLevel(context, testConfig);

      expect(result.level).toBe("S2");
      expect(result.reason).toContain("password");
    });
  });
});
