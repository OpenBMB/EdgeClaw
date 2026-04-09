import type { OpenClawPluginApi } from "../../api.js";
import { MaxCostUsdBudget } from "../budget/max-cost-usd.js";
import { MaxLoopsBudget } from "../budget/max-loops.js";
import { deserializeBudgetConstraints } from "../budget/registry.js";
import type { AlwaysOnConfig } from "../core/config.js";
import {
  buildAlwaysOnCommandNote,
  resolveAlwaysOnToolSupport,
  type AlwaysOnToolSupport,
} from "../core/tool-compat.js";
import type { AlwaysOnTask, BudgetUsage } from "../core/types.js";
import { UserCommandTaskSource } from "../source/user-command-source.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";

export function registerCommands(
  api: OpenClawPluginApi,
  store: TaskStore,
  logger: TaskLogger,
  config: AlwaysOnConfig,
  toolSupport: AlwaysOnToolSupport = resolveAlwaysOnToolSupport(api.config),
): void {
  const source = new UserCommandTaskSource();
  const commandNote = buildAlwaysOnCommandNote(toolSupport);

  api.registerCommand({
    name: "always-on",
    description: "Manage persistent background tasks",
    acceptsArgs: true,
    async handler(ctx) {
      const raw = ctx.args?.trim() ?? "";
      const spaceIdx = raw.indexOf(" ");
      const subcommand = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1).trim();

      switch (subcommand.toLowerCase()) {
        case "create":
          return handleCreate(args);
        case "list":
          return handleList();
        case "show":
          return handleShow(args);
        case "resume":
          return handleResume(args);
        case "cancel":
          return handleCancel(args);
        case "logs":
          return handleLogs(args);
        case "status":
          return handleStatus();
        default:
          return { text: HELP_TEXT };
      }
    },
  });

  async function handleCreate(title: string) {
    if (!title) {
      return { text: "Usage: `/always-on create <task description>`" };
    }

    const constraints = [
      new MaxLoopsBudget(config.defaultMaxLoops),
      new MaxCostUsdBudget(config.defaultMaxCostUsd),
    ];

    const task = source.createTask({ title, budgetConstraints: constraints });
    store.createTask(task);
    logger.info(task.id, `Task created: ${title}`);
    logger.info(task.id, "Task queued for background launch");

    return {
      text:
        `Task **${task.id}** created and queued for background execution.\n` +
        `> ${title}\n\n` +
        `Budget: ${config.defaultMaxLoops} loops, $${config.defaultMaxCostUsd} max cost.\n` +
        `The worker runs up to ${config.maxConcurrentTasks} task(s) at once and will start this task when a slot is available.\n` +
        `Your main session is not affected — keep chatting normally.` +
        (commandNote ? `\n\n${commandNote}` : ""),
    };
  }

  function handleList() {
    const tasks = store.listTasks();
    if (tasks.length === 0) {
      return { text: "No always-on tasks found." };
    }

    const grouped = new Map<string, AlwaysOnTask[]>();
    for (const t of tasks) {
      const list = grouped.get(t.status) ?? [];
      list.push(t);
      grouped.set(t.status, list);
    }

    const lines: string[] = ["## Always-On Tasks\n"];
    for (const [status, list] of grouped) {
      lines.push(`### ${status} (${list.length})`);
      for (const t of list) {
        lines.push(`- **${t.id}** — ${t.title} (runs: ${t.runCount})`);
      }
      lines.push("");
    }

    return { text: lines.join("\n") };
  }

  function handleShow(taskId: string) {
    if (!taskId) return { text: "Usage: `/always-on show <task-id>`" };

    const task = store.getTask(taskId);
    if (!task) return { text: `Task **${taskId}** not found.` };

    const usage = JSON.parse(task.budgetUsage) as BudgetUsage;
    const constraints = deserializeBudgetConstraints(task.budgetConstraints);

    const lines = [
      `## Task: ${task.title}`,
      `- **ID:** ${task.id}`,
      `- **Status:** ${task.status}`,
      `- **Runs:** ${task.runCount}`,
      `- **Created:** ${new Date(task.createdAt).toISOString()}`,
      `- **Loops used:** ${usage.loopsUsed}`,
      `- **Cost used:** $${usage.costUsedUsd.toFixed(4)}`,
    ];

    for (const c of constraints) {
      const result = c.check(usage);
      lines.push(`- **Budget (${c.kind}):** ${result.ok ? "within limits" : result.reason}`);
    }

    if (task.progressSummary) {
      lines.push("", "### Latest Progress", task.progressSummary);
    }
    if (task.resultSummary) {
      lines.push("", "### Result", task.resultSummary);
    }

    return { text: lines.join("\n") };
  }

  async function handleResume(taskId: string) {
    if (!taskId) return { text: "Usage: `/always-on resume <task-id>`" };

    const task = store.getTask(taskId);
    if (!task) return { text: `Task **${taskId}** not found.` };
    if (task.status !== "suspended") {
      return {
        text: `Task **${taskId}** is **${task.status}** — only suspended tasks can be resumed.`,
      };
    }

    store.updateTask(task.id, {
      status: "queued",
      suspendedAt: null,
    });
    logger.info(task.id, "Task re-queued for background launch");

    return {
      text:
        `Task **${taskId}** queued to resume in background. ` +
        `The worker runs up to ${config.maxConcurrentTasks} task(s) at once and will restart it when a slot is available.` +
        (commandNote ? `\n\n${commandNote}` : ""),
    };
  }

  function handleCancel(taskId: string) {
    if (!taskId) return { text: "Usage: `/always-on cancel <task-id>`" };

    const task = store.getTask(taskId);
    if (!task) return { text: `Task **${taskId}** not found.` };

    if (task.status === "completed" || task.status === "cancelled") {
      return { text: `Task **${taskId}** is already **${task.status}**.` };
    }

    store.updateTask(taskId, { status: "cancelled" });
    logger.info(taskId, "Task cancelled by user");
    return { text: `Task **${taskId}** cancelled.` };
  }

  function handleLogs(taskId: string) {
    if (!taskId) return { text: "Usage: `/always-on logs <task-id>`" };

    const task = store.getTask(taskId);
    if (!task) return { text: `Task **${taskId}** not found.` };

    const logs = logger.getLogs(taskId, 30);
    if (logs.length === 0) {
      return { text: `No logs for task **${taskId}**.` };
    }

    const lines = [`## Logs for task ${taskId}\n`];
    for (const entry of logs.reverse()) {
      const ts = new Date(entry.timestamp).toISOString().slice(11, 19);
      lines.push(`\`${ts}\` **${entry.level}** ${entry.message}`);
    }

    return { text: lines.join("\n") };
  }

  function handleStatus() {
    const all = store.listTasks();
    const runningTasks = store.listRunningTasks();
    const byStatus = new Map<string, number>();
    for (const t of all) {
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    }

    const lines = [
      "## Always-On Status",
      `- **Total tasks:** ${all.length}`,
      `- **Concurrent run limit:** ${config.maxConcurrentTasks}`,
    ];
    for (const [s, c] of byStatus) {
      lines.push(`- **${s}:** ${c}`);
    }
    if (runningTasks.length === 0) {
      lines.push("- **Running now:** none");
    } else {
      for (const task of runningTasks) {
        lines.push(`- **Running now:** ${task.title} (${task.id}, ${task.status})`);
      }
    }

    return { text: lines.join("\n") };
  }
}

const HELP_TEXT = `## /always-on — Background Task Manager

**Commands:**
- \`/always-on create <description>\` — Create and queue a task
- \`/always-on list\` — List all tasks
- \`/always-on show <id>\` — Show task details
- \`/always-on resume <id>\` — Re-queue a suspended task
- \`/always-on cancel <id>\` — Cancel a task
- \`/always-on logs <id>\` — View task logs
- \`/always-on status\` — System status overview`;
