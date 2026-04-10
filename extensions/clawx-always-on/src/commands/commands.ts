import type { OpenClawPluginApi, PluginCommandContext } from "../../api.js";
import { deserializeBudgetConstraints } from "../budget/registry.js";
import { resolveConfigSource, type AlwaysOnConfigSource } from "../core/config.js";
import { createAlwaysOnTaskFromUserInput } from "../core/task-factory.js";
import {
  buildAlwaysOnCommandNote,
  resolveAlwaysOnToolSupport,
  type AlwaysOnToolSupport,
} from "../core/tool-compat.js";
import type { AlwaysOnTask, BudgetUsage } from "../core/types.js";
import {
  resolveCommandPeer,
  resolvePlanConversationKeyFromCommand,
} from "../plan/conversation-key.js";
import type { TaskLogger } from "../storage/logger.js";
import type { TaskStore } from "../storage/store.js";

export type AlwaysOnPlanCommandHandler = {
  startPlan: (ctx: PluginCommandContext, prompt: string) => Promise<{ text: string }>;
  cancelPlan: (ctx: PluginCommandContext) => { text: string };
};

export type AlwaysOnDreamCommandHandler = {
  runDream: (ctx: PluginCommandContext) => Promise<{ text: string }>;
};

export function registerCommands(
  api: OpenClawPluginApi,
  store: TaskStore,
  logger: TaskLogger,
  config: AlwaysOnConfigSource,
  toolSupport: AlwaysOnToolSupport = resolveAlwaysOnToolSupport(api.config),
  planHandler?: AlwaysOnPlanCommandHandler,
  dreamHandler?: AlwaysOnDreamCommandHandler,
): void {
  const commandNote = buildAlwaysOnCommandNote(toolSupport);
  const getConfig = resolveConfigSource(config);

  api.registerCommand({
    name: "always-on",
    description: "Manage persistent background tasks",
    acceptsArgs: true,
    async handler(ctx) {
      const raw = ctx.args?.trim() ?? "";
      const spaceIdx = raw.indexOf(" ");
      const subcommand = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1).trim();
      const normalizedSubcommand = subcommand.toLowerCase();

      if (!normalizedSubcommand) {
        return {
          continueWithBody: ALWAYS_ON_BOOTSTRAP_PROMPT,
        };
      }

      switch (normalizedSubcommand) {
        case "create":
          return handleCreate(ctx, args);
        case "list":
          return handleList();
        case "show":
          return handleShow(args);
        case "start":
          return handleStart(args);
        case "resume":
          return handleResume(args);
        case "cancel":
          return handleCancel(args);
        case "plan":
          return handlePlan(ctx, args);
        case "dream":
          return handleDream(ctx);
        case "logs":
          return handleLogs(args);
        case "status":
          return handleStatus();
        default:
          return { text: HELP_TEXT };
      }
    },
  });

  async function handleCreate(ctx: PluginCommandContext, title: string) {
    if (!title) {
      return { text: "Usage: `/always-on create <task description>`" };
    }
    const currentConfig = getConfig();
    const target = resolveCommandTarget(ctx);
    const task = createAlwaysOnTaskFromUserInput({
      input: {
        title,
        deliverySessionKey: target.sessionKey,
        metadata: {
          mode: "create",
          originConversationKey: target.conversationKey,
          originSessionKey: target.sessionKey,
        },
      },
      store,
      logger,
      config: currentConfig,
    });

    return {
      text:
        `Task **${task.id}** created and queued for background execution.\n` +
        `> ${title}\n\n` +
        `Budget: ${currentConfig.defaultMaxLoops} loops, $${currentConfig.defaultMaxCostUsd} max cost.\n` +
        `Execution profile: provider=${task.provider ?? "default"}, model=${task.model ?? "default"}, budgetAction=${task.budgetExceededAction}.\n` +
        `The worker runs up to ${currentConfig.maxConcurrentTasks} task(s) at once and will start this task when a slot is available.\n` +
        `Your main session is not affected — keep chatting normally.` +
        (commandNote ? `\n\n${commandNote}` : ""),
    };
  }

  async function handlePlan(ctx: PluginCommandContext, args: string) {
    if (!planHandler) {
      return { text: "Planning mode is currently unavailable." };
    }
    const trimmedArgs = args.trim();
    if (!trimmedArgs) {
      return { text: "Usage: `/always-on plan <task description>` or `/always-on plan cancel`" };
    }
    if (trimmedArgs.toLowerCase() === "cancel") {
      return planHandler.cancelPlan(ctx);
    }
    return planHandler.startPlan(ctx, trimmedArgs);
  }

  async function handleDream(ctx: PluginCommandContext) {
    if (!dreamHandler) {
      return { text: "Dream mode is currently unavailable." };
    }
    return dreamHandler.runDream(ctx);
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
      `- **Execution profile:** provider=${task.provider ?? "default"}, model=${task.model ?? "default"}`,
      `- **Budget action:** ${task.budgetExceededAction}`,
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

  async function handleStart(taskId: string) {
    if (!taskId) return { text: "Usage: `/always-on start <task-id>`" };

    const task = store.getTask(taskId);
    if (!task) return { text: `Task **${taskId}** not found.` };
    if (task.status !== "pending") {
      return {
        text: `Task **${taskId}** is **${task.status}** — only pending tasks can be started.`,
      };
    }

    if (!store.startPendingTask(task.id)) {
      return { text: `Task **${taskId}** could not be moved into the queue.` };
    }
    logger.info(task.id, "Pending task started by user");
    return {
      text:
        `Task **${taskId}** moved from **pending** to **queued**.` +
        ` The worker will launch it when a slot is available.` +
        (commandNote ? `\n\n${commandNote}` : ""),
    };
  }

  async function handleResume(taskId: string) {
    if (!taskId) return { text: "Usage: `/always-on resume <task-id>`" };

    const task = store.getTask(taskId);
    if (!task) return { text: `Task **${taskId}** not found.` };
    if (task.status !== "suspended" && task.status !== "failed") {
      return {
        text:
          `Task **${taskId}** is **${task.status}** — ` +
          `only suspended or failed tasks can be resumed.`,
      };
    }

    const currentConfig = getConfig();
    store.updateTask(task.id, {
      status: "queued",
      suspendedAt: null,
    });
    logger.info(task.id, "Task re-queued for background launch");

    return {
      text:
        `Task **${taskId}** queued to resume in background. ` +
        `The worker runs up to ${currentConfig.maxConcurrentTasks} task(s) at once and will restart it when a slot is available.` +
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
    const currentConfig = getConfig();
    const all = store.listTasks();
    const runningTasks = store.listRunningTasks();
    const byStatus = new Map<string, number>();
    for (const t of all) {
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    }

    const lines = [
      "## Always-On Status",
      `- **Total tasks:** ${all.length}`,
      `- **Concurrent run limit:** ${currentConfig.maxConcurrentTasks}`,
      `- **Dream enabled:** ${currentConfig.dreamEnabled ? "yes" : "no"}`,
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

  function resolveCommandTarget(ctx: PluginCommandContext): {
    conversationKey?: string;
    sessionKey?: string;
  } {
    const conversationKey = resolvePlanConversationKeyFromCommand(ctx);
    const peer = resolveCommandPeer(ctx);
    if (!peer) {
      return { conversationKey };
    }
    const route = api.runtime.channel.routing.resolveAgentRoute({
      cfg: ctx.config,
      channel: ctx.channel,
      accountId: ctx.accountId,
      peer,
    });
    return {
      conversationKey,
      sessionKey: route.sessionKey,
    };
  }
}

const HELP_TEXT = `## /always-on — Background Task Manager

**Commands:**
- \`/always-on create <description>\` — Create and queue a task
- \`/always-on start <id>\` — Start a pending task
- \`/always-on list\` — List all tasks
- \`/always-on show <id>\` — Show task details
- \`/always-on resume <id>\` — Re-queue a suspended or failed task
- \`/always-on cancel <id>\` — Cancel a task
- \`/always-on plan <description>\` — Refine a task before creating it
- \`/always-on plan cancel\` — Cancel the active planning flow
- \`/always-on dream\` — Derive new pending tasks from transcript, memory, and task state
- \`/always-on logs <id>\` — View task logs
- \`/always-on status\` — System status overview`;

const ALWAYS_ON_BOOTSTRAP_PROMPT = `Always-On background tasks can keep working toward a goal over time, follow up later, monitor progress, and summarize results when they matter.

Help me figure out the right Always-On task to create. Start with a brief explanation of what Always-On can do, then ask only the minimum follow-up questions needed to define a concrete task. If the goal already seems clear, propose a concise task description I can confirm or refine.`;
