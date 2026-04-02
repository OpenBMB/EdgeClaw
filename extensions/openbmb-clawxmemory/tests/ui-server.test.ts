import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalUiServer } from "../src/ui-server.js";

const activeServers: LocalUiServer[] = [];

async function startUiServer(controls: Record<string, unknown> = {}): Promise<string> {
  const uiServer = new LocalUiServer(
    {} as never,
    {} as never,
    { host: "127.0.0.1", port: 0, prefix: "/clawxmemory" },
    {
      getSettings: () => ({
        reasoningMode: "answer_first",
        recallTopK: 10,
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
        autoDreamMinNewL1: 10,
      }),
      saveSettings: () => ({
        reasoningMode: "answer_first",
        recallTopK: 10,
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
        autoDreamMinNewL1: 10,
      }),
      runIndexNow: async () => ({
        l0Captured: 0,
        l1Created: 0,
        l2TimeUpdated: 0,
        l2ProjectUpdated: 0,
        profileUpdated: 0,
        failed: 0,
      }),
      runDreamNow: async () => ({
        prepFlush: {
          l0Captured: 0,
          l1Created: 0,
          l2TimeUpdated: 0,
          l2ProjectUpdated: 0,
          profileUpdated: 0,
          failed: 0,
        },
        reviewedL1: 0,
        rewrittenProjects: 0,
        deletedProjects: 0,
        profileUpdated: false,
        duplicateTopicCount: 0,
        conflictTopicCount: 0,
        prunedProjectL1Refs: 0,
        prunedProfileL1Refs: 0,
        summary: "noop",
      }),
      exportMemoryBundle: () => ({ exportedAt: "2026-04-01T00:00:00.000Z" }),
      importMemoryBundle: async () => ({ imported: {} }),
      getRuntimeOverview: () => ({
        queuedSessions: 0,
        lastRecallMs: 0,
        recallTimeouts: 0,
        lastRecallMode: "none",
        currentReasoningMode: "answer_first",
      }),
      getStartupRepairSnapshot: () => undefined,
      listCaseTraces: () => [],
      getCaseTrace: () => undefined,
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
    expect(html).toContain('data-board="memory_trace"');
    expect(html).toContain('id="memoryTraceBoard"');
    expect(html).toContain('data-level="memory_trace"');
    expect(html).toContain('id="dreamRunBtn"');
    expect(html).toContain('id="autoIndexIntervalHoursInput"');
    expect(html).toContain('id="autoDreamIntervalHoursInput"');
    expect(html).toContain('id="autoDreamMinL1Input"');
    expect(html.indexOf('data-board="profile"')).toBeLessThan(
      html.indexOf('data-board="memory_trace"'),
    );
    expect(html.indexOf('data-level="profile"')).toBeLessThan(
      html.indexOf('data-level="memory_trace"'),
    );
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
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`port ${occupiedPort} is already in use`),
      );
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("plugins.entries.openbmb-clawxmemory.config.uiPort"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("~/.openclaw/openclaw.json"));
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
        intent: "project",
        enoughAt: "l1",
        injected: true,
        contextPreview: "## Evidence Note",
        evidenceNotePreview: "上周主要在推进检索链路改造。",
        pathSummary: "l2->l1",
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
      listCaseTraces: () => [caseRecord],
      getCaseTrace: (caseId: string) => (caseId === "case-1" ? caseRecord : undefined),
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

  it("routes manual Dream runs through POST /api/dream/run", async () => {
    const runDreamNow = vi.fn().mockResolvedValue({
      prepFlush: {
        l0Captured: 1,
        l1Created: 1,
        l2TimeUpdated: 0,
        l2ProjectUpdated: 1,
        profileUpdated: 1,
        failed: 0,
      },
      reviewedL1: 12,
      rewrittenProjects: 3,
      deletedProjects: 1,
      profileUpdated: true,
      duplicateTopicCount: 2,
      conflictTopicCount: 1,
      prunedProjectL1Refs: 4,
      prunedProfileL1Refs: 2,
      summary: "Dream finished",
    });
    const baseUrl = await startUiServer({ runDreamNow });

    const postResponse = await fetch(`${baseUrl}/api/dream/run`, { method: "POST" });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      reviewedL1: 12,
      rewrittenProjects: 3,
      deletedProjects: 1,
      profileUpdated: true,
    });
    expect(runDreamNow).toHaveBeenCalledTimes(1);

    const getResponse = await fetch(`${baseUrl}/api/dream/run`);
    expect(getResponse.status).toBe(405);
  });

  it("round-trips expanded indexing settings through /api/settings", async () => {
    const saveSettings = vi.fn().mockImplementation((partial: Record<string, unknown>) => ({
      reasoningMode: partial.reasoningMode ?? "accuracy_first",
      recallTopK: partial.recallTopK ?? 12,
      autoIndexIntervalMinutes: partial.autoIndexIntervalMinutes ?? 120,
      autoDreamIntervalMinutes: partial.autoDreamIntervalMinutes ?? 360,
      autoDreamMinNewL1: partial.autoDreamMinNewL1 ?? 10,
    }));
    const baseUrl = await startUiServer({
      getSettings: () => ({
        reasoningMode: "answer_first",
        recallTopK: 10,
        autoIndexIntervalMinutes: 60,
        autoDreamIntervalMinutes: 360,
        autoDreamMinNewL1: 10,
      }),
      saveSettings,
    });

    const getResponse = await fetch(`${baseUrl}/api/settings`);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      reasoningMode: "answer_first",
      recallTopK: 10,
      autoIndexIntervalMinutes: 60,
      autoDreamIntervalMinutes: 360,
      autoDreamMinNewL1: 10,
    });

    const postResponse = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reasoningMode: "accuracy_first",
        recallTopK: 12,
        autoIndexIntervalMinutes: 120,
        autoDreamIntervalMinutes: 180,
        autoDreamMinNewL1: 15,
      }),
    });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      reasoningMode: "accuracy_first",
      recallTopK: 12,
      autoIndexIntervalMinutes: 120,
      autoDreamIntervalMinutes: 180,
      autoDreamMinNewL1: 15,
    });
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningMode: "accuracy_first",
        recallTopK: 12,
        autoIndexIntervalMinutes: 120,
        autoDreamIntervalMinutes: 180,
        autoDreamMinNewL1: 15,
      }),
    );
  });
});
