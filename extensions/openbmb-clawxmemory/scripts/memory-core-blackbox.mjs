#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveConfigPath, resolveStateDir } from "./state-paths.mjs";

const DEFAULT_OPENCLAW_CONFIG_PATH = resolveConfigPath();
const OPENCLAW_STATE_DIR = resolveStateDir();
const OPENCLAW_CONFIG_META = await loadOpenClawConfigMeta();
const DEFAULT_UI_PORT = OPENCLAW_CONFIG_META.uiPort || 39393;
const UI_BASE = process.env.CLAWXMEMORY_UI_BASE || `http://127.0.0.1:${DEFAULT_UI_PORT}/clawxmemory`;
const REPORT_PATH = process.env.CLAWXMEMORY_BLACKBOX_REPORT || "/tmp/clawxmemory-blackbox-memory-core-report.json";
const OPENCLAW_TIMEOUT_SECONDS = process.env.CLAWXMEMORY_AGENT_TIMEOUT || "300";
const OPENCLAW_COOLDOWN_MS = Number.parseInt(process.env.CLAWXMEMORY_AGENT_COOLDOWN_MS || "4000", 10);
const HTTP_TIMEOUT_MS = Number.parseInt(process.env.CLAWXMEMORY_HTTP_TIMEOUT_MS || "600000", 10);
const HTTP_RETRY_LIMIT = Number.parseInt(process.env.CLAWXMEMORY_HTTP_RETRY_LIMIT || "5", 10);
const HTTP_RETRY_BACKOFF_MS = Number.parseInt(process.env.CLAWXMEMORY_HTTP_RETRY_BACKOFF_MS || "4000", 10);
const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = Number.parseInt(process.env.CLAWXMEMORY_DASHBOARD_BOOTSTRAP_TIMEOUT_MS || "120000", 10);
const DASHBOARD_BOOTSTRAP_INTERVAL_MS = Number.parseInt(process.env.CLAWXMEMORY_DASHBOARD_BOOTSTRAP_INTERVAL_MS || "3000", 10);
const INDEX_IDLE_TIMEOUT_MS = Number.parseInt(process.env.CLAWXMEMORY_INDEX_IDLE_TIMEOUT_MS || "120000", 10);
const INDEX_IDLE_QUIET_MS = Number.parseInt(process.env.CLAWXMEMORY_INDEX_IDLE_QUIET_MS || "5000", 10);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadOpenClawConfigMeta() {
  try {
    const raw = await readFile(DEFAULT_OPENCLAW_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const uiPort = parsed?.plugins?.entries?.["openbmb-clawxmemory"]?.config?.uiPort;
    return {
      configPath: DEFAULT_OPENCLAW_CONFIG_PATH,
      uiPort: Number.isFinite(Number(uiPort)) ? Number(uiPort) : null,
      stateDir: OPENCLAW_STATE_DIR,
    };
  } catch {
    return {
      configPath: DEFAULT_OPENCLAW_CONFIG_PATH,
      uiPort: null,
      stateDir: OPENCLAW_STATE_DIR,
    };
  }
}

function commandToString(command, args) {
  return [command, ...args].join(" ");
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  const { cwd = REPO_ROOT, timeoutMs = Math.max(420_000, Number(OPENCLAW_TIMEOUT_SECONDS) * 1000 + 120_000) } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "pipe",
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`${commandToString(command, args)} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${commandToString(command, args)} failed (${code})\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runCommandAllowFailure(command, args, options = {}) {
  try {
    return await runCommand(command, args, options);
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      failed: true,
    };
  }
}

function shouldRetryResponse(status) {
  return status === 429 || status >= 500;
}

async function parseErrorText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function requestJson(pathname, init = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= HTTP_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch(`${UI_BASE}${pathname}`, {
        ...init,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await parseErrorText(response);
        const error = new Error(`${pathname} failed (${response.status})\n${body}`);
        if (attempt < HTTP_RETRY_LIMIT && shouldRetryResponse(response.status)) {
          lastError = error;
          await sleep(HTTP_RETRY_BACKOFF_MS * attempt);
          continue;
        }
        throw error;
      }
      return response.json();
    } catch (error) {
      const isAbort = error?.name === "TimeoutError" || error?.name === "AbortError" || String(error?.message ?? "").includes("aborted due to timeout");
      if (attempt < HTTP_RETRY_LIMIT && isAbort) {
        lastError = error;
        await sleep(HTTP_RETRY_BACKOFF_MS * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error(`requestJson(${pathname}) failed`);
}

async function getJson(pathname) {
  return requestJson(pathname);
}

async function postJson(pathname, body = undefined) {
  return requestJson(pathname, {
    method: "POST",
    headers: body == null ? {} : { "content-type": "application/json" },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
}

async function writeReport(report) {
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

async function sendAgentMessage(sessionId, message) {
  await runCommand("openclaw", [
    "agent",
    "--agent",
    "main",
    "--session-id",
    sessionId,
    "--message",
    message,
    "--thinking",
    "off",
    "--timeout",
    String(OPENCLAW_TIMEOUT_SECONDS),
    "--json",
  ]);
  if (Number.isFinite(OPENCLAW_COOLDOWN_MS) && OPENCLAW_COOLDOWN_MS > 0) {
    await sleep(OPENCLAW_COOLDOWN_MS);
  }
}

async function bootstrapDashboardIfNeeded() {
  const startedAt = Date.now();
  let bootstrapped = false;
  while (Date.now() - startedAt < DASHBOARD_BOOTSTRAP_TIMEOUT_MS) {
    try {
      await requestJson("/api/overview");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isConnectionRefused = /connection refused|fetch failed|Failed to fetch|ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(message);
      if (!bootstrapped || isConnectionRefused) {
        bootstrapped = true;
        await runCommandAllowFailure("openclaw", [
          "agent",
          "--agent",
          "main",
          "--session-id",
          "clawxmemory-blackbox-bootstrap",
          "--message",
          "这是一次 ClawXMemory 黑盒启动探活。只回复“ok”。",
          "--thinking",
          "off",
          "--timeout",
          String(OPENCLAW_TIMEOUT_SECONDS),
          "--json",
        ], {
          timeoutMs: Math.max(180_000, Number(OPENCLAW_TIMEOUT_SECONDS) * 1000 + 60_000),
        });
      }
    }
    await sleep(DASHBOARD_BOOTSTRAP_INTERVAL_MS);
  }
  throw new Error(`ClawXMemory dashboard did not become ready at ${UI_BASE} within ${DASHBOARD_BOOTSTRAP_TIMEOUT_MS}ms`);
}

async function waitForIndexIdle() {
  const startedAt = Date.now();
  let lastSignature = "";
  let stableStartedAt = 0;
  while (Date.now() - startedAt < INDEX_IDLE_TIMEOUT_MS) {
    const overview = await getJson("/api/overview");
    const signature = JSON.stringify({
      pendingSessions: Number(overview?.pendingSessions ?? 0),
      recentIndexTraceCount: Number(overview?.recentIndexTraceCount ?? 0),
      lastIndexedAt: overview?.lastIndexedAt ?? "",
      tmpTotalFiles: Number(overview?.tmpTotalFiles ?? 0),
      formalProjectCount: Number(overview?.formalProjectCount ?? 0),
      userProfileCount: Number(overview?.userProfileCount ?? 0),
    });
    if (signature === lastSignature) {
      if (stableStartedAt === 0) stableStartedAt = Date.now();
      if (Date.now() - stableStartedAt >= INDEX_IDLE_QUIET_MS) {
        return overview;
      }
    } else {
      lastSignature = signature;
      stableStartedAt = Date.now();
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ClawXMemory background indexing state to settle within ${INDEX_IDLE_TIMEOUT_MS}ms`);
}

