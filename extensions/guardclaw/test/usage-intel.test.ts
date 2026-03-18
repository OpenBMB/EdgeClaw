import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetUsageIntelForTests,
  getLastReplyLoopSummary,
  getLastReplyModelOrigin,
  getLastTurnTokens,
  recordFinalReply,
  recordRouterOperation,
} from "../src/usage-intel.js";

describe("usage-intel", () => {
  beforeEach(() => {
    __resetUsageIntelForTests();
  });

  it("aggregates detection/desensitization router tokens in latest turn", () => {
    recordRouterOperation(
      "main:user:1",
      "detection",
      { input: 10, output: 2, total: 12 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordRouterOperation(
      "main:user:1",
      "detection",
      { input: 7, output: 1, total: 8 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordRouterOperation(
      "main:user:1",
      "desensitization",
      { input: 20, output: 5, total: 25 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordFinalReply({
      sessionKey: "main:user:1",
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 100, output: 30, total: 130 },
      originHint: "cloud",
    });

    const turn = getLastTurnTokens("main:user:1");
    expect(turn).not.toBeNull();
    expect(turn?.detection.total).toBe(20);
    expect(turn?.desensitization.total).toBe(25);
    expect(turn?.combined.total).toBe(45);
  });

  it("keeps local router cost when final reply origin is cloud", () => {
    recordRouterOperation(
      "main:user:2",
      "detection",
      { input: 6, output: 1, total: 7 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordRouterOperation(
      "main:user:2",
      "desensitization",
      { input: 9, output: 2, total: 11 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordFinalReply({
      sessionKey: "main:user:2",
      provider: "openai",
      model: "gpt-4o-mini",
      usage: { input: 50, output: 10, total: 60 },
      originHint: "cloud",
    });

    const summary = getLastReplyLoopSummary("main:user:2");
    expect(summary).not.toBeNull();
    expect(summary?.loopLocalTokens.total).toBe(18);
    expect(summary?.loopCloudTokens.total).toBe(60);
    expect(summary?.loopTotalTokens.total).toBe(78);
  });

  it("classifies local provider with custom localProviders", () => {
    recordFinalReply({
      sessionKey: "main:user:3",
      provider: "my-edge",
      model: "my-model",
      usage: { input: 12, output: 4, total: 16 },
      extraLocalProviders: ["my-edge"],
    });

    const origin = getLastReplyModelOrigin("main:user:3");
    expect(origin?.origin).toBe("local");
    expect(origin?.provider).toBe("my-edge");
  });
});
