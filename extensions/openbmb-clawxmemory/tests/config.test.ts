import { describe, expect, it } from "vitest";
import { buildPluginConfig } from "../src/config.js";

describe("buildPluginConfig", () => {
  it("defaults uiPort to 39393", () => {
    const config = buildPluginConfig({});
    expect(config.uiHost).toBe("127.0.0.1");
    expect(config.uiPort).toBe(39393);
    expect(config.uiPathPrefix).toBe("/clawxmemory");
    expect(config.defaultIndexingSettings).toEqual({
      reasoningMode: "answer_first",
      recallTopK: 10,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinNewL1: 10,
    });
  });

  it("parses uiPort from string input", () => {
    const config = buildPluginConfig({ uiPort: "40404" });
    expect(config.uiPort).toBe(40404);
  });

  it("clamps uiPort to at least 1024", () => {
    const config = buildPluginConfig({ uiPort: 80 });
    expect(config.uiPort).toBe(1024);
  });
});
