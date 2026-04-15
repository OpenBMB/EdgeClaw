import { describe, expect, it } from "vitest";
import { hasExplicitRememberIntentText, normalizeTranscriptMessage } from "../src/message-utils.js";

describe("normalizeTranscriptMessage", () => {
  it("removes recall scaffolding and keeps the actual user turn", () => {
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: [
          "## ClawXMemory Recall",
          "",
          "Use the following retrieved ClawXMemory evidence for this turn.",
          "",
          "## ClawXMemory Retrieved Evidence",
          "intent=general",
          "enoughAt=l0",
          "",
          "Treat the selected evidence above as authoritative historical memory for this turn when it is relevant.",
          "If the needed answer is already shown above, do not claim that memory is missing or that this is a fresh conversation.",
          "",
          "System: [2026-03-24 16:24:10] Gateway restart update ok (npm)",
          "System: Run: openclaw doctor --non-interactive",
          "",
          "[Tue 2026-03-24 16:24 GMT+8] 感觉冒菜可以",
        ].join("\n"),
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(normalized).toMatchObject({
      role: "user",
      content: "感觉冒菜可以",
    });
  });

  it("still removes the legacy memory context scaffold", () => {
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: [
          "You are using multi-level memory indexes for this turn.",
          "",
          "Earlier memory summary",
          "",
          "Treat the above as authoritative prior memory when it is relevant. Prioritize the user's latest request, and do not claim memory is missing or that this is a fresh conversation if the answer is already shown above.",
          "",
          "[Tue 2026-03-24 16:23 GMT+8] 论文先不写了 我累了 想去吃点啥",
        ].join("\n"),
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(normalized).toMatchObject({
      role: "user",
      content: "论文先不写了 我累了 想去吃点啥",
    });
  });

  it("preserves normal markdown headings in user input", () => {
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: "## 清新自然风格\n给我一个更具体的拍摄方案",
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(normalized).toMatchObject({
      role: "user",
      content: "## 清新自然风格\n给我一个更具体的拍摄方案",
    });
  });

  it("decodes escaped unicode text in transcript content", () => {
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: "\\u8fd9\\u4e2a\\u9879\\u76ee\\u5148\\u53eb \\u590f\\u65e5\\u996e\\u54c1\\u6d4b\\u8bc4\\u3002",
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(normalized).toMatchObject({
      role: "user",
      content: "这个项目先叫 夏日饮品测评。",
    });
  });

  it("strips leading ClawXContext state scaffolding from user turns", () => {
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: [
          "Project state maintained by ClawXContext.",
          "Current git branch: main",
          "Git status summary: clean working tree",
          "",
          "我昨晚把排位打上新段位了",
        ].join("\n"),
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(normalized).toMatchObject({
      role: "user",
      content: "我昨晚把排位打上新段位了",
    });
  });

  it("does not treat prompt/value-only objects as visible transcript text", () => {
    const normalized = normalizeTranscriptMessage(
      {
        role: "user",
        content: {
          prompt: "Project state maintained by ClawXContext.",
          value: "Current git branch: main",
        },
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(normalized).toBeUndefined();
  });

  it("drops assistant plugin status blocks but keeps normal replies that mention git status", () => {
    const statusOnly = normalizeTranscriptMessage(
      {
        role: "assistant",
        content: [
          "📊 **Session Status** - **Agent:** main - **Host:** Example Laptop - **Workspace:** /Users/example/openclaw/workspace - **OS:** Darwin 25.4.0 - **Node:** v22.18.0",
        ].join("\n"),
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );
    const normalReply = normalizeTranscriptMessage(
      {
        role: "assistant",
        content: "我看了 git status，当前工作区是干净的，所以可以继续提交。",
      },
      {
        includeAssistant: true,
        maxMessageChars: 1000,
      },
    );

    expect(statusOnly).toBeUndefined();
    expect(normalReply).toMatchObject({
      role: "assistant",
      content: "我看了 git status，当前工作区是干净的，所以可以继续提交。",
    });
  });
});

describe("hasExplicitRememberIntentText", () => {
  it("recognizes natural explicit remember phrasing used in chat", () => {
    expect(hasExplicitRememberIntentText("记住两件事：以后回答我时先给结论再展开；代码示例优先 TypeScript。")).toBe(true);
    expect(hasExplicitRememberIntentText("另外记住，在这个项目里同步进展时先说完成了什么，再说风险。")).toBe(true);
    expect(hasExplicitRememberIntentText("再记一个长期信息：我现在常用 TypeScript 和 Node.js。")).toBe(true);
  });

  it("does not treat ordinary recall questions as explicit save requests", () => {
    expect(hasExplicitRememberIntentText("你还记住我们上次聊了什么吗？")).toBe(false);
  });
});
