import { beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { initDashboard, statsHttpHandler } from "../src/stats-dashboard.js";
import {
  __resetUsageIntelForTests,
  recordFinalReply,
  recordRouterOperation,
} from "../src/usage-intel.js";
import {
  __resetLoopDetectionLevelForTests,
  finalizeLoop,
  recordLoopDetection,
} from "../src/loop-detection-level.js";

type MockResponse = {
  statusCode: number;
  body: string;
};

async function callStats(path: string): Promise<{ handled: boolean } & MockResponse> {
  const req = {
    method: "GET",
    url: path,
  } as IncomingMessage;

  let statusCode = 200;
  let body = "";
  const res = {
    writeHead(code: number) {
      statusCode = code;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk != null) {
        body = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      }
      return this;
    },
  } as unknown as ServerResponse;

  const handled = await statsHttpHandler(req, res);
  return { handled, statusCode, body };
}

describe("stats-dashboard new REST endpoints", () => {
  beforeEach(() => {
    __resetUsageIntelForTests();
    __resetLoopDetectionLevelForTests();
    initDashboard({
      pluginId: "guardclaw",
      pluginConfig: {},
      pipeline: null,
    });
  });

  it("returns 404 when latest turn tokens are unavailable", async () => {
    const resp = await callStats("/plugins/guardclaw/stats/api/last-turn-tokens");
    expect(resp.handled).toBe(true);
    expect(resp.statusCode).toBe(404);
  });

  it("returns last-turn tokens and reply origin with loop totals", async () => {
    const sessionKey = "main:user:api-test";
    recordRouterOperation(
      sessionKey,
      "detection",
      { input: 8, output: 2, total: 10 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordRouterOperation(
      sessionKey,
      "desensitization",
      { input: 5, output: 1, total: 6 },
      "openbmb/minicpm4.1",
      "ollama",
    );
    recordFinalReply({
      sessionKey,
      provider: "openai",
      model: "gpt-4o",
      usage: { input: 40, output: 20, total: 60 },
      originHint: "cloud",
    });

    const turnResp = await callStats(
      `/plugins/guardclaw/stats/api/last-turn-tokens?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    expect(turnResp.statusCode).toBe(200);
    const turn = JSON.parse(turnResp.body) as {
      combined: { total: number };
      detection: { total: number };
      desensitization: { total: number };
    };
    expect(turn.detection.total).toBe(10);
    expect(turn.desensitization.total).toBe(6);
    expect(turn.combined.total).toBe(16);

    const originResp = await callStats(
      `/plugins/guardclaw/stats/api/reply-model-origin?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    expect(originResp.statusCode).toBe(200);
    const origin = JSON.parse(originResp.body) as {
      origin: "local" | "cloud";
      loopTotalTokens: { total: number };
      loopLocalTokens: { total: number };
      loopCloudTokens: { total: number };
      routerTokens: { combined: { total: number } };
    };
    expect(origin.origin).toBe("cloud");
    expect(origin.loopLocalTokens.total).toBe(16);
    expect(origin.loopCloudTokens.total).toBe(60);
    expect(origin.loopTotalTokens.total).toBe(76);
    expect(origin.routerTokens.combined.total).toBe(16);
  });

  it("returns current loop highest level for in-progress and completed states", async () => {
    const sessionKey = "main:user:loop-api";
    recordLoopDetection(sessionKey, "S1");
    recordLoopDetection(sessionKey, "S3");

    const inProgressResp = await callStats(
      `/plugins/guardclaw/stats/api/current-loop-highest-level?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    expect(inProgressResp.statusCode).toBe(200);
    const inProgress = JSON.parse(inProgressResp.body) as {
      loopState: "in_progress" | "completed" | "idle";
      highestLevel: "S1" | "S2" | "S3";
      eventCount: number;
    };
    expect(inProgress.loopState).toBe("in_progress");
    expect(inProgress.highestLevel).toBe("S3");
    expect(inProgress.eventCount).toBe(2);

    finalizeLoop(sessionKey);
    const completedResp = await callStats(
      `/plugins/guardclaw/stats/api/current-loop-highest-level?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    expect(completedResp.statusCode).toBe(200);
    const completed = JSON.parse(completedResp.body) as {
      loopState: "in_progress" | "completed" | "idle";
      highestLevel: "S1" | "S2" | "S3";
    };
    expect(completed.loopState).toBe("completed");
    expect(completed.highestLevel).toBe("S3");
  });
});
