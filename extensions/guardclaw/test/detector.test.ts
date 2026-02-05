/**
 * GuardClaw Detector Core Tests
 */

import { describe, test, expect } from "vitest";
import { detectSensitivityLevel } from "../src/detector.js";
import type { DetectionContext } from "../src/types.js";

describe("Detector Core", () => {
  const mockConfig = {
    privacy: {
      enabled: true,
      checkpoints: {
        onUserMessage: ["ruleDetector" as const],
        onToolCallProposed: ["ruleDetector" as const],
        onToolCallExecuted: ["ruleDetector" as const],
      },
      rules: {
        keywords: {
          S2: ["password"],
          S3: ["ssh_key"],
        },
        tools: {
          S2: { tools: ["exec"], paths: [] },
          S3: { tools: ["system.run"], paths: ["~/.ssh"] },
        },
      },
      localModel: {
        enabled: false,
      },
    },
  };

  describe("Detection with Rules", () => {
    test("should detect S3 level from message", async () => {
      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "Please copy my ssh_key",
        sessionKey: "test-session",
      };

      const result = await detectSensitivityLevel(context, mockConfig);

      expect(result.level).toBe("S3");
      expect(result.detectorType).toBe("ruleDetector");
    });

    test("should detect S2 level from tool", async () => {
      const context: DetectionContext = {
        checkpoint: "onToolCallProposed",
        toolName: "exec",
        toolParams: { command: "ls -la" },
        sessionKey: "test-session",
      };

      const result = await detectSensitivityLevel(context, mockConfig);

      expect(result.level).toBe("S2");
    });

    test("should return S1 for safe content", async () => {
      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "What is the weather?",
        sessionKey: "test-session",
      };

      const result = await detectSensitivityLevel(context, mockConfig);

      expect(result.level).toBe("S1");
    });
  });

  describe("Configuration", () => {
    test("should return S1 when privacy disabled", async () => {
      const disabledConfig = {
        privacy: { enabled: false },
      };

      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "ssh_key password",
        sessionKey: "test-session",
      };

      const result = await detectSensitivityLevel(context, disabledConfig);

      expect(result.level).toBe("S1");
      expect(result.reason).toContain("disabled");
    });

    test("should use default detectors when none configured", async () => {
      const minimalConfig = {
        privacy: { enabled: true },
      };

      const context: DetectionContext = {
        checkpoint: "onUserMessage",
        message: "test",
        sessionKey: "test-session",
      };

      const result = await detectSensitivityLevel(context, minimalConfig);

      expect(result).toBeDefined();
      expect(result.level).toBe("S1");
    });
  });
});
