import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalUiServer } from "../src/ui-server.js";

const activeServers: LocalUiServer[] = [];

function createDefaultRepository() {
  return {
    getOverview: () => ({
      pendingSessions: 0,
      formalProjectCount: 1,
      userProfileCount: 1,
      tmpTotalFiles: 0,
      recentRecallTraceCount: 0,
      recentIndexTraceCount: 0,
      recentDreamTraceCount: 0,
    }),
    getUiSnapshot: () => ({
      overview: {
        pendingSessions: 0,
        formalProjectCount: 1,
        userProfileCount: 1,
        tmpTotalFiles: 0,
        recentRecallTraceCount: 0,
        recentIndexTraceCount: 0,
        recentDreamTraceCount: 0,
      },
      settings: {
        reasoningMode: "answer_first",
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
      },
      recentMemoryFiles: [
        {
          name: "current-stage",
          description: "Project memory",
          type: "project",
          scope: "project",
          projectId: "proj-a",
          updatedAt: "2026-04-01T00:00:00.000Z",
          file: "current-stage.md",
          relativePath: "projects/proj-a/Project/current-stage.md",
          absolutePath: "/tmp/projects/proj-a/Project/current-stage.md",
        },
      ],
    }),
    listMemoryEntries: () => [],
    getMemoryRecordsByIds: () => [],
    getFileMemoryStore: () => ({
        getUserSummary: () => ({
          profile: "User profile",
          preferences: ["TypeScript"],
          constraints: [],
          relationships: [],
          files: [],
        }),
        getRootDir: () => "/tmp/memory",
        listProjectMetas: () => [
          {
          projectId: "proj-a",
          projectName: "Project A",
          description: "Project A description",
          aliases: ["A"],
          status: "active",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
          relativePath: "projects/proj-a/project.meta.md",
          absolutePath: "/tmp/projects/proj-a/project.meta.md",
        },
      ],
    }),
  };
}

async function startUiServer(
  {
    controls = {},
    repository = {},
  }: {
    controls?: Record<string, unknown>;
    repository?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const uiServer = new LocalUiServer(
    {
      ...createDefaultRepository(),
      ...repository,
    } as never,
    {} as never,
    { host: "127.0.0.1", port: 0, prefix: "/clawxmemory" },
    {
      getSettings: () => ({
        reasoningMode: "answer_first",
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
      }),
      saveSettings: () => ({
        reasoningMode: "answer_first",
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
      }),
      runIndexNow: async () => ({
        capturedSessions: 0,
        writtenFiles: 0,
        writtenProjectFiles: 0,
        writtenFeedbackFiles: 0,
        userProfilesUpdated: 0,
        failedSessions: 0,
      }),
      runDreamNow: async () => ({
        prepFlush: {
          capturedSessions: 0,
          writtenFiles: 0,
          writtenProjectFiles: 0,
          writtenFeedbackFiles: 0,
          userProfilesUpdated: 0,
          failedSessions: 0,
        },
        reviewedFiles: 0,
        rewrittenProjects: 0,
        deletedProjects: 0,
        deletedFiles: 0,
        profileUpdated: false,
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        summary: "noop",
      }),
      runMemoryAction: async (input) => ({
        ok: true,
        action: input.action,
        updatedOverview: {
          pendingSessions: 0,
          formalProjectCount: 1,
          userProfileCount: 1,
          tmpTotalFiles: 0,
        },
        mutatedIds: [],
        deletedProjectIds: [],
        messages: ["ok"],
      }),
      clearMemoryNow: async () => ({
        cleared: {
          l0: 0,
          pipelineState: 0,
          memoryFiles: 0,
          projectMetas: 0,
        },
        clearedAt: "2026-04-01T00:00:00.000Z",
      }),
      exportMemoryBundle: () => ({ exportedAt: "2026-04-01T00:00:00.000Z" }),
      importMemoryBundle: async () => ({ imported: {} }),
      getRuntimeOverview: () => ({
        runtimeIssues: [],
        managedWorkspaceFiles: [],
      }),
      getStartupRepairSnapshot: () => undefined,
      listCaseTraces: () => [],
      getCaseTrace: () => undefined,
      listIndexTraces: () => [],
      getIndexTrace: () => undefined,
      listDreamTraces: () => [],
      getDreamTrace: () => undefined,
      ...controls,
    } as never,
    {},
  );
  activeServers.push(uiServer);

  const rawServer = (uiServer as unknown as { server: Server }).server;
  const listening = new Promise<void>((resolve) => {
    rawServer.once("listening", () => resolve());
  });

  uiServer.start();
  await listening;

  const address = rawServer.address();
  if (!address || typeof address === "string") {
    throw new Error("UI server did not expose a TCP port");
  }

  return `http://127.0.0.1:${address.port}/clawxmemory`;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const uiServer = activeServers.pop();
    if (!uiServer) continue;

    const rawServer = (uiServer as unknown as { server: Server }).server;
    const closed = rawServer.listening
      ? new Promise<void>((resolve) => {
          rawServer.once("close", () => resolve());
        })
      : Promise.resolve();

    uiServer.stop();
    await closed;
  }
});

