/**
 * GuardClaw Hooks Registration
 * 
 * Registers all plugin hooks for sensitivity detection at various checkpoints.
 * Implements:
 *   - S1: pass-through (no intervention)
 *   - S2: desensitize content via local model / rules, then forward to cloud
 *   - S3: redirect to isolated guard subsession with local-only model
 *   - Dual session history (full vs clean)
 *   - Memory isolation (MEMORY-FULL.md vs MEMORY.md)
 *   - File-access guards (block cloud models from reading full history/memory)
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { detectSensitivityLevel } from "./detector.js";
import {
  markSessionAsPrivate,
  recordDetection,
  isSessionMarkedPrivate,
  getSessionSensitivity,
  markPreReadFiles,
  isFilePreRead,
} from "./session-state.js";
import { desensitizeWithLocalModel, callLocalModelDirect } from "./local-model.js";
import { getDefaultSessionManager, type SessionMessage } from "./session-manager.js";
import { getDefaultMemoryManager } from "./memory-isolation.js";
import {
  generateGuardSessionKey,
  isGuardSessionKey,
  getGuardAgentConfig,
  buildMainSessionPlaceholder,
  isLocalProvider,
} from "./guard-agent.js";
import { redactSensitiveInfo, isProtectedMemoryPath } from "./utils.js";
import type { PrivacyConfig } from "./types.js";
import { defaultPrivacyConfig } from "./config-schema.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * Privacy-aware system prompt for the guard agent.
 * Instructs the model to never repeat, echo, or include sensitive information in responses.
 */
const GUARD_AGENT_SYSTEM_PROMPT = `## 隐私保护模式 / Privacy Guard Mode

你正在处理一条隐私敏感请求。严格遵守以下规则：

**输出格式规则（最重要）：**
- 只回复一条消息，回复完立即停止
- 禁止生成 [message_id:...] 或 [system:...] 标签
- 禁止模拟多轮对话
- 用中文回复（除非用户用英文提问）

**隐私规则：**
1. 不要复述用户消息中的敏感数据原文（工资数字、身份证号、银行账号、密码等）
2. 可以讨论计算结果、比例、分析结论和建议
3. 用"您的[类型]"代替实际数值，如"您的基本工资"、"您的身份证号"
4. 重点提供：分析结论、异常发现、改进建议、操作步骤

回复要简洁专业，一次说完。`;

/**
 * Register all GuardClaw hooks
 */
