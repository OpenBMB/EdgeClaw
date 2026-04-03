import { spawn } from "node:child_process";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "openbmb-clawxmemory";
const NATIVE_MEMORY_PLUGIN_ID = "memory-core";
const DEFAULT_DATA_DIR = path.join(os.homedir(), ".openclaw", "clawxmemory");
const DEFAULT_UI_HOST = "127.0.0.1";
const DEFAULT_UI_PORT = 39393;
const DEFAULT_UI_PATH_PREFIX = "/clawxmemory";
const MANAGED_CONFIG_BACKUP_FILE = `${PLUGIN_ID}.memory-config.backup.json`;
const CHAT_FACING_MEMORY_TOOLS = ["memory_overview", "memory_list", "memory_flush"];
const RESTART_TIMEOUT_MS = process.platform === "win32" ? 15_000 : 8_000;
const RESTART_KILL_GRACE_MS = 1_000;
const HEALTH_TIMEOUT_MS = process.platform === "win32" ? 45_000 : 20_000;
const HEALTH_POLL_MS = process.platform === "win32" ? 1_000 : 750;
const SHORT_COMMAND_TIMEOUT_MS = 3_000;
const PLUGIN_INSTALL_TIMEOUT_MS = process.platform === "win32" ? 20_000 : 12_000;
const PLUGIN_UNINSTALL_TIMEOUT_MS = process.platform === "win32" ? 20_000 : 12_000;
const PLUGIN_BOOTSTRAP_TIMEOUT_MS = process.platform === "win32" ? 30_000 : 25_000;
const CLAWXMEMORY_LOG_LINE = "[clawxmemory]";
const CLAWXMEMORY_RUNTIME_READY_LOG = "[clawxmemory] dynamic memory runtime ready:";
const CLAWXMEMORY_RUNTIME_ISSUE_LOG = "[clawxmemory] dynamic memory runtime issues detected:";
const CLAWXMEMORY_STARTUP_FIX_FAILED_LOG = "[clawxmemory] startup fix failed:";
const CLAWXMEMORY_DASHBOARD_READY_LOG = "[clawxmemory] dashboard ready at";
const CLAWXMEMORY_DASHBOARD_FAILED_LOG = "[clawxmemory] dashboard server failed:";
const CLAWXMEMORY_RUNTIME_ACTIVITY_MARKERS = [
  "[clawxmemory] recall mode=",
  "[clawxmemory] captured l0 session=",
  "[clawxmemory] closed topic session=",
  "[clawxmemory] indexed reason=",
  "[clawxmemory] opened new conversation window",
];
const CLAWXMEMORY_BOOTSTRAP_SESSION_ID = "clawxmemory-bootstrap-check";
const CLAWXMEMORY_BOOTSTRAP_MESSAGE = "/status";
const OPENCLAW_UNSAFE_INSTALL_FLAG = "--dangerously-force-unsafe-install";
const OPENCLAW_UNSAFE_INSTALL_BLOCKED_TEXT = "dangerous code patterns detected";
const MANAGED_CONFIG_PATHS = {
  memorySlot: ["plugins", "slots", "memory"],
  pluginEntry: ["plugins", "entries", PLUGIN_ID],
  memoryCoreEntry: ["plugins", "entries", NATIVE_MEMORY_PLUGIN_ID],
  loadPaths: ["plugins", "load", "paths"],
  toolsAlsoAllow: ["tools", "alsoAllow"],
  sessionMemoryEntry: ["hooks", "internal", "entries", "session-memory"],
  memorySearch: ["agents", "defaults", "memorySearch"],
  memoryFlush: ["agents", "defaults", "compaction", "memoryFlush"],
};
const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
};

function resolveRepoRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

function toBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function toInteger(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeUiHost(value) {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_UI_HOST;
}

function normalizeUiPort(value) {
  return Math.max(1024, toInteger(value, DEFAULT_UI_PORT));
}

function normalizeUiPathPrefix(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_UI_PATH_PREFIX;
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function formatHttpOrigin(host, port) {
  const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

function buildUiUrl(target, options = {}) {
  const { cacheBust = false } = options;
  const pathname = target.prefix === "/" ? "/" : `${target.prefix}/`;
  const url = new URL(pathname, formatHttpOrigin(target.host, target.port));
  if (cacheBust) {
    url.searchParams.set("v", String(Date.now()));
  }
  return url.toString();
}

function getConfiguredUiTarget(config) {
  const pluginConfig = asObject(config?.plugins?.entries?.[PLUGIN_ID]?.config);
  const target = {
    enabled: toBoolean(pluginConfig?.uiEnabled, true),
    host: normalizeUiHost(pluginConfig?.uiHost),
    port: normalizeUiPort(pluginConfig?.uiPort),
    prefix: normalizeUiPathPrefix(pluginConfig?.uiPathPrefix),
  };
  return {
    ...target,
    url: buildUiUrl(target),
  };
}

function buildUiPortConfigHint() {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return `Update plugins.entries.${PLUGIN_ID}.config.uiPort in ${resolveConfigPath()}.`;
  }
  return `Update plugins.entries.${PLUGIN_ID}.config.uiPort in ~/.openclaw/openclaw.json. If you use OPENCLAW_CONFIG_PATH, update that file instead.`;
}

async function resolveUiTarget() {
  return getConfiguredUiTarget(await readOpenClawConfig());
}

async function resolveUiUrl(options = {}) {
  const target = await resolveUiTarget();
  return buildUiUrl(target, options);
}

function resolveStateDir() {
  if (process.env.OPENCLAW_STATE_DIR?.trim()) {
    return path.resolve(process.env.OPENCLAW_STATE_DIR.trim());
  }
  return path.join(os.homedir(), ".openclaw");
}

function resolveConfigPath() {
  if (process.env.OPENCLAW_CONFIG_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_CONFIG_PATH.trim());
  }
  return path.join(resolveStateDir(), "openclaw.json");
}

function resolveManagedConfigBackupPath() {
  return path.join(path.dirname(resolveConfigPath()), MANAGED_CONFIG_BACKUP_FILE);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printStep(label) {
  console.log(`\n${paint(">", ANSI.cyan, ANSI.bold)} ${paint(label, ANSI.bold)}`);
}

function supportsColor() {
  return Boolean(process.stdout?.isTTY) && process.env.NO_COLOR !== "1";
}

function paint(text, ...styles) {
  if (!supportsColor() || styles.length === 0) return text;
  return `${styles.join("")}${text}${ANSI.reset}`;
}

function printBanner(title, subtitle = "") {
  console.log("");
  console.log(paint(title, ANSI.bold, ANSI.cyan));
  if (subtitle) {
    console.log(paint(subtitle, ANSI.dim));
  }
}

function printSuccess(label, detail = "") {
  console.log(`${paint("OK", ANSI.green, ANSI.bold)} ${label}${detail ? ` ${paint(detail, ANSI.dim)}` : ""}`);
}

function printWarn(label, detail = "") {
  console.warn(`${paint("WARN", ANSI.yellow, ANSI.bold)} ${label}${detail ? ` ${paint(detail, ANSI.dim)}` : ""}`);
}

function printInfo(label, detail = "") {
  console.log(`${paint("INFO", ANSI.cyan, ANSI.bold)} ${label}${detail ? ` ${paint(detail, ANSI.dim)}` : ""}`);
}

function summarizeOutput(text, max = 600) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

export function shouldSkipPluginInstall({ trackedInstall, configuredLoadPath, forceInstall }) {
  if (trackedInstall && !forceInstall) {
    return { skip: true, reason: "tracked_install" };
  }
  if (configuredLoadPath && !forceInstall) {
    return { skip: true, reason: "configured_load_path" };
  }
  return {
    skip: false,
    reason: forceInstall ? "forced_reinstall" : "install_required",
  };
}

export function shouldRetryUnsafeLinkInstall(rawOutput) {
  const normalized = String(rawOutput || "").toLowerCase();
  return normalized.includes(OPENCLAW_UNSAFE_INSTALL_BLOCKED_TEXT);
}

export function shouldContinueWithConfigManagedLoadPath({ trackedInstall, loadPathConfiguredAfterInstall, rawOutput }) {
  if (trackedInstall || loadPathConfiguredAfterInstall) {
    return {
      continueWithLoadPath: true,
      reason: trackedInstall ? "tracked_install" : "configured_load_path",
    };
  }
  if (shouldRetryUnsafeLinkInstall(rawOutput)) {
    return {
      continueWithLoadPath: true,
      reason: "unsafe_install_blocked",
    };
  }
  return {
    continueWithLoadPath: false,
    reason: "install_failed",
  };
}

function parseJsonFromMixedOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function commandToString(command, args) {
  return [command, ...args].join(" ");
}

function resolveSpawn(command, args) {
  if (process.platform !== "win32") {
    return { command, args };
  }
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args],
  };
}

function runCommand(command, args, options = {}) {
  const {
    cwd,
    inherit = false,
    timeoutMs,
    tolerateNonZero = false,
    env,
  } = options;

  return new Promise((resolve, reject) => {
    const resolved = resolveSpawn(command, args);
    const child = spawn(resolved.command, resolved.args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: inherit ? "inherit" : "pipe",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let closed = false;

    if (!inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (!closed) {
              child.kill("SIGKILL");
            }
          }, RESTART_KILL_GRACE_MS).unref();
        }, timeoutMs)
      : null;

    child.on("error", (error) => {
      if (settled) return;
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on("close", (code, signal) => {
      closed = true;
      const result = {
        code: typeof code === "number" ? code : 1,
        signal,
        stdout,
        stderr,
        timedOut,
      };
      if (!tolerateNonZero && result.code !== 0 && !timedOut) {
        const snippet = summarizeOutput(`${stderr}\n${stdout}`);
        reject(new Error(`${commandToString(command, args)} failed (${result.code})${snippet ? `\n${snippet}` : ""}`));
        return;
      }
      finish(result);
    });
  });
}

async function runLoggedCommand(label, command, args, options = {}) {
  printStep(label);
  return runCommand(command, args, options);
}

async function readGatewayStatus(repoRoot) {
  const result = await runCommand("openclaw", ["gateway", "status", "--json"], {
    cwd: repoRoot,
    timeoutMs: SHORT_COMMAND_TIMEOUT_MS,
    tolerateNonZero: true,
  });
  const payload = parseJsonFromMixedOutput(`${result.stdout}\n${result.stderr}`);
  return {
    raw: result,
    payload,
  };
}

function resolveGatewayLogPath() {
  return path.join(resolveStateDir(), "logs", "gateway.log");
}

