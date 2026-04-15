import { describe, expect, it } from "vitest";
import { renderTraceI18nText } from "../ui-source/trace-i18n.js";

const LOCALES = {
  zh: {
    "trace.step.focus_turns_selected": "焦点轮次已选定",
    "trace.text.focus_turns_selected.output.classifying": "这些用户轮次会逐条进入分类。",
    "trace.text.manifest_scanned.output.ready": "已准备好 {0} 条 recall header。",
  },
  en: {
    "trace.step.focus_turns_selected": "Focus Turns Selected",
    "trace.text.focus_turns_selected.output.classifying": "User turns will be classified one by one.",
    "trace.text.project_selected.input": "{0} shortlist candidates",
  },
};

describe("trace ui i18n helper", () => {
  it("renders localized trace prose in zh and en", () => {
    expect(renderTraceI18nText(
      "Focus Turns Selected",
      { key: "trace.step.focus_turns_selected", fallback: "Focus Turns Selected" },
      "zh",
      LOCALES,
    )).toBe("焦点轮次已选定");

    expect(renderTraceI18nText(
      "User turns will be classified one by one.",
      { key: "trace.text.focus_turns_selected.output.classifying", fallback: "User turns will be classified one by one." },
      "en",
      LOCALES,
    )).toBe("User turns will be classified one by one.");
  });

  it("keeps raw values unchanged when no trace i18n payload exists", () => {
    expect(renderTraceI18nText("project_memory", undefined, "zh", LOCALES)).toBe("project_memory");
    expect(renderTraceI18nText("projects/demo/Project/current-stage.md", null, "zh", LOCALES)).toBe("projects/demo/Project/current-stage.md");
    expect(renderTraceI18nText("我还有一个项目叫「周末咖啡探店图文」。", undefined, "en", LOCALES)).toBe("我还有一个项目叫「周末咖啡探店图文」。");
  });

  it("falls back to english fallback instead of zh in english mode", () => {
    expect(renderTraceI18nText(
      "候选项目 2 个",
      { key: "trace.text.manifest_scanned.output.ready", fallback: "1 recall header entries ready.", args: ["1"] },
      "en",
      LOCALES,
    )).toBe("1 recall header entries ready.");
  });

  it("allows zh mode to fall back to english locale entries", () => {
    expect(renderTraceI18nText(
      "2 shortlist candidates",
      { key: "trace.text.project_selected.input", fallback: "2 shortlist candidates", args: ["2"] },
      "zh",
      LOCALES,
    )).toBe("2 shortlist candidates");
  });

  it("falls back to descriptor fallback for legacy trace records", () => {
    expect(renderTraceI18nText("Legacy English Summary", { key: "trace.missing", fallback: "Fallback English" }, "zh", LOCALES))
      .toBe("Fallback English");
    expect(renderTraceI18nText("Legacy English Summary", undefined, "zh", LOCALES)).toBe("Legacy English Summary");
  });
});
