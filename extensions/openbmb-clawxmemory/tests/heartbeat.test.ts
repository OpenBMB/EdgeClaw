import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryCandidate, MemoryMessage } from "../src/core/index.js";
import { HeartbeatIndexer, MemoryRepository } from "../src/core/index.js";

const DEFAULT_SETTINGS = {
  reasoningMode: "accuracy_first" as const,
  autoIndexIntervalMinutes: 60,
  autoDreamIntervalMinutes: 360,
};

function createMessages(user: string, assistant: string): MemoryMessage[] {
  return [
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ];
}

describe("HeartbeatIndexer batch indexing", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("processes all pending l0 rows in the same session with a shared batch context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-heartbeat-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });

    repository.insertL0Session({
      l0IndexId: "l0-1",
      sessionKey: "agent:main:main#window:1",
      timestamp: "2026-04-10T07:00:00.000Z",
      source: "openclaw",
      indexed: false,
      messages: createMessages(
        "记住，在这个项目里，你给我汇报时要先说完成了什么，再说风险。",
        "好的，我记住这条项目内规则。",
      ),
    });
    repository.insertL0Session({
      l0IndexId: "l0-2",
      sessionKey: "agent:main:main#window:1",
      timestamp: "2026-04-10T07:01:00.000Z",
      source: "openclaw",
      indexed: false,
      messages: createMessages(
        "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
        "好的，我记下 Boreal 了。",
      ),
    });

    const extractFileMemoryCandidates = vi.fn(async (input: {
      timestamp: string;
      batchContextMessages?: MemoryMessage[];
      messages: MemoryMessage[];
    }): Promise<MemoryCandidate[]> => {
      expect(input.batchContextMessages?.length).toBe(4);
      expect(input.messages).toHaveLength(1);
      expect(input.messages.every((message) => message.role === "user")).toBe(true);
      const userText = input.messages.find((message) => message.role === "user")?.content ?? "";
      if (userText.includes("汇报时要先说完成了什么")) {
        return [{
          type: "feedback",
          scope: "project",
          name: "collaboration-rule",
          description: "你给我汇报时要先说完成了什么，再说风险。",
          capturedAt: input.timestamp,
          sourceSessionKey: "agent:main:main#window:1",
          rule: "你给我汇报时要先说完成了什么，再说风险。",
        }];
      }
      return [{
        type: "project",
        scope: "project",
        name: "Boreal",
        description: "本地知识库整理工具",
        capturedAt: input.timestamp,
        sourceSessionKey: "agent:main:main#window:1",
        stage: "目前还在设计阶段。",
      }];
    });

    const rewriteUserProfile = vi.fn().mockResolvedValue(null);
    const indexer = new HeartbeatIndexer(
      repository,
      {
        extractFileMemoryCandidates,
        rewriteUserProfile,
      } as never,
      { settings: DEFAULT_SETTINGS },
    );

    const stats = await indexer.runHeartbeat({ reason: "manual" });

    expect(extractFileMemoryCandidates).toHaveBeenCalledTimes(2);
    expect(repository.listPendingSessionKeys()).toEqual([]);
    expect(repository.listRecentL0(10).every((record) => record.indexed)).toBe(true);
    const tmpEntries = repository.getFileMemoryStore().listTmpEntries(10);
    expect(tmpEntries.map((entry) => entry.type).sort()).toEqual(["feedback", "project"]);
    const indexTraces = repository.listRecentIndexTraces(5);
    expect(indexTraces).toHaveLength(1);
    expect(indexTraces[0]?.trigger).toBe("manual_sync");
    expect(indexTraces[0]?.batchSummary).toMatchObject({
      l0Ids: ["l0-1", "l0-2"],
      segmentCount: 2,
      focusUserTurnCount: 2,
    });
    expect(indexTraces[0]?.steps.map((step) => step.kind)).toEqual([
      "index_start",
      "batch_loaded",
      "focus_turns_selected",
      "turn_classified",
      "candidate_validated",
      "candidate_grouped",
      "candidate_persisted",
      "turn_classified",
      "candidate_validated",
      "candidate_grouped",
      "candidate_persisted",
      "index_finished",
    ]);
    const batchLoaded = indexTraces[0]?.steps.find((step) => step.kind === "batch_loaded");
    expect(batchLoaded?.titleI18n).toMatchObject({ key: "trace.step.batch_loaded" });
    expect(batchLoaded?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Batch Summary",
        labelI18n: expect.objectContaining({ key: "trace.detail.batch_summary" }),
      }),
      expect.objectContaining({
        label: "Batch Context",
        labelI18n: expect.objectContaining({ key: "trace.detail.batch_context" }),
      }),
    ]));
    const persistedStep = indexTraces[0]?.steps.find((step) => step.kind === "candidate_persisted");
    expect(persistedStep?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Persisted Files",
        labelI18n: expect.objectContaining({ key: "trace.detail.persisted_files" }),
      }),
    ]));
    expect(indexTraces[0]?.storedResults.map((result) => result.relativePath).sort()).toEqual(
      tmpEntries.map((entry) => entry.relativePath).sort(),
    );
    expect(stats).toMatchObject({
      capturedSessions: 2,
      writtenFiles: 2,
      writtenProjectFiles: 1,
      writtenFeedbackFiles: 1,
      failedSessions: 0,
    });

    repository.close();
  });

  it("stages a readable project_id in tmp instead of treating it as a formal project id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-heartbeat-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });

    repository.insertL0Session({
      l0IndexId: "l0-1",
      sessionKey: "agent:main:main#window:2",
      timestamp: "2026-04-10T07:05:00.000Z",
      source: "openclaw",
      indexed: false,
      messages: createMessages(
        "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
        "好的，我记下 Boreal 了。",
      ),
    });

    const indexer = new HeartbeatIndexer(
      repository,
      {
        extractFileMemoryCandidates: vi.fn().mockResolvedValue([{
          type: "project",
          scope: "project",
          projectId: "boreal",
          name: "Boreal",
          description: "本地知识库整理工具",
          capturedAt: "2026-04-10T07:05:00.000Z",
          stage: "目前还在设计阶段。",
        }]),
        rewriteUserProfile: vi.fn().mockResolvedValue(null),
      } as never,
      { settings: DEFAULT_SETTINGS },
    );

    await indexer.runHeartbeat({ reason: "manual" });

    const store = repository.getFileMemoryStore();
    expect(store.listProjectIds().filter((projectId) => projectId !== "_tmp")).toEqual([]);
    const tmpEntries = store.listTmpEntries(10);
    expect(tmpEntries).toHaveLength(1);
    expect(tmpEntries[0]?.name).toBe("Boreal");
    repository.close();
  });

  it("reuses one tmp project file when same-session candidates only differ by trailing quotes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-heartbeat-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });

    repository.insertL0Session({
      l0IndexId: "l0-quoted-1",
      sessionKey: "agent:main:quoted#window:1",
      timestamp: "2026-04-10T07:05:00.000Z",
      source: "openclaw",
      indexed: false,
      messages: [
        { role: "user", content: "这个项目先叫 “Boreal”。" },
        { role: "assistant", content: "好，我先按 Boreal 记。" },
        { role: "user", content: "Boreal 还是那个本地知识库整理工具，现在补充一下下一步。" },
        { role: "assistant", content: "收到，我补充进去。" },
      ],
    });

    const indexer = new HeartbeatIndexer(
      repository,
      {
        extractFileMemoryCandidates: vi.fn(async (input: { timestamp: string; messages: MemoryMessage[] }) => {
          const userText = input.messages[0]?.content ?? "";
          if (userText.includes("先叫")) {
            return [{
              type: "project",
              scope: "project",
              name: "Boreal”",
              description: "本地知识库整理工具",
              capturedAt: input.timestamp,
              sourceSessionKey: "agent:main:quoted#window:1",
              stage: "初始定义",
            }];
          }
          return [{
            type: "project",
            scope: "project",
            name: "Boreal",
            description: "本地知识库整理工具",
            capturedAt: input.timestamp,
            sourceSessionKey: "agent:main:quoted#window:1",
            stage: "已经补充到下一步",
            nextSteps: ["整理目录结构"],
          }];
        }),
        rewriteUserProfile: vi.fn().mockResolvedValue(null),
      } as never,
      { settings: DEFAULT_SETTINGS },
    );

    await indexer.runHeartbeat({ reason: "manual" });

    const store = repository.getFileMemoryStore();
    const tmpEntries = store.listTmpEntries(10);
    expect(tmpEntries).toHaveLength(1);
    expect(tmpEntries[0]?.name).toBe("Boreal");
    const record = tmpEntries[0] ? store.getMemoryRecord(tmpEntries[0].relativePath, 5000) : undefined;
    expect(record?.content).toContain("整理目录结构");
    repository.close();
  });

  it("rewrites the global user profile from a content-only user candidate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-heartbeat-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });

    repository.insertL0Session({
      l0IndexId: "l0-user-1",
      sessionKey: "agent:main:explicit:user-window",
      timestamp: "2026-04-11T09:31:37.010Z",
      source: "openclaw",
      indexed: false,
      messages: createMessages(
        "记住这些长期信息：我是做小红书图文选题策划的，平时更习惯中文；我常用飞书表格和 Notion 管选题。",
        "好的，我记住了。",
      ),
    });

    const indexer = new HeartbeatIndexer(
      repository,
      {
        extractFileMemoryCandidates: vi.fn().mockResolvedValue([{
          type: "user",
          scope: "global",
          name: "user-profile",
          description: "职业：小红书图文选题策划；语言偏好：中文；常用工具：飞书表格和 Notion。",
          profile: "职业：小红书图文选题策划；语言偏好：中文；常用工具：飞书表格和 Notion。",
          capturedAt: "2026-04-11T09:31:37.010Z",
        }]),
        rewriteUserProfile: vi.fn().mockResolvedValue({
          type: "user",
          scope: "global",
          name: "user-profile",
          description: "用户画像",
          profile: "用户是做小红书图文选题策划的。",
          preferences: ["更习惯中文", "常用飞书表格和 Notion"],
          constraints: [],
          relationships: [],
          capturedAt: "2026-04-11T09:31:37.010Z",
        }),
      } as never,
      { settings: DEFAULT_SETTINGS },
    );

    const stats = await indexer.runHeartbeat({ reason: "manual" });

    const userRecord = repository.getFileMemoryStore().getMemoryRecord("global/User/user-profile.md", 5000);
    expect(userRecord?.content).toContain("## Profile");
    expect(userRecord?.content).toContain("小红书图文选题策划");
    expect(stats.userProfilesUpdated).toBe(1);
    repository.close();
  });

  it("only indexes newly introduced user turns when later l0 rows contain a full-session snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawxmemory-heartbeat-"));
    cleanupPaths.push(dir);
    const repository = new MemoryRepository(join(dir, "memory.sqlite"), {
      memoryDir: join(dir, "memory"),
    });

    repository.insertL0Session({
      l0IndexId: "l0-full-1",
      sessionKey: "agent:main:main#full-session",
      timestamp: "2026-04-10T08:00:00.000Z",
      source: "openclaw",
      indexed: false,
      messages: createMessages(
        "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
        "好的，我记下 Boreal 了。",
      ),
    });
    repository.insertL0Session({
      l0IndexId: "l0-full-2",
      sessionKey: "agent:main:main#full-session",
      timestamp: "2026-04-10T08:02:00.000Z",
      source: "openclaw",
      indexed: false,
      messages: [
        ...createMessages(
          "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
          "好的，我记下 Boreal 了。",
        ),
        ...createMessages(
          "在这个 Boreal 项目里，每次交付时先给我结论，再给风险。",
          "好的，我记住这条规则。",
        ),
      ],
    });

    const seenTurns: string[] = [];
    const extractFileMemoryCandidates = vi.fn(async (input: {
      timestamp: string;
      batchContextMessages?: MemoryMessage[];
      messages: MemoryMessage[];
    }): Promise<MemoryCandidate[]> => {
      expect(input.batchContextMessages?.length).toBe(4);
      const userText = input.messages.find((message) => message.role === "user")?.content ?? "";
      seenTurns.push(userText);
      if (userText.includes("先叫 Boreal")) {
        return [{
          type: "project",
          scope: "project",
          name: "Boreal",
          description: "本地知识库整理工具",
          capturedAt: input.timestamp,
          sourceSessionKey: "agent:main:main#full-session",
          stage: "目前还在设计阶段。",
        }];
      }
      return [{
        type: "feedback",
        scope: "project",
        name: "delivery-rule",
        description: "每次交付时先给我结论，再给风险。",
        capturedAt: input.timestamp,
        sourceSessionKey: "agent:main:main#full-session",
        rule: "每次交付时先给我结论，再给风险。",
      }];
    });

    const indexer = new HeartbeatIndexer(
      repository,
      {
        extractFileMemoryCandidates,
        rewriteUserProfile: vi.fn().mockResolvedValue(null),
      } as never,
      { settings: DEFAULT_SETTINGS },
    );

    const stats = await indexer.runHeartbeat({ reason: "manual" });

    expect(seenTurns).toEqual([
      "这个项目先叫 Boreal。它是一个本地知识库整理工具，目前还在设计阶段。",
      "在这个 Boreal 项目里，每次交付时先给我结论，再给风险。",
    ]);
    expect(extractFileMemoryCandidates).toHaveBeenCalledTimes(2);
    expect(repository.getFileMemoryStore().listTmpEntries(10).map((entry) => entry.type).sort()).toEqual(["feedback", "project"]);
    expect(stats).toMatchObject({
      capturedSessions: 2,
      writtenFiles: 2,
      writtenProjectFiles: 1,
      writtenFeedbackFiles: 1,
      failedSessions: 0,
    });
    repository.close();
  });
});