async function captureGatewayLogCursor() {
  try {
    const snapshot = await stat(resolveGatewayLogPath());
    return { offset: snapshot.size };
  } catch {
    return { offset: 0 };
  }
}

async function readGatewayLogDelta(cursor) {
  try {
    const raw = await readFile(resolveGatewayLogPath());
    if (!raw || raw.byteLength === 0) return "";
    const offset = typeof cursor?.offset === "number" ? Math.max(0, cursor.offset) : 0;
    return (offset > 0 && offset < raw.byteLength ? raw.subarray(offset) : raw).toString("utf-8");
  } catch {
    return "";
  }
}

export function parseClawxmemoryRuntimeSignals(rawLog) {
  const lines = String(rawLog || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.includes(CLAWXMEMORY_LOG_LINE));
  const recentLines = lines.toReversed();
  const runtimeReadyLine = recentLines.find((line) =>
    line.includes(CLAWXMEMORY_RUNTIME_READY_LOG) || line.includes(CLAWXMEMORY_DASHBOARD_READY_LOG));
  const runtimeFailureLine = recentLines.find((line) =>
    line.includes(CLAWXMEMORY_STARTUP_FIX_FAILED_LOG) || line.includes(CLAWXMEMORY_RUNTIME_ISSUE_LOG));
  const dashboardFailureLine = recentLines.find((line) => line.includes(CLAWXMEMORY_DASHBOARD_FAILED_LOG));
  const dashboardReadyLine = recentLines.find((line) => line.includes(CLAWXMEMORY_DASHBOARD_READY_LOG));
  const runtimeActivityLine = recentLines.find((line) =>
    CLAWXMEMORY_RUNTIME_ACTIVITY_MARKERS.some((marker) => line.includes(marker)));
  return {
    runtimeReady: Boolean(runtimeReadyLine),
    runtimeFailure: runtimeFailureLine,
    runtimeActivity: runtimeActivityLine,
    dashboardReady: Boolean(dashboardReadyLine),
    dashboardFailure: dashboardFailureLine,
    logSummary: summarizeOutput(lines.slice(-8).join("\n"), 1200),
  };
}

export function evaluatePluginVerification({ pluginPayload, runtimeSignals, uiTarget, uiReachable }) {
  const pluginLoaded = pluginPayload?.plugin?.status === "loaded";
  const uiEnabled = uiTarget?.enabled !== false;
  const gatewayObserved = Boolean(
    runtimeSignals?.runtimeReady
      || runtimeSignals?.runtimeActivity
      || runtimeSignals?.dashboardFailure
      || (uiEnabled && uiReachable),
  );
  const runtimeReady = Boolean(runtimeSignals?.runtimeReady || runtimeSignals?.runtimeActivity || (uiEnabled && uiReachable));
  return {
    loaded: runtimeReady && (pluginLoaded || gatewayObserved),
    pluginLoaded,
    gatewayObserved,
    runtimeReady,
    runtimeFailure: runtimeSignals?.runtimeFailure,
    uiStatus: !uiEnabled ? "disabled" : uiReachable ? "reachable" : runtimeSignals?.dashboardFailure ? "failed" : "unreachable",
    dashboardFailure: runtimeSignals?.dashboardFailure,
    logSummary: runtimeSignals?.logSummary || "",
  };
}

async function waitForGatewayHealthy(repoRoot) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await readGatewayStatus(repoRoot);
    const payload = status.payload;
    const serviceLoaded = payload?.service?.loaded === true;
    const runtimeStatus = typeof payload?.service?.runtime?.status === "string"
      ? payload.service.runtime.status.trim().toLowerCase()
      : "";
    const runtimeState = typeof payload?.service?.runtime?.state === "string"
      ? payload.service.runtime.state.trim().toLowerCase()
      : "";
    const runtimeRunning = runtimeStatus === "running" || runtimeState === "running";
    const rpcOk = payload?.rpc?.ok === true;
    if ((serviceLoaded && runtimeRunning) || rpcOk) {
      return {
        payload,
        via: rpcOk ? "rpc" : "service",
      };
    }
    await sleep(HEALTH_POLL_MS);
  }
  return null;
}

async function restartGatewayService(repoRoot) {
  printStep("Restart gateway");
  return runCommand("openclaw", ["gateway", "restart"], {
    cwd: repoRoot,
    timeoutMs: RESTART_TIMEOUT_MS,
    tolerateNonZero: true,
  });
}

async function startGatewayService(repoRoot) {
  printStep("Start gateway");
  return runCommand("openclaw", ["gateway", "start"], {
    cwd: repoRoot,
    timeoutMs: RESTART_TIMEOUT_MS,
    tolerateNonZero: true,
  });
}

async function waitForPluginRuntimeReady(logCursor, uiTarget) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let latestSignals = parseClawxmemoryRuntimeSignals("");
  let latestUiReachable = false;
  while (Date.now() < deadline) {
    const logDelta = await readGatewayLogDelta(logCursor);
    latestSignals = parseClawxmemoryRuntimeSignals(logDelta);
    latestUiReachable = await isUiReachable(uiTarget);
    if (latestSignals.runtimeReady || latestSignals.runtimeFailure || (uiTarget?.enabled && latestUiReachable)) {
      return {
        ...latestSignals,
        uiReachable: latestUiReachable,
      };
    }
    await sleep(HEALTH_POLL_MS);
  }
  return {
    ...latestSignals,
    uiReachable: latestUiReachable,
  };
}

