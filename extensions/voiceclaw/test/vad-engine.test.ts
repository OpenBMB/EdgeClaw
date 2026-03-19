/**
 * VoiceClaw VAD Engine Tests
 */

import { describe, it, expect } from "vitest";
import { VadEngine } from "../src/vad-engine.js";

describe("VadEngine", () => {
  it("should create with default config", () => {
    const vad = new VadEngine();
    expect(vad.speaking).toBe(false);
  });

  it("should be disabled when config says so", () => {
    const vad = new VadEngine({ enabled: false });
    const events = vad.process(new Float32Array(512));
    expect(events).toHaveLength(0);
  });

  it("should process silence without events (no model loaded)", () => {
    const vad = new VadEngine({ enabled: true });
    // Without initialize(), no model is loaded — process should return empty
    const silence = new Float32Array(512).fill(0);
    const events = vad.process(silence);
    expect(events).toHaveLength(0);
  });

  it("should reset state", () => {
    const vad = new VadEngine();
    vad.reset();
    expect(vad.speaking).toBe(false);
  });

  it("should destroy cleanly", () => {
    const vad = new VadEngine();
    vad.destroy();
    expect(vad.speaking).toBe(false);
  });
});

describe("VoicePrivacyManager", () => {
  it("should default to S1 for new sessions", async () => {
    const { VoicePrivacyManager } = await import("../src/voice-privacy.js");
    const mgr = new VoicePrivacyManager();
    expect(mgr.getSessionLevel("test-123")).toBe("S1");
  });

  it("should escalate session level", async () => {
    const { VoicePrivacyManager } = await import("../src/voice-privacy.js");
    const mgr = new VoicePrivacyManager();
    mgr.markSession("test-123", "S2");
    expect(mgr.getSessionLevel("test-123")).toBe("S2");

    // Cannot downgrade
    mgr.markSession("test-123", "S1");
    expect(mgr.getSessionLevel("test-123")).toBe("S2");

    // Can upgrade
    mgr.markSession("test-123", "S3");
    expect(mgr.getSessionLevel("test-123")).toBe("S3");
  });

  it("should force local ASR for S2 sessions", async () => {
    const { VoicePrivacyManager } = await import("../src/voice-privacy.js");
    const mgr = new VoicePrivacyManager({ localAsrForS2: true });
    mgr.markSession("test", "S2");
    const decision = mgr.preAsrDecision("test");
    expect(decision.asrProvider).toBe("local");
  });

  it("should force full local for S3 sessions", async () => {
    const { VoicePrivacyManager } = await import("../src/voice-privacy.js");
    const mgr = new VoicePrivacyManager({ localTtsForS3: true });
    mgr.markSession("test", "S3");
    const decision = mgr.preAsrDecision("test");
    expect(decision.asrProvider).toBe("local");
    expect(decision.ttsProvider).toBe("local");
  });

  it("should clear session state", async () => {
    const { VoicePrivacyManager } = await import("../src/voice-privacy.js");
    const mgr = new VoicePrivacyManager();
    mgr.markSession("test", "S3");
    mgr.clearSession("test");
    expect(mgr.getSessionLevel("test")).toBe("S1");
  });
});
