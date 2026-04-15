import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmMemoryExtractor } from "../src/core/index.js";

function createExtractor() {
  return new LlmMemoryExtractor({}, undefined, undefined);
}

function createConfiguredExtractor() {
  return new LlmMemoryExtractor({
    agents: {
      defaults: {
        model: {
          primary: "test/test-model",
        },
      },
    },
    models: {
      providers: {
        test: {
          apiKey: "test-key",
          baseUrl: "https://example.test/v1",
          api: "openai-completions",
          models: [
            {
              id: "test-model",
              api: "openai-completions",
            },
          ],
        },
      },
    },
  }, undefined, undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LlmMemoryExtractor hop debug trace", () => {
  it("retries transient 429 responses for structured json calls", async () => {
    const extractor = createConfiguredExtractor();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (extractor as never as {
      callStructuredJsonWithDebug: (input: {
        systemPrompt: string;
        userPrompt: string;
        requestLabel: string;
        parse: (raw: string) => unknown;
      }) => Promise<unknown>;
    }).callStructuredJsonWithDebug({
      systemPrompt: "system",
      userPrompt: "user",
      requestLabel: "Structured retry test",
      parse: (raw) => JSON.parse(raw),
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient timeout-like fetch failures for structured json calls", async () => {
    const extractor = createConfiguredExtractor();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await (extractor as never as {
      callStructuredJsonWithDebug: (input: {
        systemPrompt: string;
        userPrompt: string;
        requestLabel: string;
        parse: (raw: string) => unknown;
      }) => Promise<unknown>;
    }).callStructuredJsonWithDebug({
      systemPrompt: "system",
      userPrompt: "user",
      requestLabel: "Structured retry test",
      parse: (raw) => JSON.parse(raw),
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts explicit collaboration-rule feedback from the model without forcing a formal project id", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          name: "collaboration-rule",
          description: "以后回答我时先给结论再展开；代码示例优先 TypeScript。",
          rule: "以后回答我时先给结论再展开；代码示例优先 TypeScript。",
          why: "",
          how_to_apply: "",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-09T09:22:53.260Z",
      sessionKey: "session-remember-1",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住两件事：以后回答我时先给结论再展开；代码示例优先 TypeScript，除非我明确说别的。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "feedback",
      scope: "project",
      name: "collaboration-rule",
      sourceSessionKey: "session-remember-1",
    });
    expect(result[0]?.projectId).toBeUndefined();
    expect(result[0]?.rule).toContain("以后回答我时先给结论再展开");
  });

  it("normalizes feedback candidates from rule-only model output", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          rule: "每次给我交付时都先给3个标题，再给正文，再给封面文案。",
          why: "",
          how_to_apply: "在这个项目里交付小红书文案时应用。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-11T08:22:53.260Z",
      sessionKey: "session-delivery-rule",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住，在这个小红书文案项目里，你每次给我交付时都先给3个标题，再给正文，再给封面文案。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "feedback",
      scope: "project",
      name: "delivery-rule",
      description: "每次给我交付时都先给3个标题，再给正文，再给封面文案。",
      rule: "每次给我交付时都先给3个标题，再给正文，再给封面文案。",
      howToApply: "在这个项目里交付小红书文案时应用。",
    });
  });

  it("discards feedback candidates that do not contain a rule", async () => {
    const extractor = createExtractor();
    const decisionTrace = vi.fn();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          name: "delivery-rule",
          description: "每次给我交付时都先给3个标题，再给正文，再给封面文案。",
          why: "",
          how_to_apply: "",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-11T08:23:53.260Z",
      sessionKey: "session-invalid-feedback",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住，在这个小红书文案项目里，你每次给我交付时都先给3个标题，再给正文，再给封面文案。",
        },
      ],
      decisionTrace,
    });

    expect(result).toEqual([]);
    expect(decisionTrace).toHaveBeenCalledWith(expect.objectContaining({
      discarded: expect.arrayContaining([
        expect.objectContaining({
          reason: "invalid_schema",
          candidateType: "feedback",
          summary: "Feedback candidate missing a non-empty rule.",
        }),
      ]),
    }));
  });

  it("keeps explicit project feedback how_to_apply semantic when the model returns a structured answer", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          name: "collaboration-rule",
          description: "你给我汇报时要先说完成了什么，再说风险。",
          rule: "你给我汇报时要先说完成了什么，再说风险。",
          why: "",
          how_to_apply: "在这个项目里做进展汇报或状态同步时应用。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T06:56:46.718Z",
      sessionKey: "session-boreal-1",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住，在这个项目里，你给我汇报时要先说完成了什么，再说风险。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "feedback",
      scope: "project",
      name: "collaboration-rule",
      howToApply: "在这个项目里做进展汇报或状态同步时应用。",
    });
  });

  it("drops pure project-local collaboration rules when the model misclassifies them as project memory", async () => {
    const extractor = createExtractor();
    const decisionTrace = vi.fn();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "春日穿搭爆文",
          description: "每次给我交付时都先给3个标题，再给正文，再给封面文案。",
          stage: "",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T06:56:46.718Z",
      sessionKey: "session-xhs-1",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住，在这个小红书文案项目里，你每次给我交付时都先给3个标题，再给正文，再给封面文案。",
        },
      ],
      decisionTrace,
    });

    expect(result).toEqual([]);
    expect(decisionTrace).toHaveBeenCalledWith(expect.objectContaining({
      discarded: expect.arrayContaining([
        expect.objectContaining({
          reason: "violates_feedback_project_boundary",
          candidateType: "project",
        }),
      ]),
    }));
  });

  it("keeps explicit user identity or long-term personal preference in global user memory", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "user",
          name: "user-profile",
          description: "长期偏好中文交流，住在北京。",
          profile: "我长期偏好中文交流，而且我住在北京。",
          preferences: ["长期偏好中文交流"],
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-09T09:22:53.260Z",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住我长期偏好中文交流，而且我住在北京。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "user",
      scope: "global",
      name: "user-profile",
      profile: expect.stringContaining("我长期偏好中文交流"),
    });
  });

  it("normalizes user candidates when the model only returns content", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "user",
          content: "职业：小红书图文选题策划；语言偏好：中文；常用工具：飞书表格和 Notion（用于管理选题）。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-11T09:31:37.010Z",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住这些长期信息：我是做小红书图文选题策划的，平时更习惯中文；我常用飞书表格和 Notion 管选题。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "user",
      scope: "global",
      name: "user-profile",
      profile: "职业：小红书图文选题策划；语言偏好：中文；常用工具：飞书表格和 Notion（用于管理选题）。",
    });
    expect(result[0]?.description).toContain("职业：小红书图文选题策划");
  });

  it("does not turn a transient explicit reminder into user profile memory", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T01:05:00.000Z",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住今天下午三点我要开会。",
        },
      ],
    });

    expect(result).toHaveLength(0);
  });

  it("treats '我现在常用 TypeScript 和 Node.js' as a durable user preference update", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "user",
          name: "user-profile",
          description: "常用 TypeScript 和 Node.js。",
          profile: "用户现在常用 TypeScript 和 Node.js。",
          preferences: ["我现在常用 TypeScript 和 Node.js。"],
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T02:35:00.000Z",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "再记一个长期信息：我现在常用 TypeScript 和 Node.js。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "user",
      scope: "global",
      name: "user-profile",
    });
    expect(result[0]?.preferences?.some((item) => item.includes("TypeScript") && item.includes("Node.js"))).toBe(true);
  });

  it("keeps durable first-person quality preferences in global user memory", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "user",
          content: "我做文案时很在意标题和封面文案的一致性。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-11T10:05:00.000Z",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "再记一个长期信息：我做文案时很在意标题和封面文案的一致性。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "user",
      scope: "global",
      name: "user-profile",
    });
    expect(result[0]?.description).toContain("标题和封面文案的一致性");
  });

  it("recasts first-person quality-bar feedback output into global user memory", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          rule: "标题和封面文案要保持一致性",
          description: "标题和封面文案要保持一致性",
          why: "用户在做文案时很在意标题和封面文案的一致性",
          how_to_apply: "在生成小红书选题策划或文案时，确保标题与封面文案在风格、关键词和调性上保持一致。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-11T10:06:00.000Z",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "再记一个长期信息：我做文案时很在意标题和封面文案的一致性。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "user",
      scope: "global",
      name: "user-profile",
      profile: "标题和封面文案要保持一致性",
    });
  });

  it("rewrites user profile candidates into the fixed four-section schema", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        profile: "用户长期住在北京，平时更习惯中文交流。",
        preferences: ["中文交流"],
        constraints: ["长期住在北京"],
        relationships: [],
      }));

    const result = await extractor.rewriteUserProfile({
      existingProfile: {
        profile: "",
        preferences: [],
        constraints: [],
        relationships: [],
        files: [],
      },
      candidates: [{
        type: "user",
        scope: "global",
        name: "user-profile",
        description: "记住，我长期住在北京，而且我平时更习惯中文交流。",
        profile: "记住，我长期住在北京，而且我平时更习惯中文交流。",
        capturedAt: "2026-04-10T01:00:00.000Z",
      }],
    });

    expect(result).toMatchObject({
      type: "user",
      scope: "global",
      name: "user-profile",
      profile: "用户长期住在北京，平时更习惯中文交流。",
      preferences: ["中文交流"],
      constraints: ["长期住在北京"],
      relationships: [],
    });
  });

  it("does not let the model drop newly added durable user facts during rewrite", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        profile: "用户从事AI产品工作，长期住在北京。",
        preferences: ["使用中文交流"],
        constraints: [],
        relationships: [],
      }));

    const result = await extractor.rewriteUserProfile({
      existingProfile: {
        profile: "用户从事AI产品工作，长期住在北京。",
        preferences: ["使用中文交流"],
        constraints: [],
        relationships: [],
        files: [],
      },
      candidates: [{
        type: "user",
        scope: "global",
        name: "user-profile",
        description: "我现在常用 TypeScript 和 Node.js。",
        profile: "我现在常用 TypeScript 和 Node.js。",
        preferences: ["我现在常用 TypeScript 和 Node.js。"],
        capturedAt: "2026-04-10T02:36:13.474Z",
      }],
    });

    expect(result?.preferences).toEqual(expect.arrayContaining([
      "使用中文交流",
      "我现在常用 TypeScript 和 Node.js。",
    ]));
  });

  it("removes profile and relationship duplicates from user preferences during rewrite", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        profile: "用户从事AI产品工作，长期居住在北京，主要使用Mac设备，习惯使用中文进行交流。",
        preferences: [
          "我平时更习惯中文交流",
          "我主要用 Mac",
          "我是做 AI 产品的，长期住在北京",
          "长期与产品经理Alice合作",
          "技术栈常用TypeScript和Node.js",
          "我现在常用 TypeScript 和 Node.js。",
        ],
        constraints: [],
        relationships: ["长期与产品经理Alice合作"],
      }));

    const result = await extractor.rewriteUserProfile({
      existingProfile: {
        profile: "",
        preferences: [],
        constraints: [],
        relationships: [],
        files: [],
      },
      candidates: [{
        type: "user",
        scope: "global",
        name: "user-profile",
        description: "我是做 AI 产品的，长期住在北京；我平时更习惯中文交流；我主要用 Mac；我长期和产品经理 Alice 一起合作；我现在常用 TypeScript 和 Node.js。",
        profile: "我是做 AI 产品的，长期住在北京。",
        preferences: ["我平时更习惯中文交流", "我主要用 Mac", "我现在常用 TypeScript 和 Node.js。"],
        relationships: ["长期与产品经理Alice合作"],
        capturedAt: "2026-04-10T02:36:13.474Z",
      }],
    });

    expect(result?.preferences).toEqual(expect.arrayContaining([
      "我平时更习惯中文交流",
      "我主要用 Mac",
      expect.stringMatching(/TypeScript/i),
    ]));
    expect(result?.preferences).not.toEqual(expect.arrayContaining([
      "我是做 AI 产品的，长期住在北京",
      "长期与产品经理Alice合作",
    ]));
    expect(result?.relationships).toEqual(["长期与产品经理Alice合作"]);
  });

  it("accepts both project and feedback memories for explicit project remembers when the model extracts them", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [
          {
            type: "project",
            name: "Aster",
            description: "把 OpenClaw 的记忆系统改成文件式 memory。",
            stage: "目标是把 OpenClaw 的记忆系统改成文件式 memory。",
            blockers: ["导入导出还沿用旧 sqlite 结构"],
            timeline: ["2026-04-20 要出可演示版本", "2026-05-05 要给团队试用"],
          },
          {
            type: "feedback",
            name: "collaboration-rule",
            description: "同步进展时先说完成了什么，再说风险。",
            rule: "同步进展时先说完成了什么，再说风险，不要写成泛泛总结。",
            why: "",
            how_to_apply: "在这个项目里做状态同步或进展汇报时应用。",
          },
        ],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-09T09:25:13.007Z",
      sessionKey: "session-aster-1",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: [
            "我最近在做一个项目，先叫它 Aster。目标是把 OpenClaw 的记忆系统改成文件式 memory。",
            "2026-04-20 要出可演示版本，2026-05-05 要给团队试用。",
            "当前卡点是导入导出还沿用旧 sqlite 结构。",
            "另外记住，在这个项目里，你给我同步进展时要非常工程化：先说完成了什么，再说风险，不要写成泛泛总结。",
          ].join("\n"),
        },
      ],
    });

    expect(result.map((item) => item.type)).toEqual(expect.arrayContaining(["project", "feedback"]));
    expect(result.find((item) => item.type === "project")).toMatchObject({
      name: "Aster",
      scope: "project",
      timeline: expect.arrayContaining([
        "2026-04-20 要出可演示版本",
        "2026-05-05 要给团队试用",
      ]),
      blockers: expect.arrayContaining(["导入导出还沿用旧 sqlite 结构"]),
    });
    expect(result.find((item) => item.type === "feedback")).toMatchObject({
      scope: "project",
      name: "collaboration-rule",
      sourceSessionKey: "session-aster-1",
    });
  });

  it("does not fabricate a feedback candidate when the model only returns the project item", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "Aster",
          description: "把 OpenClaw 的记忆系统改成文件式 memory。",
          stage: "目标是把 OpenClaw 的记忆系统改成文件式 memory。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-09T09:25:13.007Z",
      sessionKey: "session-aster-project-only",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: [
            "我最近在做一个项目，先叫它 Aster。目标是把 OpenClaw 的记忆系统改成文件式 memory。",
            "另外记住，在这个项目里，你给我同步进展时要非常工程化：先说完成了什么，再说风险，不要写成泛泛总结。",
          ].join("\n"),
        },
      ],
    });

    expect(result.map((item) => item.type)).toEqual(["project"]);
  });

  it("does not trust a human-readable model project_id as a formal project id", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          project_id: "Boreal",
          name: "Boreal",
          description: "本地知识库整理工具",
          stage: "目前还在设计阶段",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T06:57:17.011Z",
      sessionKey: "session-boreal-2",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "Boreal",
      description: "本地知识库整理工具",
    });
    expect(result[0]?.projectId).toBeUndefined();
  });

  it("normalizes project candidates when the model only returns a human-readable project_id plus stage", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          project_id: "租房桌面改造爆文",
          stage: "风格模板验证阶段",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T08:00:00.000Z",
      sessionKey: "session-desk-project-id-only",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "我最近在做一个项目，先叫 租房桌面改造爆文。目标是给租房博主批量生成桌面改造类小红书图文，目前在风格模板验证阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "租房桌面改造爆文",
      description: expect.stringContaining("给租房博主批量生成桌面改造类小红书图文"),
      stage: "风格模板验证阶段",
    });
    expect(result[0]?.projectId).toBeUndefined();
  });

  it("normalizes project candidates when the model uses project_name instead of name", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          project_name: "周末低预算约会爆文",
          content: "目标：给本地生活博主批量生成低预算约会路线的小红书图文。",
          stage: "选题方向验证阶段",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T08:01:00.000Z",
      sessionKey: "session-date-project-name",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "我最近在做一个项目，先叫 周末低预算约会爆文。目标是给本地生活博主批量生成低预算约会路线的小红书图文，目前在选题方向验证阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "周末低预算约会爆文",
      description: expect.stringContaining("低预算约会路线"),
      stage: "选题方向验证阶段",
    });
  });

  it("extracts a project name from project content when the model omits name fields", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          content: "项目名称：打工人午餐便当爆文（便当出片实验室）。目标：给职场博主批量生成午餐便当主题的小红书图文。",
          stage: "选题试水阶段",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T08:02:00.000Z",
      sessionKey: "session-lunch-content-only",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "我最近在做一个项目，先叫 打工人午餐便当爆文，也可以把它记成 便当出片实验室。目标是给职场博主批量生成午餐便当主题的小红书图文，目前还在选题试水阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "打工人午餐便当爆文",
      description: expect.stringContaining("午餐便当主题"),
      stage: "选题试水阶段",
    });
  });

  it("prefers the explicit project name over an alias-like model name and preserves aliases", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "便当出片实验室",
          aliases: ["便当出片实验室"],
          description: "给职场博主批量生成午餐便当主题的小红书图文（原暂定名：打工人午餐便当爆文）",
          stage: "选题试水阶段",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T08:03:00.000Z",
      sessionKey: "session-lunch-alias-preferred",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "我最近在做一个项目，先叫 打工人午餐便当爆文，也可以把它记成 便当出片实验室。目标是给职场博主批量生成午餐便当主题的小红书图文，目前还在选题试水阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "打工人午餐便当爆文",
      aliases: ["便当出片实验室"],
      stage: "选题试水阶段",
    });
  });

  it("promotes project constraints into a usable description when the model omits description", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "小个子通勤西装爆文",
          description: "",
          constraints: ["避免大牌价格表达", "尽量落到可复制的搭配步骤"],
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T08:04:00.000Z",
      sessionKey: "session-suit-constraints-only",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "继续记住小个子通勤西装爆文：项目约束是避免大牌价格表达，尽量落到可复制的搭配步骤。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "小个子通勤西装爆文",
      description: "避免大牌价格表达",
      constraints: ["避免大牌价格表达", "尽量落到可复制的搭配步骤"],
    });
  });

  it("prefers structured project fields over a repeated generic project description", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "小个子通勤西装爆文",
          description: "给小个子职场女生批量生成通勤西装主题小红书图文的项目",
          stage: "模板验证阶段",
          constraints: "核心受众是身高150到158、想穿得显高利落的上班族",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T08:05:00.000Z",
      sessionKey: "session-suit-audience",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "我最近在做一个项目，先叫 小个子通勤西装爆文。它是给小个子职场女生批量生成通勤西装主题小红书图文的项目，目前在模板验证阶段。",
        },
        {
          role: "assistant",
          content: "好的，我记下这个项目了。",
        },
        {
          role: "user",
          content: "继续记住小个子通勤西装爆文：核心受众是身高150到158、想穿得显高利落的上班族。",
        },
      ],
      batchContextMessages: [
        {
          role: "user",
          content: "我最近在做一个项目，先叫 小个子通勤西装爆文。它是给小个子职场女生批量生成通勤西装主题小红书图文的项目，目前在模板验证阶段。",
        },
        {
          role: "assistant",
          content: "好的，我记下这个项目了。",
        },
        {
          role: "user",
          content: "继续记住小个子通勤西装爆文：核心受众是身高150到158、想穿得显高利落的上班族。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "小个子通勤西装爆文",
      description: "核心受众是身高150到158、想穿得显高利落的上班族",
      constraints: ["核心受众是身高150到158、想穿得显高利落的上班族"],
      stage: "模板验证阶段",
    });
  });

  it("does not create a fake project overview for a project-local collaboration rule without concrete project facts", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          name: "collaboration-rule",
          description: "你给我汇报时要先说完成了什么，再说风险。",
          rule: "你给我汇报时要先说完成了什么，再说风险。",
          why: "",
          how_to_apply: "",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-09T11:12:40.389Z",
      sessionKey: "session-project-feedback",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住，在这个项目里，你给我汇报时要先说完成了什么，再说风险。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "feedback",
      scope: "project",
      name: "collaboration-rule",
      sourceSessionKey: "session-project-feedback",
    });
    expect(result[0]?.why || "").toBe("");
    expect(result[0]?.howToApply || "").toBe("");
  });

  it("synthesizes a project candidate when the model misses an explicit project definition turn", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T06:57:17.011Z",
      sessionKey: "session-boreal",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "Boreal",
      stage: "目前还在设计阶段",
    });
  });

  it("does not backfill a project candidate for a vague project mention without definition signals", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T06:58:00.000Z",
      sessionKey: "session-vague-project",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "这个项目我们后面再说，先不展开。",
        },
      ],
    });

    expect(result).toHaveLength(0);
  });

  it("does not fabricate feedback from project stage text that merely mentions 风格摸索阶段", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "春日穿搭爆文",
          description: "帮博主批量生成春日穿搭小红书文案的项目",
          stage: "目前还在选题和风格摸索阶段。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-11T02:55:34.467Z",
      sessionKey: "session-xhs-stage",
      explicitRemember: false,
      messages: [
        {
          role: "user",
          content: "这个项目先叫 春日穿搭爆文。它是一个帮博主批量生成春日穿搭小红书文案的项目，目前还在选题和风格摸索阶段。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "春日穿搭爆文",
    });
  });

  it("allows a generic anchor to attach concrete project memory when the batch context has a unique project", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "project",
          name: "Boreal",
          description: "第一版先别碰知识库。",
          stage: "目前还在设计阶段。",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T07:05:00.000Z",
      sessionKey: "session-boreal-batch",
      explicitRemember: false,
      batchContextMessages: [
        { role: "user", content: "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。" },
        { role: "assistant", content: "好的，我记下这个项目了。" },
        { role: "user", content: "帮我记住这个项目，第一版先别碰知识库。" },
      ],
      messages: [
        { role: "user", content: "帮我记住这个项目，第一版先别碰知识库。" },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      name: "Boreal",
      description: "第一版先别碰知识库。",
    });
  });

  it("synthesizes a project candidate for a natural follow-up turn when the batch context has a unique project", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-14T09:00:00.000Z",
      sessionKey: "session-boreal-follow-up",
      explicitRemember: false,
      batchContextMessages: [
        { role: "user", content: "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。" },
        { role: "assistant", content: "明白。" },
        { role: "user", content: "接下来我最该补的是把首批目录结构先模板化，然后统一检索入口命名。" },
      ],
      messages: [
        { role: "user", content: "接下来我最该补的是把首批目录结构先模板化，然后统一检索入口命名。" },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "project",
      scope: "project",
      name: "Boreal",
    });
    expect(result[0]?.nextSteps).toEqual(expect.arrayContaining([
      expect.stringContaining("接下来我最该补的是把首批目录结构先模板化"),
    ]));
  });

  it("does not create a project candidate for a generic anchor when batch context contains multiple project names", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({ items: [] }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T07:06:00.000Z",
      sessionKey: "session-multi-project",
      explicitRemember: false,
      batchContextMessages: [
        { role: "user", content: "这个项目先叫 Aster。它是一个记忆系统重构项目。" },
        { role: "assistant", content: "好的。" },
        { role: "user", content: "我还有一个项目叫 Northwind，是一个本地知识库整理工具。" },
        { role: "assistant", content: "明白。" },
        { role: "user", content: "帮我记住这个项目。" },
      ],
      messages: [
        { role: "user", content: "帮我记住这个项目。" },
      ],
    });

    expect(result).toHaveLength(0);
  });

  it("leaves why and how_to_apply empty when feedback evidence is too weak", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [{
          type: "feedback",
          name: "collaboration-rule",
          description: "先说完成了什么，再说风险。",
          rule: "先说完成了什么，再说风险。",
          why: "",
          how_to_apply: "",
        }],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T03:10:00.000Z",
      sessionKey: "session-feedback-weak",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住：先说完成了什么，再说风险。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "feedback",
      scope: "project",
      name: "collaboration-rule",
    });
    expect(result[0]?.why || "").toBe("");
    expect(result[0]?.howToApply || "").toBe("");
  });

  it("sanitizes generic why and how_to_apply template text from model output", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({
        items: [
          {
            type: "feedback",
            name: "collaboration-rule",
            description: "Status updates should lead with completed work and risks.",
            rule: "先说完成了什么，再说风险。",
            why: "Explicit project collaboration preference captured from the user.",
            how_to_apply: "Follow this collaboration rule in future project replies unless the user overrides it.",
          },
        ],
      }));

    const result = await extractor.extractFileMemoryCandidates({
      timestamp: "2026-04-10T03:11:00.000Z",
      sessionKey: "session-feedback-sanitize",
      explicitRemember: true,
      messages: [
        {
          role: "user",
          content: "记住，在这个项目里先说完成了什么，再说风险。",
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.why || "").toBe("");
    expect(result[0]?.howToApply || "").toBe("");
  });

  it("maps project-related recall queries to project_memory without query-side semantic rewriting", async () => {
    const extractor = createExtractor();
    vi.spyOn(extractor as never as { callStructuredJson: (input: unknown) => Promise<string> }, "callStructuredJson")
      .mockResolvedValue(JSON.stringify({ route: "project_memory" }));

    const route = await extractor.decideFileMemoryRoute({
      query: "我们继续聊 Aster。这个项目现在的阶段、关键约束、下一步，以及你应该怎么和我协作？",
    });

    expect(route).toBe("project_memory");
  });

  it("uses a stricter recall project-selection prompt for similar project names", async () => {
    const extractor = createExtractor();
    const callStructuredJsonWithDebug = vi.spyOn(
      extractor as never as { callStructuredJsonWithDebug: (input: unknown) => Promise<unknown> },
      "callStructuredJsonWithDebug",
    ).mockResolvedValue({
      selected_project_id: "project_citycoffee",
      reason: "The query explicitly names the exact project.",
    });

    await extractor.selectRecallProject({
      query: "我们继续聊 城市咖啡探店爆文。",
      shortlist: [
        {
          projectId: "project_citycoffee",
          projectName: "城市咖啡探店爆文",
          description: "本地生活探店内容",
          aliases: ["城市咖啡探店爆文"],
          status: "active",
          score: 12,
          exact: 1,
          updatedAt: "2026-04-12T00:00:00.000Z",
          source: "query",
          matchedText: "城市咖啡探店爆文",
        },
        {
          projectId: "project_citycafe",
          projectName: "城市咖啡馆探店爆文",
          description: "精品咖啡馆探店内容",
          aliases: ["城市咖啡馆探店爆文"],
          status: "active",
          score: 10,
          exact: 0,
          updatedAt: "2026-04-12T00:00:01.000Z",
          source: "query",
          matchedText: "城市咖啡",
        },
      ],
    });

    expect(callStructuredJsonWithDebug).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "File memory project selection",
      systemPrompt: expect.stringContaining("Similar project names are distinct by default"),
    }));
    expect(callStructuredJsonWithDebug.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      systemPrompt: expect.stringContaining("If the query explicitly names one shortlist project, prefer that exact project"),
    }));
  });

  it("uses a stricter Dream global-plan prompt for explicit project-boundary merges", async () => {
    const extractor = createExtractor();
    const callStructuredJsonWithDebug = vi.spyOn(
      extractor as never as { callStructuredJsonWithDebug: (input: unknown) => Promise<unknown> },
      "callStructuredJsonWithDebug",
    ).mockResolvedValue({
      summary: "Keep projects separate.",
      duplicate_topic_count: 0,
      conflict_topic_count: 0,
      projects: [],
      deleted_project_ids: [],
      deleted_entry_ids: [],
    });

    await extractor.planDreamFileMemory({
      currentProjects: [
        {
          projectId: "project_citycoffee",
          projectName: "城市咖啡探店爆文",
          description: "本地生活探店内容",
          aliases: ["城市咖啡探店爆文"],
          status: "active",
          updatedAt: "2026-04-12T00:00:00.000Z",
        },
      ],
      records: [
        {
          entryId: "projects/project_citycoffee/Project/current-stage.md",
          relativePath: "projects/project_citycoffee/Project/current-stage.md",
          type: "project",
          scope: "project",
          projectId: "project_citycoffee",
          isTmp: false,
          name: "current-stage",
          description: "当前阶段",
          updatedAt: "2026-04-12T00:00:00.000Z",
          content: "## Current Stage\n还在测试中。",
          project: {
            stage: "测试中",
            decisions: [],
            constraints: [],
            nextSteps: [],
            blockers: [],
            timeline: [],
            notes: [],
          },
        },
      ],
    });

    expect(callStructuredJsonWithDebug).toHaveBeenCalledWith(expect.objectContaining({
      requestLabel: "Dream file global plan",
      systemPrompt: expect.stringContaining("Similar project names, shared prefixes, or small wording differences do NOT imply the same project."),
    }));
    expect(callStructuredJsonWithDebug.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      systemPrompt: expect.stringContaining("duplicate_formal_project is only for multiple already-existing formal project identities"),
    }));
    expect(callStructuredJsonWithDebug.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      systemPrompt: expect.stringContaining("evidence_entry_ids must point to explicit rename, alias, or duplicate-identity evidence"),
    }));
    expect(callStructuredJsonWithDebug.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      userPrompt: expect.stringContaining("\"duplicate_formal_project_requires_multiple_formal_identities\": true"),
    }));
    expect(callStructuredJsonWithDebug.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      userPrompt: expect.stringContaining("\"distinct_tmp_project_names_remain_separate_by_default\": true"),
    }));
  });
});