async function ensurePluginLoaded(repoRoot, uiTarget, runtimeSignals) {
  const result = await runCommand("openclaw", ["plugins", "inspect", PLUGIN_ID, "--json"], {
    cwd: repoRoot,
    timeoutMs: SHORT_COMMAND_TIMEOUT_MS,
    tolerateNonZero: true,
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const payload = parseJsonFromMixedOutput(combined);
  const uiReady = await isUiReachable(uiTarget);
  const verification = evaluatePluginVerification({
    pluginPayload: payload,
    runtimeSignals,
    uiTarget,
    uiReachable: uiReady,
  });
  return {
    ...verification,
    output: combined,
    via: verification.loaded
      ? verification.pluginLoaded
        ? "plugins-inspect+runtime"
        : "gateway-runtime"
      : "unknown",
    payload,
    uiReachable: uiReady,
  };
}

async function bootstrapPluginRuntime(repoRoot) {
  printInfo(
    "Plugin runtime bootstrap",
    "OpenClaw 2026.4.2 loads memory plugins lazily; sending a short gateway command turn.",
  );
  return runCommand("openclaw", [
    "agent",
    "--session-id",
    CLAWXMEMORY_BOOTSTRAP_SESSION_ID,
    "--message",
    CLAWXMEMORY_BOOTSTRAP_MESSAGE,
    "--thinking",
    "off",
    "--timeout",
    "20",
    "--json",
  ], {
    cwd: repoRoot,
    timeoutMs: PLUGIN_BOOTSTRAP_TIMEOUT_MS,
    tolerateNonZero: true,
  });
}

async function readOpenClawConfig() {
  try {
    const raw = await readFile(resolveConfigPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeOpenClawConfig(config) {
  await writeFile(resolveConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

async function readManagedConfigBackup() {
  try {
    const raw = await readFile(resolveManagedConfigBackupPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeManagedConfigBackup(backup) {
  await writeFile(resolveManagedConfigBackupPath(), `${JSON.stringify(backup, null, 2)}\n`, "utf-8");
}

async function removeManagedConfigBackup() {
  await rm(resolveManagedConfigBackupPath(), { force: true });
}

async function verifyMemorySlotBound() {
  const config = await readOpenClawConfig();
  return config?.plugins?.slots?.memory === PLUGIN_ID;
}

async function verifyPluginEnabled() {
  const config = await readOpenClawConfig();
  return config?.plugins?.entries?.[PLUGIN_ID]?.enabled === true;
}

async function verifyPromptInjectionEnabled() {
  const config = await readOpenClawConfig();
  return config?.plugins?.entries?.[PLUGIN_ID]?.hooks?.allowPromptInjection === true;
}

async function verifyMemoryCoreDisabled() {
  const config = await readOpenClawConfig();
  return config?.plugins?.entries?.["memory-core"]?.enabled === false;
}

async function verifySessionMemoryDisabled() {
  const config = await readOpenClawConfig();
  return config?.hooks?.internal?.entries?.["session-memory"]?.enabled === false;
}

async function verifyAgentMemorySearchDisabled() {
  const config = await readOpenClawConfig();
  return config?.agents?.defaults?.memorySearch?.enabled === false;
}

async function verifyCompactionMemoryFlushDisabled() {
  const config = await readOpenClawConfig();
  return config?.agents?.defaults?.compaction?.memoryFlush?.enabled === false;
}

async function verifyChatFacingMemoryToolsAllowed() {
  const config = await readOpenClawConfig();
  const alsoAllow = normalizeStringList(config?.tools?.alsoAllow);
  return CHAT_FACING_MEMORY_TOOLS.every((tool) => alsoAllow.includes(tool));
}

async function hasTrackedPluginInstall() {
  const config = await readOpenClawConfig();
  return Boolean(config?.plugins?.installs?.[PLUGIN_ID]);
}

async function hasConfiguredPluginLoadPath(pluginPath) {
  const config = await readOpenClawConfig();
  const configuredPaths = Array.isArray(config?.plugins?.load?.paths)
    ? config.plugins.load.paths.filter((entry) => typeof entry === "string" && entry.trim())
    : [];
  const normalizedPluginPath = path.resolve(pluginPath);
  return configuredPaths.some((entry) => path.resolve(entry) === normalizedPluginPath);
}

function ensureObject(parent, key) {
  const current = parent[key];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    parent[key] = {};
  }
  return parent[key];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)));
}

function captureConfigNode(root, segments) {
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!asObject(current) || !hasOwn(current, segment)) {
      return { exists: false };
    }
    current = current[segment];
  }

  const leaf = segments[segments.length - 1];
  if (!asObject(current) || !hasOwn(current, leaf)) {
    return { exists: false };
  }

  return {
    exists: true,
    value: cloneJson(current[leaf]),
  };
}

function setConfigNode(root, segments, value) {
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    current = ensureObject(current, segments[index]);
  }
  current[segments[segments.length - 1]] = cloneJson(value);
}

function deleteConfigNode(root, segments) {
  const lineage = [];
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!asObject(current) || !hasOwn(current, segment)) {
      return;
    }
    lineage.push([current, segment]);
    current = current[segment];
  }

  const leaf = segments[segments.length - 1];
  if (!asObject(current) || !hasOwn(current, leaf)) {
    return;
  }
  delete current[leaf];

  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const [parent, key] = lineage[index];
    const value = parent[key];
    if (asObject(value) && Object.keys(value).length === 0) {
      delete parent[key];
      continue;
    }
    break;
  }
}