async function waitForCase(query, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const cases = await getJson("/api/cases?limit=120");
    const match = Array.isArray(cases)
      ? [...cases].reverse().find((item) => item?.query === query)
      : undefined;
    if (match?.caseId) {
      return getJson(`/api/cases/${encodeURIComponent(match.caseId)}`);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for recall case: ${query}`);
}

async function runRecallCase(sessionId, query) {
  await sendAgentMessage(sessionId, query);
  return waitForCase(query);
}

function summarizeProjects(projects) {
  return Array.isArray(projects)
    ? projects.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      status: project.status,
      projectCount: project.projectCount,
      feedbackCount: project.feedbackCount,
      deprecatedProjectCount: Array.isArray(project.deprecatedProjectEntries) ? project.deprecatedProjectEntries.length : 0,
      deprecatedFeedbackCount: Array.isArray(project.deprecatedFeedbackEntries) ? project.deprecatedFeedbackEntries.length : 0,
      projectEntries: safeArray(project.projectEntries).map((entry) => ({
        relativePath: entry.relativePath,
        name: entry.name,
        description: entry.description,
        type: entry.type,
      })),
      feedbackEntries: safeArray(project.feedbackEntries).map((entry) => ({
        relativePath: entry.relativePath,
        name: entry.name,
        description: entry.description,
        type: entry.type,
      })),
    }))
    : [];
}

function summarizeTmp(tmpSnapshot) {
  return {
    totalFiles: tmpSnapshot?.totalFiles ?? 0,
    totalProjects: tmpSnapshot?.totalProjects ?? 0,
    totalFeedback: tmpSnapshot?.totalFeedback ?? 0,
    projectEntries: safeArray(tmpSnapshot?.projectEntries).map(summarizeEntry),
    feedbackEntries: safeArray(tmpSnapshot?.feedbackEntries).map(summarizeEntry),
    deprecatedProjectEntries: safeArray(tmpSnapshot?.deprecatedProjectEntries).map(summarizeEntry),
    deprecatedFeedbackEntries: safeArray(tmpSnapshot?.deprecatedFeedbackEntries).map(summarizeEntry),
  };
}

async function captureSnapshot(label) {
  const [overview, projects, tmp, cases, indexTraces, dreamTraces] = await Promise.all([
    getJson("/api/overview"),
    getJson("/api/projects?limit=80"),
    getJson("/api/tmp?limit=120"),
    getJson("/api/cases?limit=120"),
    getJson("/api/index-traces?limit=40"),
    getJson("/api/dream-traces?limit=40"),
  ]);
  return {
    label,
    capturedAt: nowIso(),
    overview,
    projects: summarizeProjects(projects),
    tmp: summarizeTmp(tmp),
    cases,
    indexTraces,
    dreamTraces,
  };
}

function summarizeEntry(entry) {
  return {
    relativePath: entry.relativePath,
    name: entry.name,
    description: entry.description,
    type: entry.type,
    preview: entry.preview,
  };
}

function createReport() {
  return {
    ok: false,
    generatedAt: nowIso(),
    uiBase: UI_BASE,
    openclawConfig: OPENCLAW_CONFIG_META,
    reportPath: REPORT_PATH,
    conversationA: null,
    conversationBoundary: {
      type: "none",
      reason: "explicit /new was skipped because no stable CLI reset command is available",
    },
    conversationB: null,
    afterSeed: null,
    afterIndex: null,
    afterDream: null,
    afterSecondDream: null,
    recallChecks: [],
    assertions: [],
    issues: [],
    finalState: null,
  };
}

function findProjectByName(projects, projectName) {
  return Array.isArray(projects)
    ? projects.find((project) => project?.projectName === projectName)
    : undefined;
}

function getTraceStep(caseDetail, kind) {
  const steps = caseDetail?.retrieval?.trace?.steps;
  return Array.isArray(steps) ? steps.find((step) => step?.kind === kind) : undefined;
}

function getDetail(step, key) {
  return Array.isArray(step?.details) ? step.details.find((detail) => detail?.key === key) : undefined;
}

function getKvValue(step, detailKey, label) {
  const detail = getDetail(step, detailKey);
  if (detail?.kind !== "kv" || !Array.isArray(detail.entries)) return "";
  const match = detail.entries.find((entry) => entry?.label === label);
  return match?.value == null ? "" : String(match.value);
}

function getListItems(step, detailKey) {
  const detail = getDetail(step, detailKey);
  return detail?.kind === "list" && Array.isArray(detail.items) ? detail.items : [];
}

function recallSummary(caseDetail) {
  const projectSelectedStep = getTraceStep(caseDetail, "project_selected");
  const manifestSelectedStep = getTraceStep(caseDetail, "manifest_selected");
  const filesLoadedStep = getTraceStep(caseDetail, "files_loaded");
  return {
    query: caseDetail?.query ?? "",
    intent: caseDetail?.retrieval?.intent ?? "",
    injected: Boolean(caseDetail?.retrieval?.injected),
    selectedProjectId: getKvValue(projectSelectedStep, "project-selection-summary", "project_id") || "none",
    selectedFiles: getListItems(manifestSelectedStep, "selected-files"),
    loadedFiles: getListItems(filesLoadedStep, "loaded-files"),
    contextPreview: String(caseDetail?.retrieval?.contextPreview ?? ""),
  };
}

function pushRecallCheck(report, label, caseDetail) {
  const summary = {
    label,
    ...recallSummary(caseDetail),
  };
  report.recallChecks.push(summary);
  return summary;
}

function pushIssue(report, type, label, meta = {}) {
  report.issues.push({
    type,
    label,
    ...meta,
  });
}

function recordAssertion(report, condition, label, meta = {}) {
  const passed = Boolean(condition);
  report.assertions.push({
    label,
    passed,
    ...meta,
  });
  if (!passed) {
    pushIssue(report, "assertion", label, meta);
  }
  return passed;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectTexts(record) {
  return [
    record?.name,
    record?.description,
    record?.relativePath,
    record?.preview,
    record?.content,
  ]
    .filter(Boolean)
    .join("\n");
}

function countMatching(records, matcher) {
  return safeArray(records).filter((record) => matcher(collectTexts(record))).length;
}

function textIncludesAny(text, candidates) {
  const normalized = String(text || "").toLowerCase();
  return candidates.some((item) => normalized.includes(String(item).toLowerCase()));
}

function markEnvironmentIssues(report, snapshot, label, seen) {
  const warning = snapshot?.overview?.dashboardWarning;
  if (!warning || seen.has(warning)) return;
  seen.add(warning);
  pushIssue(report, "environment", label, {
    warning,
    diagnostics: snapshot?.overview?.dashboardDiagnostics ?? null,
  });
}

async function sendConversationBlock(sessionId, messages, bucket) {
  bucket.sessionId = sessionId;
  bucket.messages = [];
  for (const message of messages) {
    bucket.messages.push(message);
    await sendAgentMessage(sessionId, message);
  }
}

async function safeRunRecall(report, label, sessionId, query) {
  try {
    const caseDetail = await runRecallCase(sessionId, query);
    return pushRecallCheck(report, label, caseDetail);
  } catch (error) {
    pushIssue(report, "recall", label, {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    const summary = {
      label,
      query,
      intent: "error",
      injected: false,
      selectedProjectId: "none",
      selectedFiles: [],
      loadedFiles: [],
      contextPreview: "",
    };
    report.recallChecks.push(summary);
    return summary;
  }
}

function buildConversationABlock() {
  return [
    "我最近主要在做小红书图文内容策划，平时默认用中文沟通。",
    "我一般用飞书表格和 Notion 管选题，而且很在意标题里有没有数字感。",
    "最近先在做一个项目，叫 工位午休充电爆文，主要是给职场博主批量出午休回血和充电主题的图文。",
    "这个项目现在还在第一轮题材验证，我在看用户到底更吃工位回血感还是办公室自救感。",
    "我自己有时候也会把它叫成 工位回血实验室，之后聊到这个名字也还是这个项目。",
    "这个项目先别写成办公室鸡汤，我更想要真实一点、能让人一看就想收藏。",
    "受众先锁在上班族，尤其是那种午休只有四十分钟、但又想稍微恢复一下状态的人。",
    "交付上我习惯你先给3个标题，再给正文，再给结尾互动引导。",
    "我最近还在想，内容里是不是要多放一点低成本充电动作，比如趴桌休息、热水、短散步这种。",
    "下一步我应该会先测两组三封面，看哪种更容易出收藏。",
  ];
}

function buildConversationBBlock() {
  return [
    "另外我最近又开了一个项目，叫 早八通勤显高穿搭爆文，主要是给穿搭博主批量出早八通勤场景的图文。",
    "这个项目现在在模板验证阶段，我先看通勤西装和针织外套两种方向谁更稳。",
    "它的核心受众是身高150到158、想穿得利落显高的上班族。",
    "内容角度先抓 显高比例、通勤可复制、不过分正式 这三件事。",
    "这个项目还有个约束，尽量不要写大牌价格表达，最好都落到能照着抄的搭配步骤。",
    "我现在更纠结的一点是，标题到底该更偏 早八不狼狈，还是更偏 小个子显高。",
    "这个项目交付的时候，先给5个标题，再给正文，再给3个封面短句。",
    "另外标题里最好直接出现 显高 或 通勤 这种词，结尾再补一个行动号召。",
    "如果你后面写这个项目，别把场景写得太像周末逛街，核心还是上班前赶时间。",
    "我下一步会先补三组模板，把西装、针织、衬衫这三个方向拉开。",
  ];
}

async function main() {
  const report = createReport();
  const environmentWarningsSeen = new Set();
  const sessionId = "bb-memory-long-conversation";

  try {
    await bootstrapDashboardIfNeeded();
    await postJson("/api/clear");

    report.conversationA = {};
    await sendConversationBlock(sessionId, buildConversationABlock(), report.conversationA);

    report.conversationB = {};
    await sendConversationBlock(sessionId, buildConversationBBlock(), report.conversationB);

    await waitForIndexIdle();
    report.afterSeed = await captureSnapshot("after-seed");
    markEnvironmentIssues(report, report.afterSeed, "afterSeed", environmentWarningsSeen);

    await postJson("/api/index/run");
    report.afterIndex = await captureSnapshot("after-index");
    markEnvironmentIssues(report, report.afterIndex, "afterIndex", environmentWarningsSeen);

    const afterIndexTmp = report.afterIndex.tmp;
    const project2TmpProjectCount = countMatching(afterIndexTmp.projectEntries, (text) =>
      textIncludesAny(text, ["早八通勤显高穿搭爆文"]),
    );
    const project2FeedbackHasRuleA = countMatching(afterIndexTmp.feedbackEntries, (text) =>
      textIncludesAny(text, ["5个标题", "封面短句", "3个封面短句"]),
    ) >= 1;
    const project2FeedbackHasRuleB = countMatching(afterIndexTmp.feedbackEntries, (text) =>
      textIncludesAny(text, ["行动号召", "显高", "通勤"]),
    ) >= 1;

    recordAssertion(
      report,
      report.afterIndex.overview.userProfileCount === 1,
      "index should produce exactly one user profile",
      { overview: report.afterIndex.overview },
    );
    recordAssertion(
      report,
      report.afterIndex.overview.formalProjectCount === 0,
      "index should not create formal projects before Dream",
      { overview: report.afterIndex.overview },
    );
    recordAssertion(
      report,
      report.afterIndex.tmp.totalProjects >= 4
        && report.afterIndex.tmp.totalFeedback >= 3
        && project2TmpProjectCount >= 3
        && project2FeedbackHasRuleA
        && project2FeedbackHasRuleB,
      "index should preserve the second project's multi-memory tmp structure",
      {
        tmp: report.afterIndex.tmp,
        project2TmpProjectCount,
        project2FeedbackHasRuleA,
        project2FeedbackHasRuleB,
      },
    );

    await postJson("/api/dream/run");
    report.afterDream = await captureSnapshot("after-dream");
    markEnvironmentIssues(report, report.afterDream, "afterDream", environmentWarningsSeen);

    const lunchProject = findProjectByName(report.afterDream.projects, "工位午休充电爆文");
    const commuteProject = findProjectByName(report.afterDream.projects, "早八通勤显高穿搭爆文");

    recordAssertion(
      report,
      report.afterDream.overview.formalProjectCount === 2 && report.afterDream.overview.tmpTotalFiles === 0,
      "dream should produce exactly two formal projects and clear tmp",
      { overview: report.afterDream.overview },
    );
    recordAssertion(
      report,
      Boolean(lunchProject?.projectId) && Boolean(commuteProject?.projectId),
      "dream should preserve both project identities",
      { lunchProject, commuteProject },
    );
    recordAssertion(
      report,
      (commuteProject?.projectCount ?? 0) >= 1 && (commuteProject?.feedbackCount ?? 0) >= 1,
      "dream should keep active project and feedback memories for the second project even if files are consolidated",
      { commuteProject },
    );

    await postJson("/api/dream/run");
    report.afterSecondDream = await captureSnapshot("after-second-dream");
    markEnvironmentIssues(report, report.afterSecondDream, "afterSecondDream", environmentWarningsSeen);

    recordAssertion(
      report,
      report.afterDream.overview.formalProjectCount === report.afterSecondDream.overview.formalProjectCount
        && report.afterDream.overview.tmpTotalFiles === report.afterSecondDream.overview.tmpTotalFiles,
      "second Dream should preserve formal/tmp counts",
      {
        afterDream: report.afterDream.overview,
        afterSecondDream: report.afterSecondDream.overview,
      },
    );
    recordAssertion(
      report,
      report.afterDream.projects.map((item) => item.projectName).join("|")
        === report.afterSecondDream.projects.map((item) => item.projectName).join("|"),
      "second Dream should preserve project identities",
      {
        afterDreamProjects: report.afterDream.projects,
        afterSecondDreamProjects: report.afterSecondDream.projects,
      },
    );

    const lunchProjectId = lunchProject?.projectId ?? "";
    const commuteProjectId = commuteProject?.projectId ?? "";

    const userRecall = await safeRunRecall(report, "user", "bb-recall-user", "我默认用什么语言沟通？平时用什么工具管选题？");
    recordAssertion(
      report,
      userRecall.intent === "user"
        && userRecall.contextPreview.includes("飞书表格")
        && userRecall.contextPreview.includes("Notion"),
      "user recall should inject the global user profile",
      userRecall,
    );

    const aliasRecall = await safeRunRecall(report, "alias", "bb-recall-alias", "工位回血实验室这个项目现在处在什么阶段？");
    recordAssertion(
      report,
      aliasRecall.intent === "project_memory" && aliasRecall.selectedProjectId === lunchProjectId,
      "alias recall should resolve the lunch project",
      aliasRecall,
    );

    const projectRecall = await safeRunRecall(report, "projectOnly", "bb-recall-project", "工位午休充电爆文这个项目现在的阶段和下一步是什么？");
    recordAssertion(
      report,
      projectRecall.intent === "project_memory"
        && projectRecall.selectedProjectId === lunchProjectId
        && projectRecall.selectedFiles.some((item) => item.includes("/Project/")),
      "project-only recall should resolve lunch project memories",
      projectRecall,
    );

    const feedbackRecall = await safeRunRecall(report, "feedbackOnly", "bb-recall-feedback", "工位午休充电爆文这个项目你应该怎么给我交付？");
    recordAssertion(
      report,
      feedbackRecall.intent === "project_memory"
        && feedbackRecall.selectedProjectId === lunchProjectId
        && feedbackRecall.selectedFiles.some((item) => item.includes("/Feedback/"))
        && textIncludesAny(feedbackRecall.contextPreview, ["3个标题", "结尾互动引导"]),
      "feedback-only recall should resolve lunch feedback",
      feedbackRecall,
    );

    const stageRecall = await safeRunRecall(report, "stage", "bb-recall-stage", "早八通勤显高穿搭爆文这个项目现在是什么阶段？");
    recordAssertion(
      report,
      stageRecall.intent === "project_memory"
        && stageRecall.selectedProjectId === commuteProjectId
        && textIncludesAny(stageRecall.contextPreview, ["模板验证阶段", "通勤西装", "针织外套"]),
      "second-project stage recall should include stage information",
      stageRecall,
    );

    const audienceRecall = await safeRunRecall(report, "audience", "bb-recall-audience", "早八通勤显高穿搭爆文这个项目更适合谁？");
    recordAssertion(
      report,
      audienceRecall.intent === "project_memory"
        && audienceRecall.selectedProjectId === commuteProjectId
        && textIncludesAny(audienceRecall.contextPreview, ["150到158", "显高的上班族", "小个子"]),
      "second-project audience recall should include target audience information",
      audienceRecall,
    );

    const angleRecall = await safeRunRecall(report, "angleOrConstraint", "bb-recall-angle", "早八通勤显高穿搭爆文这个项目更强调什么内容角度和约束？");
    recordAssertion(
      report,
      angleRecall.intent === "project_memory"
        && angleRecall.selectedProjectId === commuteProjectId
        && textIncludesAny(angleRecall.contextPreview, ["显高比例", "通勤可复制", "不要写大牌价格", "搭配步骤"]),
      "second-project angle recall should include angle or constraint information",
      angleRecall,
    );

    const feedbackRecall2 = await safeRunRecall(report, "feedbackSecondProject", "bb-recall-feedback-2", "早八通勤显高穿搭爆文这个项目你应该怎么给我交付？");
    recordAssertion(
      report,
      feedbackRecall2.intent === "project_memory"
        && feedbackRecall2.selectedProjectId === commuteProjectId
        && feedbackRecall2.selectedFiles.some((item) => item.includes("/Feedback/"))
        && textIncludesAny(feedbackRecall2.contextPreview, ["5个标题", "封面短句", "行动号召"]),
      "second-project feedback recall should include feedback rules",
      feedbackRecall2,
    );

    const mixedRecall = await safeRunRecall(report, "mixed", "bb-recall-mixed", "早八通勤显高穿搭爆文这个项目现在的阶段，以及你应该怎么给我交付？");
    recordAssertion(
      report,
      mixedRecall.intent === "project_memory"
        && mixedRecall.selectedProjectId === commuteProjectId
        && mixedRecall.selectedFiles.some((item) => item.includes("/Project/"))
        && mixedRecall.selectedFiles.some((item) => item.includes("/Feedback/"))
        && textIncludesAny(mixedRecall.contextPreview, ["模板验证阶段", "5个标题", "行动号召"]),
      "mixed recall should combine project and feedback evidence for the second project",
      mixedRecall,
    );

    await safeRunRecall(report, "continuationWarmup", "bb-recall-cont", "我们继续聊早八通勤显高穿搭爆文。只回复继续。");
    const continuationRecall = await safeRunRecall(report, "continuation", "bb-recall-cont", "这个项目现在卡在哪？");
    recordAssertion(
      report,
      continuationRecall.intent === "project_memory" && continuationRecall.selectedProjectId === commuteProjectId,
      "continuation recall should reuse recent user context for the second project",
      continuationRecall,
    );

    const noneRecall = await safeRunRecall(report, "none", "bb-recall-none", "给我写一个最短的 Python 快速排序。");
    recordAssertion(
      report,
      noneRecall.intent === "none" && noneRecall.injected === false,
      "none recall should skip memory injection",
      noneRecall,
    );

    const unresolvedRecall = await safeRunRecall(report, "unresolved", "bb-recall-unresolved", "这个项目现在怎么样了？");
    recordAssertion(
      report,
      unresolvedRecall.intent === "project_memory"
        && unresolvedRecall.selectedProjectId === "none"
        && !unresolvedRecall.contextPreview.includes("project.meta.md"),
      "unresolved generic recall should avoid selecting any formal project",
      unresolvedRecall,
    );

    report.finalState = await captureSnapshot("final");
    markEnvironmentIssues(report, report.finalState, "final", environmentWarningsSeen);
    report.ok = report.issues.length === 0;
    await writeReport(report);
    console.log(JSON.stringify({
      ok: report.ok,
      issues: report.issues.length,
      reportPath: REPORT_PATH,
      finalOverview: report.finalState.overview,
    }, null, 2));
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    try {
      report.finalState = await captureSnapshot("failed-final");
      markEnvironmentIssues(report, report.finalState, "failed-final", environmentWarningsSeen);
    } catch {
      // ignore follow-up snapshot failures
    }
    pushIssue(report, "blocker", "blackbox execution failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    report.ok = false;
    await writeReport(report);
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      issues: report.issues.length,
      reportPath: REPORT_PATH,
    }, null, 2));
    process.exit(1);
  }
}

main();
