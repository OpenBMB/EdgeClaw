import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const UI_BASE = process.env.CLAWXMEMORY_UI_BASE || "http://127.0.0.1:39393/clawxmemory";
const OPENCLAW_TIMEOUT_SECONDS = process.env.CLAWXMEMORY_AGENT_TIMEOUT || "60";
const HTTP_TIMEOUT_MS = 30_000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function commandToString(command, args) {
  return [command, ...args].join(" ");
}

function runCommand(command, args, options = {}) {
  const { cwd = REPO_ROOT, timeoutMs = 120_000 } = options;
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

async function getJson(pathname) {
  const response = await fetch(`${UI_BASE}${pathname}`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${pathname} failed (${response.status})\n${await response.text()}`);
  }
  return response.json();
}

async function postJson(pathname, body = undefined) {
  const response = await fetch(`${UI_BASE}${pathname}`, {
    method: "POST",
    headers: body == null ? {} : { "content-type": "application/json" },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${pathname} failed (${response.status})\n${await response.text()}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sendAgentMessage(sessionId, message) {
  await runCommand("openclaw", [
    "agent",
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
}

async function waitForCase(query, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const cases = await getJson("/api/cases?limit=50");
    const match = Array.isArray(cases) ? cases.find((item) => item?.query === query) : null;
    if (match?.caseId) {
      return getJson(`/api/cases/${encodeURIComponent(match.caseId)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for case: ${query}`);
}

async function runRecallCase(sessionId, query) {
  await sendAgentMessage(sessionId, query);
  return waitForCase(query);
}

function findProjectByName(projects, projectName) {
  return Array.isArray(projects) ? projects.find((item) => item?.projectName === projectName) : undefined;
}

function findEntryByName(entries, name, type = "") {
  return Array.isArray(entries)
    ? entries.find((item) => item?.name === name && (!type || item?.type === type))
    : undefined;
}

function firstEntryOfType(entries, type) {
  return Array.isArray(entries) ? entries.find((item) => item?.type === type) : undefined;
}

function findTmpRecord(snapshot, name, type) {
  const entries = [
    ...(Array.isArray(snapshot?.projectEntries) ? snapshot.projectEntries : []),
    ...(Array.isArray(snapshot?.feedbackEntries) ? snapshot.feedbackEntries : []),
  ];
  return entries.find((item) => item?.name === name && (!type || item?.type === type));
}

function contextPreview(caseDetail) {
  return String(caseDetail?.retrieval?.contextPreview || "");
}

async function main() {
  const report = {
    initialOverview: null,
    postMaintenanceOverview: null,
    finalOverview: null,
    actions: [],
    recalls: {},
  };

  await postJson("/api/clear");

  await sendAgentMessage("maint-user-1", "记住这些长期信息：我是做小红书图文选题策划的，平时更习惯中文；我常用飞书表格和 Notion 管选题。");
  await sendAgentMessage("maint-user-2", "再记一个长期信息：我做文案时很在意标题和封面文案的一致性。");
  await sendAgentMessage("maint-project-base", "这个项目先叫 初夏通勤穿搭爆文。它是一个帮时尚博主批量生成小红书通勤穿搭文案的项目，目前还在选题和风格摸索阶段。");
  await sendAgentMessage("maint-feedback-base", "在这个初夏通勤穿搭爆文项目里，你每次给我交付时都先给3个标题，再给正文，再给封面文案。");

  await postJson("/api/index/run");
  report.initialOverview = await getJson("/api/overview");
  let projects = await getJson("/api/projects?limit=20");
  let tmpSnapshot = await getJson("/api/tmp?limit=20");
  assert(report.initialOverview.formalProjectCount === 0, "expected no formal project before manual archive");
  assert(report.initialOverview.userProfileCount === 1, "expected one user profile after initial index");
  assert(tmpSnapshot.totalFiles === 2, "expected base project and feedback to be pending tmp files");

  const baseTmpProject = findTmpRecord(tmpSnapshot, "初夏通勤穿搭爆文", "project");
  const baseTmpFeedback = findTmpRecord(tmpSnapshot, "delivery-rule", "feedback");
  assert(baseTmpProject?.relativePath, "expected base tmp project before manual archive");
  assert(baseTmpFeedback?.relativePath, "expected base tmp feedback before manual archive");

  report.actions.push(await postJson("/api/memory/actions", {
    action: "archive_tmp",
    ids: [baseTmpProject.relativePath],
    newProjectName: "初夏通勤穿搭爆文",
  }));
  projects = await getJson("/api/projects?limit=20");
  const baseProject = findProjectByName(projects, "初夏通勤穿搭爆文");
  assert(baseProject?.projectId, "expected initial formal project after base tmp archive");
  report.actions.push(await postJson("/api/memory/actions", {
    action: "archive_tmp",
    ids: [baseTmpFeedback.relativePath],
    targetProjectId: baseProject.projectId,
  }));

  report.initialOverview = await getJson("/api/overview");
  projects = await getJson("/api/projects?limit=20");
  tmpSnapshot = await getJson("/api/tmp?limit=20");
  assert(report.initialOverview.formalProjectCount === 1, "expected exactly one formal project after base manual archive");
  assert(report.initialOverview.userProfileCount === 1, "expected one user profile after base manual archive");
  assert(tmpSnapshot.totalFiles === 0, "expected tmp to be empty after base manual archive");

  await sendAgentMessage("maint-tmp-project-a", "我最近在做一个项目，先叫 秋日城市散步爆文。目标是给生活方式博主批量生成城市散步主题的小红书文案。");
  await sendAgentMessage("maint-tmp-project-b", "我还有一个项目叫 周末露营vlog爆文，是给户外博主批量生成露营 vlog 的小红书文案。");
  await sendAgentMessage("maint-tmp-feedback", "在这个初夏通勤穿搭爆文项目里，交付时再额外给我一句 30 字以内的评论区引导。");
  await postJson("/api/index/run");

  tmpSnapshot = await getJson("/api/tmp?limit=20");
  assert(tmpSnapshot.totalFiles === 3, "expected three tmp files before manual maintenance");

  assert(baseProject?.projectId, "expected to find the initial formal project");
  const tmpProjectA = findTmpRecord(tmpSnapshot, "秋日城市散步爆文", "project");
  const tmpProjectB = findTmpRecord(tmpSnapshot, "周末露营vlog爆文", "project");
  const tmpFeedback = findTmpRecord(tmpSnapshot, "delivery-rule", "feedback");
  assert(tmpProjectA?.relativePath, "expected tmp project A");
  assert(tmpProjectB?.relativePath, "expected tmp project B");
  assert(tmpFeedback?.relativePath, "expected tmp feedback");

  report.actions.push(await postJson("/api/memory/actions", {
    action: "edit_entry",
    id: tmpProjectA.relativePath,
    name: "current-stage",
    description: "秋日城市散步项目已进入模板验证阶段",
    fields: {
      stage: "秋日城市散步项目已进入模板验证阶段",
      nextSteps: ["补齐 3 组散步路线模板", "验证封面标题一致性"],
      notes: ["保持中文输出"],
    },
  }));
  report.actions.push(await postJson("/api/memory/actions", {
    action: "edit_entry",
    id: tmpFeedback.relativePath,
    name: "delivery-rule",
    description: "交付时追加评论区引导",
    fields: {
      rule: "交付时先标题、再正文、再封面，最后给一句评论区引导",
      why: "方便一次性审核交付结构",
      howToApply: "评论区引导限制在 30 字内",
      notes: ["保持固定交付顺序"],
    },
  }));

  report.actions.push(await postJson("/api/memory/actions", {
    action: "archive_tmp",
    ids: [tmpProjectA.relativePath],
    newProjectName: "秋日城市散步爆文",
  }));
  report.actions.push(await postJson("/api/memory/actions", {
    action: "archive_tmp",
    ids: [tmpProjectB.relativePath],
    newProjectName: "周末露营vlog爆文",
  }));
  report.actions.push(await postJson("/api/memory/actions", {
    action: "archive_tmp",
    ids: [tmpFeedback.relativePath],
    targetProjectId: baseProject.projectId,
  }));
  report.actions.push(await postJson("/api/memory/actions", {
    action: "edit_project_meta",
    projectId: baseProject.projectId,
    projectName: "初夏通勤穿搭内容工厂",
    description: "用于批量生产通勤穿搭内容",
    aliases: ["通勤穿搭内容工厂"],
    status: "in_progress",
  }));

  projects = await getJson("/api/projects?limit=20");
  const renamedProject = findProjectByName(projects, "初夏通勤穿搭内容工厂");
  const projectA = findProjectByName(projects, "秋日城市散步爆文");
  const projectB = findProjectByName(projects, "周末露营vlog爆文");
  assert(renamedProject?.projectId, "expected renamed project after edit_project_meta");
  assert(projectA?.projectEntries?.[0]?.relativePath, "expected archived project A to exist");
  assert(projectB?.projectEntries?.[0]?.relativePath, "expected archived project B to exist");

  const baseProjectEntry = firstEntryOfType(renamedProject.projectEntries, "project");
  const baseFeedbackEntry = findEntryByName(renamedProject.feedbackEntries, "delivery-rule", "feedback");
  assert(baseProjectEntry?.relativePath, "expected base project memory after archive");
  assert(baseFeedbackEntry?.relativePath, "expected base feedback memory after archive");

  report.actions.push(await postJson("/api/memory/actions", {
    action: "edit_entry",
    id: baseProjectEntry.relativePath,
    name: "current-stage",
    description: "项目进入批量模板验证阶段",
    fields: {
      stage: "项目进入批量模板验证阶段",
      nextSteps: ["验证 5 个标题模板", "校准封面标题一致性"],
      blockers: ["还缺稳定封面模板"],
    },
  }));
  report.actions.push(await postJson("/api/memory/actions", {
    action: "edit_entry",
    id: baseFeedbackEntry.relativePath,
    name: "delivery-rule",
    description: "交付时追加评论区引导",
    fields: {
      rule: "交付时先标题、再正文、再封面，最后给一句评论区引导",
      why: "方便一次性审核交付结构",
      howToApply: "评论区引导限制在 30 字内",
      notes: ["保持固定交付顺序"],
    },
  }));

  const projectAEntryPath = projectA.projectEntries[0].relativePath;
  report.actions.push(await postJson("/api/memory/actions", {
    action: "deprecate_entries",
    ids: [projectAEntryPath],
  }));

  projects = await getJson("/api/projects?limit=20");
  assert(!findProjectByName(projects, "秋日城市散步爆文"), "deprecated-only project should be hidden from active project list");

  const deprecatedRecall = await runRecallCase(
    "maint-recall-deprecated-before-restore",
    "秋日城市散步爆文这个项目在恢复前的阶段是什么？",
  );
  assert(!contextPreview(deprecatedRecall).includes("project.meta.md"), "expected deprecated project recall to avoid active project injection");

  report.actions.push(await postJson("/api/memory/actions", {
    action: "restore_entries",
    ids: [projectAEntryPath],
  }));

  projects = await getJson("/api/projects?limit=20");
  const restoredProjectA = findProjectByName(projects, "秋日城市散步爆文");
  assert(restoredProjectA?.projectEntries?.[0]?.relativePath, "expected restored project A to reappear in active list");

  const projectBEntryPath = projectB.projectEntries[0].relativePath;
  report.actions.push(await postJson("/api/memory/actions", {
    action: "deprecate_entries",
    ids: [projectBEntryPath],
  }));
  report.actions.push(await postJson("/api/memory/actions", {
    action: "delete_entries",
    ids: [projectBEntryPath],
  }));

  report.postMaintenanceOverview = await getJson("/api/overview");
  projects = await getJson("/api/projects?limit=20");
  tmpSnapshot = await getJson("/api/tmp?limit=20");
  assert(report.postMaintenanceOverview.formalProjectCount === 2, "expected two active formal projects after restore+delete");
  assert(tmpSnapshot.totalFiles === 0, "expected tmp to be empty after archive actions");
  assert(findProjectByName(projects, "秋日城市散步爆文"), "restored project should remain active");
  assert(!findProjectByName(projects, "周末露营vlog爆文"), "deleted project should be removed from active project list");

  const preDreamFeedbackRecall = await runRecallCase(
    "maint-recall-feedback-before-dream",
    "初夏通勤穿搭爆文这个项目在 Dream 前应该怎么给我交付？",
  );
  const preDreamMixedRecall = await runRecallCase(
    "maint-recall-mixed-before-dream",
    "初夏通勤穿搭内容工厂这个项目在 Dream 前现在的阶段、下一步，以及你应该怎么给我交付？",
  );
  const preDreamRestoredRecall = await runRecallCase(
    "maint-recall-restored-before-dream",
    "秋日城市散步爆文这个项目在 Dream 前现在的阶段是什么？",
  );
  assert(contextPreview(preDreamFeedbackRecall).includes("评论区引导"), "expected edited feedback content before Dream");
  assert(contextPreview(preDreamMixedRecall).includes("项目进入批量模板验证阶段"), "expected edited project content before Dream");
  assert(contextPreview(preDreamRestoredRecall).includes("秋日城市散步项目已进入模板验证阶段"), "expected restored project content before Dream");

  await postJson("/api/dream/run");

  const userRecall = await runRecallCase("maint-recall-user", "我平时更习惯什么语言交流？常用什么工具管理选题？");
  const feedbackRecall = await runRecallCase("maint-recall-feedback", "初夏通勤穿搭爆文这个项目你应该怎么给我交付？");
  const mixedRecall = await runRecallCase("maint-recall-mixed", "初夏通勤穿搭内容工厂这个项目现在的阶段、下一步，以及你应该怎么给我交付？");
  const restoredRecall = await runRecallCase("maint-recall-restored", "秋日城市散步爆文这个项目现在的阶段是什么？");
  await runRecallCase("maint-recall-cont", "我们继续聊 初夏通勤穿搭内容工厂。只回复“继续”。");
  const continuationRecall = await runRecallCase("maint-recall-cont", "这个项目现在到哪一步了？");
  const noneRecall = await runRecallCase("maint-recall-none", "给我写一个最短的 JavaScript 冒泡排序。");
  const unresolvedRecall = await runRecallCase("maint-recall-unresolved", "这个项目现在怎么样了？");

  report.recalls = {
    preDreamFeedback: preDreamFeedbackRecall.retrieval?.intent,
    preDreamMixed: preDreamMixedRecall.retrieval?.intent,
    preDreamRestored: preDreamRestoredRecall.retrieval?.intent,
    user: userRecall.retrieval?.intent,
    feedback: feedbackRecall.retrieval?.intent,
    mixed: mixedRecall.retrieval?.intent,
    restored: restoredRecall.retrieval?.intent,
    continuation: continuationRecall.retrieval?.intent,
    none: noneRecall.retrieval?.intent,
    unresolved: unresolvedRecall.retrieval?.intent,
  };

  assert(userRecall.retrieval?.intent === "user", "expected user recall route");
  assert(contextPreview(feedbackRecall).includes("Feedback/delivery-rule.md"), "expected feedback recall to include delivery-rule");
  assert(
    contextPreview(mixedRecall).includes(`projects/${renamedProject.projectId}/Project/`),
    "expected mixed recall to include formal project memory",
  );
  assert(contextPreview(mixedRecall).includes("Feedback/delivery-rule.md"), "expected mixed recall to include feedback memory");
  assert(continuationRecall.retrieval?.intent === "project_memory", "expected continuation recall to resolve project memory");
  assert(noneRecall.retrieval?.intent === "none" && noneRecall.retrieval?.injected === false, "expected none recall to skip memory injection");
  assert(!contextPreview(unresolvedRecall).includes("project.meta.md"), "expected unresolved recall to avoid selecting a formal project");
  assert(contextPreview(restoredRecall).includes("project.meta.md"), "expected restored project recall to include active project injection");
  assert(contextPreview(restoredRecall).includes("秋日城市散步爆文"), "expected restored project recall to target the restored project");

  report.finalOverview = await getJson("/api/overview");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exit(1);
  });
