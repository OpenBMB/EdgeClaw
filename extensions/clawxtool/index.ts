import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { annotateAge } from "./src/annotate.js";
import { classifyCommand } from "./src/classifier.js";
import { nextOccurrences, describeCron } from "./src/cron-parser.js";
import { readNotebook, formatNotebook, editNotebookCell } from "./src/notebook.js";
// ── src imports ─────────────────────────────────────────────────────
import {
  formatAsTextFallback,
  parseTextResponse,
  type QuestionOption,
} from "./src/question-tool.js";
import { BUILTIN_RULES, scanForSecrets, type SecretRule } from "./src/secret-patterns.js";
import { TaskStore, type TaskStatus } from "./src/store.js";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  getWorktreeChanges,
} from "./src/worktree.js";

const EXEC_TOOL_NAMES = new Set([
  "exec",
  "code_execution",
  "shell",
  "bash",
  "terminal",
  "run_command",
]);

function formatTask(t: {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}): string {
  const parts = [`**${t.id}**: ${t.title} [${t.status}]`];
  if (t.description) parts.push(`  ${t.description}`);
  if (t.priority !== 0) parts.push(`  Priority: ${t.priority}`);
  if (t.blockedBy.length > 0) parts.push(`  Blocked by: ${t.blockedBy.join(", ")}`);
  return parts.join("\n");
}