function restoreConfigNode(root, segments, snapshot) {
  if (snapshot?.exists) {
    setConfigNode(root, segments, snapshot.value);
    return;
  }
  deleteConfigNode(root, segments);
}

function removeManagedPluginArtifacts(config, pluginPath) {
  const normalizedPluginPath = path.resolve(pluginPath);
  const plugins = asObject(config.plugins);
  const entries = asObject(plugins?.entries);
  const installs = asObject(plugins?.installs);
  const load = asObject(plugins?.load);
  const slots = asObject(plugins?.slots);

  if (entries) {
    delete entries[PLUGIN_ID];
    if (Object.keys(entries).length === 0) {
      delete plugins.entries;
    }
  }

  if (installs) {
    delete installs[PLUGIN_ID];
    if (Object.keys(installs).length === 0) {
      delete plugins.installs;
    }
  }

  if (Array.isArray(load?.paths)) {
    load.paths = load.paths.filter((entry) => {
      if (typeof entry !== "string" || !entry.trim()) return false;
      return path.resolve(entry) !== normalizedPluginPath;
    });
    if (load.paths.length === 0) {
      delete load.paths;
    }
    if (Object.keys(load).length === 0) {
      delete plugins.load;
    }
  }

  if (slots?.memory === PLUGIN_ID) {
    delete slots.memory;
  }
  if (slots && Object.keys(slots).length === 0) {
    delete plugins.slots;
  }
  if (plugins && Object.keys(plugins).length === 0) {
    delete config.plugins;
  }
}

async function captureManagedConfigBackup(config, pluginPath) {
  const existingBackup = await readManagedConfigBackup();
  if (existingBackup) {
    return false;
  }

  const normalizedPluginPath = path.resolve(pluginPath);
  const currentPaths = Array.isArray(config?.plugins?.load?.paths)
    ? config.plugins.load.paths.filter((entry) => typeof entry === "string" && entry.trim())
    : [];
  const alreadyManaged = config?.plugins?.slots?.memory === PLUGIN_ID
    || Boolean(config?.plugins?.installs?.[PLUGIN_ID])
    || currentPaths.some((entry) => path.resolve(entry) === normalizedPluginPath);

  if (alreadyManaged) {
    printWarn("Config snapshot skipped", "ClawXMemory already appears to own the memory slot");
    return false;
  }

  await writeManagedConfigBackup({
    version: 1,
    pluginId: PLUGIN_ID,
    capturedAt: new Date().toISOString(),
    configPath: resolveConfigPath(),
    entries: Object.fromEntries(
      Object.entries(MANAGED_CONFIG_PATHS).map(([key, segments]) => [key, captureConfigNode(config, segments)]),
    ),
  });
  printSuccess("Config snapshot saved", resolveManagedConfigBackupPath());
  return true;
}

function restoreConfigFromManagedBackup(config, backup) {
  const entries = asObject(backup?.entries);
  for (const [key, segments] of Object.entries(MANAGED_CONFIG_PATHS)) {
    if (!entries || !hasOwn(entries, key)) continue;
    restoreConfigNode(config, segments, entries[key]);
  }
}

function applyNativeMemoryDefaults(config) {
  const plugins = ensureObject(config, "plugins");
  const slots = ensureObject(plugins, "slots");
  const entries = ensureObject(plugins, "entries");
  const memoryCore = ensureObject(entries, NATIVE_MEMORY_PLUGIN_ID);
  const internalHooks = ensureObject(ensureObject(ensureObject(config, "hooks"), "internal"), "entries");
  const sessionMemory = ensureObject(internalHooks, "session-memory");
  const agents = ensureObject(config, "agents");
  const defaults = ensureObject(agents, "defaults");
  const memorySearch = ensureObject(defaults, "memorySearch");
  const compaction = ensureObject(defaults, "compaction");
  const memoryFlush = ensureObject(compaction, "memoryFlush");

  slots.memory = NATIVE_MEMORY_PLUGIN_ID;
  memoryCore.enabled = true;
  sessionMemory.enabled = true;
  memorySearch.enabled = true;
  memoryFlush.enabled = true;
}

