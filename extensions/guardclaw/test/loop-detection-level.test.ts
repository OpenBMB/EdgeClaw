import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLoopDetectionLevelForTests,
  finalizeLoop,
  getCurrentLoopHighestLevel,
  recordLoopDetection,
} from "../src/loop-detection-level.js";

describe("loop-detection-level", () => {
  beforeEach(() => {
    __resetLoopDetectionLevelForTests();
  });

  it("upgrades highest level within current loop", () => {
    const sessionKey = "main:user:loop-1";
    recordLoopDetection(sessionKey, "S1");
    recordLoopDetection(sessionKey, "S2");
    recordLoopDetection(sessionKey, "S3");

    const result = getCurrentLoopHighestLevel(sessionKey);
    expect(result.loopState).toBe("in_progress");
    expect(result.highestLevel).toBe("S3");
    expect(result.eventCount).toBe(3);
    expect(result.startedAt).not.toBeNull();
    expect(result.lastUpdatedAt).not.toBeNull();
  });

  it("returns completed loop after finalize", () => {
    const sessionKey = "main:user:loop-2";
    recordLoopDetection(sessionKey, "S2");
    finalizeLoop(sessionKey);

    const result = getCurrentLoopHighestLevel(sessionKey);
    expect(result.loopState).toBe("completed");
    expect(result.highestLevel).toBe("S2");
    expect(result.eventCount).toBe(1);
  });

  it("returns idle when no detection in loop", () => {
    const result = getCurrentLoopHighestLevel("main:user:loop-3");
    expect(result.loopState).toBe("idle");
    expect(result.highestLevel).toBe("S1");
    expect(result.eventCount).toBe(0);
    expect(result.startedAt).toBeNull();
    expect(result.lastUpdatedAt).toBeNull();
  });
});
