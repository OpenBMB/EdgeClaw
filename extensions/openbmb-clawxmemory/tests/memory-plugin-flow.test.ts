import { describe, expect, it } from "vitest";
import {
  evaluatePluginVerification,
  parseClawxmemoryRuntimeSignals,
  shouldContinueWithConfigManagedLoadPath,
  shouldRetryUnsafeLinkInstall,
  shouldSkipPluginInstall,
} from "../scripts/memory-plugin-flow.mjs";

describe("memory-plugin-flow", () => {
  it("parses runtime-ready and dashboard failure signals from gateway logs", () => {
    const signals = parseClawxmemoryRuntimeSignals([
      "2026-04-03T10:10:31.000+08:00 [gateway] [clawxmemory] dynamic memory runtime ready: active memory slot is ClawXMemory.",
      "2026-04-03T10:10:31.100+08:00 [gateway] [clawxmemory] dashboard server failed: port 39393 is already in use (EADDRINUSE).",
    ].join("\n"));

    expect(signals.runtimeReady).toBe(true);
    expect(signals.dashboardFailure).toContain("port 39393 is already in use");
  });

  it("treats real gateway hook activity as proof that the lazy-loaded runtime is alive", () => {
    const signals = parseClawxmemoryRuntimeSignals(
      "2026-04-03T10:10:31.000+08:00 [gateway] [clawxmemory] recall mode=llm reasoning_mode=answer_first recall_top_k=20 enough_at=l2 injected=true elapsed_ms=611 cache_hit=0",
    );

    expect(signals.runtimeReady).toBe(false);
    expect(signals.runtimeActivity).toContain("recall mode=llm");
  });

  it("requires both plugin load status and runtime readiness instead of gateway health alone", () => {
    const verification = evaluatePluginVerification({
      pluginPayload: {
        plugin: {
          status: "loaded",
        },
      },
      runtimeSignals: parseClawxmemoryRuntimeSignals(""),
      uiTarget: { enabled: false },
      uiReachable: false,
    });

    expect(verification.loaded).toBe(false);
    expect(verification.pluginLoaded).toBe(true);
    expect(verification.runtimeReady).toBe(false);
  });

  it("treats ui-disabled runtimes as healthy once the runtime-ready signal is present", () => {
    const verification = evaluatePluginVerification({
      pluginPayload: {
        plugin: {
          status: "loaded",
        },
      },
      runtimeSignals: parseClawxmemoryRuntimeSignals(
        "2026-04-03T10:10:31.000+08:00 [gateway] [clawxmemory] dynamic memory runtime ready: active memory slot is ClawXMemory.",
      ),
      uiTarget: { enabled: false },
      uiReachable: false,
    });

    expect(verification.loaded).toBe(true);
    expect(verification.uiStatus).toBe("disabled");
  });

  it("accepts gateway-observed runtime activity even when plugins inspect is noisy", () => {
    const verification = evaluatePluginVerification({
      pluginPayload: null,
      runtimeSignals: parseClawxmemoryRuntimeSignals(
        "2026-04-03T10:10:31.000+08:00 [gateway] [clawxmemory] captured l0 session=clawxmemory-bootstrap-check indexed=pending trigger=idle|timer|session_boundary|manual",
      ),
      uiTarget: { enabled: true },
      uiReachable: false,
    });

    expect(verification.loaded).toBe(true);
    expect(verification.pluginLoaded).toBe(false);
    expect(verification.gatewayObserved).toBe(true);
    expect(verification.runtimeReady).toBe(true);
  });

  it("does not skip a relink install refresh just because the load path is already configured", () => {
    expect(shouldSkipPluginInstall({
      trackedInstall: false,
      configuredLoadPath: true,
      forceInstall: true,
    })).toEqual({
      skip: false,
      reason: "forced_reinstall",
    });
  });

  it("retries link installs that OpenClaw blocks behind the unsafe-install scanner", () => {
    expect(shouldRetryUnsafeLinkInstall(
      "Plugin \"openbmb-clawxmemory\" installation blocked: dangerous code patterns detected: Shell command execution detected (child_process).",
    )).toBe(true);
    expect(shouldRetryUnsafeLinkInstall("plugin install failed: ENOENT")).toBe(false);
  });

  it("continues with config-managed load paths when a clean relink is blocked by the unsafe-install scanner", () => {
    expect(shouldContinueWithConfigManagedLoadPath({
      trackedInstall: false,
      loadPathConfiguredAfterInstall: false,
      rawOutput: "Plugin \"openbmb-clawxmemory\" installation blocked: dangerous code patterns detected",
    })).toEqual({
      continueWithLoadPath: true,
      reason: "unsafe_install_blocked",
    });
  });
});