export function registerHooks(api: OpenClawPluginApi): void {
  // Initialize memory directories on startup
  const memoryManager = getDefaultMemoryManager();
  memoryManager.initializeDirectories().catch((err) => {
    api.logger.error(`[GuardClaw] Failed to initialize memory directories: ${String(err)}`);
  });

  // =========================================================================
  // Hook 1: message_received — Checkpoint for user messages
  // =========================================================================
  api.on("message_received", async (event, ctx) => {
    try {
      const { message, sessionKey, agentId } = event;

      if (!message || !sessionKey) {
        return;
      }

      const messageText = extractMessageText(message);
      if (!messageText) {
        return;
      }

      // Detect sensitivity level
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onUserMessage",
          message: messageText,
          sessionKey,
          agentId,
        },
        api.pluginConfig
      );

      // Record detection
      recordDetection(sessionKey, result.level, "onUserMessage", result.reason);

      if (result.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Message sensitivity: ${result.level} for session ${sessionKey} — ${result.reason ?? "no reason"}`
        );
      }

      // Persist to dual history
      const sessionManager = getDefaultSessionManager();
      const sessionMessage: SessionMessage = {
        role: "user",
        content: messageText,
        timestamp: Date.now(),
        sessionKey,
      };
      await sessionManager.persistMessage(sessionKey, sessionMessage, agentId ?? "main");

      // Mark session state
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.warn(
          `[GuardClaw] Session ${sessionKey} marked as PRIVATE (S3 detected)`
        );
      } else if (result.level === "S2") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.info(
          `[GuardClaw] S2 detected for session ${sessionKey}. Content will be desensitized for cloud.`
        );
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in message_received hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 2: before_tool_call — Checkpoint for tool calls before execution
  //   S3 tools → BLOCK the call and return an error
  //   S2 tools → allow but log
  //   Also: block cloud model access to protected memory/history paths
  // =========================================================================
  api.on("before_tool_call", async (event, ctx) => {
    try {
      const { toolName, params } = event;
      const sessionKey = ctx.sessionKey ?? "";

      if (!toolName) {
        return;
      }

      // ── File-access guard: block cloud models from reading full history / memory ──
      const typedParams = params as Record<string, unknown>;
      if (typedParams) {
        const privacyConfig = getPrivacyConfigFromApi(api);
        const baseDir = privacyConfig.session?.baseDir ?? "~/.openclaw";
        const pathValues = extractPathValuesFromParams(typedParams);

        // If the session is NOT a guard session (i.e., cloud model context),
        // block access to protected full-history / full-memory paths.
        if (!isGuardSessionKey(sessionKey)) {
          for (const p of pathValues) {
            if (isProtectedMemoryPath(p, baseDir)) {
              api.logger.warn(
                `[GuardClaw] BLOCKED: cloud model tried to access protected path: ${p}`
              );
              return {
                block: true,
                blockReason: `GuardClaw: access to full history/memory is restricted for cloud models (${p})`,
              };
            }
          }
        }
      }

      // ── Block tool reads for files already pre-read in S2 desensitization ──
      if (toolName === "read" || toolName === "read_file" || toolName === "cat") {
        const filePath = String(typedParams?.path ?? typedParams?.file ?? typedParams?.target ?? "");
        if (filePath && isFilePreRead(sessionKey, filePath)) {
          api.logger.info(
            `[GuardClaw] BLOCKED tool ${toolName} for pre-read file: ${filePath} (content already desensitized in prompt)`
          );
          return {
            block: true,
            blockReason: `File content has already been provided in the conversation (desensitized for privacy). No need to read it again.`,
          };
        }
      }

      // ── Sensitivity detection ──
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onToolCallProposed",
          toolName,
          toolParams: typedParams,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      recordDetection(sessionKey, result.level, "onToolCallProposed", result.reason);

      if (result.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Tool call sensitivity: ${result.level} for ${toolName} — ${result.reason ?? "no reason"}`
        );
      }

      // S3 → BLOCK the tool call
      if (result.level === "S3") {
        markSessionAsPrivate(sessionKey, result.level);
        api.logger.warn(
          `[GuardClaw] BLOCKED tool ${toolName} (S3). Session ${sessionKey} marked as PRIVATE.`
        );
        return {
          block: true,
          blockReason: `GuardClaw: tool "${toolName}" blocked — S3 sensitivity detected (${result.reason ?? "sensitive operation"})`,
        };
      }

      // S2 → allow but mark session
      if (result.level === "S2") {
        markSessionAsPrivate(sessionKey, result.level);
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in before_tool_call hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 3: after_tool_call — Checkpoint for tool results
  // =========================================================================
  api.on("after_tool_call", async (event, ctx) => {
    try {
      const { toolName, result } = event;
      const sessionKey = ctx.sessionKey ?? "";

      if (!toolName) {
        return;
      }

      const detectionResult = await detectSensitivityLevel(
        {
          checkpoint: "onToolCallExecuted",
          toolName,
          toolResult: result,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      recordDetection(
        sessionKey,
        detectionResult.level,
        "onToolCallExecuted",
        detectionResult.reason
      );

      if (detectionResult.level !== "S1") {
        api.logger.info(
          `[GuardClaw] Tool result sensitivity: ${detectionResult.level} for ${toolName} — ${detectionResult.reason ?? "no reason"}`
        );
      }

      if (detectionResult.level === "S3" || detectionResult.level === "S2") {
        markSessionAsPrivate(sessionKey, detectionResult.level);
        if (detectionResult.level === "S3") {
          api.logger.warn(
            `[GuardClaw] Tool ${toolName} result contains S3 content. Session ${sessionKey} marked as PRIVATE.`
          );
        }
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in after_tool_call hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 4: tool_result_persist — Control dual-history persistence
  // =========================================================================
  api.on("tool_result_persist", (event, ctx) => {
    try {
      const { message, sessionKey } = event;
      const isPrivate = isSessionMarkedPrivate(sessionKey ?? "");

      if (isPrivate && sessionKey) {
        // Persist to full history (includes everything)
        const sessionManager = getDefaultSessionManager();
        const msgText = typeof message === "string" ? message : JSON.stringify(message);
        const sessionMessage: SessionMessage = {
          role: "tool",
          content: msgText,
          timestamp: Date.now(),
          sessionKey,
        };
        // Fire-and-forget async write
        sessionManager.persistMessage(sessionKey, sessionMessage).catch((err) => {
          console.error(`[GuardClaw] Failed to persist tool result to dual history:`, err);
        });

        api.logger.debug(
          `[GuardClaw] Tool result in private session ${sessionKey}, dual history write triggered`
        );
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in tool_result_persist hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 5: session_end — Cleanup and memory sync
  // =========================================================================
  api.on("session_end", async (event, ctx) => {
    try {
      const { sessionKey } = event;

      if (sessionKey) {
        const wasPrivate = isSessionMarkedPrivate(sessionKey);
        if (wasPrivate) {
          api.logger.info(
            `[GuardClaw] Private session ${sessionKey} ended. Syncing memory…`
          );

          // Sync full memory → clean memory (strip guard agent sections)
          const memMgr = getDefaultMemoryManager();
          await memMgr.syncMemoryToClean();
        }
        // Note: We keep session state for audit purposes
      }
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in session_end hook: ${String(err)}`);
    }
  });

  // =========================================================================
  // Hook 6: resolve_model — Model + session routing
  //
  //   S1 → pass-through (cloud model, normal session)
  //   S2 → desensitize content, send desensitized version to cloud model
  //   S3 → redirect to guard subsession with local-only model
  // =========================================================================
  api.on("resolve_model", async (event, ctx) => {
    try {
      const { message, provider, model } = event;
      const sessionKey = ctx.sessionKey ?? "";

      api.logger.info(
        `[GuardClaw] resolve_model called: sessionKey=${sessionKey}, message=${String(message).slice(0, 50)}, provider=${provider}, model=${model}`
      );

      if (!sessionKey) {
        api.logger.info(`[GuardClaw] resolve_model: no sessionKey, returning`);
        return;
      }

      const privacyConfig = getPrivacyConfigFromApi(api);
      api.logger.info(
        `[GuardClaw] resolve_model: enabled=${privacyConfig.enabled}, localModel=${privacyConfig.localModel?.enabled}, checkpoints=${JSON.stringify(privacyConfig.checkpoints?.onUserMessage)}`
      );
      if (!privacyConfig.enabled) {
        api.logger.info(`[GuardClaw] resolve_model: privacy disabled, returning`);
        return;
      }

      // If already in a guard session, enforce local model
      if (isGuardSessionKey(sessionKey)) {
        const guardCfg = getGuardAgentConfig(privacyConfig);
        if (guardCfg && (!isLocalProvider(provider ?? "") || model !== guardCfg.modelName)) {
          return {
            provider: guardCfg.provider,
            model: guardCfg.modelName,
            reason: "GuardClaw: guard session must use local model",
          };
        }
        return; // already correct
      }

      // Detect sensitivity of current message
      if (!message) {
        api.logger.info(`[GuardClaw] resolve_model: no message, returning`);
        return;
      }

      // Skip if message was already desensitized (prevent double resolve_model runs)
      const msgStr = String(message);
      if (msgStr.includes("[REDACTED:") || msgStr.startsWith("[SYSTEM]")) {
        api.logger.info(`[GuardClaw] resolve_model: already processed or internal prompt, skipping`);
        return;
      }

      api.logger.info(`[GuardClaw] resolve_model: calling detectSensitivityLevel with message="${msgStr.slice(0, 80)}"`);
      
      const result = await detectSensitivityLevel(
        {
          checkpoint: "onUserMessage",
          message,
          sessionKey,
          agentId: ctx.agentId,
        },
        api.pluginConfig
      );

      api.logger.info(
        `[GuardClaw] resolve_model: detection result: level=${result.level}, reason=${result.reason}`
      );

      recordDetection(sessionKey, result.level, "onUserMessage", result.reason);

      // ── S3: call local model directly, bypass full agent pipeline ──
      if (result.level === "S3") {
        const guardCfg = getGuardAgentConfig(privacyConfig);
        const guardProvider = guardCfg?.provider ?? "ollama";
        const guardModelName = guardCfg?.modelName ?? "openbmb/minicpm4.1";
        const ollamaEndpoint = privacyConfig.localModel?.endpoint ?? "http://localhost:11434";

        markSessionAsPrivate(sessionKey, result.level);

        api.logger.info(
          `[GuardClaw] S3 detected. Calling local model directly: ${guardModelName}`
        );

        // Emit UI event
        api.emitEvent("privacy_activated", {
          active: true,
          level: result.level,
          model: `${guardProvider}/${guardModelName}`,
          provider: guardProvider,
          reason: result.reason ?? "S3 content detected",
          sessionKey,
        });

        // Pre-read any referenced files so the guard model has the data
        const workspaceDir = api.config.agents?.defaults?.workspace ?? process.cwd();
        let fileContent: string | undefined;
        try {
          fileContent = await tryReadReferencedFile(message, workspaceDir);
          if (fileContent) {
            api.logger.info(`[GuardClaw] Pre-read file for S3 guard (${fileContent.length} chars)`);
          }
        } catch (fileErr) {
          api.logger.warn(`[GuardClaw] Failed to pre-read file: ${String(fileErr)}`);
        }

        // Build user prompt with file content
        let fullUserMessage = message;
        if (fileContent) {
          fullUserMessage += `\n\n--- 文件内容 ---\n${fileContent}\n--- 文件内容结束 ---`;
        }

        // Call Ollama directly with minimal prompt — bypasses OpenClaw's 21k system prompt
        try {
          const directReply = await callLocalModelDirect(
            GUARD_AGENT_SYSTEM_PROMPT,
            fullUserMessage,
            { endpoint: ollamaEndpoint, model: guardModelName },
          );

          api.logger.info(
            `[GuardClaw] S3 direct response (${directReply.length} chars): "${directReply.slice(0, 100)}..."`
          );

          return {
            reason: `GuardClaw: S3 — processed locally by ${guardModelName}`,
            provider: guardProvider,
            model: guardModelName,
            directResponse: `🔒 [本地隐私模型处理]\n\n${directReply}`,
          };
        } catch (ollamaErr) {
          api.logger.error(`[GuardClaw] Failed to call local model directly: ${String(ollamaErr)}`);
          // Fall through to let normal pipeline handle it as a fallback
        }
      }

      // ── S2: desensitize content, then forward to cloud model ──
      if (result.level === "S2") {
        markSessionAsPrivate(sessionKey, result.level);

        api.logger.info(
          `[GuardClaw] S2 detected. Desensitizing content for cloud model.`
        );

        // Check if the message references a file — if so, pre-read and desensitize the FILE content
        const workspaceDir = api.config.agents?.defaults?.workspace ?? process.cwd();
        let fileContent: string | undefined;
        try {
          fileContent = await tryReadReferencedFile(message, workspaceDir);
          if (fileContent) {
            api.logger.info(`[GuardClaw] Pre-read file for S2 desensitization (${fileContent.length} chars)`);
          }
        } catch (fileErr) {
          api.logger.warn(`[GuardClaw] Failed to pre-read file for S2: ${String(fileErr)}`);
        }

        let desensitizedPrompt: string;
        let wasModelUsed = false;

        if (fileContent) {
          // File-reference case: desensitize the FILE CONTENT, keep the request intact
          const { desensitized: desensitizedFile, wasModelUsed: fileModelUsed } =
            await desensitizeWithLocalModel(fileContent, privacyConfig);
          wasModelUsed = fileModelUsed;

          // Strip file path from message so cloud model doesn't try to read it again
          const filePathPattern = /(?:[\w./-]+\/)?[\w\u4e00-\u9fff._-]+\.(?:xlsx|xls|csv|txt|docx|json|md)/g;
          const taskDescription = message.replace(filePathPattern, "").replace(/\s{2,}/g, " ").trim();

          // Build a prompt: task description (no file path) + desensitized content + clear instructions
          desensitizedPrompt = `用户请求：${taskDescription}\n\n以下是文件内容（已脱敏，隐私信息已替换为 [REDACTED:xxx] 标记）：\n--- 文件内容 ---\n${desensitizedFile}\n--- 文件内容结束 ---\n\n请直接基于上述已脱敏的文件内容完成任务。不需要读取任何文件，内容已提供在上方。在你的回复中，不要出现任何 [REDACTED:xxx] 标记——直接省略隐私信息，用自然语言概括即可（例如"您的地址"、"您的电话"等）。`;
          api.logger.info(
            `[GuardClaw] S2 file desensitization complete (model=${wasModelUsed}, ${desensitizedFile.length} chars)`
          );

          // Track which files were pre-read so we can block tool reads for them
          markPreReadFiles(sessionKey, message);
        } else {
          // Inline PII case: desensitize the user message directly
          const { desensitized, wasModelUsed: msgModelUsed } =
            await desensitizeWithLocalModel(message, privacyConfig);
          wasModelUsed = msgModelUsed;
          desensitizedPrompt = desensitized;
          api.logger.info(
            `[GuardClaw] S2 message desensitization complete (model=${wasModelUsed})`
          );
        }

        // Persist the ORIGINAL message to full history
        const sessionManager = getDefaultSessionManager();
        await sessionManager.persistMessage(sessionKey, {
          role: "user",
          content: message,
          timestamp: Date.now(),
          sessionKey,
        });

        // Emit UI event
        api.emitEvent("privacy_activated", {
          active: true,
          level: result.level,
          desensitized: true,
          wasModelUsed,
          reason: result.reason ?? "S2 content detected — desensitized",
          sessionKey,
        });

        // Forward the DESENSITIZED content to cloud (don't change provider/model)
        return {
          reason: `GuardClaw: S2 — content desensitized before cloud delivery`,
          userPromptOverride: desensitizedPrompt,
        };
      }

      // ── S1: no intervention ──
      // Session is clean, use cloud model normally
    } catch (err) {
      api.logger.error(`[GuardClaw] Error in resolve_model hook: ${String(err)}`);
    }
  });

  api.logger.info("[GuardClaw] All hooks registered successfully");
}

// ==========================================================================
// Helpers
// ==========================================================================

/**
 * Merge user config with defaults and return typed PrivacyConfig
 */
function getPrivacyConfigFromApi(api: OpenClawPluginApi): PrivacyConfig {
  return mergeWithDefaults(
    (api.pluginConfig?.privacy as PrivacyConfig) ?? {},
    defaultPrivacyConfig
  );
}

function mergeWithDefaults(
  userConfig: PrivacyConfig,
  defaults: typeof defaultPrivacyConfig
): PrivacyConfig {
  return {
    enabled: userConfig.enabled ?? defaults.enabled,
    checkpoints: {
      onUserMessage: userConfig.checkpoints?.onUserMessage ?? defaults.checkpoints?.onUserMessage,
      onToolCallProposed:
        userConfig.checkpoints?.onToolCallProposed ?? defaults.checkpoints?.onToolCallProposed,
      onToolCallExecuted:
        userConfig.checkpoints?.onToolCallExecuted ?? defaults.checkpoints?.onToolCallExecuted,
    },
    rules: {
      keywords: {
        S2: userConfig.rules?.keywords?.S2 ?? defaults.rules?.keywords?.S2,
        S3: userConfig.rules?.keywords?.S3 ?? defaults.rules?.keywords?.S3,
      },
      patterns: {
        S2: userConfig.rules?.patterns?.S2 ?? defaults.rules?.patterns?.S2,
        S3: userConfig.rules?.patterns?.S3 ?? defaults.rules?.patterns?.S3,
      },
      tools: {
        S2: {
          tools: userConfig.rules?.tools?.S2?.tools ?? defaults.rules?.tools?.S2?.tools,
          paths: userConfig.rules?.tools?.S2?.paths ?? defaults.rules?.tools?.S2?.paths,
        },
        S3: {
          tools: userConfig.rules?.tools?.S3?.tools ?? defaults.rules?.tools?.S3?.tools,
          paths: userConfig.rules?.tools?.S3?.paths ?? defaults.rules?.tools?.S3?.paths,
        },
      },
    },
    localModel: {
      enabled: userConfig.localModel?.enabled ?? defaults.localModel?.enabled,
      provider: userConfig.localModel?.provider ?? defaults.localModel?.provider,
      model: userConfig.localModel?.model ?? defaults.localModel?.model,
      endpoint: userConfig.localModel?.endpoint ?? defaults.localModel?.endpoint,
    },
    guardAgent: {
      id: userConfig.guardAgent?.id ?? defaults.guardAgent?.id,
      workspace: userConfig.guardAgent?.workspace ?? defaults.guardAgent?.workspace,
      model: userConfig.guardAgent?.model ?? defaults.guardAgent?.model,
    },
    session: {
      isolateGuardHistory:
        userConfig.session?.isolateGuardHistory ?? defaults.session?.isolateGuardHistory,
      baseDir: userConfig.session?.baseDir ?? defaults.session?.baseDir,
    },
  };
}

/**
 * Extract text from message object
 */
function extractMessageText(message: unknown): string | undefined {
  if (typeof message === "string") {
    return message;
  }

  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    if (typeof msg.text === "string") return msg.text;
    if (typeof msg.content === "string") return msg.content;
    if (typeof msg.body === "string") return msg.body;
  }

  return undefined;
}

/**
 * Build a wrapped user prompt for the guard agent (S3)
 */
function buildGuardUserPrompt(
  originalMessage: string,
  level: string,
  reason?: string,
  fileContent?: string
): string {
  let prompt = `[Privacy Level: ${level}${reason ? ` — ${reason}` : ""}]

${originalMessage}`;

  if (fileContent) {
    prompt += `\n\n--- FILE CONTENT (read locally, never sent to cloud) ---\n${fileContent}\n--- END FILE CONTENT ---`;
  }

  return prompt;
}

/**
 * Try to read a file referenced in the user message.
 * Supports text files directly and xlsx/docx via conversion.
 */
async function tryReadReferencedFile(
  message: string,
  workspaceDir: string
): Promise<string | undefined> {
  // Extract file paths from the message (e.g. test-files/foo.xlsx, /path/to/file.txt)
  const filePattern = /(?:^|\s)((?:[\w./-]+\/)?[\w\u4e00-\u9fff._-]+\.(?:xlsx|xls|csv|txt|docx|json|md))\b/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = filePattern.exec(message)) !== null) {
    matches.push(m[1]);
  }

  if (matches.length === 0) return undefined;

  // Try multiple base directories — workspace first, cwd, then parent of cwd as fallback
  const cwd = process.cwd();
  const baseDirs = [
    workspaceDir,
    cwd,
    resolve(cwd, ".."),  // parent dir (gateway may run from openclaw/ subdir)
  ].filter(Boolean);

  for (const filePath of matches) {
    try {
      let absPath = "";
      for (const base of baseDirs) {
        const candidate = resolve(base, filePath);
        if (existsSync(candidate)) {
          absPath = candidate;
          break;
        }
      }
      // Also try the file path as-is (if absolute)
      if (!absPath && existsSync(filePath)) absPath = resolve(filePath);
      if (!absPath) continue;

      const ext = filePath.split(".").pop()?.toLowerCase();

      if (ext === "xlsx" || ext === "xls") {
        // Convert xlsx → csv via xlsx2csv or python
        try {
          const csv = execSync(`xlsx2csv "${absPath}"`, {
            encoding: "utf-8",
            timeout: 10000,
          });
          return `[Converted from ${filePath}]\n${csv}`;
        } catch {
          try {
            const csv = execSync(
              `python3 -c "import openpyxl; wb=openpyxl.load_workbook('${absPath}'); ws=wb.active; [print(','.join(str(c.value or '') for c in row)) for row in ws.iter_rows()]"`,
              { encoding: "utf-8", timeout: 10000 }
            );
            return `[Converted from ${filePath}]\n${csv}`;
          } catch {
            return undefined;
          }
        }
      } else if (ext === "docx") {
        // Try to extract text from docx
        try {
          const text = execSync(
            `python3 -c "from docx import Document; d=Document('${absPath}'); print('\\n'.join(p.text for p in d.paragraphs))"`,
            { encoding: "utf-8", timeout: 10000 }
          );
          return `[Extracted from ${filePath}]\n${text}`;
        } catch {
          return undefined;
        }
      } else {
        // Text file — read directly
        const content = await readFile(absPath, "utf-8");
        return `[Content of ${filePath}]\n${content.slice(0, 10000)}`;
      }
    } catch {
      // Skip files we can't read
      continue;
    }
  }

  return undefined;
}

/**
 * Extract path-like values from tool params for file-access guarding
 */
function extractPathValuesFromParams(params: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const pathKeys = ["path", "file", "filepath", "filename", "dir", "directory", "target", "source"];

  for (const key of pathKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      paths.push(value.trim());
    }
  }

  // Recurse into nested objects
  for (const value of Object.values(params)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...extractPathValuesFromParams(value as Record<string, unknown>));
    }
  }

  return paths;
}
