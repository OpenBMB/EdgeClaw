/**
 * GuardClaw Rules Detector Tests
 */

import { describe, test, expect } from "vitest";
import { detectByRules } from "../src/rules.js";
import type { PrivacyConfig } from "../src/types.js";

describe("Rules Detector", () => {
  const testConfig: PrivacyConfig = {
    enabled: true,
    rules: {
      keywords: {
        S2: ["password", "api_key", "secret"],
        S3: ["ssh", "id_rsa", "private_key"],
      },
      tools: {
        S2: {
          tools: ["exec"],
          paths: ["~/secrets"],
        },
        S3: {
          tools: ["system.run"],
          paths: ["~/.ssh", "/etc"],
        },
      },
    },
  };

  describe("Keyword Detection", () => {
    test("should detect S3 keywords", () => {
      const result = detectByRules(
        {
          checkpoint: "onUserMessage",
          message: "Please read my id_rsa file",
        },
        testConfig
      );

      expect(result.level).toBe("S3");
      expect(result.reason).toContain("id_rsa");
    });

    test("should detect S2 keywords", () => {
      const result = detectByRules(
        {
          checkpoint: "onUserMessage",
          message: "Here is my api_key for the service",
        },
        testConfig
      );

      expect(result.level).toBe("S2");
      expect(result.reason).toContain("api_key");
    });

    test("should return S1 for safe content", () => {
      const result = detectByRules(
        {
          checkpoint: "onUserMessage",
          message: "What is the weather today?",
        },
        testConfig
      );

      expect(result.level).toBe("S1");
    });

    test("should be case-insensitive", () => {
      const result = detectByRules(
        {
          checkpoint: "onUserMessage",
          message: "My PASSWORD is secret123",
        },
        testConfig
      );

      expect(result.level).toBe("S2");
    });
  });

  describe("Tool Type Detection", () => {
    test("should detect S3 tools", () => {
      const result = detectByRules(
        {
          checkpoint: "onToolCallProposed",
          toolName: "system.run",
          toolParams: {},
        },
        testConfig
      );

      expect(result.level).toBe("S3");
      expect(result.reason).toContain("system.run");
    });

    test("should detect S2 tools", () => {
      const result = detectByRules(
        {
          checkpoint: "onToolCallProposed",
          toolName: "exec",
          toolParams: {},
        },
        testConfig
      );

      expect(result.level).toBe("S2");
      expect(result.reason).toContain("exec");
    });

    test("should return S1 for safe tools", () => {
      const result = detectByRules(
        {
          checkpoint: "onToolCallProposed",
          toolName: "read_file",
          toolParams: { path: "/tmp/test.txt" },
        },
        testConfig
      );

      expect(result.level).toBe("S1");
    });
  });

  describe("Path Detection", () => {
    test("should detect S3 paths", () => {
      const result = detectByRules(
        {
          checkpoint: "onToolCallProposed",
          toolName: "read",
          toolParams: { path: "~/.ssh/id_rsa" },
        },
        testConfig
      );

      expect(result.level).toBe("S3");
      expect(result.reason).toContain(".ssh");
    });

    test("should detect S2 paths", () => {
      const result = detectByRules(
        {
          checkpoint: "onToolCallProposed",
          toolName: "read",
          toolParams: { path: "~/secrets/config.json" },
        },
        testConfig
      );

      expect(result.level).toBe("S2");
      expect(result.reason).toContain("secrets");
    });

    test("should detect sensitive file extensions", () => {
      const result = detectByRules(
        {
          checkpoint: "onToolCallProposed",
          toolName: "read",
          toolParams: { path: "/tmp/certificate.pem" },
        },
        testConfig
      );

      expect(result.level).toBe("S3");
      expect(result.reason).toContain("extension");
    });
  });

  describe("Result Merging", () => {
    test("should take highest level when multiple issues detected", () => {
      const result = detectByRules(
        {
          checkpoint: "onUserMessage",
          message: "Read my password from ~/.ssh/id_rsa",
        },
        testConfig
      );

      expect(result.level).toBe("S3");
      expect(result.reason).toContain("password");
      expect(result.reason).toContain("id_rsa");
    });
  });
});