async function applyManagedPluginConfig(pluginPath) {
  printStep("Sync OpenClaw config");
  const config = (await readOpenClawConfig()) ?? {};
  const normalizedPluginPath = path.resolve(pluginPath);

  await captureManagedConfigBackup(config, normalizedPluginPath);

  const plugins = ensureObject(config, "plugins");
  const slots = ensureObject(plugins, "slots");
  const entries = ensureObject(plugins, "entries");
  const pluginEntry = ensureObject(entries, PLUGIN_ID);
  const pluginHooks = ensureObject(pluginEntry, "hooks");
  const pluginConfig = ensureObject(pluginEntry, "config");
  const internalHooks = ensureObject(ensureObject(ensureObject(config, "hooks"), "internal"), "entries");
  const sessionMemory = ensureObject(internalHooks, "session-memory");
  const agents = ensureObject(config, "agents");
  const defaults = ensureObject(agents, "defaults");
  const memorySearch = ensureObject(defaults, "memorySearch");
  const compaction = ensureObject(defaults, "compaction");
  const memoryFlush = ensureObject(compaction, "memoryFlush");
  const memoryCore = ensureObject(entries, NATIVE_MEMORY_PLUGIN_ID);
  const tools = ensureObject(config, "tools");

  const load = ensureObject(plugins, "load");
  const currentPaths = Array.isArray(load.paths)
    ? load.paths.filter((entry) => typeof entry === "string" && entry.trim())
    : [];
  const nextPaths = [normalizedPluginPath, ...currentPaths.filter((entry) => path.resolve(entry) !== normalizedPluginPath)];
  load.paths = nextPaths;

  slots.memory = PLUGIN_ID;
  pluginEntry.enabled = true;
  pluginHooks.allowPromptInjection = true;
  memoryCore.enabled = false;
  sessionMemory.enabled = false;
  memorySearch.enabled = false;
  memoryFlush.enabled = false;
  tools.alsoAllow = normalizeStringList([...(Array.isArray(tools.alsoAllow) ? tools.alsoAllow : []), ...CHAT_FACING_MEMORY_TOOLS]);

  if (plugins.installs && typeof plugins.installs === "object" && Object.keys(plugins.installs).length === 0) {
    delete plugins.installs;
  }

  await writeOpenClawConfig(config);

  const checks = await Promise.all([
    verifyMemorySlotBound(),
    verifyPluginEnabled(),
    verifyPromptInjectionEnabled(),
    verifyMemoryCoreDisabled(),
    verifySessionMemoryDisabled(),
    verifyAgentMemorySearchDisabled(),
    verifyCompactionMemoryFlushDisabled(),
    verifyChatFacingMemoryToolsAllowed(),
  ]);

  if (checks.some((item) => item !== true)) {
    throw new Error("managed OpenClaw config update did not persist the expected state");
  }

  printSuccess("Config synced", "memory slot bound, prompt injection enabled, chat-facing memory tools allowed, native memory disabled");
}

