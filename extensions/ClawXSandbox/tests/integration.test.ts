import { describe, expect, it } from "vitest";

/**
 * Integration tests that exercise @anthropic-ai/sandbox-runtime APIs
 * against the real host platform.
 *
 * These are gated behind platform availability checks so CI on
 * unsupported platforms simply skips them.
 */

let SandboxManager: typeof import("@anthropic-ai/sandbox-runtime").SandboxManager;
let platformSupported = false;
let dependenciesAvailable = false;

try {
  const mod = await import("@anthropic-ai/sandbox-runtime");
  SandboxManager = mod.SandboxManager;
  platformSupported = SandboxManager.isSupportedPlatform();
  if (platformSupported) {
    const deps = SandboxManager.checkDependencies();
    dependenciesAvailable = deps.errors.length === 0;
  }
} catch {
  // Package not installed — skip integration tests
}

describe("platform detection", () => {
  it("reports platform support without throwing", () => {
    if (!SandboxManager) {
      return;
    }
    const supported = SandboxManager.isSupportedPlatform();
    expect(typeof supported).toBe("boolean");
  });

  it.runIf(platformSupported)("checkDependencies returns valid result", () => {
    const deps = SandboxManager.checkDependencies();
    expect(deps).toHaveProperty("errors");
    expect(deps).toHaveProperty("warnings");
    expect(Array.isArray(deps.errors)).toBe(true);
    expect(Array.isArray(deps.warnings)).toBe(true);
  });
});

describe.runIf(dependenciesAvailable)("real sandbox wrapping", () => {
  it("wrapWithSandbox returns a non-empty string", async () => {
    const config = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        allowWrite: ["."],
        denyWrite: [],
        denyRead: [],
      },
    };
    await SandboxManager.initialize(config);

    const wrapped = await SandboxManager.wrapWithSandbox("echo hello");
    expect(typeof wrapped).toBe("string");
    expect(wrapped.length).toBeGreaterThan(0);
    expect(wrapped).toContain("echo hello");

    await SandboxManager.reset();
  });
});