describe("LocalUiServer static assets", () => {
  it("serves dashboard html with favicon and logo branding", async () => {
    const baseUrl = await startUiServer();

    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain('rel="icon"');
    expect(html).toContain("./assets/brand/logo.png");
    expect(html).toContain('data-page="memory_trace"');
    expect(html).toContain('id="memoryTraceBoard"');
    expect(html).toContain('id="tmpBoard"');
    expect(html).toContain('id="dreamRunBtn"');
    expect(html).toContain('id="autoIndexIntervalHoursInput"');
    expect(html).toContain('id="autoDreamIntervalHoursInput"');
    expect(html).not.toContain('id="dreamRebuildTimeoutSecondsInput"');
    expect(html).toContain('data-page="project"');
    expect(html).toContain('data-page="user"');
    expect(html).toContain('id="projectDetailBoard"');
    expect(html).toContain('id="fileDetailBoard"');
    expect(html).toContain('id="projectDetailBackBtn"');
    expect(html).toContain('id="fileDetailBackBtn"');
    expect(html).not.toContain('id="viewToggleBtn"');
    expect(html).not.toContain('data-page="feedback"');
    expect(html).not.toContain('id="feedbackBoard"');
    expect(html).not.toContain('id="detailPanel"');
    expect(html).not.toContain('id="reasoningModeToggle"');
    expect(html).not.toContain('id="retrievePanel"');
    expect(html).not.toContain(">CX<");
    expect(html).not.toContain(">Memory<");
  });

  it("serves the brand logo as png", async () => {
    const baseUrl = await startUiServer();

    const response = await fetch(`${baseUrl}/assets/brand/logo.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("serves a product-shaped overview with summarized dashboard diagnostics", async () => {
    const baseUrl = await startUiServer({
      repository: {
        getOverview: () => ({
          pendingSessions: 2,
          formalProjectCount: 3,
          userProfileCount: 1,
          tmpTotalFiles: 4,
          recentRecallTraceCount: 12,
          recentIndexTraceCount: 7,
          recentDreamTraceCount: 2,
          lastIndexedAt: "2026-04-01T00:00:00.000Z",
          lastDreamAt: "2026-04-01T01:00:00.000Z",
          lastDreamStatus: "success",
          lastDreamSummary: "Dream complete",
        }),
      },
      controls: {
        getRuntimeOverview: () => ({
          runtimeIssues: ["workspace USER.md should be isolated from OpenClaw bootstrap memory"],
          managedWorkspaceFiles: [
            {
              name: "MEMORY.md",
              originalPath: "/tmp/workspace/MEMORY.md",
              managedPath: "/tmp/.managed/MEMORY.md",
              hash: "hash-memory",
              isolatedAt: "2026-04-01T00:00:00.000Z",
              status: "isolated",
            },
            {
              name: "USER.md",
              originalPath: "/tmp/workspace/USER.md",
              managedPath: "/tmp/.managed/USER.md",
              hash: "hash-user",
              isolatedAt: "2026-04-01T00:00:00.000Z",
              status: "conflict",
              conflictPath: "/tmp/workspace/USER.conflict.md",
            },
          ],
          startupRepairMessage: "repair pending",
        }),
      },
    });

    const response = await fetch(`${baseUrl}/api/overview`);
    expect(response.status).toBe(200);
    const overview = await response.json();

    expect(overview).toMatchObject({
      pendingSessions: 2,
      formalProjectCount: 3,
      userProfileCount: 1,
      tmpTotalFiles: 4,
      dashboardStatus: "conflict",
      dashboardDiagnostics: {
        issues: ["workspace USER.md should be isolated from OpenClaw bootstrap memory"],
        conflictingFiles: [
          {
            name: "USER.md",
            conflictPath: "/tmp/workspace/USER.conflict.md",
          },
        ],
        startupRepairMessage: "repair pending",
      },
    });
    expect(overview.dashboardWarning).toContain("USER.md");
    expect(overview.dashboardWarning).not.toContain("MEMORY.md");
    expect(overview.managedWorkspaceFiles).toBeUndefined();
    expect(overview.runtimeIssues).toBeUndefined();
    expect(overview.slotOwner).toBeUndefined();
  });

  it("routes POST /api/memory/actions to manual memory mutation controls", async () => {
    const runMemoryAction = vi.fn().mockResolvedValue({
      ok: true,
      action: "edit_project_meta",
      updatedOverview: {
        pendingSessions: 0,
        formalProjectCount: 1,
        userProfileCount: 1,
        tmpTotalFiles: 0,
      },
      mutatedIds: ["projects/proj-a/project.meta.md"],
      deletedProjectIds: [],
      messages: ["Updated project meta."],
    });
    const baseUrl = await startUiServer({
      controls: {
        runMemoryAction,
      },
    });

    const response = await fetch(`${baseUrl}/api/memory/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "edit_project_meta",
        projectId: "proj-a",
        projectName: "Project Renamed",
        description: "Project A description",
        aliases: ["Project A"],
        status: "active",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(runMemoryAction).toHaveBeenCalledWith({
      action: "edit_project_meta",
      projectId: "proj-a",
      projectName: "Project Renamed",
      description: "Project A description",
      aliases: ["Project A"],
      status: "active",
    });
  });

  it("routes edit_entry payloads with structured fields", async () => {
    const runMemoryAction = vi.fn().mockResolvedValue({
      ok: true,
      action: "edit_entry",
      updatedOverview: {
        pendingSessions: 0,
        formalProjectCount: 1,
        userProfileCount: 1,
        tmpTotalFiles: 0,
      },
      mutatedIds: ["projects/proj-a/Project/current-stage.md"],
      deletedProjectIds: [],
      messages: ["Updated memory entry."],
    });
    const baseUrl = await startUiServer({
      controls: {
        runMemoryAction,
      },
    });

    const response = await fetch(`${baseUrl}/api/memory/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "edit_entry",
        id: "projects/proj-a/Project/current-stage.md",
        name: "current-stage",
        description: "项目进入模板验证阶段",
        fields: {
          stage: "项目进入模板验证阶段",
          nextSteps: ["补充模板", "验证封面"],
          notes: ["保留中文输出"],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(runMemoryAction).toHaveBeenCalledWith({
      action: "edit_entry",
      id: "projects/proj-a/Project/current-stage.md",
      name: "current-stage",
      description: "项目进入模板验证阶段",
      fields: {
        stage: "项目进入模板验证阶段",
        nextSteps: ["补充模板", "验证封面"],
        notes: ["保留中文输出"],
      },
    });
  });

  it("rejects invalid POST /api/memory/actions payloads", async () => {
    const baseUrl = await startUiServer();

    const response = await fetch(`${baseUrl}/api/memory/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "archive_tmp",
        ids: ["projects/_tmp/Feedback/delivery-rule.md"],
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("archive_tmp requires targetProjectId or newProjectName");
  });

  it("warns with uiPort config instructions when the dashboard port is already in use", async () => {
    const baseUrl = await startUiServer();
    const occupiedPort = Number(new URL(baseUrl).port);
    const warn = vi.fn();

    const conflictingServer = new LocalUiServer(
      {} as never,
      {} as never,
      { host: "127.0.0.1", port: occupiedPort, prefix: "/clawxmemory" },
      {} as never,
      { warn },
    );
    activeServers.push(conflictingServer);

    conflictingServer.start();

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`port ${occupiedPort} is already in use`));
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("plugins.entries.openbmb-clawxmemory.config.uiPort"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("~/.edgeclaw/openclaw.json"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OPENCLAW_CONFIG_PATH"));
  });

  it("serves recent case traces and removes the old retrieve endpoint", async () => {
    const caseRecord = {
      caseId: "case-1",
      sessionKey: "session-a",
      query: "我上周项目进展如何",
      startedAt: "2026-04-01T00:00:00.000Z",
      finishedAt: "2026-04-01T00:00:02.000Z",
      status: "completed",
      toolEvents: [],
      assistantReply: "上周主要在推进检索链路改造。",
      retrieval: {
        intent: "project_memory",
        injected: true,
        contextPreview: "## Evidence Note",
        trace: {
          traceId: "trace-1",
          query: "我上周项目进展如何",
          mode: "auto",
          startedAt: "2026-04-01T00:00:00.000Z",
          finishedAt: "2026-04-01T00:00:01.000Z",
          steps: [],
        },
      },
    };
    const baseUrl = await startUiServer({
      controls: {
        listCaseTraces: () => [caseRecord],
        getCaseTrace: (caseId: string) => (caseId === "case-1" ? caseRecord : undefined),
      },
    });

    const listResponse = await fetch(`${baseUrl}/api/cases`);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([caseRecord]);

    const detailResponse = await fetch(`${baseUrl}/api/cases/case-1`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual(caseRecord);

    const removedResponse = await fetch(`${baseUrl}/api/retrieve?q=test`);
    expect(removedResponse.status).toBe(404);
  });

  it("serves recent index traces", async () => {
    const indexTraceRecord = {
      indexTraceId: "index-trace-1",
      sessionKey: "session-a",
      trigger: "manual_sync",
      startedAt: "2026-04-01T00:00:00.000Z",
      finishedAt: "2026-04-01T00:00:01.000Z",
      status: "completed",
      batchSummary: {
        l0Ids: ["l0-1", "l0-2"],
        segmentCount: 2,
        focusUserTurnCount: 2,
        fromTimestamp: "2026-04-01T00:00:00.000Z",
        toTimestamp: "2026-04-01T00:01:00.000Z",
      },
      steps: [],
      storedResults: [
        {
          candidateType: "feedback",
          candidateName: "delivery-rule",
          scope: "project",
          projectId: "_tmp",
          relativePath: "projects/_tmp/Feedback/delivery-rule.md",
          storageKind: "tmp_feedback",
        },
      ],
    };
    const baseUrl = await startUiServer({
      controls: {
        listIndexTraces: () => [indexTraceRecord],
        getIndexTrace: (indexTraceId: string) => (indexTraceId === "index-trace-1" ? indexTraceRecord : undefined),
      },
    });

    const listResponse = await fetch(`${baseUrl}/api/index-traces`);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([indexTraceRecord]);

    const detailResponse = await fetch(`${baseUrl}/api/index-traces/index-trace-1`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual(indexTraceRecord);
  });

  it("serves recent dream traces", async () => {
    const dreamTraceRecord = {
      dreamTraceId: "dream-trace-1",
      trigger: "manual",
      startedAt: "2026-04-01T00:00:00.000Z",
      finishedAt: "2026-04-01T00:00:02.000Z",
      status: "completed",
      snapshotSummary: {
        formalProjectCount: 1,
        tmpProjectCount: 1,
        tmpFeedbackCount: 1,
        formalProjectFileCount: 1,
        formalFeedbackFileCount: 1,
        hasUserProfile: true,
      },
      steps: [],
      mutations: [
        {
          mutationId: "mutation-1",
          action: "delete",
          relativePath: "projects/_tmp/Feedback/delivery-rule.md",
          candidateType: "feedback",
          name: "delivery-rule",
          description: "交付顺序要求",
          preview: "先给3个标题，再给正文。",
        },
      ],
      outcome: {
        rewrittenProjects: 1,
        deletedProjects: 0,
        deletedFiles: 1,
        profileUpdated: false,
        summary: "Dream reorganized one project and deleted one redundant file.",
      },
    };
    const baseUrl = await startUiServer({
      controls: {
        listDreamTraces: () => [dreamTraceRecord],
        getDreamTrace: (dreamTraceId: string) => (dreamTraceId === "dream-trace-1" ? dreamTraceRecord : undefined),
      },
    });

    const listResponse = await fetch(`${baseUrl}/api/dream-traces`);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([dreamTraceRecord]);

    const detailResponse = await fetch(`${baseUrl}/api/dream-traces/dream-trace-1`);
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toEqual(dreamTraceRecord);
  });

  it("routes manual Dream runs through POST /api/dream/run", async () => {
    const runDreamNow = vi.fn().mockResolvedValue({
      prepFlush: {
        capturedSessions: 1,
        writtenFiles: 1,
        writtenProjectFiles: 1,
        writtenFeedbackFiles: 0,
        userProfilesUpdated: 1,
        failedSessions: 0,
      },
      reviewedFiles: 12,
      rewrittenProjects: 3,
      deletedProjects: 1,
      deletedFiles: 2,
      profileUpdated: true,
      duplicateTopicCount: 2,
      conflictTopicCount: 1,
      summary: "Dream finished",
    });
    const baseUrl = await startUiServer({ controls: { runDreamNow } });

    const postResponse = await fetch(`${baseUrl}/api/dream/run`, { method: "POST" });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      reviewedFiles: 12,
      rewrittenProjects: 3,
      deletedProjects: 1,
      profileUpdated: true,
    });
    expect(runDreamNow).toHaveBeenCalledTimes(1);

    const getResponse = await fetch(`${baseUrl}/api/dream/run`);
    expect(getResponse.status).toBe(405);
  });

  it("serves file-memory list/get/user-summary APIs", async () => {
    const projectEntry = {
      name: "current-stage",
      description: "Current stage and blockers",
      type: "project",
      scope: "project",
      projectId: "proj-a",
      updatedAt: "2026-04-01T00:00:00.000Z",
      file: "current-stage.md",
      relativePath: "projects/proj-a/Project/current-stage.md",
      absolutePath: "/tmp/projects/proj-a/Project/current-stage.md",
    };
    const projectRecord = {
      ...projectEntry,
      content: "## Current Stage\nshipping v1",
      preview: "shipping v1",
    };
    const userSummary = {
      profile: "Prefers concise technical writing.",
      preferences: ["TypeScript"],
      constraints: ["Avoid fluff"],
      relationships: [],
      files: [],
    };

    const baseUrl = await startUiServer({
      repository: {
        listMemoryEntries: vi.fn().mockReturnValue([projectEntry]),
        getMemoryRecordsByIds: vi.fn().mockReturnValue([projectRecord]),
        getFileMemoryStore: () => ({
          getUserSummary: () => userSummary,
        }),
      },
    });

    const listResponse = await fetch(`${baseUrl}/api/memory/list?kind=project&q=shipping&projectId=proj-a`);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([projectEntry]);

    const getResponse = await fetch(`${baseUrl}/api/memory/get?ids=${encodeURIComponent(projectEntry.relativePath)}`);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual([projectRecord]);

    const summaryResponse = await fetch(`${baseUrl}/api/memory/user-summary`);
    expect(summaryResponse.status).toBe(200);
    await expect(summaryResponse.json()).resolves.toEqual(userSummary);
  });

  it("serves tmp staged memory separately from formal projects", async () => {
    const tmpProjectRecord = {
      name: "Aster",
      description: "Move OpenClaw memory to markdown files",
      type: "project",
      scope: "project",
      projectId: "_tmp",
      updatedAt: "2026-04-09T11:13:53.477Z",
      capturedAt: "2026-04-09T11:13:50.000Z",
      sourceSessionKey: "session-aster",
      dreamAttempts: 1,
      file: "aster.md",
      relativePath: "projects/_tmp/Project/aster.md",
      absolutePath: "/tmp/memory/projects/_tmp/Project/aster.md",
      content: "## Current Stage\nMove the memory system to markdown files.",
      preview: "Move the memory system to markdown files.",
    };
    const tmpFeedbackRecord = {
      name: "collaboration-rule",
      description: "Status updates should lead with completed work and then risks.",
      type: "feedback",
      scope: "project",
      projectId: "_tmp",
      updatedAt: "2026-04-09T11:13:53.480Z",
      capturedAt: "2026-04-09T11:13:51.000Z",
      sourceSessionKey: "session-aster",
      dreamAttempts: 2,
      file: "collaboration-rule.md",
      relativePath: "projects/_tmp/Feedback/collaboration-rule.md",
      absolutePath: "/tmp/memory/projects/_tmp/Feedback/collaboration-rule.md",
      content: "## Rule\nLead with completed work.\n\n## Why\n\n## How to apply\n在这个项目里给我同步进展时\n",
      preview: "Lead with completed work.",
    };

    const baseUrl = await startUiServer({
      repository: {
        listMemoryEntries: vi.fn().mockImplementation((options: Record<string, unknown>) => {
          if (options.projectId === "_tmp" && options.includeTmp === true) {
            return [tmpFeedbackRecord, tmpProjectRecord];
          }
          return [];
        }),
        getMemoryRecordsByIds: vi.fn().mockReturnValue([tmpProjectRecord, tmpFeedbackRecord]),
        getFileMemoryStore: () => ({
          getUserSummary: () => ({
            profile: "",
            preferences: [],
            constraints: [],
            relationships: [],
            files: [],
          }),
          getRootDir: () => "/tmp/memory",
          listProjectMetas: () => [],
        }),
      },
    });

    const response = await fetch(`${baseUrl}/api/tmp`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        manifestPath: "projects/_tmp/MEMORY.md",
        totalFiles: 2,
        totalProjects: 1,
        totalFeedback: 1,
        projectEntries: [tmpProjectRecord],
        feedbackEntries: [tmpFeedbackRecord],
      }),
    );
  });

  it("serves project-centric grouped memory for the dashboard", async () => {
    const projectEntry = {
      name: "Aster",
      description: "Move OpenClaw memory to markdown files",
      type: "project",
      scope: "project",
      projectId: "proj-aster",
      updatedAt: "2026-04-09T11:13:53.477Z",
      file: "aster.md",
      relativePath: "projects/proj-aster/Project/aster.md",
      absolutePath: "/tmp/projects/proj-aster/Project/aster.md",
    };
    const feedbackEntry = {
      name: "collaboration-rule",
      description: "Status updates should lead with completed work and then risks.",
      type: "feedback",
      scope: "project",
      projectId: "proj-aster",
      updatedAt: "2026-04-09T11:13:53.480Z",
      file: "collaboration-rule.md",
      relativePath: "projects/proj-aster/Feedback/collaboration-rule.md",
      absolutePath: "/tmp/projects/proj-aster/Feedback/collaboration-rule.md",
    };

    const baseUrl = await startUiServer({
      repository: {
        listMemoryEntries: vi.fn().mockImplementation((options: Record<string, unknown>) => {
          if (options.projectId === "proj-aster") return [feedbackEntry, projectEntry];
          return [];
        }),
        getFileMemoryStore: () => ({
          getUserSummary: () => ({
            profile: "",
            preferences: [],
            constraints: [],
            relationships: [],
            files: [],
          }),
          listProjectMetas: () => [
            {
              projectId: "proj-aster",
              projectName: "Aster",
              description: "Move OpenClaw memory to markdown files",
              aliases: ["Aster"],
              status: "active",
              createdAt: "2026-04-09T11:13:53.470Z",
              updatedAt: "2026-04-09T11:13:53.477Z",
              relativePath: "projects/proj-aster/project.meta.md",
              absolutePath: "/tmp/projects/proj-aster/project.meta.md",
            },
          ],
        }),
      },
    });

    const response = await fetch(`${baseUrl}/api/projects`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        projectId: "proj-aster",
        projectName: "Aster",
        projectCount: 1,
        feedbackCount: 1,
        projectEntries: [projectEntry],
        feedbackEntries: [feedbackEntry],
      }),
    ]);
  });

  it("round-trips indexing settings through /api/settings", async () => {
    const saveSettings = vi.fn().mockImplementation((partial: Record<string, unknown>) => ({
      reasoningMode: partial.reasoningMode ?? "accuracy_first",
      autoIndexIntervalMinutes: partial.autoIndexIntervalMinutes ?? 120,
      autoDreamIntervalMinutes: partial.autoDreamIntervalMinutes ?? 360,
    }));
    const baseUrl = await startUiServer({
      controls: {
        getSettings: () => ({
          reasoningMode: "answer_first",
          autoIndexIntervalMinutes: 60,
          autoDreamIntervalMinutes: 360,
        }),
        saveSettings,
      },
    });

    const getResponse = await fetch(`${baseUrl}/api/settings`);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      reasoningMode: "answer_first",
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
    });

    const postResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reasoningMode: "accuracy_first",
        autoIndexIntervalMinutes: 120,
        autoDreamIntervalMinutes: 180,
      }),
    });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      reasoningMode: "accuracy_first",
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 180,
    });
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      reasoningMode: "accuracy_first",
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 180,
    }));
  });
});

describe("LocalUiServer API", () => {
  it("delegates clear requests to runtime controls instead of clearing the repository directly", async () => {
    const clearMemoryNow = vi.fn().mockResolvedValue({
      cleared: {
        l0: 6,
        pipelineState: 7,
        memoryFiles: 8,
        projectMetas: 2,
      },
      clearedAt: "2026-04-10T00:00:00.000Z",
    });
    const repository = {
      ...createDefaultRepository(),
      clearAllMemoryData: vi.fn(() => {
        throw new Error("repository.clearAllMemoryData should not be called directly");
      }),
    };
    const baseUrl = await startUiServer({
      controls: { clearMemoryNow },
      repository,
    });

    const response = await fetch(`${baseUrl}/api/clear`, { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      clearedAt: "2026-04-10T00:00:00.000Z",
      cleared: expect.objectContaining({
        l0: 6,
        pipelineState: 7,
      }),
    });
    expect(clearMemoryNow).toHaveBeenCalledTimes(1);
  });
});