export default definePluginEntry({
  id: "clawxtool",
  name: "ClawXTool",
  description:
    "Unified tool suite — cron, bash security, secret scanning, notebooks, git worktrees, tasks, memory age, structured questions.",

  register(api) {
    const rootCfg = (api.pluginConfig ?? {}) as Record<string, Record<string, unknown>>;

    // ═══════════════════════════════════════════════════════════════════
    // 1. Ask User
    // ═══════════════════════════════════════════════════════════════════
    {
      const cfg = rootCfg.askUser ?? {};
      const defaultTimeoutMs = (cfg.defaultTimeoutMs as number) ?? 120_000;

      api.registerTool({
        name: "ask_user_question",
        label: "Ask User",
        description:
          "Present a structured multiple-choice question to the user. " +
          "The user selects from predefined options. Use this instead of free-text questions " +
          "when there is a known set of valid answers.",
        parameters: Type.Object({
          question: Type.String({ description: "The question to present to the user" }),
          options: Type.Array(
            Type.Object({
              id: Type.String({ description: "Unique identifier for this option" }),
              label: Type.String({ description: "Display text for this option" }),
              description: Type.Optional(
                Type.String({ description: "Additional context for this option" }),
              ),
            }),
            { description: "Available options (minimum 2)", minItems: 2 },
          ),
          allow_multiple: Type.Optional(
            Type.Boolean({ description: "Allow selecting multiple options (default: false)" }),
          ),
          timeout_ms: Type.Optional(
            Type.Number({ description: "Timeout in ms for waiting (default: from config)" }),
          ),
        }),
        async execute(_id, args) {
          const params = args as {
            question: string;
            options: QuestionOption[];
            allow_multiple?: boolean;
            timeout_ms?: number;
          };
          const allowMultiple = params.allow_multiple ?? false;
          const timeoutMs = params.timeout_ms ?? defaultTimeoutMs;
          const textPrompt = formatAsTextFallback({
            question: params.question,
            options: params.options,
            allowMultiple,
            timeoutMs,
          });

          try {
            const runtime = api.runtime as Record<string, unknown>;
            const askUser = runtime.askUser as
              | ((prompt: string, opts?: { timeoutMs?: number }) => Promise<string>)
              | undefined;
            if (typeof askUser === "function") {
              const response = await askUser(textPrompt, { timeoutMs });
              const selected = parseTextResponse(response, params.options, allowMultiple);
              if (selected.length === 0) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `User responded: "${response}" (could not match to any option)\n\nOptions were:\n${params.options.map((o) => `- ${o.id}: ${o.label}`).join("\n")}`,
                    },
                  ],
                  details: undefined,
                };
              }
              const selectedLabels = selected
                .map((id) => params.options.find((o) => o.id === id))
                .filter(Boolean)
                .map((o) => `${o!.id}: ${o!.label}`);
              return {
                content: [{ type: "text", text: `User selected: ${selectedLabels.join(", ")}` }],
                details: undefined,
              };
            }
          } catch (err) {
            if (err instanceof Error && err.message.includes("timeout")) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Question timed out after ${timeoutMs}ms. No response from user.\n\nQuestion was: ${params.question}`,
                  },
                ],
                details: undefined,
              };
            }
          }
          return {
            content: [
              {
                type: "text",
                text: `[Structured Question]\n\n${textPrompt}\n\n(Awaiting user response in the next message)`,
              },
            ],
            details: undefined,
          };
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. Bash Security
    // ═══════════════════════════════════════════════════════════════════
    {
      const cfg = rootCfg.bashSecurity ?? {};
      const autoApprove = (cfg.autoApprove as string[]) ?? [];
      const alwaysBlock = (cfg.alwaysBlock as string[]) ?? [];

      api.on(
        "before_tool_call",
        async (event) => {
          const { toolName, params } = event as { toolName: string; params: unknown };
          if (!EXEC_TOOL_NAMES.has(toolName.toLowerCase())) return {};
          const p = params as Record<string, unknown> | undefined;
          const command =
            (p?.command as string) ??
            (p?.cmd as string) ??
            (p?.input as string) ??
            (typeof params === "string" ? params : undefined);
          if (!command) return {};
          const verdict = classifyCommand(command, { autoApprove, alwaysBlock });
          if (verdict.level === "dangerous") {
            api.logger.warn?.(
              `clawxtool/bash: BLOCKED dangerous command: ${command} — ${verdict.reason}`,
            );
            return {
              block: true,
              blockReason: `Security analysis blocked this command.\n\n**Verdict:** DANGEROUS\n**Reason:** ${verdict.reason}\n**Details:**\n${verdict.details.map((d) => `- ${d}`).join("\n")}`,
            };
          }
          if (verdict.level === "needs_approval") {
            return {
              requireApproval: {
                title: `Command requires approval: ${command.slice(0, 80)}`,
                description: `Reason: ${verdict.reason}\nDetails: ${verdict.details.join("; ")}`,
                severity: "warning" as const,
              },
            };
          }
          return {};
        },
        { priority: 200 },
      );

      api.registerTool(
        {
          name: "bash_analyze",
          label: "Bash Security",
          description:
            "Analyze a shell command for security risks before executing it. Returns a verdict (safe, needs_approval, dangerous, unknown) with detailed reasoning.",
          parameters: Type.Object({
            command: Type.String({ description: "The shell command to analyze" }),
          }),
          async execute(_id, args) {
            const { command } = args as { command: string };
            const verdict = classifyCommand(command, { autoApprove, alwaysBlock });
            const lines = [
              `**Command:** \`${command}\``,
              `**Verdict:** ${verdict.level.toUpperCase()}`,
              `**Reason:** ${verdict.reason}`,
            ];
            if (verdict.details.length > 0) {
              lines.push("**Details:**");
              verdict.details.forEach((d) => lines.push(`- ${d}`));
            }
            return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
          },
        },
        { optional: true },
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3. Cron Parser
    // ═══════════════════════════════════════════════════════════════════
    api.registerTool({
      name: "cron_parse",
      label: "Cron",
      description:
        "Parse a 5-field cron expression (minute hour day-of-month month day-of-week) and return the next N execution times. Supports *, ranges (1-5), steps (*/10), and lists (1,3,5).",
      parameters: Type.Object({
        expression: Type.String({ description: "5-field cron expression, e.g. '30 2 * * 1-5'" }),
        count: Type.Optional(
          Type.Number({
            description: "Number of upcoming times to return (default: 5)",
            minimum: 1,
            maximum: 50,
          }),
        ),
      }),
      async execute(_id, args) {
        const { expression, count } = args as { expression: string; count?: number };
        const n = count ?? 5;
        try {
          const times = nextOccurrences(expression, n);
          const desc = describeCron(expression);
          const lines = [
            `**Cron expression:** \`${expression}\``,
            `**Description:** ${desc}`,
            `**Next ${times.length} occurrence(s):**`,
            ...times.map((t, i) => `${i + 1}. ${t.toISOString()} (${t.toLocaleString()})`),
          ];
          return { content: [{ type: "text", text: lines.join("\n") }], details: undefined };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Error parsing cron expression: ${msg}` }],
            details: undefined,
          };
        }
      },
    });

    // ═══════════════════════════════════════════════════════════════════
    // 4. Git Worktree
    // ═══════════════════════════════════════════════════════════════════
    {
      const cfg = rootCfg.gitWorktree ?? {};
      const maxWorktrees = (cfg.maxWorktrees as number) ?? 5;

      api.registerTool({
        name: "worktree_create",
        label: "Worktree Create",
        description:
          "Create an isolated git worktree for experimental changes. The worktree gets its own branch and working directory, leaving the main branch untouched.",
        parameters: Type.Object({
          branch: Type.String({ description: "Branch name for the new worktree" }),
          base: Type.Optional(
            Type.String({ description: "Base ref to branch from (default: HEAD)" }),
          ),
          path: Type.Optional(
            Type.String({ description: "Custom path for the worktree directory" }),
          ),
        }),
        async execute(_id, args) {
          const {
            branch,
            base,
            path: targetPath,
          } = args as { branch: string; base?: string; path?: string };
          try {
            const existing = await listWorktrees();
            if (existing.length >= maxWorktrees + 1) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Cannot create worktree: limit of ${maxWorktrees} worktrees reached.\n\nCurrent:\n${existing.map((w) => `- ${w.branch}: ${w.path}`).join("\n")}`,
                  },
                ],
                details: undefined,
              };
            }
            const result = await createWorktree(branch, base, targetPath);
            return { content: [{ type: "text", text: result.summary }], details: undefined };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error creating worktree: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: undefined,
            };
          }
        },
      });

      api.registerTool({
        name: "worktree_exit",
        label: "Worktree Exit",
        description:
          "Exit and optionally remove a git worktree. 'keep' preserves the branch; 'discard' force-removes it.",
        parameters: Type.Object({
          action: Type.Union([Type.Literal("keep"), Type.Literal("discard")], {
            description: "keep or discard",
          }),
          path: Type.Optional(Type.String({ description: "Path to the worktree" })),
        }),
        async execute(_id, args) {
          const { action, path: worktreePath } = args as {
            action: "keep" | "discard";
            path?: string;
          };
          try {
            if (!worktreePath)
              return {
                content: [{ type: "text", text: "Please specify the worktree path to exit." }],
                details: undefined,
              };
            if (action === "keep") {
              const changes = await getWorktreeChanges(worktreePath);
              return {
                content: [
                  {
                    type: "text",
                    text: `Worktree at ${worktreePath} kept.\n\nChanges:\n${changes}`,
                  },
                ],
                details: undefined,
              };
            }
            const msg = await removeWorktree(worktreePath, true);
            return { content: [{ type: "text", text: msg }], details: undefined };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: undefined,
            };
          }
        },
      });

      api.registerTool({
        name: "worktree_list",
        label: "Worktree List",
        description: "List all git worktrees in the current repository.",
        parameters: Type.Object({}),
        async execute() {
          try {
            const trees = await listWorktrees();
            if (trees.length === 0)
              return {
                content: [{ type: "text", text: "No worktrees found." }],
                details: undefined,
              };
            const lines = trees.map(
              (w) =>
                `- **${w.branch || "(detached)"}**: ${w.path}${w.head ? ` HEAD: ${w.head.slice(0, 8)}` : ""}`,
            );
            return {
              content: [
                { type: "text", text: `**Worktrees (${trees.length}):**\n\n${lines.join("\n")}` },
              ],
              details: undefined,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: undefined,
            };
          }
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. Memory Age
    // ═══════════════════════════════════════════════════════════════════
    {
      const cfg = rootCfg.memoryAge ?? {};
      const staleDays = (cfg.staleDays as number) ?? 30;
      const warnPrefix = (cfg.warnPrefix as string) ?? "\u26a0\ufe0f";

      api.on(
        "before_prompt_build",
        async () => {
          const guidance = [
            "## Memory Freshness Guide\n",
            "When using information from memory, consider its freshness:",
            "- Entries marked [fresh] or [recent] can be trusted.",
            `- Entries older than ${staleDays} days are marked as stale — verify before relying on them.`,
            `- ${warnPrefix} prefix indicates information that may be outdated.`,
            "",
            `Thresholds: fresh (<1h), recent (<24h), aging (<7d), old (<${staleDays}d), stale (>=${staleDays}d).`,
          ].join("\n");
          return { appendSystemContext: guidance };
        },
        { priority: 50 },
      );

      api.on("after_tool_call", async (event) => {
        const ev = event as Record<string, unknown>;
        const toolName = ev.toolName as string | undefined;
        if (!toolName || !toolName.toLowerCase().includes("memory")) return;
        const result = ev.result;
        if (!result || typeof result !== "object") return;
        const r = result as Record<string, unknown>;
        if (typeof r.text === "string" && r.timestamp) {
          const ts = new Date(r.timestamp as string);
          if (!isNaN(ts.getTime())) {
            const { tag, category } = annotateAge(ts, undefined, staleDays);
            r.text = `${category === "stale" || category === "old" ? `${warnPrefix} ${tag}` : tag} ${r.text}`;
          }
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 6. Notebook Edit
    // ═══════════════════════════════════════════════════════════════════
    api.registerTool({
      name: "notebook_read",
      label: "Notebook Read",
      description:
        "Read a Jupyter .ipynb notebook and display its cells. Optionally specify a cell index.",
      parameters: Type.Object({
        path: Type.String({ description: "Path to the .ipynb file" }),
        cell_index: Type.Optional(
          Type.Number({ description: "Specific cell index to read (0-based)" }),
        ),
      }),
      async execute(_id, args) {
        const { path: filePath, cell_index } = args as { path: string; cell_index?: number };
        try {
          const nb = readNotebook(filePath);
          const text = formatNotebook(nb, cell_index);
          return {
            content: [
              {
                type: "text",
                text: `**${filePath}** — ${nb.cells.length} cell(s), nbformat ${nb.nbformat}.${nb.nbformat_minor}\n\n${text}`,
              },
            ],
            details: undefined,
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading notebook: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: undefined,
          };
        }
      },
    });

    api.registerTool({
      name: "notebook_edit",
      label: "Notebook Edit",
      description:
        "Edit a specific cell in a Jupyter .ipynb notebook. Specify cell index and new source content.",
      parameters: Type.Object({
        path: Type.String({ description: "Path to the .ipynb file" }),
        cell_index: Type.Number({ description: "Cell index to edit (0-based)" }),
        source: Type.String({ description: "New source content" }),
        cell_type: Type.Optional(
          Type.Union([Type.Literal("code"), Type.Literal("markdown"), Type.Literal("raw")]),
        ),
        create_if_missing: Type.Optional(
          Type.Boolean({ description: "Create notebook if missing (default: false)" }),
        ),
      }),
      async execute(_id, args) {
        const {
          path: filePath,
          cell_index,
          source,
          cell_type,
          create_if_missing,
        } = args as {
          path: string;
          cell_index: number;
          source: string;
          cell_type?: "code" | "markdown" | "raw";
          create_if_missing?: boolean;
        };
        try {
          const { summary } = editNotebookCell(
            filePath,
            cell_index,
            source,
            cell_type,
            create_if_missing,
          );
          return { content: [{ type: "text", text: summary }], details: undefined };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Error editing notebook: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: undefined,
          };
        }
      },
    });

    // ═══════════════════════════════════════════════════════════════════
    // 7. Secret Scanner
    // ═══════════════════════════════════════════════════════════════════
    {
      const cfg = rootCfg.secretScanner ?? {};
      const action = (cfg.action as string) ?? "block";
      const enabledRuleIds = cfg.enabledRules as string[] | undefined;
      const customPatterns =
        (cfg.customPatterns as Array<{ id: string; pattern: string; description?: string }>) ?? [];
      const customRules: SecretRule[] = customPatterns.map((p) => ({
        id: p.id,
        pattern: new RegExp(p.pattern, "g"),
        description: p.description ?? `Custom rule: ${p.id}`,
      }));
      const allRules = [...BUILTIN_RULES, ...customRules];

      function formatFindings(matches: ReturnType<typeof scanForSecrets>): string {
        return matches.map((m) => `- [${m.ruleId}] ${m.description}: "${m.match}"`).join("\n");
      }

      api.on(
        "message_sending",
        async (event) => {
          const text = (event as Record<string, unknown>).text as string | undefined;
          if (!text) return {};
          const matches = scanForSecrets(text, allRules, enabledRuleIds);
          if (matches.length === 0) return {};
          const report = formatFindings(matches);
          api.logger.warn?.(
            `clawxtool/secret: ${matches.length} potential secret(s) in outbound message:\n${report}`,
          );
          if (action === "block")
            return {
              cancel: true,
              cancelReason: `Secret scanner blocked this message. Found ${matches.length} potential secret(s):\n${report}`,
            };
          return {};
        },
        { priority: 100 },
      );

      api.on(
        "before_tool_call",
        async (event) => {
          const params = (event as Record<string, unknown>).params;
          if (!params) return {};
          const text = typeof params === "string" ? params : JSON.stringify(params);
          const matches = scanForSecrets(text, allRules, enabledRuleIds);
          if (matches.length === 0) return {};
          const report = formatFindings(matches);
          api.logger.warn?.(
            `clawxtool/secret: ${matches.length} potential secret(s) in tool parameters:\n${report}`,
          );
          if (action === "block")
            return {
              block: true,
              blockReason: `Secret scanner detected ${matches.length} potential secret(s) in tool parameters:\n${report}`,
            };
          return {};
        },
        { priority: 90 },
      );

      api.registerTool(
        {
          name: "secret_scan",
          label: "Secret Scanner",
          description: "Scan text for potential API keys, tokens, passwords, and other secrets.",
          parameters: Type.Object({
            text: Type.String({ description: "The text to scan for secrets" }),
          }),
          async execute(_id, args) {
            const { text } = args as { text: string };
            const matches = scanForSecrets(text, allRules, enabledRuleIds);
            if (matches.length === 0)
              return {
                content: [{ type: "text", text: "No secrets detected." }],
                details: undefined,
              };
            return {
              content: [
                {
                  type: "text",
                  text: `Found ${matches.length} potential secret(s):\n${formatFindings(matches)}`,
                },
              ],
              details: undefined,
            };
          },
        },
        { optional: true },
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    // 8. Task Manager
    // ═══════════════════════════════════════════════════════════════════
    {
      const cfg = rootCfg.taskManager ?? {};
      const store = new TaskStore(
        cfg.stateDir as string | undefined,
        (cfg.maxTasks as number) ?? 200,
      );

      api.registerTool({
        name: "task_create",
        label: "Task Create",
        description:
          "Create a new task to track progress on multi-step work. Supports dependency tracking.",
        parameters: Type.Object({
          title: Type.String({ description: "Task title" }),
          description: Type.Optional(Type.String({ description: "Detailed description" })),
          status: Type.Optional(
            Type.Union([
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("completed"),
              Type.Literal("cancelled"),
            ]),
          ),
          priority: Type.Optional(
            Type.Number({ description: "Priority (higher = more important)" }),
          ),
          blockedBy: Type.Optional(
            Type.Array(Type.String(), { description: "IDs of blocking tasks" }),
          ),
        }),
        async execute(_id, args) {
          const params = args as {
            title: string;
            description?: string;
            status?: TaskStatus;
            priority?: number;
            blockedBy?: string[];
          };
          try {
            const task = store.create(params);
            return {
              content: [{ type: "text", text: `Created:\n${formatTask(task)}` }],
              details: undefined,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: undefined,
            };
          }
        },
      });

      api.registerTool({
        name: "task_update",
        label: "Task Update",
        description: "Update an existing task's status, title, description, or dependencies.",
        parameters: Type.Object({
          id: Type.String({ description: "Task ID (e.g. task-1)" }),
          status: Type.Optional(
            Type.Union([
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("completed"),
              Type.Literal("cancelled"),
            ]),
          ),
          title: Type.Optional(Type.String()),
          description: Type.Optional(Type.String()),
          priority: Type.Optional(Type.Number()),
          blockedBy: Type.Optional(Type.Array(Type.String())),
        }),
        async execute(_id, args) {
          const { id, ...updates } = args as {
            id: string;
            status?: TaskStatus;
            title?: string;
            description?: string;
            priority?: number;
            blockedBy?: string[];
          };
          try {
            const task = store.update(id, updates);
            return {
              content: [{ type: "text", text: `Updated:\n${formatTask(task)}` }],
              details: undefined,
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              details: undefined,
            };
          }
        },
      });

      api.registerTool({
        name: "task_list",
        label: "Task List",
        description: "List all tasks, optionally filtered by status.",
        parameters: Type.Object({
          status: Type.Optional(
            Type.Union([
              Type.Literal("pending"),
              Type.Literal("in_progress"),
              Type.Literal("completed"),
              Type.Literal("cancelled"),
            ]),
          ),
          includeCompleted: Type.Optional(
            Type.Boolean({ description: "Include completed/cancelled tasks" }),
          ),
        }),
        async execute(_id, args) {
          const { status, includeCompleted } = args as {
            status?: TaskStatus;
            includeCompleted?: boolean;
          };
          const tasks = store.list({ status, includeCompleted });
          if (tasks.length === 0)
            return { content: [{ type: "text", text: "No tasks found." }], details: undefined };
          return {
            content: [
              {
                type: "text",
                text: `**Tasks (${tasks.length}):**\n\n${tasks.map(formatTask).join("\n\n")}`,
              },
            ],
            details: undefined,
          };
        },
      });

      api.registerTool({
        name: "task_get",
        label: "Task Get",
        description: "Get details of a specific task by ID, including dependency status.",
        parameters: Type.Object({ id: Type.String({ description: "Task ID (e.g. task-1)" }) }),
        async execute(_id, args) {
          const { id } = args as { id: string };
          const task = store.get(id);
          if (!task)
            return {
              content: [{ type: "text", text: `Task not found: ${id}` }],
              details: undefined,
            };
          const { blocked, blockers } = store.getBlockedStatus(id);
          let text = formatTask(task);
          if (blocked) text += `\n  **BLOCKED** by incomplete tasks: ${blockers.join(", ")}`;
          return { content: [{ type: "text", text }], details: undefined };
        },
      });
    }

    api.logger.info?.(
      "clawxtool: all modules registered (ask-user, bash-security, cron, git-worktree, memory-age, notebook-edit, secret-scanner, task-manager)",
    );
  },
});
