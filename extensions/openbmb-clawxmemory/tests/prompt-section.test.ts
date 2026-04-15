import { describe, expect, it } from "vitest";
import { buildMemoryPromptSection } from "../src/prompt-section.js";

describe("buildMemoryPromptSection", () => {
  it("returns no section when memory tools are unavailable", () => {
    expect(buildMemoryPromptSection({ availableTools: new Set() })).toEqual([]);
  });

  it("mentions browse, retrieval, and flush tools when they are available", () => {
    const lines = buildMemoryPromptSection({
      availableTools: new Set(["memory_overview", "memory_list", "memory_search", "memory_get", "memory_flush", "memory_dream"]),
    });

    expect(lines.join("\n")).toContain("memory_overview");
    expect(lines.join("\n")).toContain("memory_list");
    expect(lines.join("\n")).toContain("memory_search");
    expect(lines.join("\n")).toContain("memory_get");
    expect(lines.join("\n")).toContain("memory_flush");
    expect(lines.join("\n")).toContain("memory_dream");
    expect(lines.join("\n")).toContain("authoritative long-term memory source");
    expect(lines.join("\n")).toContain("Never call write, edit, move, rename, or delete tools on workspace memory files");
  });
});
