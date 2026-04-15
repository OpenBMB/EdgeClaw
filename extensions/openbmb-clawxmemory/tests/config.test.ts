import { afterEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { buildPluginConfig } from "../src/config.js";

describe("buildPluginConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults uiPort to 39393", () => {
    const config = buildPluginConfig({});
    expect(config.uiHost).toBe("127.0.0.1");
    expect(config.uiPort).toBe(39393);
    expect(config.uiPathPrefix).toBe("/clawxmemory");
    expect(config.defaultIndexingSettings).toEqual({
      reasoningMode: "answer_first",
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    });
  });

  it("defaults storage under the EdgeClaw state dir", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", "/tmp/edgeclaw-state");

    const config = buildPluginConfig({});

    expect(config.dataDir).toBe(resolve("/tmp/edgeclaw-state", "clawxmemory"));
    expect(config.dbPath).toBe(resolve("/tmp/edgeclaw-state", "clawxmemory", "memory.sqlite"));
    expect(config.memoryDir).toBe(resolve("/tmp/edgeclaw-state", "clawxmemory", "memory"));
  });

  it("parses uiPort from string input", () => {
    const config = buildPluginConfig({ uiPort: "40404" });
    expect(config.uiPort).toBe(40404);
  });

  it("clamps uiPort to at least 1024", () => {
    const config = buildPluginConfig({ uiPort: 80 });
    expect(config.uiPort).toBe(1024);
  });

  it("ignores legacy dream rebuild timeout overrides", () => {
    const config = buildPluginConfig({ dreamProjectRebuildTimeoutMs: 0 });
    expect(config.defaultIndexingSettings).toEqual({
      reasoningMode: "answer_first",
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    });
  });

  it("derives memoryDir from dbPath when only dbPath is overridden", () => {
    const config = buildPluginConfig({ dbPath: "/tmp/clawxmemory-tests/memory.sqlite" });
    expect(config.dbPath).toBe("/tmp/clawxmemory-tests/memory.sqlite");
    expect(config.memoryDir).toBe(join("/tmp/clawxmemory-tests", "memory"));
  });
});
