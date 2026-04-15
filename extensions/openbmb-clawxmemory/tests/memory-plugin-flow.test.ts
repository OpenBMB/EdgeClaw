import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluatePluginVerification,
  parseClawxmemoryRuntimeSignals,
  restoreManagedWorkspaceBoundaryArtifacts,
  shouldContinueWithConfigManagedLoadPath,
  shouldRetryUnsafeLinkInstall,
  shouldSkipPluginInstall,
} from "../scripts/memory-plugin-flow.mjs";

const cleanupPaths: string[] = [];

function hashText(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

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

  it("restores managed workspace USER.md and MEMORY.md back to the workspace root", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "clawxmemory-flow-"));
    const dataDir = path.join(dir, "data");
    const workspaceDir = path.join(dir, "workspace");
    const boundaryDir = path.join(dataDir, "managed-boundary", hashText(workspaceDir).slice(0, 12));
    cleanupPaths.push(dir);

    await mkdir(boundaryDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    const managedUserPath = path.join(boundaryDir, "USER.md.managed.md");
    const managedMemoryPath = path.join(boundaryDir, "MEMORY.md.managed.md");
    await writeFile(managedUserPath, "legacy user\n", "utf-8");
    await writeFile(managedMemoryPath, "legacy memory\n", "utf-8");
    await writeFile(path.join(boundaryDir, "workspace-memory-boundary.json"), `${JSON.stringify({
      version: 1,
      workspaceDir,
      updatedAt: "2026-04-10T03:00:00.000Z",
      lastAction: "isolated USER.md, MEMORY.md",
      files: [
        {
          name: "USER.md",
          originalPath: path.join(workspaceDir, "USER.md"),
          managedPath: managedUserPath,
          hash: "ignored",
          isolatedAt: "2026-04-10T03:00:00.000Z",
          status: "isolated",
        },
        {
          name: "MEMORY.md",
          originalPath: path.join(workspaceDir, "MEMORY.md"),
          managedPath: managedMemoryPath,
          hash: "ignored",
          isolatedAt: "2026-04-10T03:00:00.000Z",
          status: "isolated",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    const result = await restoreManagedWorkspaceBoundaryArtifacts({ dataDir, workspaceDir });

    expect(result).toMatchObject({
      action: "restored",
      restored: expect.arrayContaining([
        path.join(workspaceDir, "USER.md"),
        path.join(workspaceDir, "MEMORY.md"),
      ]),
      conflicts: [],
    });
    await expect(readFile(path.join(workspaceDir, "USER.md"), "utf-8")).resolves.toBe("legacy user\n");
    await expect(readFile(path.join(workspaceDir, "MEMORY.md"), "utf-8")).resolves.toBe("legacy memory\n");
  });

  it("restores managed workspace files into conflict copies instead of overwriting user edits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "clawxmemory-flow-"));
    const dataDir = path.join(dir, "data");
    const workspaceDir = path.join(dir, "workspace");
    const boundaryDir = path.join(dataDir, "managed-boundary", hashText(workspaceDir).slice(0, 12));
    cleanupPaths.push(dir);

    await mkdir(boundaryDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });
    const originalMemoryPath = path.join(workspaceDir, "MEMORY.md");
    const managedMemoryPath = path.join(boundaryDir, "MEMORY.md.managed.md");
    await writeFile(originalMemoryPath, "new user memory\n", "utf-8");
    await writeFile(managedMemoryPath, "legacy managed memory\n", "utf-8");
    await writeFile(path.join(boundaryDir, "workspace-memory-boundary.json"), `${JSON.stringify({
      version: 1,
      workspaceDir,
      updatedAt: "2026-04-10T03:00:00.000Z",
      lastAction: "isolated MEMORY.md",
      files: [
        {
          name: "MEMORY.md",
          originalPath: originalMemoryPath,
          managedPath: managedMemoryPath,
          hash: "legacy-managed-hash",
          isolatedAt: "2026-04-10T03:00:00.000Z",
          status: "isolated",
        },
      ],
    }, null, 2)}\n`, "utf-8");

    const result = await restoreManagedWorkspaceBoundaryArtifacts({ dataDir, workspaceDir });

    expect(result.action).toBe("conflict");
    expect(result.conflicts).toHaveLength(1);
    await expect(readFile(originalMemoryPath, "utf-8")).resolves.toBe("new user memory\n");
    await expect(readFile(result.conflicts[0], "utf-8")).resolves.toBe("legacy managed memory\n");
  });
});