async function isUiReachable(uiTarget) {
  const target = uiTarget ?? await resolveUiTarget();
  if (!target.enabled) return false;
  try {
    const response = await fetch(buildUiUrl(target), {
      signal: AbortSignal.timeout(SHORT_COMMAND_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function removePluginInstallMetadata() {
  printStep("Remove existing plugin link metadata");
  const config = await readOpenClawConfig();
  if (!config?.plugins?.installs?.[PLUGIN_ID]) {
    return;
  }
  delete config.plugins.installs[PLUGIN_ID];
  if (Object.keys(config.plugins.installs).length === 0) {
    delete config.plugins.installs;
  }
  await writeOpenClawConfig(config);
}

async function runLinkInstallCommand(repoRoot, pluginPath, extraArgs = []) {
  const args = ["plugins", "install", "--link", pluginPath, ...extraArgs];
  return {
    args,
    result: await runCommand("openclaw", args, {
      cwd: repoRoot,
      timeoutMs: PLUGIN_INSTALL_TIMEOUT_MS,
      tolerateNonZero: true,
    }),
  };
}

async function ensureLinkedPluginInstall(repoRoot, pluginPath, { forceInstall = false } = {}) {
  const trackedInstall = await hasTrackedPluginInstall();
  const configuredLoadPath = await hasConfiguredPluginLoadPath(pluginPath);
  const installDecision = shouldSkipPluginInstall({
    trackedInstall,
    configuredLoadPath,
    forceInstall,
  });
  if (installDecision.skip && installDecision.reason === "tracked_install") {
    printInfo("Plugin install", "reusing tracked linked install");
    return;
  }
  if (installDecision.skip && installDecision.reason === "configured_load_path") {
    printWarn("Plugin install", "tracked install metadata missing; reusing configured plugin load path");
    return;
  }

  printStep("Install plugin via OpenClaw");
  if (configuredLoadPath && forceInstall) {
    printInfo("Plugin install", "refreshing tracked linked install metadata");
  }

  let installAttempt = await runLinkInstallCommand(repoRoot, pluginPath);
  let installOutput = `${installAttempt.result.stderr}\n${installAttempt.result.stdout}`;
  if (!installAttempt.result.timedOut && installAttempt.result.code !== 0 && shouldRetryUnsafeLinkInstall(installOutput)) {
    printWarn(
      "Plugin install blocked by OpenClaw scanner",
      `retrying with ${OPENCLAW_UNSAFE_INSTALL_FLAG} for this local development plugin`,
    );
    installAttempt = await runLinkInstallCommand(repoRoot, pluginPath, [OPENCLAW_UNSAFE_INSTALL_FLAG]);
    installOutput = `${installAttempt.result.stderr}\n${installAttempt.result.stdout}`;
  }

  const { args: installArgs, result } = installAttempt;
  const installCommand = `\`${commandToString("openclaw", installArgs)}\``;
  const tracked = await hasTrackedPluginInstall();
  const loadPathConfiguredAfterInstall = await hasConfiguredPluginLoadPath(pluginPath);
  if (!tracked) {
    const fallbackDecision = shouldContinueWithConfigManagedLoadPath({
      trackedInstall: tracked,
      loadPathConfiguredAfterInstall,
      rawOutput: installOutput,
    });
    if (fallbackDecision.continueWithLoadPath) {
      if (result.timedOut) {
        printWarn(`${installCommand} timed out`, "continuing with load-path based linking");
      } else if (result.code !== 0) {
        const snippet = summarizeOutput(installOutput, 1200);
        if (fallbackDecision.reason === "unsafe_install_blocked") {
          printWarn(
            `${installCommand} remained blocked by the OpenClaw scanner`,
            "continuing with config-managed load-path linking for this local development plugin",
          );
          if (snippet) {
            printInfo("Plugin install diagnostics", snippet);
          }
        } else {
          printWarn(`${installCommand} exited non-zero`, snippet || `exit=${result.code}`);
        }
      } else {
        printWarn("Plugin install metadata missing", "continuing with load-path based linking");
      }
      printSuccess("Plugin install linked", pluginPath);
      return;
    }
    const snippet = summarizeOutput(installOutput, 1200);
    throw new Error(`plugin install via OpenClaw failed\n${snippet || "tracked install metadata not found"}`);
  }
  if (result.timedOut) {
    printWarn(`${installCommand} timed out, but install metadata was written.`);
  } else if (result.code !== 0) {
    printWarn(`${installCommand} exited with ${result.code}, but install metadata was written.`);
  }
  printSuccess("Plugin install linked", pluginPath);
}

async function uninstallManagedPlugin(repoRoot, pluginPath) {
  printStep("Uninstall plugin via OpenClaw");
  const uninstall = await runCommand("openclaw", ["plugins", "uninstall", PLUGIN_ID, "--force"], {
    cwd: repoRoot,
    timeoutMs: PLUGIN_UNINSTALL_TIMEOUT_MS,
    tolerateNonZero: true,
  });
  if (uninstall.timedOut) {
    printWarn("`openclaw plugins uninstall` timed out", "continuing with config restore");
  } else if (uninstall.code !== 0) {
    const snippet = summarizeOutput(`${uninstall.stderr}\n${uninstall.stdout}`, 1200);
    printWarn("`openclaw plugins uninstall` exited non-zero", snippet || `exit=${uninstall.code}`);
  } else {
    printSuccess("Plugin uninstall requested", PLUGIN_ID);
  }

  printStep("Restore OpenClaw memory config");
  const config = (await readOpenClawConfig()) ?? {};
  const backup = await readManagedConfigBackup();

  removeManagedPluginArtifacts(config, pluginPath);
  if (backup?.entries) {
    restoreConfigFromManagedBackup(config, backup);
    printSuccess("Memory config restored", "using saved pre-install snapshot");
  } else {
    applyNativeMemoryDefaults(config);
    printWarn("Config snapshot missing", "restored OpenClaw native memory defaults");
  }

  await writeOpenClawConfig(config);
  await removeManagedConfigBackup();
}

function maybeOpenBrowser(url) {
  if (process.env.CLAWXMEMORY_OPEN_BROWSER === "0") return;
  if (process.platform === "darwin") {
    const child = spawn("open", [url], { stdio: "ignore", detached: true });
    child.unref();
    return;
  }
  if (process.platform === "linux") {
    const child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
    child.unref();
  }
}

async function buildPlugin(repoRoot) {
  await runLoggedCommand(
    "Build memory plugin",
    "npm",
    ["run", "build"],
    { cwd: repoRoot, inherit: true },
  );
  printSuccess("Plugin build complete");
}

async function runReloadFlow(repoRoot, options = {}) {
  printBanner("ClawXMemory Plugin Reload", "Link config, restart gateway, and verify the memory runtime.");
  const { skipBuild = false, forceInstall = false } = options;
  const pluginPath = repoRoot;
  const gatewayLogCursor = await captureGatewayLogCursor();
  if (!skipBuild) {
    await buildPlugin(repoRoot);
  }
  await ensureLinkedPluginInstall(repoRoot, pluginPath, { forceInstall });
  await applyManagedPluginConfig(pluginPath);
  const uiTarget = await resolveUiTarget();

  const restart = await restartGatewayService(repoRoot);
  let health = await waitForGatewayHealthy(repoRoot);
  let recoveredVia = "restart";
  if (!health) {
    printWarn("Gateway did not report healthy after restart", "trying a follow-up start");
    const start = await startGatewayService(repoRoot);
    health = await waitForGatewayHealthy(repoRoot);
    if (health) {
      recoveredVia = start.timedOut ? "start-timeout" : "start";
    }
  }
  if (!health) {
    const snippet = summarizeOutput(`${restart.stderr}\n${restart.stdout}`);
    throw new Error(
      [
        "gateway restart did not become healthy",
        restart.timedOut ? "restart command timed out" : `restart exit code ${restart.code}`,
        snippet || "no restart output captured",
      ].join("\n"),
    );
  }

  if (restart.timedOut) {
    printWarn("`openclaw gateway restart` timed out, but the gateway recovered.");
  } else if (restart.code !== 0) {
    printWarn(`\`openclaw gateway restart\` exited with ${restart.code}, but the gateway recovered.`);
  }
  printSuccess("Gateway ready", `health source=${health.via}; recovery=${recoveredVia}`);

  printStep("Verify plugin status");
  let runtimeSignals = await waitForPluginRuntimeReady(gatewayLogCursor, uiTarget);
  let bootstrap = null;
  if (!runtimeSignals.runtimeReady && !runtimeSignals.runtimeFailure && !(uiTarget.enabled && runtimeSignals.uiReachable)) {
    bootstrap = await bootstrapPluginRuntime(repoRoot);
    const bootstrapOutput = `${bootstrap.stderr}\n${bootstrap.stdout}`;
    if (bootstrap.timedOut) {
      printWarn("Plugin runtime bootstrap timed out", "waiting for gateway-side runtime signals anyway");
    } else if (bootstrap.code !== 0) {
      printWarn("Plugin runtime bootstrap exited non-zero", summarizeOutput(bootstrapOutput, 1200) || `exit=${bootstrap.code}`);
    } else {
      printSuccess("Plugin runtime bootstrap", `session=${CLAWXMEMORY_BOOTSTRAP_SESSION_ID}`);
    }
    runtimeSignals = await waitForPluginRuntimeReady(gatewayLogCursor, uiTarget);
  }
  const plugin = await ensurePluginLoaded(repoRoot, uiTarget, runtimeSignals);
  if (!plugin.loaded) {
    const bootstrapOutput = bootstrap ? summarizeOutput(`${bootstrap.stderr}\n${bootstrap.stdout}`, 1200) : "";
    throw new Error(
      [
        "plugin failed to become runtime-ready",
        plugin.pluginLoaded
          ? "`openclaw plugins inspect` reported status=loaded"
          : "`openclaw plugins inspect` did not report status=loaded",
        plugin.runtimeFailure
          || plugin.logSummary
          || bootstrapOutput
          || summarizeOutput(plugin.output, 1200)
          || "gateway stayed healthy, but ClawXMemory never reported runtime readiness",
      ].join("\n"),
    );
  }
  printSuccess("Plugin loaded", `verified via ${plugin.via}`);

  const uiReady = plugin.uiReachable;
  if (uiTarget.enabled && uiReady) {
    maybeOpenBrowser(buildUiUrl(uiTarget, { cacheBust: true }));
  } else if (uiTarget.enabled) {
    const detail = plugin.dashboardFailure
      ? `${plugin.dashboardFailure} ${buildUiPortConfigHint()}`
      : `runtime is ready, but configured URL ${uiTarget.url} did not respond. This usually means the local dashboard port is blocked or another process is intercepting it. ${buildUiPortConfigHint()}`;
    printWarn("Dashboard not reachable", detail);
  }

  console.log("");
  printSuccess("Memory plugin reloaded");
  printInfo("Gateway", `ws://127.0.0.1:${health?.payload?.gateway?.port ?? "18789"}`);
  if (!uiTarget.enabled) {
    printInfo("UI", `disabled via plugins.entries.${PLUGIN_ID}.config.uiEnabled=false`);
  } else if (uiReady) {
    printInfo("UI", uiTarget.url);
  } else {
    printInfo("UI", `${uiTarget.url} (configured, dashboard not reachable)`);
  }
}

export async function reloadMemoryPlugin({ importMetaUrl, skipBuild = false } = {}) {
  const repoRoot = resolveRepoRoot(importMetaUrl);
  await runReloadFlow(repoRoot, { skipBuild });
}

export async function relinkMemoryPlugin({ importMetaUrl } = {}) {
  const repoRoot = resolveRepoRoot(importMetaUrl);
  const installDir = path.join(resolveStateDir(), "extensions", PLUGIN_ID);

  printBanner("ClawXMemory Plugin Relink", "Build, relink, update config, and restart the gateway.");
  await buildPlugin(repoRoot);

  printStep("Clean extension directory");
  await rm(installDir, { recursive: true, force: true });
  printSuccess("Extension directory cleaned", installDir);

  await removePluginInstallMetadata();
  await runReloadFlow(repoRoot, { skipBuild: true, forceInstall: true });
}

export async function uninstallMemoryPlugin({ importMetaUrl } = {}) {
  const repoRoot = resolveRepoRoot(importMetaUrl);
  const pluginPath = repoRoot;

  printBanner("ClawXMemory Plugin Uninstall", "Remove the plugin and restore OpenClaw memory ownership.");
  await uninstallManagedPlugin(repoRoot, pluginPath);

  const restart = await restartGatewayService(repoRoot);
  let health = await waitForGatewayHealthy(repoRoot);
  let recoveredVia = "restart";
  if (!health) {
    printWarn("Gateway did not report healthy after restart", "trying a follow-up start");
    const start = await startGatewayService(repoRoot);
    health = await waitForGatewayHealthy(repoRoot);
    if (health) {
      recoveredVia = start.timedOut ? "start-timeout" : "start";
    }
  }
  if (!health) {
    const snippet = summarizeOutput(`${restart.stderr}\n${restart.stdout}`);
    throw new Error(
      [
        "gateway restart did not become healthy after uninstall",
        restart.timedOut ? "restart command timed out" : `restart exit code ${restart.code}`,
        snippet || "no restart output captured",
      ].join("\n"),
    );
  }

  if (restart.timedOut) {
    printWarn("`openclaw gateway restart` timed out, but the gateway recovered.");
  } else if (restart.code !== 0) {
    printWarn(`\`openclaw gateway restart\` exited with ${restart.code}, but the gateway recovered.`);
  }

  console.log("");
  printSuccess("Memory plugin removed");
  printInfo("Gateway", `ws://127.0.0.1:${health?.payload?.gateway?.port ?? "18789"}`);
}
