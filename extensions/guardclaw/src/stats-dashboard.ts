/**
 * GuardClaw Stats Dashboard
 *
 * HTTP handler that serves:
 *   - GET  /plugins/guardclaw/stats              → Dashboard HTML (inline SPA)
 *   - GET  /plugins/guardclaw/stats/api/summary  → JSON summary
 *   - GET  /plugins/guardclaw/stats/api/hourly   → JSON hourly timeline
 *   - GET  /plugins/guardclaw/stats/api/sessions → JSON session stats
 *   - GET  /plugins/guardclaw/stats/api/detections → JSON detection event log
 *   - GET  /plugins/guardclaw/stats/api/config   → current guardclaw config
 *   - POST /plugins/guardclaw/stats/api/config   → update config (hot-reload + persist)
 *   - GET  /plugins/guardclaw/stats/api/prompts  → all editable prompts
 *   - POST /plugins/guardclaw/stats/api/prompts  → save a prompt (hot-reload)
 *   - POST /plugins/guardclaw/stats/api/reset          → reset all token stats
 *   - POST /plugins/guardclaw/stats/api/test-classify → dry-run pipeline classification
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { getLiveConfig, updateLiveConfig } from "./live-config.js";
import { DEFAULT_DETECTION_SYSTEM_PROMPT, DEFAULT_PII_EXTRACTION_PROMPT } from "./local-model.js";
import { loadPrompt, readPromptFromDisk, writePrompt } from "./prompt-loader.js";
import type { RouterPipeline } from "./router-pipeline.js";
import { createConfigurableRouter } from "./routers/configurable.js";
import { DEFAULT_JUDGE_PROMPT } from "./routers/token-saver.js";
import { getAllSessionStates } from "./session-state.js";
import { getGlobalCollector } from "./token-stats.js";
import {
  getLastReplyLoopSummary,
  getLastReplyModelOrigin,
  getLastTurnTokens,
} from "./usage-intel.js";
import { getCurrentLoopHighestLevel } from "./loop-detection-level.js";

const GUARDCLAW_CONFIG_PATH = join(process.env.HOME ?? "/tmp", ".openclaw", "guardclaw.json");

function saveGuardClawConfig(privacy: Record<string, unknown>): void {
  try {
    const dir = join(process.env.HOME ?? "/tmp", ".openclaw");
    mkdirSync(dir, { recursive: true });
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(GUARDCLAW_CONFIG_PATH, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      /* file may not exist yet */
    }
    const updated = { ...existing, privacy };
    writeFileSync(GUARDCLAW_CONFIG_PATH, JSON.stringify(updated, null, 2), "utf-8");
  } catch {
    // best-effort persistence
  }
}

export type DashboardDeps = {
  pluginId: string;
  pluginConfig: Record<string, unknown>;
  pipeline: RouterPipeline | null;
};

let deps: DashboardDeps | null = null;

export function initDashboard(d: DashboardDeps): void {
  deps = d;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

export async function statsHttpHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? "";
  const parsedUrl = new URL(url, "http://localhost");
  const reqPath = parsedUrl.pathname;
  const base = "/plugins/guardclaw/stats";

  if (!reqPath.startsWith(base)) return false;

  const sub = reqPath.slice(base.length) || "/";

  if (req.method === "GET" && sub === "/") {
    html(res, dashboardHtml());
    return true;
  }

  if (req.method === "GET" && sub === "/api/summary") {
    const collector = getGlobalCollector();
    if (!collector) {
      json(res, { error: "not initialized" }, 503);
      return true;
    }
    json(res, collector.getSummary());
    return true;
  }

  if (req.method === "GET" && sub === "/api/hourly") {
    const collector = getGlobalCollector();
    if (!collector) {
      json(res, { error: "not initialized" }, 503);
      return true;
    }
    json(res, collector.getHourly());
    return true;
  }

  if (req.method === "GET" && sub === "/api/sessions") {
    const collector = getGlobalCollector();
    if (!collector) {
      json(res, { error: "not initialized" }, 503);
      return true;
    }
    json(res, collector.getSessionStats());
    return true;
  }

  if (req.method === "GET" && sub === "/api/current-loop-highest-level") {
    const sessionKey = parsedUrl.searchParams.get("sessionKey") ?? undefined;
    const data = getCurrentLoopHighestLevel(sessionKey);
    json(res, data);
    return true;
  }

  if (req.method === "GET" && sub === "/api/last-turn-tokens") {
    const sessionKey = parsedUrl.searchParams.get("sessionKey") ?? undefined;
    const data = getLastTurnTokens(sessionKey);
    if (!data) {
      json(res, { error: "no last-turn router tokens yet" }, 404);
      return true;
    }
    json(res, data);
    return true;
  }

  if (req.method === "GET" && sub === "/api/reply-model-origin") {
    const sessionKey = parsedUrl.searchParams.get("sessionKey") ?? undefined;
    const origin = getLastReplyModelOrigin(sessionKey);
    const loopSummary = getLastReplyLoopSummary(sessionKey);
    if (!origin || !loopSummary) {
      json(res, { error: "no reply-model-origin data yet" }, 404);
      return true;
    }
    json(res, {
      sessionKey: origin.sessionKey,
      timestamp: origin.timestamp,
      provider: origin.provider,
      model: origin.model,
      origin: origin.origin,
      reason: origin.reason,
      loopTotalTokens: loopSummary.loopTotalTokens,
      loopLocalTokens: loopSummary.loopLocalTokens,
      loopCloudTokens: loopSummary.loopCloudTokens,
      routerTokens: loopSummary.routerTokens,
    });
    return true;
  }

  if (req.method === "POST" && sub === "/api/reset") {
    const collector = getGlobalCollector();
    if (!collector) {
      json(res, { error: "not initialized" }, 503);
      return true;
    }
    await collector.reset();
    json(res, { ok: true });
    return true;
  }

  if (req.method === "GET" && sub === "/api/detections") {
    const states = getAllSessionStates();
    const events: Array<{
      sessionKey: string;
      level: string;
      checkpoint: string;
      reason?: string;
      timestamp: number;
    }> = [];
    states.forEach((state) => {
      for (const d of state.detectionHistory) {
        events.push({
          sessionKey: state.sessionKey,
          level: d.level,
          checkpoint: d.checkpoint,
          reason: d.reason,
          timestamp: d.timestamp,
        });
      }
    });
    events.sort((a, b) => b.timestamp - a.timestamp);
    json(res, events.slice(0, 500));
    return true;
  }

  if (req.method === "GET" && sub === "/api/config") {
    const liveConfig = getLiveConfig();
    const cfgAny = liveConfig as Record<string, unknown>;
    json(res, {
      privacy: {
        enabled: liveConfig.enabled,
        localModel: liveConfig.localModel,
        guardAgent: liveConfig.guardAgent,
        s2Policy: liveConfig.s2Policy,
        proxyPort: liveConfig.proxyPort,
        checkpoints: liveConfig.checkpoints,
        rules: liveConfig.rules,
        localProviders: liveConfig.localProviders,
        modelPricing: liveConfig.modelPricing,
        session: liveConfig.session,
        routers: cfgAny.routers,
        pipeline: cfgAny.pipeline,
      },
    });
    return true;
  }

  if (req.method === "POST" && sub === "/api/config") {
    if (!deps) {
      json(res, { error: "dashboard not initialized" }, 503);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req));

      if (body.privacy) {
        updateLiveConfig(body.privacy);

        const existingPrivacy = ((deps.pluginConfig as Record<string, unknown>).privacy ??
          {}) as Record<string, unknown>;
        const mergedPrivacy = { ...existingPrivacy, ...body.privacy } as Record<string, unknown>;

        // Persist to guardclaw.json (does NOT touch openclaw.json → no restart)
        saveGuardClawConfig(mergedPrivacy);

        // Dynamically register/update configurable routers in the pipeline
        if (body.privacy.routers && deps.pipeline) {
          const routers = body.privacy.routers as Record<
            string,
            { type?: string; enabled?: boolean }
          >;
          for (const [id, reg] of Object.entries(routers)) {
            if (reg.type === "configurable" && !deps.pipeline.hasRouter(id)) {
              deps.pipeline.register(
                createConfigurableRouter(id),
                reg as Parameters<typeof deps.pipeline.register>[1],
              );
            }
          }
          // Re-configure pipeline with updated router configs and order
          const mergedPrivacy = { ...existingPrivacy, ...body.privacy } as Record<string, unknown>;
          deps.pipeline.configure({
            routers: mergedPrivacy.routers as Record<
              string,
              Parameters<typeof deps.pipeline.register>[1]
            >,
            pipeline: mergedPrivacy.pipeline as Record<string, string[]>,
          });
          // Update deps.pluginConfig so test-classify picks up new options
          (deps.pluginConfig as Record<string, unknown>).privacy = mergedPrivacy;
        }
      }

      json(res, { ok: true });
    } catch (err) {
      json(res, { error: String(err) }, 400);
    }
    return true;
  }

  // ── Prompts API ──

  const EDITABLE_PROMPTS: Record<string, { label: string; defaultContent: string }> = {
    "detection-system": {
      label: "Privacy Detection (S1/S2/S3 Classifier)",
      defaultContent: DEFAULT_DETECTION_SYSTEM_PROMPT,
    },
    "token-saver-judge": {
      label: "Token-Saver (Task Complexity Judge)",
      defaultContent: DEFAULT_JUDGE_PROMPT,
    },
    "pii-extraction": {
      label: "PII Extraction Engine",
      defaultContent: DEFAULT_PII_EXTRACTION_PROMPT,
    },
  };

  if (req.method === "GET" && sub === "/api/prompts") {
    const result: Record<
      string,
      { label: string; content: string; isCustom: boolean; defaultContent: string }
    > = {};
    for (const [name, meta] of Object.entries(EDITABLE_PROMPTS)) {
      const fromDisk = readPromptFromDisk(name);
      result[name] = {
        label: meta.label,
        content: fromDisk ?? meta.defaultContent,
        isCustom: fromDisk !== null,
        defaultContent: meta.defaultContent,
      };
    }
    json(res, result);
    return true;
  }

  if (req.method === "POST" && sub === "/api/prompts") {
    try {
      const body = JSON.parse(await readBody(req)) as { name: string; content: string };
      if (!body.name || typeof body.content !== "string") {
        json(res, { error: "name and content required" }, 400);
        return true;
      }
      // Allow both built-in prompts and custom router prompts (custom-*)
      if (!EDITABLE_PROMPTS[body.name] && !body.name.startsWith("custom-")) {
        json(res, { error: `Unknown prompt: ${body.name}` }, 400);
        return true;
      }
      writePrompt(body.name, body.content);
      json(res, { ok: true });
    } catch (err) {
      json(res, { error: String(err) }, 400);
    }
    return true;
  }

  // ── Test Classify API ──

  if (req.method === "POST" && sub === "/api/test-classify") {
    if (!deps?.pipeline) {
      json(res, { error: "pipeline not initialized" }, 503);
      return true;
    }
    try {
      const body = JSON.parse(await readBody(req)) as {
        message: string;
        checkpoint?: string;
        router?: string;
      };
      if (!body.message?.trim()) {
        json(res, { error: "message required" }, 400);
        return true;
      }
      const checkpoint = (body.checkpoint ?? "onUserMessage") as
        | "onUserMessage"
        | "onToolCallProposed"
        | "onToolCallExecuted";

      if (body.router) {
        const decision = await deps.pipeline.runSingle(
          body.router,
          { checkpoint, message: body.message, sessionKey: "__test__" },
          deps.pluginConfig,
        );
        if (!decision) {
          json(res, { error: `Router not found: ${body.router}` }, 404);
          return true;
        }
        json(res, {
          level: decision.level,
          action: decision.action,
          target: decision.target,
          reason: decision.reason,
          confidence: decision.confidence,
          routerId: decision.routerId,
        });
      } else {
        // Full pipeline test
        const decision = await deps.pipeline.run(
          checkpoint,
          { checkpoint, message: body.message, sessionKey: "__test__" },
          deps.pluginConfig,
        );
        json(res, {
          level: decision.level,
          action: decision.action,
          target: decision.target,
          reason: decision.reason,
          confidence: decision.confidence,
          routerId: decision.routerId,
        });
      }
    } catch (err) {
      json(res, { error: String(err) }, 500);
    }
    return true;
  }

  return false;
}

// ── Dashboard HTML ──

function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GuardClaw Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root{--bg-body:#ffffff;--bg-surface:#f9f9fa;--bg-card:#ffffff;--bg-input:#eff1f5;--text-primary:#1a1a1a;--text-secondary:#6e6e80;--text-tertiary:#9ca3af;--border-subtle:#e5e5e5;--accent:#2563eb;--accent-hover:#1d4ed8;--radius-sm:6px;--radius-md:12px;--radius-lg:16px;--shadow-sm:0 1px 2px 0 rgba(0,0,0,.05);--shadow-card:0 2px 8px rgba(0,0,0,.04);--shadow-float:0 10px 15px -3px rgba(0,0,0,.08),0 4px 6px -2px rgba(0,0,0,.04);--font-sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--font-mono:'JetBrains Mono','SFMono-Regular',ui-monospace,monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:var(--font-sans);background:var(--bg-surface);color:var(--text-primary);min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.6}

  .header{padding:12px 24px;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
  .header-left{display:flex;align-items:center;gap:14px}
  .header h1{font-size:18px;font-weight:700;letter-spacing:-.01em;color:var(--text-primary)}
  .header-right{display:flex;align-items:center;gap:14px;font-size:12px;color:var(--text-tertiary)}
  .status-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0;box-shadow:0 0 0 2px rgba(34,197,94,.2)}
  .status-dot.err{background:#ef4444;box-shadow:0 0 0 2px rgba(239,68,68,.2)}
  .status-dot.warn{background:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.2)}

  .tabs{display:flex;gap:0;padding:0 24px;background:var(--bg-card);border-bottom:1px solid var(--border-subtle);overflow-x:auto}
  .tab{padding:12px 20px;cursor:pointer;border-bottom:2px solid transparent;color:var(--text-secondary);font-size:13px;font-weight:500;white-space:nowrap;transition:color .15s,border-color .15s}
  .tab.active{color:var(--accent);border-bottom-color:var(--accent)}
  .tab:hover{color:var(--text-primary)}

  .panel{display:none;padding:24px}
  .panel.active{display:block}

  .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}
  @media(max-width:1000px){.cards{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:700px){.cards{grid-template-columns:repeat(2,1fr)}}
  .card{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:16px 18px;box-shadow:var(--shadow-sm);transition:box-shadow .2s,transform .2s}
  .card:hover{box-shadow:var(--shadow-card);transform:translateY(-1px)}
  .card-label{font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:6px}
  .card-value{font-size:24px;font-weight:700;letter-spacing:-.02em;color:var(--text-primary)}
  .card-sub{font-size:11px;color:var(--text-tertiary);margin-top:4px}
  .card.cloud .card-value{color:#2563eb}
  .card.local .card-value{color:#059669}
  .card.proxy .card-value{color:#d97706}
  .card.privacy .card-value{color:#7c3aed}
  .card.cost .card-value{color:#dc2626}

  .chart-wrap{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:16px 18px;margin-bottom:20px;box-shadow:var(--shadow-sm)}
  .chart-wrap h3{font-size:12px;color:var(--text-secondary);font-weight:600;margin-bottom:10px}

  .data-table{width:100%;border-collapse:collapse;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden}
  .data-table th,.data-table td{padding:10px 14px;font-size:13px;text-align:right}
  .data-table th{background:var(--bg-surface);color:var(--text-secondary);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .data-table th:first-child,.data-table td:first-child{text-align:left}
  .data-table tr:not(:last-child) td{border-bottom:1px solid var(--border-subtle)}
  .data-table tbody tr:hover{background:rgba(37,99,235,.02)}
  #detections-panel .data-table th,#detections-panel .data-table td{text-align:left}

  .info-bar{display:flex;gap:24px;padding:14px 0;font-size:12px;color:var(--text-tertiary)}

  .level-tag{display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:99px}
  .level-S1{background:rgba(37,99,235,.08);color:#2563eb}
  .level-S2{background:rgba(217,119,6,.08);color:#d97706}
  .level-S3{background:rgba(5,150,105,.08);color:#059669}
  .checkpoint-tag{font-size:11px;padding:3px 8px;border-radius:99px;background:var(--bg-input);color:var(--text-secondary);font-weight:500}
  .session-key{font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)}

  .empty-state{text-align:center;color:var(--text-tertiary);padding:48px 0;font-size:14px}

  .filter-bar{display:flex;gap:8px;margin-bottom:18px}
  .filter-btn{padding:7px 16px;border-radius:99px;border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;font-size:12px;font-weight:500;transition:all .15s}
  .filter-btn.active{background:var(--text-primary);color:#fff;border-color:var(--text-primary)}
  .filter-btn:hover{border-color:#d1d5db;color:var(--text-primary)}

  .config-section{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:18px 20px;margin-bottom:14px;box-shadow:var(--shadow-sm)}
  .config-section h3{font-size:11px;color:var(--text-secondary);margin-bottom:14px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  .field{margin-bottom:16px}
  .field label{display:block;font-size:12px;color:var(--text-secondary);margin-bottom:6px;font-weight:500}
  .field input,.field select{width:100%;padding:10px 14px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px;outline:none;transition:all .15s}
  .field select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236e6e80' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px}
  .field input:hover,.field select:hover{background:#eaecf1}
  .field input:focus,.field select:focus{background:#fff;border-color:transparent;box-shadow:0 0 0 3px rgba(37,99,235,.15)}

  .tag-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;min-height:32px}
  .tag{background:var(--bg-input);color:var(--text-primary);padding:5px 12px;border-radius:99px;font-size:12px;font-weight:500;display:flex;align-items:center;gap:6px;border:1px solid var(--border-subtle)}
  .tag button{background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:14px;line-height:1;transition:color .15s}
  .tag button:hover{color:#ef4444}
  .add-row{display:flex;gap:10px;margin-top:10px;align-items:center}
  .add-row input{flex:1;min-width:0}

  .btn{padding:10px 20px;border-radius:var(--radius-sm);border:none;cursor:pointer;font-size:13px;font-weight:500;transition:all .15s;white-space:nowrap;flex-shrink:0}
  .btn-primary{background:var(--text-primary);color:#fff}
  .btn-primary:hover{background:#333}
  .btn-sm{padding:8px 16px;font-size:12px}
  .btn-outline{background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text-primary)}
  .btn-outline:hover{border-color:#d1d5db;background:var(--bg-surface)}
  .save-bar{display:flex;justify-content:flex-end;gap:10px;padding-top:14px;margin-top:10px}

  .badge{display:inline-block;font-size:10px;padding:3px 8px;border-radius:99px;margin-left:8px;vertical-align:middle;font-weight:600}
  .badge-hot{background:rgba(5,150,105,.1);color:#059669}

  .toast{position:fixed;bottom:24px;right:24px;background:var(--text-primary);color:#fff;padding:14px 22px;border-radius:var(--radius-md);font-size:13px;font-weight:500;display:none;z-index:100;box-shadow:0 12px 40px rgba(0,0,0,.15)}
  .toast.error{background:#dc2626}

  .rules-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:700px){.rules-grid{grid-template-columns:1fr}}
  .rules-col{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:14px}
  .rules-col h4{font-size:11px;color:var(--text-tertiary);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;border-bottom:1px solid var(--border-subtle);padding-bottom:8px}

  .toggle-bar{display:flex;align-items:center;justify-content:space-between;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px 18px;margin-bottom:14px;box-shadow:var(--shadow-sm)}
  .toggle-bar label{font-size:13px;color:var(--text-primary);font-weight:500}
  .toggle{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}
  .toggle input{opacity:0;width:0;height:0}
  .toggle .slider{position:absolute;inset:0;background:#d1d5db;border-radius:12px;cursor:pointer;transition:.2s}
  .toggle .slider::before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
  .toggle input:checked+.slider{background:var(--accent)}
  .toggle input:checked+.slider::before{transform:translateX(20px)}

  .chip-group{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .chip{padding:7px 14px;border-radius:99px;font-size:12px;cursor:pointer;border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-secondary);font-weight:500;transition:all .15s}
  .chip.active{background:var(--text-primary);color:#fff;border-color:var(--text-primary)}
  .chip:hover{border-color:#d1d5db;color:var(--text-primary)}

  .router-card{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:16px;margin-bottom:10px;transition:border-color .15s}
  .router-card:hover{border-color:#d1d5db}
  .router-card .rc-head{display:flex;align-items:center;gap:8px}
  .router-card .rc-name{font-size:13px;color:var(--text-primary);font-weight:600}
  .router-card .rc-type{font-size:11px;color:var(--text-tertiary)}
  .router-card .rc-del{margin-left:auto;background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:16px;line-height:1;transition:color .15s}
  .router-card .rc-del:hover{color:#ef4444}
  .router-card .rc-module{font-size:11px;color:var(--text-tertiary);margin-top:4px}

  .field-toggle{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .field-toggle>label{font-size:13px;color:var(--text-secondary);margin-bottom:0}
  .hint{font-size:11px;color:var(--text-tertiary);margin-top:4px}

  .prompt-editor{width:100%;min-height:200px;padding:16px 18px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-md);color:var(--text-primary);font-family:var(--font-mono);font-size:12px;line-height:1.6;resize:vertical;outline:none;tab-size:2;transition:all .15s}
  .prompt-editor:hover{background:#eaecf1}
  .prompt-editor:focus{background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
  .prompt-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .prompt-header h4{font-size:13px;color:var(--text-primary);font-weight:600}
  .prompt-actions{display:flex;gap:6px}
  .custom-badge{font-size:10px;padding:3px 8px;border-radius:99px;background:rgba(37,99,235,.08);color:var(--accent);font-weight:600;margin-left:8px}

  .test-panel{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:18px 20px;margin-bottom:14px;box-shadow:var(--shadow-sm)}
  .test-input{width:100%;min-height:80px;padding:14px 16px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-md);color:var(--text-primary);font-size:13px;resize:vertical;outline:none;transition:all .15s}
  .test-input:hover{background:#eaecf1}
  .test-input:focus{background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
  .test-result{margin-top:18px;padding:18px 20px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-subtle);display:none}
  .test-result.visible{display:block}
  .test-result-row{display:flex;justify-content:space-between;padding:10px 0;font-size:13px;border-bottom:1px solid var(--border-subtle)}
  .test-result-row:last-child{border-bottom:none}
  .test-result-label{color:var(--text-secondary)}
  .test-result-value{color:var(--text-primary);font-weight:600}
  .test-loading{color:var(--text-secondary);font-size:13px;padding:14px 0}

  .tier-grid{display:grid;grid-template-columns:120px 1fr 1fr;gap:10px;align-items:center}
  .tier-grid .tier-label{font-size:12px;color:var(--text-secondary);font-weight:600}
  .tier-grid input{padding:9px 14px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-sm);color:var(--text-primary);font-size:12px;outline:none;transition:all .15s}
  .tier-grid input:hover{background:#eaecf1}
  .tier-grid input:focus{background:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
  .tier-grid-header{font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.06em;font-weight:700;padding-bottom:8px}

  .section-collapse{cursor:pointer;user-select:none}
  .section-collapse::before{content:'\\25BC';display:inline-block;margin-right:8px;font-size:10px;transition:transform .2s;color:var(--text-tertiary)}
  .section-collapse.collapsed::before{transform:rotate(-90deg)}
  .section-body{overflow:hidden;transition:max-height .3s ease}
  .section-body.collapsed{max-height:0 !important;padding:0;overflow:hidden}

  .router-section{background:var(--bg-card);border-radius:var(--radius-md);margin-bottom:14px;border:1px solid var(--border-subtle);overflow:hidden;box-shadow:var(--shadow-sm)}
  .router-section-header{display:flex;align-items:center;gap:10px;padding:14px 18px;cursor:pointer;user-select:none;transition:background .15s}
  .router-section-header:hover{background:var(--bg-surface)}
  .router-section-header h3{font-size:14px;color:var(--text-primary);font-weight:600;margin:0}
  .router-section-header .section-arrow{font-size:10px;color:var(--text-tertiary);transition:transform .2s;display:inline-block}
  .router-section-header.collapsed .section-arrow{transform:rotate(-90deg)}
  .router-id-badge{font-size:11px;padding:3px 10px;border-radius:99px;background:var(--bg-input);color:var(--text-secondary);font-family:var(--font-mono);font-weight:500}
  .router-section-body{padding:0 18px 18px}
  .router-section-body.collapsed{display:none}
  .subsection{margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--border-subtle)}
  .subsection:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
  .subsection>h4{font-size:11px;color:var(--text-secondary);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  .add-custom-router{background:var(--bg-card);border:2px dashed var(--border-subtle);border-radius:var(--radius-md);padding:18px 20px;margin-bottom:14px;transition:border-color .15s}
  .add-custom-router:hover{border-color:#d1d5db}
  .btn-danger{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
  .btn-danger:hover{background:#fee2e2}
  .pipe-picker{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .pipe-pick-btn{padding:6px 14px;border-radius:99px;font-size:12px;cursor:pointer;border:1px dashed var(--border-subtle);background:var(--bg-card);color:var(--text-secondary);transition:all .15s;font-family:var(--font-mono);font-weight:500}
  .pipe-pick-btn:hover{border-color:var(--accent);color:var(--accent)}
  .pipe-pick-btn.in-use{opacity:.35;cursor:default;border-style:solid}
  .pipe-pick-btn.in-use:hover{border-color:var(--border-subtle);color:var(--text-secondary)}
  .tag.pipe-tag{cursor:grab;user-select:none}
  .tag.pipe-tag.dragging{opacity:.4}
  .adv-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:12px;color:var(--text-tertiary);margin:18px 0 10px;padding:6px 0;font-weight:500}
  .adv-toggle:hover{color:var(--text-secondary)}
  .adv-toggle .adv-arrow{font-size:10px;transition:transform .2s;display:inline-block}
  .adv-toggle.open .adv-arrow{transform:rotate(90deg)}
  .adv-body{display:none}
  .adv-body.open{display:block}

  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}
  ::-webkit-scrollbar-thumb:hover{background:#9ca3af}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1 data-i18n="header.title">GuardClaw Dashboard</h1>
  </div>
  <div class="header-right">
    <span class="status-dot warn" id="status-dot"></span>
    <span id="status-text" data-i18n="header.connecting">Connecting...</span>
    <span id="last-updated"></span>
    <button class="btn btn-sm btn-outline" onclick="refreshAll()" data-i18n="header.refresh">Refresh</button>
    <button class="btn btn-sm btn-outline" id="lang-toggle" onclick="setLang(LANG==='en'?'zh':'en')">中文</button>
  </div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="stats" data-i18n="tab.overview">Overview</div>
  <div class="tab" data-tab="sessions" data-i18n="tab.sessions">Sessions</div>
  <div class="tab" data-tab="detections" data-i18n="tab.detections">Detection Log</div>
  <div class="tab" data-tab="rules"><span data-i18n="tab.rules">Router Rules</span> <span class="badge badge-hot">live</span></div>
  <div class="tab" data-tab="config"><span data-i18n="tab.config">Configuration</span> <span class="badge badge-hot">live</span></div>
</div>

<!-- Overview -->
<div id="stats-panel" class="panel active">
  <div class="cards">
    <div class="card cloud">
      <div class="card-label" data-i18n="overview.cloud">Cloud Tokens</div>
      <div class="card-value" id="cloud-tokens">-</div>
      <div class="card-sub" id="cloud-reqs">0 requests</div>
    </div>
    <div class="card local">
      <div class="card-label" data-i18n="overview.local">Local Tokens</div>
      <div class="card-value" id="local-tokens">-</div>
      <div class="card-sub" id="local-reqs">0 requests</div>
    </div>
    <div class="card proxy">
      <div class="card-label" data-i18n="overview.redacted">Redacted Tokens</div>
      <div class="card-value" id="proxy-tokens">-</div>
      <div class="card-sub" id="proxy-reqs">0 requests</div>
    </div>
    <div class="card privacy">
      <div class="card-label" data-i18n="overview.protection">Data Protection Rate</div>
      <div class="card-value" id="privacy-rate">-</div>
      <div class="card-sub" id="privacy-sub" data-i18n="overview.sub">of total tokens protected</div>
    </div>
    <div class="card cost">
      <div class="card-label" data-i18n="overview.cost">Cloud Cost</div>
      <div class="card-value" id="cloud-cost">-</div>
      <div class="card-sub" id="cloud-cost-sub" data-i18n="overview.cost_sub">estimated cloud API cost</div>
    </div>
  </div>
  <div class="chart-wrap">
    <h3 data-i18n="overview.chart">Hourly Token Usage</h3>
    <canvas id="hourlyChart" height="80"></canvas>
  </div>
  <table class="data-table">
    <thead><tr><th data-i18n="table.category">Category</th><th data-i18n="table.input">Input</th><th data-i18n="table.output">Output</th><th data-i18n="table.cache">Cache Read</th><th data-i18n="table.total">Total</th><th data-i18n="table.requests">Requests</th><th data-i18n="table.cost">Cost</th></tr></thead>
    <tbody id="detail-body"></tbody>
  </table>
  <h4 style="margin-top:18px;margin-bottom:6px;color:var(--text-secondary);" data-i18n="table.by_source">By Source (Router vs Task)</h4>
  <table class="data-table">
    <thead><tr><th data-i18n="table.source">Source</th><th data-i18n="table.input">Input</th><th data-i18n="table.output">Output</th><th data-i18n="table.cache">Cache Read</th><th data-i18n="table.total">Total</th><th data-i18n="table.requests">Requests</th><th data-i18n="table.cost">Cost</th></tr></thead>
    <tbody id="source-body"></tbody>
  </table>
  <div class="info-bar" id="info-bar"></div>
  <div style="text-align:right;margin-top:8px;">
    <button class="btn btn-sm btn-outline" onclick="resetStats()" data-i18n="overview.reset_btn">Reset Stats</button>
  </div>
</div>

<!-- Sessions -->
<div id="sessions-panel" class="panel">
  <table class="data-table">
    <thead><tr><th data-i18n="sessions.session">Session</th><th data-i18n="sessions.level">Level</th><th data-i18n="sessions.cloud">Cloud</th><th data-i18n="sessions.local">Local</th><th data-i18n="sessions.redacted">Redacted</th><th>Router</th><th>Task</th><th data-i18n="sessions.total">Total</th><th data-i18n="sessions.cost">Cost</th><th data-i18n="sessions.requests">Requests</th><th data-i18n="sessions.last_active">Last Active</th></tr></thead>
    <tbody id="sessions-body"><tr><td colspan="11" class="empty-state" data-i18n="sessions.empty">No session data yet</td></tr></tbody>
  </table>
</div>

<!-- Detection Log -->
<div id="detections-panel" class="panel">
  <div class="filter-bar">
    <button class="filter-btn active" onclick="filterDetections('all',this)" data-i18n="det.all">All</button>
    <button class="filter-btn" onclick="filterDetections('S1',this)">S1</button>
    <button class="filter-btn" onclick="filterDetections('S2',this)">S2</button>
    <button class="filter-btn" onclick="filterDetections('S3',this)">S3</button>
  </div>
  <table class="data-table">
    <thead><tr><th data-i18n="det.time">Time</th><th data-i18n="det.session">Session</th><th data-i18n="det.level">Level</th><th data-i18n="det.checkpoint">Checkpoint</th><th data-i18n="det.reason">Reason</th></tr></thead>
    <tbody id="detections-body"><tr><td colspan="5" class="empty-state" data-i18n="det.empty">No detections yet</td></tr></tbody>
  </table>
</div>

<!-- Router Rules -->
<div id="rules-panel" class="panel">

  <!-- Pipeline Test (full pipeline) -->
  <div class="test-panel">
    <h3 style="font-size:12px;color:var(--text-secondary);margin-bottom:14px;text-transform:uppercase;letter-spacing:.06em;font-weight:700" data-i18n="test.title">Test Classification</h3>
    <div class="hint" style="margin-bottom:10px" data-i18n="test.hint">Test how the router pipeline would classify a message (no changes applied).</div>
    <textarea class="test-input" id="test-message" data-i18n-ph="test.placeholder" placeholder="e.g. &quot;帮我分析一下这个月的工资单&quot; or &quot;write a poem about spring&quot;"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      <select id="test-checkpoint" style="padding:10px 36px 10px 14px;background:var(--bg-input) url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236e6e80' d='M2 4l4 4 4-4'/%3E%3C/svg%3E&quot;) no-repeat right 14px center;border:1px solid transparent;border-radius:6px;color:var(--text-primary);font-size:12px;appearance:none;-webkit-appearance:none">
        <option value="onUserMessage" data-i18n-opt="ck.user_message">User Message</option>
        <option value="onToolCallProposed" data-i18n-opt="ck.before_tool">Before Tool Runs</option>
        <option value="onToolCallExecuted" data-i18n-opt="ck.after_tool">After Tool Runs</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="runTestClassify()" data-i18n="test.run">Run Test</button>
    </div>
    <div class="test-result" id="test-result">
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-tertiary);letter-spacing:.06em;font-weight:700;margin-bottom:10px" data-i18n="test.merged">Merged Result</div>
      <div class="test-result-row"><span class="test-result-label" data-i18n="test.level">Level</span><span class="test-result-value" id="tr-level">-</span></div>
      <div class="test-result-row"><span class="test-result-label" data-i18n="test.action">Action</span><span class="test-result-value" id="tr-action">-</span></div>
      <div class="test-result-row"><span class="test-result-label" data-i18n="test.target">Target</span><span class="test-result-value" id="tr-target">-</span></div>
      <div class="test-result-row"><span class="test-result-label" data-i18n="test.deciding">Deciding Router</span><span class="test-result-value" id="tr-router">-</span></div>
      <div class="test-result-row"><span class="test-result-label" data-i18n="test.reason">Reason</span><span class="test-result-value" id="tr-reason">-</span></div>
      <div class="test-result-row"><span class="test-result-label" data-i18n="test.confidence">Confidence</span><span class="test-result-value" id="tr-confidence">-</span></div>
      <div id="tr-per-router"></div>
    </div>
    <div class="test-loading" id="test-loading" style="display:none" data-i18n="test.classifying">Classifying...</div>
  </div>

  <!-- Pipeline Order (Advanced) -->
  <div class="adv-toggle" onclick="toggleAdv(this)">
    <span class="adv-arrow">&#9654;</span> <span data-i18n="pipe.title">Router Execution Order (Advanced)</span>
  </div>
  <div class="adv-body">
    <div class="config-section">
      <div class="hint" style="margin-bottom:12px" data-i18n="pipe.hint">Click a router to add it to a stage. Drag tags to reorder. Click &times; to remove.</div>
      <div class="field">
        <label data-i18n="ck.user_message">User Message</label>
        <div class="tag-list" id="cfg-tags-pipe-um"></div>
        <div class="pipe-picker" id="pipe-picker-um"></div>
      </div>
      <div class="field">
        <label data-i18n="ck.before_tool">Before Tool Runs</label>
        <div class="tag-list" id="cfg-tags-pipe-tcp"></div>
        <div class="pipe-picker" id="pipe-picker-tcp"></div>
      </div>
      <div class="field">
        <label data-i18n="ck.after_tool">After Tool Runs</label>
        <div class="tag-list" id="cfg-tags-pipe-tce"></div>
        <div class="pipe-picker" id="pipe-picker-tce"></div>
      </div>
      <div class="save-bar"><button class="btn btn-primary btn-sm" onclick="savePipelineOrder()" data-i18n="pipe.save">Save Execution Order</button></div>
    </div>
  </div>

  <!-- ═══ Privacy Router Card ═══ -->
  <div class="router-section">
    <div class="router-section-header" onclick="toggleSection(this)">
      <span class="section-arrow">&#9660;</span>
      <h3 data-i18n="priv.title">Privacy Router</h3>
      <span class="router-id-badge">privacy</span>
    </div>
    <div class="router-section-body">
      <div class="hint" style="margin-bottom:14px" data-i18n="priv.desc">Detects sensitive data in messages and routes to local or redacted cloud models.</div>

      <div class="field-toggle" style="margin-bottom:18px">
        <label data-i18n="common.enabled">Enabled</label>
        <label class="toggle"><input type="checkbox" id="cfg-privacy-enabled" checked><span class="slider"></span></label>
      </div>

      <!-- Keywords (always visible) -->
      <div class="subsection">
        <h4 data-i18n="priv.keywords">Keywords</h4>
        <div class="rules-grid">
          <div class="rules-col">
            <h4 data-i18n-html="priv.s2">S2 &mdash; Sensitive (Redact &rarr; Cloud)</h4>
            <div class="field">
              <label data-i18n="priv.keywords">Keywords</label>
              <div class="tag-list" id="cfg-tags-kw-s2"></div>
              <div class="add-row">
                <input id="cfg-tags-kw-s2-input" placeholder="e.g. salary, phone number" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('kw-s2')}">
                <button class="btn btn-sm btn-outline" onclick="addTag('kw-s2')">Add</button>
              </div>
            </div>
          </div>
          <div class="rules-col">
            <h4 data-i18n-html="priv.s3">S3 &mdash; Confidential (Local Model Only)</h4>
            <div class="field">
              <label data-i18n="priv.keywords">Keywords</label>
              <div class="tag-list" id="cfg-tags-kw-s3"></div>
              <div class="add-row">
                <input id="cfg-tags-kw-s3-input" placeholder="e.g. SSN, bank account" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('kw-s3')}">
                <button class="btn btn-sm btn-outline" onclick="addTag('kw-s3')">Add</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- LLM Prompts (privacy-specific) -->
      <div class="subsection">
        <h4 data-i18n="priv.llm_prompt">LLM Prompt</h4>
        <div class="hint" style="margin-bottom:12px" data-i18n="priv.llm_hint">Prompt used by the local LLM to classify data sensitivity (S1/S2/S3).</div>
        <div id="privacy-prompt-main"></div>
      </div>

      <!-- Per-router Test -->
      <div class="subsection">
        <h4 data-i18n="priv.test_title">Test (Privacy Router Only)</h4>
        <textarea class="test-input" id="test-privacy-message" data-i18n-ph="priv.test_ph" placeholder="Enter a message to test the privacy router alone..."></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
          <button class="btn btn-primary btn-sm" onclick="runRouterTest('privacy')" data-i18n="priv.test_btn">Test Privacy Router</button>
        </div>
        <div class="test-result" id="test-privacy-result">
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.level">Level</span><span class="test-result-value" id="tr-privacy-level">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.action">Action</span><span class="test-result-value" id="tr-privacy-action">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.target">Target</span><span class="test-result-value" id="tr-privacy-target">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.reason">Reason</span><span class="test-result-value" id="tr-privacy-reason">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.confidence">Confidence</span><span class="test-result-value" id="tr-privacy-confidence">-</span></div>
        </div>
        <div class="test-loading" id="test-privacy-loading" style="display:none" data-i18n="test.testing">Testing...</div>
      </div>

      <!-- Advanced Configuration -->
      <div class="adv-toggle" onclick="toggleAdv(this)">
        <span class="adv-arrow">&#9654;</span> <span data-i18n="priv.adv">Advanced Configuration</span>
      </div>
      <div class="adv-body">

        <!-- When to Run -->
        <div class="subsection">
          <h4 data-i18n="priv.when">When to Run</h4>
          <div class="hint" style="margin-bottom:10px" data-i18n="priv.when_hint">Select which detectors run at each stage for the privacy router.</div>
          <div class="field">
            <label data-i18n="ck.user_message">User Message</label>
            <div class="chip-group" id="ck-um">
              <button class="chip" data-ck="um" data-det="ruleDetector" onclick="toggleChip(this)" data-i18n="priv.kw_regex">Keyword &amp; Regex</button>
              <button class="chip" data-ck="um" data-det="localModelDetector" onclick="toggleChip(this)" data-i18n="priv.llm_cls">LLM Classifier</button>
            </div>
          </div>
          <div class="field">
            <label data-i18n="ck.before_tool">Before Tool Runs</label>
            <div class="chip-group" id="ck-tcp">
              <button class="chip" data-ck="tcp" data-det="ruleDetector" onclick="toggleChip(this)" data-i18n="priv.kw_regex">Keyword &amp; Regex</button>
              <button class="chip" data-ck="tcp" data-det="localModelDetector" onclick="toggleChip(this)" data-i18n="priv.llm_cls">LLM Classifier</button>
            </div>
          </div>
          <div class="field">
            <label data-i18n="ck.after_tool">After Tool Runs</label>
            <div class="chip-group" id="ck-tce">
              <button class="chip" data-ck="tce" data-det="ruleDetector" onclick="toggleChip(this)" data-i18n="priv.kw_regex">Keyword &amp; Regex</button>
              <button class="chip" data-ck="tce" data-det="localModelDetector" onclick="toggleChip(this)" data-i18n="priv.llm_cls">LLM Classifier</button>
            </div>
          </div>
        </div>

        <!-- Regex Patterns, Sensitive Tool Names, Sensitive File Paths -->
        <div class="subsection">
          <h4 data-i18n="priv.det_rules">Detection Rules (Regex &amp; Tool Filters)</h4>
          <div class="rules-grid">
            <div class="rules-col">
              <h4 data-i18n-html="priv.s2">S2 &mdash; Sensitive (Redact &rarr; Cloud)</h4>
              <div class="field">
                <label data-i18n="priv.regex">Regex Patterns</label>
                <div class="tag-list" id="cfg-tags-pat-s2"></div>
                <div class="add-row">
                  <input id="cfg-tags-pat-s2-input" placeholder="e.g. \\d{3}-\\d{4}" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('pat-s2')}">
                  <button class="btn btn-sm btn-outline" onclick="addTag('pat-s2')">Add</button>
                </div>
              </div>
              <div class="field">
                <label data-i18n="priv.tools">Sensitive Tool Names</label>
                <div class="tag-list" id="cfg-tags-tool-s2"></div>
                <div class="add-row">
                  <input id="cfg-tags-tool-s2-input" placeholder="e.g. read_file, execute_sql" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('tool-s2')}">
                  <button class="btn btn-sm btn-outline" onclick="addTag('tool-s2')">Add</button>
                </div>
              </div>
              <div class="field">
                <label data-i18n="priv.paths">Sensitive File Paths</label>
                <div class="tag-list" id="cfg-tags-toolpath-s2"></div>
                <div class="add-row">
                  <input id="cfg-tags-toolpath-s2-input" placeholder="e.g. /secrets/, *.env" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('toolpath-s2')}">
                  <button class="btn btn-sm btn-outline" onclick="addTag('toolpath-s2')">Add</button>
                </div>
              </div>
            </div>
            <div class="rules-col">
              <h4 data-i18n-html="priv.s3">S3 &mdash; Confidential (Local Model Only)</h4>
              <div class="field">
                <label data-i18n="priv.regex">Regex Patterns</label>
                <div class="tag-list" id="cfg-tags-pat-s3"></div>
                <div class="add-row">
                  <input id="cfg-tags-pat-s3-input" placeholder="e.g. \\b\\d{3}-\\d{2}-\\d{4}\\b" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('pat-s3')}">
                  <button class="btn btn-sm btn-outline" onclick="addTag('pat-s3')">Add</button>
                </div>
              </div>
              <div class="field">
                <label data-i18n="priv.tools">Sensitive Tool Names</label>
                <div class="tag-list" id="cfg-tags-tool-s3"></div>
                <div class="add-row">
                  <input id="cfg-tags-tool-s3-input" placeholder="e.g. execute_command" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('tool-s3')}">
                  <button class="btn btn-sm btn-outline" onclick="addTag('tool-s3')">Add</button>
                </div>
              </div>
              <div class="field">
                <label data-i18n="priv.paths">Sensitive File Paths</label>
                <div class="tag-list" id="cfg-tags-toolpath-s3"></div>
                <div class="add-row">
                  <input id="cfg-tags-toolpath-s3-input" placeholder="e.g. /credentials/" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('toolpath-s3')}">
                  <button class="btn btn-sm btn-outline" onclick="addTag('toolpath-s3')">Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Personal Info Redaction Prompt -->
        <div class="subsection">
          <h4 data-i18n="priv.pii">Personal Info Redaction Prompt</h4>
          <div class="hint" style="margin-bottom:12px" data-i18n="priv.pii_hint">Prompt used by the local LLM to extract and redact personal info.</div>
          <div id="privacy-prompt-adv"></div>
        </div>

      </div>

      <div class="save-bar"><button class="btn btn-primary" onclick="savePrivacyRouter()" data-i18n="priv.save">Save Privacy Router</button></div>
    </div>
  </div>

  <!-- ═══ Token-Saver Router Card ═══ -->
  <div class="router-section">
    <div class="router-section-header" onclick="toggleSection(this)">
      <span class="section-arrow">&#9660;</span>
      <h3 data-i18n="co.title">Cost-Optimizer Router</h3>
      <span class="router-id-badge">token-saver</span>
    </div>
    <div class="router-section-body">
      <div class="hint" style="margin-bottom:14px" data-i18n="co.desc">Classifies task complexity and routes to the most cost-effective model.</div>

      <div class="field-toggle" style="margin-bottom:18px">
        <label data-i18n="common.enabled">Enabled</label>
        <label class="toggle"><input type="checkbox" id="cfg-ts-enabled"><span class="slider"></span></label>
      </div>

      <!-- Judge Model -->
      <div class="subsection">
        <h4 data-i18n-html="co.tier">Complexity Level &rarr; Model</h4>
        <div class="tier-grid">
          <div class="tier-grid-header" data-i18n="co.complexity">Complexity</div>
          <div class="tier-grid-header" data-i18n="co.provider">Provider</div>
          <div class="tier-grid-header" data-i18n="co.model">Model</div>
          <div class="tier-label">SIMPLE</div><input id="cfg-ts-tier-SIMPLE-provider" placeholder="openai"><input id="cfg-ts-tier-SIMPLE-model" placeholder="gpt-4o-mini">
          <div class="tier-label">MEDIUM</div><input id="cfg-ts-tier-MEDIUM-provider" placeholder="openai"><input id="cfg-ts-tier-MEDIUM-model" placeholder="gpt-4o">
          <div class="tier-label">COMPLEX</div><input id="cfg-ts-tier-COMPLEX-provider" placeholder="anthropic"><input id="cfg-ts-tier-COMPLEX-model" placeholder="claude-sonnet-4.6">
          <div class="tier-label">REASONING</div><input id="cfg-ts-tier-REASONING-provider" placeholder="openai"><input id="cfg-ts-tier-REASONING-model" placeholder="o4-mini">
        </div>
      </div>

      <!-- LLM Prompt (token-saver-specific) -->
      <div class="subsection">
        <h4 data-i18n="co.llm_prompt">LLM Prompt</h4>
        <div class="hint" style="margin-bottom:12px" data-i18n="co.llm_hint">Prompt used by the classifier LLM to determine task complexity.</div>
        <div id="tokensaver-prompt-editors"></div>
      </div>

      <!-- Per-router Test -->
      <div class="subsection">
        <h4 data-i18n="co.test_title">Test (Cost-Optimizer Only)</h4>
        <textarea class="test-input" id="test-token-saver-message" data-i18n-ph="co.test_ph" placeholder="Enter a message to test the cost-optimizer router alone..."></textarea>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
          <button class="btn btn-primary btn-sm" onclick="runRouterTest('token-saver')" data-i18n="co.test_btn">Test Cost-Optimizer</button>
        </div>
        <div class="test-result" id="test-token-saver-result">
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.level">Level</span><span class="test-result-value" id="tr-token-saver-level">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.action">Action</span><span class="test-result-value" id="tr-token-saver-action">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.target">Target</span><span class="test-result-value" id="tr-token-saver-target">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.reason">Reason</span><span class="test-result-value" id="tr-token-saver-reason">-</span></div>
          <div class="test-result-row"><span class="test-result-label" data-i18n="test.confidence">Confidence</span><span class="test-result-value" id="tr-token-saver-confidence">-</span></div>
        </div>
        <div class="test-loading" id="test-token-saver-loading" style="display:none" data-i18n="test.testing">Testing...</div>
      </div>

      <!-- Advanced Configuration -->
      <div class="adv-toggle" onclick="toggleAdv(this)">
        <span class="adv-arrow">&#9654;</span> <span data-i18n="co.adv">Advanced Configuration</span>
      </div>
      <div class="adv-body">

        <!-- Cache Duration -->
        <div class="subsection">
          <h4 data-i18n="co.cache">Cache</h4>
          <div class="field">
            <label data-i18n="co.cache_dur">Cache Duration (ms)</label>
            <input id="cfg-ts-cachettl" type="number" placeholder="300000" style="max-width:180px">
          </div>
        </div>

      </div>

      <div class="save-bar"><button class="btn btn-primary" onclick="saveTokenSaverConfig()" data-i18n="co.save">Save Cost-Optimizer</button></div>
    </div>
  </div>

  <!-- ═══ Custom Router Cards (rendered dynamically) ═══ -->
  <div id="custom-router-cards"></div>

  <!-- Add Custom Router -->
  <div class="add-custom-router">
    <div style="display:flex;gap:10px;align-items:center">
      <input id="new-router-id" data-i18n-ph="cr.add_ph" placeholder="Router ID (e.g. content-filter)" style="flex:1;padding:10px 14px;background:var(--bg-input);border:1px solid transparent;border-radius:8px;color:var(--text-primary);font-size:13px;outline:none">
      <button class="btn btn-primary" onclick="addCustomRouter()" data-i18n="cr.add_btn">+ Add Custom Router</button>
    </div>
    <div class="hint" style="margin-top:8px" data-i18n="cr.add_hint">Create a new router with keyword rules and an optional LLM classification prompt. Added routers appear above and can be included in Router Execution Order.</div>
  </div>

</div>

<!-- Configuration -->
<div id="config-panel" class="panel">

  <div class="toggle-bar">
    <label data-i18n="cfg.enabled">GuardClaw Enabled</label>
    <label class="toggle"><input type="checkbox" id="cfg-enabled" checked><span class="slider"></span></label>
  </div>

  <div class="config-section">
    <h3><span data-i18n="cfg.lm">Local Model</span> <span class="badge badge-hot">instant</span></h3>
    <div class="hint" style="margin-bottom:14px" data-i18n="cfg.lm_desc">Configure the LLM used locally for privacy classification and PII redaction.</div>
    <div class="field-toggle">
      <label data-i18n="cfg.lm_enabled">Enabled</label>
      <label class="toggle"><input type="checkbox" id="cfg-lm-enabled" checked><span class="slider"></span></label>
    </div>
    <div class="field">
      <label data-i18n="cfg.api_proto">API Protocol</label>
      <select id="cfg-lm-type">
        <option value="openai-compatible">openai-compatible (Ollama, vLLM, LMStudio ...)</option>
        <option value="ollama-native">ollama-native (Ollama /api/chat)</option>
        <option value="custom">custom (user module)</option>
      </select>
    </div>
    <div class="field"><label data-i18n="cfg.provider">Provider</label><input id="cfg-lm-provider" placeholder="ollama"></div>
    <div class="field"><label data-i18n="cfg.endpoint">Endpoint</label><input id="cfg-lm-endpoint" placeholder="http://localhost:11434"></div>
    <div class="field"><label data-i18n="cfg.model">Model</label><input id="cfg-lm-model" placeholder="openbmb/minicpm4.1"></div>
    <div class="field"><label data-i18n="cfg.api_key">API Key</label><input id="cfg-lm-apikey" type="password" placeholder="sk-..."></div>
    <div class="field" id="cfg-lm-module-wrap" style="display:none"><label data-i18n="cfg.custom_mod">Custom Module Path</label><input id="cfg-lm-module" placeholder="./my-provider.js"></div>
  </div>

  <div class="config-section">
    <h3><span data-i18n="cfg.cls">Cost-Optimizer Classifier</span> <span class="badge badge-hot">instant</span></h3>
    <div class="hint" style="margin-bottom:14px" data-i18n="cfg.cls_desc">LLM used by the Cost-Optimizer to determine task complexity. Falls back to the Local Model settings above if empty.</div>
    <div class="field"><label data-i18n="cfg.endpoint">Endpoint</label><input id="cfg-ts-endpoint" placeholder="(inherits from Local Model)"></div>
    <div class="field"><label data-i18n="cfg.model">Model</label><input id="cfg-ts-model" placeholder="(inherits from Local Model)"></div>
    <div class="field">
      <label data-i18n="cfg.api_proto">API Protocol</label>
      <select id="cfg-ts-providertype">
        <option value="openai-compatible">openai-compatible</option>
        <option value="ollama-native">ollama-native</option>
        <option value="custom">custom</option>
      </select>
    </div>
  </div>

  <div class="adv-toggle" onclick="toggleAdv(this)">
    <span class="adv-arrow">&#9654;</span> <span data-i18n="cfg.adv">Advanced Settings</span>
  </div>
  <div class="adv-body">

  <div class="config-section">
    <h3><span data-i18n="cfg.guard">Privacy Guard Agent</span> <span class="badge badge-hot">instant</span></h3>
    <div class="hint" style="margin-bottom:14px" data-i18n="cfg.guard_desc">A local agent that handles sensitive tasks entirely on-device.</div>
    <div class="field"><label data-i18n="cfg.agent_id">Agent ID</label><input id="cfg-ga-id" placeholder="guard"></div>
    <div class="field"><label data-i18n="cfg.workspace">Workspace</label><input id="cfg-ga-workspace" placeholder="~/.openclaw/workspace-guard"></div>
    <div class="field"><label data-i18n="cfg.model_prov">Model (provider/model)</label><input id="cfg-ga-model" placeholder="ollama/qwen3.5-27b"></div>
  </div>

  <div class="config-section">
    <h3><span data-i18n="cfg.routing">Routing Policy</span> <span class="badge badge-hot">instant</span></h3>
    <div class="hint" style="margin-bottom:14px" data-i18n="cfg.routing_desc">How S2-level sensitive data is handled before reaching the cloud.</div>
    <div class="field">
      <label data-i18n="cfg.sens_route">Sensitive Data Routing</label>
      <select id="cfg-s2policy">
        <option value="proxy" data-i18n-opt="cfg.s2_proxy">Proxy (redact personal info before sending)</option>
        <option value="local" data-i18n-opt="cfg.s2_local">Local only (process on-device, no cloud)</option>
      </select>
    </div>
    <div class="field">
      <label data-i18n="cfg.proxy_port">Proxy Port</label>
      <input id="cfg-proxyport" type="number" placeholder="8403" style="max-width:160px">
      <div class="hint" data-i18n="cfg.restart_hint">Requires restart to take effect</div>
    </div>
  </div>

  <div class="config-section">
    <h3><span data-i18n="cfg.session">Session Settings</span> <span class="badge badge-hot">instant</span></h3>
    <div class="hint" style="margin-bottom:14px" data-i18n="cfg.session_desc">Manage isolation and storage of guard-related session data.</div>
    <div class="field-toggle">
      <label data-i18n="cfg.isolate">Separate Guard Chat History</label>
      <label class="toggle"><input type="checkbox" id="cfg-sess-isolate" checked><span class="slider"></span></label>
    </div>
    <div class="field"><label data-i18n="cfg.base_dir">Base Directory</label><input id="cfg-sess-basedir" placeholder="~/.openclaw"></div>
  </div>

  <div class="config-section">
    <h3><span data-i18n="cfg.local_prov">Local Providers</span> <span class="badge badge-hot">instant</span></h3>
    <div class="field">
      <label data-i18n="cfg.local_prov_hint">Additional providers treated as &quot;local&quot; (safe for confidential data routing)</label>
      <div class="tag-list" id="cfg-tags-lp"></div>
      <div class="add-row">
        <input id="cfg-tags-lp-input" placeholder="e.g. my-inference-server" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('lp')}">
        <button class="btn btn-sm btn-outline" onclick="addTag('lp')">Add</button>
      </div>
    </div>
  </div>

  </div>

  <div class="config-section">
    <h3><span data-i18n="cfg.pricing">Model Pricing</span> <span class="badge badge-hot">instant</span></h3>
    <div class="hint" style="margin-bottom:14px" data-i18n="cfg.pricing_desc">Configure per-model pricing for cloud API cost estimation (USD per 1M tokens). Only cloud models are tracked.</div>
    <table class="data-table" id="pricing-table">
      <thead><tr><th data-i18n="cfg.pricing_model">Model</th><th data-i18n="cfg.pricing_input">Input $/1M</th><th data-i18n="cfg.pricing_output">Output $/1M</th><th style="width:40px"></th></tr></thead>
      <tbody id="pricing-body"></tbody>
    </table>
    <div class="add-row" style="margin-top:12px">
      <input id="pricing-new-model" placeholder="e.g. gpt-4o" style="flex:2;padding:10px 14px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px;outline:none">
      <input id="pricing-new-input" type="number" step="0.01" placeholder="Input $/1M" style="flex:1;padding:10px 14px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px;outline:none">
      <input id="pricing-new-output" type="number" step="0.01" placeholder="Output $/1M" style="flex:1;padding:10px 14px;background:var(--bg-input);border:1px solid transparent;border-radius:var(--radius-sm);color:var(--text-primary);font-size:13px;outline:none">
      <button class="btn btn-sm btn-outline" onclick="addPricingRow()" data-i18n="cfg.pricing_add">Add Model</button>
    </div>
    <div style="margin-top:10px">
      <button class="btn btn-sm btn-outline" onclick="loadDefaultPricing()" data-i18n="cfg.pricing_load">Load Defaults</button>
    </div>
  </div>

  <div class="save-bar">
    <button class="btn btn-primary" onclick="saveConfig()" data-i18n="cfg.save">Save Configuration</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
var BASE = '/plugins/guardclaw/stats/api';
var hourlyChart = null;
var _detections = [];
var _detectionFilter = 'all';

// ── i18n ──
var LANG = localStorage.getItem('gc-lang') || 'en';
var T = {
  'tab.overview':{en:'Overview',zh:'概览'},
  'tab.sessions':{en:'Sessions',zh:'会话'},
  'tab.detections':{en:'Detection Log',zh:'检测日志'},
  'tab.rules':{en:'Router Rules',zh:'路由规则'},
  'tab.config':{en:'Configuration',zh:'配置'},
  'header.title':{en:'GuardClaw Dashboard',zh:'GuardClaw 控制台'},
  'header.connecting':{en:'Connecting...',zh:'连接中...'},
  'header.refresh':{en:'Refresh',zh:'刷新'},
  'header.online':{en:'Online',zh:'在线'},
  'overview.cloud':{en:'Cloud Tokens',zh:'云端 Tokens'},
  'overview.local':{en:'Local Tokens',zh:'本地 Tokens'},
  'overview.redacted':{en:'Redacted Tokens',zh:'脱敏 Tokens'},
  'overview.protection':{en:'Data Protection Rate',zh:'数据保护率'},
  'overview.cost':{en:'Cloud Cost',zh:'云端费用'},
  'overview.cost_sub':{en:'estimated cloud API cost',zh:'估算云端 API 费用'},
  'overview.sub':{en:'of total tokens protected',zh:'受保护的 Token 占比'},
  'overview.chart':{en:'Hourly Token Usage',zh:'每小时 Token 用量'},
  'overview.requests':{en:'requests',zh:'请求'},
  'overview.no_data':{en:'No data yet',zh:'暂无数据'},
  'overview.reset_btn':{en:'Reset Stats',zh:'重置统计'},
  'overview.reset_confirm':{en:'Reset all token statistics? This cannot be undone.',zh:'确定要重置所有 Token 统计数据吗？此操作不可撤销。'},
  'overview.reset_ok':{en:'Stats reset successfully',zh:'统计数据已重置'},
  'overview.reset_fail':{en:'Failed to reset stats: ',zh:'重置统计失败：'},
  'table.category':{en:'Category',zh:'分类'},
  'table.input':{en:'Input',zh:'输入'},
  'table.output':{en:'Output',zh:'输出'},
  'table.cache':{en:'Cache Read',zh:'缓存读取'},
  'table.total':{en:'Total',zh:'总计'},
  'table.requests':{en:'Requests',zh:'请求数'},
  'table.cost':{en:'Cost',zh:'费用'},
  'table.by_source':{en:'By Source (Router vs Task)',zh:'按来源（路由开销 vs 任务执行）'},
  'table.source':{en:'Source',zh:'来源'},
  'sessions.session':{en:'Session',zh:'会话'},
  'sessions.level':{en:'Level',zh:'等级'},
  'sessions.cloud':{en:'Cloud',zh:'云端'},
  'sessions.local':{en:'Local',zh:'本地'},
  'sessions.redacted':{en:'Redacted',zh:'脱敏'},
  'sessions.cost':{en:'Cost',zh:'费用'},
  'sessions.total':{en:'Total',zh:'总计'},
  'sessions.requests':{en:'Requests',zh:'请求数'},
  'sessions.last_active':{en:'Last Active',zh:'最近活跃'},
  'sessions.empty':{en:'No session data yet',zh:'暂无会话数据'},
  'det.time':{en:'Time',zh:'时间'},
  'det.session':{en:'Session',zh:'会话'},
  'det.level':{en:'Level',zh:'等级'},
  'det.checkpoint':{en:'Checkpoint',zh:'检查点'},
  'det.reason':{en:'Reason',zh:'原因'},
  'det.empty':{en:'No detections yet',zh:'暂无检测记录'},
  'det.empty_for':{en:'No detections for ',zh:'暂无检测记录：'},
  'det.all':{en:'All',zh:'全部'},
  'test.title':{en:'Test Classification',zh:'分类测试'},
  'test.hint':{en:'Test how the router pipeline would classify a message (no changes applied).',zh:'测试路由管道如何对消息进行分类（不会实际生效）。'},
  'test.placeholder':{en:'e.g. "帮我分析一下这个月的工资单" or "write a poem about spring"',zh:'例如 "帮我分析一下这个月的工资单" 或 "write a poem about spring"'},
  'test.run':{en:'Run Test',zh:'运行测试'},
  'test.merged':{en:'Merged Result',zh:'合并结果'},
  'test.level':{en:'Level',zh:'等级'},
  'test.action':{en:'Action',zh:'动作'},
  'test.target':{en:'Target',zh:'目标'},
  'test.deciding':{en:'Deciding Router',zh:'决策路由'},
  'test.reason':{en:'Reason',zh:'原因'},
  'test.confidence':{en:'Confidence',zh:'置信度'},
  'test.classifying':{en:'Classifying...',zh:'分类中...'},
  'test.testing':{en:'Testing...',zh:'测试中...'},
  'test.individual':{en:'Individual Router Results',zh:'各路由独立结果'},
  'test.enter_msg':{en:'Enter a test message',zh:'请输入测试消息'},
  'test.failed':{en:'Test failed: ',zh:'测试失败：'},
  'ck.user_message':{en:'User Message',zh:'用户消息'},
  'ck.before_tool':{en:'Before Tool Runs',zh:'工具执行前'},
  'ck.after_tool':{en:'After Tool Runs',zh:'工具执行后'},
  'pipe.title':{en:'Router Execution Order (Advanced)',zh:'路由执行顺序（高级）'},
  'pipe.hint':{en:'Click a router to add it to a stage. Drag tags to reorder. Click \\u00d7 to remove.',zh:'点击路由添加到对应阶段。拖拽标签调整顺序，点击 \\u00d7 移除。'},
  'pipe.save':{en:'Save Execution Order',zh:'保存执行顺序'},
  'pipe.saved':{en:'Execution order saved',zh:'执行顺序已保存'},
  'priv.title':{en:'Privacy Router',zh:'隐私路由'},
  'priv.desc':{en:'Detects sensitive data in messages and routes to local or redacted cloud models.',zh:'检测消息中的敏感数据，路由到本地模型或脱敏后发送云端。'},
  'priv.keywords':{en:'Keywords',zh:'关键词'},
  'priv.s2':{en:'S2 \\u2014 Sensitive (Redact \\u2192 Cloud)',zh:'S2 \\u2014 敏感（脱敏后走云端）'},
  'priv.s3':{en:'S3 \\u2014 Confidential (Local Model Only)',zh:'S3 \\u2014 机密（仅本地模型）'},
  'priv.llm_prompt':{en:'LLM Prompt',zh:'LLM 提示词'},
  'priv.llm_hint':{en:'Prompt used by the local LLM to classify data sensitivity (S1/S2/S3).',zh:'本地 LLM 用于分类数据敏感等级（S1/S2/S3）的提示词。'},
  'priv.test_title':{en:'Test (Privacy Router Only)',zh:'测试（仅隐私路由）'},
  'priv.test_ph':{en:'Enter a message to test the privacy router alone...',zh:'输入消息以单独测试隐私路由...'},
  'priv.test_btn':{en:'Test Privacy Router',zh:'测试隐私路由'},
  'priv.save':{en:'Save Privacy Router',zh:'保存隐私路由'},
  'priv.saved':{en:'Privacy Router saved',zh:'隐私路由已保存'},
  'priv.adv':{en:'Advanced Configuration',zh:'高级配置'},
  'priv.when':{en:'When to Run',zh:'何时运行'},
  'priv.when_hint':{en:'Select which detectors run at each stage for the privacy router.',zh:'选择隐私路由在每个阶段运行的检测器。'},
  'priv.kw_regex':{en:'Keyword \\u0026 Regex',zh:'关键词和正则'},
  'priv.llm_cls':{en:'LLM Classifier',zh:'LLM 分类器'},
  'priv.det_rules':{en:'Detection Rules (Regex \\u0026 Tool Filters)',zh:'检测规则（正则和工具过滤）'},
  'priv.regex':{en:'Regex Patterns',zh:'正则表达式'},
  'priv.tools':{en:'Sensitive Tool Names',zh:'敏感工具名'},
  'priv.paths':{en:'Sensitive File Paths',zh:'敏感文件路径'},
  'priv.pii':{en:'Personal Info Redaction Prompt',zh:'个人信息脱敏提示词'},
  'priv.pii_hint':{en:'Prompt used by the local LLM to extract and redact personal info.',zh:'本地 LLM 用于提取和脱敏个人信息的提示词。'},
  'co.title':{en:'Cost-Optimizer Router',zh:'成本优化路由'},
  'co.desc':{en:'Classifies task complexity and routes to the most cost-effective model.',zh:'判断任务复杂度，自动选择性价比最高的模型。'},
  'co.tier':{en:'Complexity Level \\u2192 Model',zh:'复杂度等级 \\u2192 模型'},
  'co.complexity':{en:'Complexity',zh:'复杂度'},
  'co.provider':{en:'Provider',zh:'供应商'},
  'co.model':{en:'Model',zh:'模型'},
  'co.llm_prompt':{en:'LLM Prompt',zh:'LLM 提示词'},
  'co.llm_hint':{en:'Prompt used by the classifier LLM to determine task complexity.',zh:'分类 LLM 用于判断任务复杂度的提示词。'},
  'co.test_title':{en:'Test (Cost-Optimizer Only)',zh:'测试（仅成本优化）'},
  'co.test_ph':{en:'Enter a message to test the cost-optimizer router alone...',zh:'输入消息以单独测试成本优化路由...'},
  'co.test_btn':{en:'Test Cost-Optimizer',zh:'测试成本优化'},
  'co.save':{en:'Save Cost-Optimizer',zh:'保存成本优化'},
  'co.saved':{en:'Cost-Optimizer config saved',zh:'成本优化配置已保存'},
  'co.adv':{en:'Advanced Configuration',zh:'高级配置'},
  'co.cache':{en:'Cache',zh:'缓存'},
  'co.cache_dur':{en:'Cache Duration (ms)',zh:'缓存时长（毫秒）'},
  'cr.add_ph':{en:'Router ID (e.g. content-filter)',zh:'路由 ID（如 content-filter）'},
  'cr.add_btn':{en:'+ Add Custom Router',zh:'+ 添加自定义路由'},
  'cr.add_hint':{en:'Create a new router with keyword rules and an optional LLM classification prompt. Added routers appear above and can be included in Router Execution Order.',zh:'创建一个带有关键词规则和可选 LLM 分类提示词的新路由。添加后显示在上方，可加入路由执行顺序。'},
  'cr.kw_rules':{en:'Keyword Rules',zh:'关键词规则'},
  'cr.s2_kw':{en:'S2 \\u2014 Sensitive Keywords',zh:'S2 \\u2014 敏感关键词'},
  'cr.s3_kw':{en:'S3 \\u2014 Confidential Keywords',zh:'S3 \\u2014 机密关键词'},
  'cr.s2_pat':{en:'S2 \\u2014 Sensitive Patterns (regex)',zh:'S2 \\u2014 敏感模式（正则）'},
  'cr.s3_pat':{en:'S3 \\u2014 Confidential Patterns (regex)',zh:'S3 \\u2014 机密模式（正则）'},
  'cr.cls_prompt':{en:'Classification Prompt',zh:'分类提示词'},
  'cr.cls_hint':{en:'If set, the local LLM will classify messages using this prompt. Should output JSON with {level, reason}.',zh:'如果设置，本地 LLM 将使用此提示词分类消息。应输出包含 {level, reason} 的 JSON。'},
  'cr.enter_id':{en:'Enter a router ID',zh:'请输入路由 ID'},
  'cr.exists':{en:'" already exists',zh:'" 已存在'},
  'cr.created':{en:'" created \\u2014 configure and save it below',zh:'" 已创建 \\u2014 请在下方配置并保存'},
  'cr.del_pre':{en:'Delete router "',zh:'确认删除路由 "'},
  'cr.del_suf':{en:'"? This cannot be undone.',zh:'"？此操作不可撤销。'},
  'cr.deleted':{en:'" deleted',zh:'" 已删除'},
  'cr.saved':{en:'" saved',zh:'" 已保存'},
  'cfg.enabled':{en:'GuardClaw Enabled',zh:'GuardClaw 启用'},
  'cfg.lm':{en:'Local Model',zh:'本地模型'},
  'cfg.lm_desc':{en:'Configure the LLM used locally for privacy classification and PII redaction.',zh:'配置用于隐私分类和个人信息脱敏的本地 LLM。'},
  'cfg.lm_enabled':{en:'Enabled',zh:'启用'},
  'cfg.api_proto':{en:'API Protocol',zh:'API 协议'},
  'cfg.provider':{en:'Provider',zh:'供应商'},
  'cfg.endpoint':{en:'Endpoint',zh:'端点'},
  'cfg.model':{en:'Model',zh:'模型'},
  'cfg.api_key':{en:'API Key',zh:'API 密钥'},
  'cfg.custom_mod':{en:'Custom Module Path',zh:'自定义模块路径'},
  'cfg.cls':{en:'Cost-Optimizer Classifier',zh:'成本优化分类器'},
  'cfg.cls_desc':{en:'LLM used by the Cost-Optimizer to determine task complexity. Falls back to the Local Model settings above if empty.',zh:'成本优化路由用于判断任务复杂度的 LLM。留空则使用上方本地模型配置。'},
  'cfg.adv':{en:'Advanced Settings',zh:'高级设置'},
  'cfg.guard':{en:'Privacy Guard Agent',zh:'隐私守护 Agent'},
  'cfg.guard_desc':{en:'A local agent that handles sensitive tasks entirely on-device.',zh:'完全在本地运行的隐私守护 Agent。'},
  'cfg.agent_id':{en:'Agent ID',zh:'Agent ID'},
  'cfg.workspace':{en:'Workspace',zh:'工作目录'},
  'cfg.model_prov':{en:'Model (provider/model)',zh:'模型（供应商/模型）'},
  'cfg.routing':{en:'Routing Policy',zh:'路由策略'},
  'cfg.routing_desc':{en:'How S2-level sensitive data is handled before reaching the cloud.',zh:'S2 级敏感数据发送云端前的处理策略。'},
  'cfg.sens_route':{en:'Sensitive Data Routing',zh:'敏感数据路由'},
  'cfg.s2_proxy':{en:'Proxy (redact personal info before sending)',zh:'代理（发送前脱敏个人信息）'},
  'cfg.s2_local':{en:'Local only (process on-device, no cloud)',zh:'仅本地（设备端处理，不上云）'},
  'cfg.proxy_port':{en:'Proxy Port',zh:'代理端口'},
  'cfg.restart_hint':{en:'Requires restart to take effect',zh:'需要重启生效'},
  'cfg.session':{en:'Session Settings',zh:'会话设置'},
  'cfg.session_desc':{en:'Manage isolation and storage of guard-related session data.',zh:'管理隔离与存储守护相关的会话数据。'},
  'cfg.isolate':{en:'Separate Guard Chat History',zh:'隔离守护聊天记录'},
  'cfg.base_dir':{en:'Base Directory',zh:'基础目录'},
  'cfg.local_prov':{en:'Local Providers',zh:'本地供应商'},
  'cfg.local_prov_hint':{en:'Additional providers treated as "local" (safe for confidential data routing)',zh:'额外视为"本地"的供应商（可安全路由机密数据）'},
  'cfg.pricing':{en:'Model Pricing',zh:'模型定价'},
  'cfg.pricing_desc':{en:'Configure per-model pricing for cloud API cost estimation (USD per 1M tokens). Only cloud models are tracked.',zh:'配置云端模型的单价用于费用估算（美元/百万 Token）。仅统计云端模型。'},
  'cfg.pricing_model':{en:'Model',zh:'模型'},
  'cfg.pricing_input':{en:'Input $/1M',zh:'输入 $/1M'},
  'cfg.pricing_output':{en:'Output $/1M',zh:'输出 $/1M'},
  'cfg.pricing_add':{en:'Add Model',zh:'添加模型'},
  'cfg.pricing_load':{en:'Load Defaults',zh:'加载默认'},
  'cfg.save':{en:'Save Configuration',zh:'保存配置'},
  'cfg.saved':{en:'Configuration saved',zh:'配置已保存'},
  'common.add':{en:'Add',zh:'添加'},
  'common.save':{en:'Save',zh:'保存'},
  'common.delete':{en:'Delete',zh:'删除'},
  'common.test':{en:'Test',zh:'测试'},
  'common.enabled':{en:'Enabled',zh:'启用'},
  'common.optional':{en:'(optional)',zh:'（可选）'},
  'common.none':{en:'(none)',zh:'（无）'},
  'common.customized':{en:'customized',zh:'已自定义'},
  'common.reset':{en:'Reset Default',zh:'恢复默认'},
  'common.save_failed':{en:'Save failed: ',zh:'保存失败：'},
  'common.loading':{en:'Loading prompts...',zh:'加载提示词中...'},
  'common.prompt_saved':{en:'" saved & applied',zh:'" 已保存并生效'},
  'chart.cloud':{en:'Cloud',zh:'云端'},
  'chart.local':{en:'Local',zh:'本地'},
  'chart.redacted':{en:'Redacted',zh:'脱敏'},
  'status.uptime':{en:'Uptime: ',zh:'运行时间：'},
  'status.activity':{en:'Last activity: ',zh:'最近活动：'},
  'status.updated':{en:'Updated ',zh:'已更新 '},
  'status.error':{en:'Error: ',zh:'错误：'},
};
function t(k){return(T[k]&&T[k][LANG])||k;}

function setLang(lang){
  LANG=lang;
  localStorage.setItem('gc-lang',lang);
  document.querySelectorAll('[data-i18n]').forEach(function(el){
    var k=el.getAttribute('data-i18n');
    if(T[k]) el.textContent=t(k);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function(el){
    var k=el.getAttribute('data-i18n-html');
    if(T[k]) el.innerHTML=t(k);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(function(el){
    var k=el.getAttribute('data-i18n-ph');
    if(T[k]) el.placeholder=t(k);
  });
  document.querySelectorAll('[data-i18n-opt]').forEach(function(el){
    var k=el.getAttribute('data-i18n-opt');
    if(T[k]) el.textContent=t(k);
  });
  document.getElementById('lang-toggle').textContent=lang==='en'?'中文':'EN';
  document.querySelectorAll('.add-row .btn-outline').forEach(function(el){el.textContent=t('common.add');});
  hourlyChart=null;
  refreshAll();
  renderCustomRouterCards();
  updateAvailableRouters();
  loadPrompts();
}
// ── Generic tag management ──
var _tags = {
  'kw-s2': [], 'kw-s3': [], 'pat-s2': [], 'pat-s3': [],
  'tool-s2': [], 'tool-s3': [], 'toolpath-s2': [], 'toolpath-s3': [],
  'lp': [],
  'pipe-um': [], 'pipe-tcp': [], 'pipe-tce': []
};

var _checkpoints = { um: [], tcp: [], tce: [] };
var _routers = {};

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderTags(key) {
  var c = document.getElementById('cfg-tags-' + key);
  if (!c) return;
  c.innerHTML = _tags[key].map(function(v, i) {
    return '<span class="tag">' + escHtml(v) +
      ' <button data-key="' + key + '" data-idx="' + i + '" onclick="removeTag(this)">&times;</button></span>';
  }).join('');
}

function addTag(key) {
  var input = document.getElementById('cfg-tags-' + key + '-input');
  if (!input) return;
  var val = input.value.trim();
  if (val && _tags[key].indexOf(val) === -1) {
    _tags[key].push(val);
    renderTags(key);
  }
  input.value = '';
  input.focus();
}

function removeTag(el) {
  var key = el.getAttribute('data-key');
  var idx = parseInt(el.getAttribute('data-idx'));
  if (key && _tags[key]) {
    _tags[key].splice(idx, 1);
    renderTags(key);
  }
}

// ── Checkpoint chips ──
function toggleChip(el) {
  var ck = el.getAttribute('data-ck');
  var det = el.getAttribute('data-det');
  if (!ck || !det || !_checkpoints[ck]) return;
  var arr = _checkpoints[ck];
  var idx = arr.indexOf(det);
  if (idx === -1) { arr.push(det); el.classList.add('active'); }
  else { arr.splice(idx, 1); el.classList.remove('active'); }
}

function syncChips() {
  document.querySelectorAll('.chip[data-ck]').forEach(function(el) {
    var ck = el.getAttribute('data-ck');
    var det = el.getAttribute('data-det');
    if (_checkpoints[ck] && _checkpoints[ck].indexOf(det) !== -1) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

// ── Router management ──
function renderRouters() {
  var c = document.getElementById('cfg-routers-list');
  if (!c) return;
  var ids = Object.keys(_routers);
  if (!ids.length) {
    c.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0">No routers configured</div>';
    return;
  }
  c.innerHTML = ids.map(function(id) {
    var r = _routers[id];
    var checked = r.enabled !== false ? ' checked' : '';
    return '<div class="router-card"><div class="rc-head">' +
      '<label class="toggle"><input type="checkbox"' + checked +
      ' data-rid="' + escHtml(id) + '" onchange="toggleRouter(this)"><span class="slider"></span></label>' +
      '<span class="rc-name">' + escHtml(id) + '</span>' +
      '<span class="rc-type">[' + escHtml(r.type || 'builtin') + ']</span>' +
      '<button class="rc-del" data-rid="' + escHtml(id) + '" onclick="removeRouter(this)">&times;</button>' +
      '</div>' +
      (r.module ? '<div class="rc-module">Module: ' + escHtml(r.module) + '</div>' : '') +
      '</div>';
  }).join('');
}

function toggleRouter(el) {
  var id = el.getAttribute('data-rid');
  if (id && _routers[id]) _routers[id].enabled = el.checked;
}

function removeRouter(el) {
  var id = el.getAttribute('data-rid');
  if (id) { delete _routers[id]; renderRouters(); }
}

function addRouter() {
  var idInput = document.getElementById('cfg-router-id-input');
  var typeInput = document.getElementById('cfg-router-type-input');
  var moduleInput = document.getElementById('cfg-router-module-input');
  var id = idInput.value.trim();
  if (!id) return;
  _routers[id] = {
    enabled: true,
    type: typeInput.value || 'builtin',
    module: typeInput.value === 'custom' ? (moduleInput.value.trim() || undefined) : undefined
  };
  renderRouters();
  idInput.value = '';
  moduleInput.value = '';
}

// ── Model Pricing ──
var _pricing = {};

var DEFAULT_PRICING = {
  'claude-sonnet-4.6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-3.5-sonnet': { inputPer1M: 3, outputPer1M: 15 },
  'claude-3.5-haiku': { inputPer1M: 0.8, outputPer1M: 4 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'o4-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 }
};

function renderPricing() {
  var tbody = document.getElementById('pricing-body');
  if (!tbody) return;
  var keys = Object.keys(_pricing);
  if (!keys.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary);font-size:13px;padding:14px 0">No pricing configured</td></tr>';
    return;
  }
  tbody.innerHTML = keys.sort().map(function(model) {
    var p = _pricing[model];
    var eid = escHtml(model);
    return '<tr>' +
      '<td style="font-family:var(--font-mono);font-size:12px">' + eid + '</td>' +
      '<td><input type="number" step="0.01" min="0" value="' + (p.inputPer1M ?? 0) + '" data-pricing-model="' + eid + '" data-pricing-field="inputPer1M" onchange="updatePricing(this)" style="width:80px;padding:6px 8px;background:var(--bg-input);border:1px solid transparent;border-radius:4px;font-size:12px;color:var(--text-primary);outline:none"></td>' +
      '<td><input type="number" step="0.01" min="0" value="' + (p.outputPer1M ?? 0) + '" data-pricing-model="' + eid + '" data-pricing-field="outputPer1M" onchange="updatePricing(this)" style="width:80px;padding:6px 8px;background:var(--bg-input);border:1px solid transparent;border-radius:4px;font-size:12px;color:var(--text-primary);outline:none"></td>' +
      '<td><button style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;font-size:14px" onclick="removePricing(\\'' + eid + '\\')">&times;</button></td>' +
      '</tr>';
  }).join('');
}

function updatePricing(el) {
  var model = el.getAttribute('data-pricing-model');
  var field = el.getAttribute('data-pricing-field');
  if (!model || !field || !_pricing[model]) return;
  _pricing[model][field] = parseFloat(el.value) || 0;
}

function addPricingRow() {
  var modelEl = document.getElementById('pricing-new-model');
  var inputEl = document.getElementById('pricing-new-input');
  var outputEl = document.getElementById('pricing-new-output');
  var model = modelEl.value.trim();
  if (!model) return;
  _pricing[model] = {
    inputPer1M: parseFloat(inputEl.value) || 0,
    outputPer1M: parseFloat(outputEl.value) || 0
  };
  modelEl.value = '';
  inputEl.value = '';
  outputEl.value = '';
  modelEl.focus();
  renderPricing();
}

function removePricing(model) {
  delete _pricing[model];
  renderPricing();
}

function loadDefaultPricing() {
  Object.keys(DEFAULT_PRICING).forEach(function(k) {
    if (!_pricing[k]) _pricing[k] = Object.assign({}, DEFAULT_PRICING[k]);
  });
  renderPricing();
}

// ── Tabs ──
document.querySelectorAll('.tab').forEach(function(t) {
  t.addEventListener('click', function() {
    document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
    document.querySelectorAll('.panel').forEach(function(x) { x.classList.remove('active'); });
    t.classList.add('active');
    document.getElementById(t.dataset.tab + '-panel').classList.add('active');
  });
});

// ── Formatters ──
function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function timeAgo(ts) {
  var diff = Date.now() - ts;
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function fmtTime(ts) {
  var d = new Date(ts);
  var hh = String(d.getHours()).padStart(2, '0');
  var mm = String(d.getMinutes()).padStart(2, '0');
  var ss = String(d.getSeconds()).padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

function fmtCost(n) {
  if (n == null || n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return '$' + n.toFixed(2);
}

function fillRow(cat, b) {
  var cost = b.estimatedCost || 0;
  return '<tr><td>' + cat + '</td><td>' + fmt(b.inputTokens) + '</td><td>' + fmt(b.outputTokens) +
    '</td><td>' + fmt(b.cacheReadTokens) + '</td><td>' + fmt(b.totalTokens) + '</td><td>' + b.requestCount + '</td><td>' + fmtCost(cost) + '</td></tr>';
}

// ── Overview ──
async function refreshStats() {
  try {
    var results = await Promise.all([
      fetch(BASE + '/summary').then(function(r) { return r.json(); }),
      fetch(BASE + '/hourly').then(function(r) { return r.json(); }),
    ]);
    var summary = results[0];
    var hourly = results[1];
    if (summary.error) throw new Error(summary.error);

    var lt = summary.lifetime;
    document.getElementById('cloud-tokens').textContent = fmt(lt.cloud.totalTokens);
    document.getElementById('cloud-reqs').textContent = lt.cloud.requestCount + ' ' + t('overview.requests');
    document.getElementById('local-tokens').textContent = fmt(lt.local.totalTokens);
    document.getElementById('local-reqs').textContent = lt.local.requestCount + ' ' + t('overview.requests');
    document.getElementById('proxy-tokens').textContent = fmt(lt.proxy.totalTokens);
    document.getElementById('proxy-reqs').textContent = lt.proxy.requestCount + ' ' + t('overview.requests');

    var total = lt.cloud.totalTokens + lt.local.totalTokens + lt.proxy.totalTokens;
    var prot = lt.local.totalTokens + lt.proxy.totalTokens;
    var rate = total > 0 ? (prot / total * 100).toFixed(1) + '%' : '--';
    document.getElementById('privacy-rate').textContent = rate;
    document.getElementById('privacy-sub').textContent = total > 0
      ? fmt(prot) + ' / ' + fmt(total) + ' ' + t('overview.sub')
      : t('overview.no_data');

    var cloudCost = (lt.cloud.estimatedCost || 0) + (lt.proxy.estimatedCost || 0);
    document.getElementById('cloud-cost').textContent = fmtCost(cloudCost);
    document.getElementById('cloud-cost-sub').textContent = t('overview.cost_sub');

    document.getElementById('detail-body').innerHTML =
      fillRow(t('chart.cloud'), lt.cloud) + fillRow(t('chart.local'), lt.local) + fillRow(t('chart.redacted'), lt.proxy);

    var bs = summary.bySource || {};
    var routerB = bs.router || {inputTokens:0,outputTokens:0,cacheReadTokens:0,totalTokens:0,requestCount:0};
    var taskB = bs.task || {inputTokens:0,outputTokens:0,cacheReadTokens:0,totalTokens:0,requestCount:0};
    document.getElementById('source-body').innerHTML =
      fillRow('🔀 Router (overhead)', routerB) + fillRow('⚡ Task (execution)', taskB);

    var infoHtml = '';
    if (summary.startedAt) infoHtml += t('status.uptime') + timeAgo(summary.startedAt);
    if (summary.lastUpdatedAt) infoHtml += ' &middot; ' + t('status.activity') + timeAgo(summary.lastUpdatedAt);
    document.getElementById('info-bar').innerHTML = infoHtml;

    document.getElementById('status-dot').className = 'status-dot';
    document.getElementById('status-text').textContent = t('header.online');
    document.getElementById('last-updated').textContent = t('status.updated') + fmtTime(Date.now());

    updateChart(hourly);
  } catch (e) {
    document.getElementById('status-dot').className = 'status-dot err';
    document.getElementById('status-text').textContent = t('status.error') + (e.message || 'unavailable');
  }
}

async function resetStats() {
  if (!confirm(t('overview.reset_confirm'))) return;
  try {
    var r = await fetch(BASE + '/reset', { method: 'POST' });
    var body = await r.json();
    if (body.error) throw new Error(body.error);
    showToast(t('overview.reset_ok'));
    refreshStats();
    refreshSessions();
  } catch (e) {
    showToast(t('overview.reset_fail') + (e.message || ''), true);
  }
}

function updateChart(hourly) {
  var labels = hourly.map(function(h) { return h.hour.slice(5).replace('T', ' ') + ':00'; });
  var cloudData = hourly.map(function(h) { return h.cloud.totalTokens; });
  var localData = hourly.map(function(h) { return h.local.totalTokens; });
  var proxyData = hourly.map(function(h) { return h.proxy.totalTokens; });
  if (hourlyChart) {
    hourlyChart.data.labels = labels;
    hourlyChart.data.datasets[0].data = cloudData;
    hourlyChart.data.datasets[1].data = localData;
    hourlyChart.data.datasets[2].data = proxyData;
    hourlyChart.update('none');
  } else {
    var ctx = document.getElementById('hourlyChart');
    if (!ctx) return;
    hourlyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: t('chart.cloud'), data: cloudData, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.06)', fill: true, tension: 0.4, borderWidth: 2 },
          { label: t('chart.local'), data: localData, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.06)', fill: true, tension: 0.4, borderWidth: 2 },
          { label: t('chart.redacted'), data: proxyData, borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.06)', fill: true, tension: 0.4, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#6e6e80', usePointStyle: true, pointStyle: 'circle', padding: 20, font: { size: 12, weight: 500 } } } },
        scales: {
          x: { ticks: { color: '#9ca3af', maxTicksLimit: 12, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,.04)' } },
          y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,.04)' } },
        },
      },
    });
  }
}

// ── Sessions ──
function totalForSession(s) {
  return s.cloud.totalTokens + s.local.totalTokens + s.proxy.totalTokens;
}
function totalReqsForSession(s) {
  return s.cloud.requestCount + s.local.requestCount + s.proxy.requestCount;
}

async function refreshSessions() {
  try {
    var sessions = await fetch(BASE + '/sessions').then(function(r) { return r.json(); });
    var tbody = document.getElementById('sessions-body');
    if (!sessions || !sessions.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">' + t('sessions.empty') + '</td></tr>';
      return;
    }
    tbody.innerHTML = sessions.map(function(s) {
      var shortKey = s.sessionKey.length > 20 ? s.sessionKey.slice(0, 20) + '...' : s.sessionKey;
      var bs = s.bySource || {};
      var routerTokens = (bs.router || {}).totalTokens || 0;
      var taskTokens = (bs.task || {}).totalTokens || 0;
      var sessCost = (s.cloud.estimatedCost || 0) + (s.proxy.estimatedCost || 0);
      return '<tr>' +
        '<td><span class="session-key" title="' + escHtml(s.sessionKey) + '">' + escHtml(shortKey) + '</span></td>' +
        '<td><span class="level-tag level-' + s.highestLevel + '">' + s.highestLevel + '</span></td>' +
        '<td>' + fmt(s.cloud.totalTokens) + '</td>' +
        '<td>' + fmt(s.local.totalTokens) + '</td>' +
        '<td>' + fmt(s.proxy.totalTokens) + '</td>' +
        '<td>' + fmt(routerTokens) + '</td>' +
        '<td>' + fmt(taskTokens) + '</td>' +
        '<td>' + fmt(totalForSession(s)) + '</td>' +
        '<td>' + fmtCost(sessCost) + '</td>' +
        '<td>' + totalReqsForSession(s) + '</td>' +
        '<td>' + timeAgo(s.lastActiveAt) + '</td>' +
        '</tr>';
    }).join('');
  } catch (e) { /* non-critical */ }
}

// ── Detection Log ──
async function refreshDetections() {
  try {
    _detections = await fetch(BASE + '/detections').then(function(r) { return r.json(); });
    renderDetections();
  } catch (e) { /* non-critical */ }
}

function filterDetections(level, el) {
  _detectionFilter = level;
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderDetections();
}

function renderDetections() {
  var tbody = document.getElementById('detections-body');
  var filtered = _detectionFilter === 'all'
    ? _detections
    : _detections.filter(function(d) { return d.level === _detectionFilter; });
  if (!filtered || !filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">' +
      (_detectionFilter !== 'all' ? t('det.empty_for') + _detectionFilter : t('det.empty')) + '</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.slice(0, 100).map(function(d) {
    var shortKey = d.sessionKey.length > 16 ? d.sessionKey.slice(0, 16) + '...' : d.sessionKey;
    return '<tr>' +
      '<td>' + fmtTime(d.timestamp) + '</td>' +
      '<td><span class="session-key" title="' + escHtml(d.sessionKey) + '">' + escHtml(shortKey) + '</span></td>' +
      '<td><span class="level-tag level-' + d.level + '">' + d.level + '</span></td>' +
      '<td><span class="checkpoint-tag">' + escHtml(d.checkpoint || '--') + '</span></td>' +
      '<td>' + escHtml(d.reason || '--') + '</td>' +
      '</tr>';
  }).join('');
}

// ── Config ──
function toggleModuleField() {
  var wrap = document.getElementById('cfg-lm-module-wrap');
  wrap.style.display = document.getElementById('cfg-lm-type').value === 'custom' ? 'block' : 'none';
}

async function loadConfig() {
  try {
    var cfg = await fetch(BASE + '/config').then(function(r) { return r.json(); });
    var p = cfg.privacy || {};
    var lm = p.localModel || {};
    var ga = p.guardAgent || {};
    var rules = p.rules || {};
    var sess = p.session || {};
    var ck = p.checkpoints || {};
    var routers = p.routers || {};
    var pipeline = p.pipeline || {};

    document.getElementById('cfg-enabled').checked = p.enabled !== false;
    document.getElementById('cfg-lm-enabled').checked = lm.enabled !== false;
    document.getElementById('cfg-lm-type').value = lm.type || 'openai-compatible';
    document.getElementById('cfg-lm-provider').value = lm.provider || '';
    document.getElementById('cfg-lm-endpoint').value = lm.endpoint || '';
    document.getElementById('cfg-lm-model').value = lm.model || '';
    document.getElementById('cfg-lm-apikey').value = lm.apiKey || '';
    document.getElementById('cfg-lm-module').value = lm.module || '';

    document.getElementById('cfg-ga-id').value = ga.id || '';
    document.getElementById('cfg-ga-workspace').value = ga.workspace || '';
    document.getElementById('cfg-ga-model').value = ga.model || '';

    document.getElementById('cfg-s2policy').value = p.s2Policy || 'proxy';
    document.getElementById('cfg-proxyport').value = p.proxyPort || '';

    document.getElementById('cfg-sess-isolate').checked = sess.isolateGuardHistory !== false;
    document.getElementById('cfg-sess-basedir').value = sess.baseDir || '';

    _checkpoints.um = Array.isArray(ck.onUserMessage) ? ck.onUserMessage.slice() : [];
    _checkpoints.tcp = Array.isArray(ck.onToolCallProposed) ? ck.onToolCallProposed.slice() : [];
    _checkpoints.tce = Array.isArray(ck.onToolCallExecuted) ? ck.onToolCallExecuted.slice() : [];
    syncChips();

    _tags['kw-s2'] = (rules.keywords && rules.keywords.S2) ? rules.keywords.S2.slice() : [];
    _tags['kw-s3'] = (rules.keywords && rules.keywords.S3) ? rules.keywords.S3.slice() : [];
    _tags['pat-s2'] = (rules.patterns && rules.patterns.S2) ? rules.patterns.S2.slice() : [];
    _tags['pat-s3'] = (rules.patterns && rules.patterns.S3) ? rules.patterns.S3.slice() : [];
    var toolRules = rules.tools || {};
    _tags['tool-s2'] = (toolRules.S2 && toolRules.S2.tools) ? toolRules.S2.tools.slice() : [];
    _tags['tool-s3'] = (toolRules.S3 && toolRules.S3.tools) ? toolRules.S3.tools.slice() : [];
    _tags['toolpath-s2'] = (toolRules.S2 && toolRules.S2.paths) ? toolRules.S2.paths.slice() : [];
    _tags['toolpath-s3'] = (toolRules.S3 && toolRules.S3.paths) ? toolRules.S3.paths.slice() : [];
    _tags['lp'] = Array.isArray(p.localProviders) ? p.localProviders.slice() : [];

    _pricing = {};
    if (p.modelPricing && typeof p.modelPricing === 'object') {
      Object.keys(p.modelPricing).forEach(function(k) {
        _pricing[k] = Object.assign({}, p.modelPricing[k]);
      });
    }
    renderPricing();

    _tags['pipe-um'] = Array.isArray(pipeline.onUserMessage) ? pipeline.onUserMessage.slice() : [];
    _tags['pipe-tcp'] = Array.isArray(pipeline.onToolCallProposed) ? pipeline.onToolCallProposed.slice() : [];
    _tags['pipe-tce'] = Array.isArray(pipeline.onToolCallExecuted) ? pipeline.onToolCallExecuted.slice() : [];

    _routers = {};
    if (routers && typeof routers === 'object') {
      Object.keys(routers).forEach(function(k) { _routers[k] = Object.assign({}, routers[k]); });
    }

    // Privacy router enable toggle
    var privacyReg = _routers['privacy'] || {};
    var privacyEl = document.getElementById('cfg-privacy-enabled');
    if (privacyEl) privacyEl.checked = privacyReg.enabled !== false;

    Object.keys(_tags).forEach(function(k) {
      if (k.indexOf('pipe-') === 0) return;
      renderTags(k);
    });
    toggleModuleField();
    loadTokenSaverConfig();
    renderCustomRouterCards();
    updateAvailableRouters();
  } catch (e) { /* non-critical, fields stay at defaults */ }
}

document.getElementById('cfg-lm-type').addEventListener('change', toggleModuleField);

async function saveConfig() {
  try {
    var typeVal = document.getElementById('cfg-lm-type').value;
    var portVal = document.getElementById('cfg-proxyport').value;

    var payload = {
      privacy: {
        enabled: document.getElementById('cfg-enabled').checked,
        localModel: {
          enabled: document.getElementById('cfg-lm-enabled').checked,
          type: typeVal || undefined,
          provider: document.getElementById('cfg-lm-provider').value || undefined,
          endpoint: document.getElementById('cfg-lm-endpoint').value || undefined,
          model: document.getElementById('cfg-lm-model').value || undefined,
          apiKey: document.getElementById('cfg-lm-apikey').value || undefined,
          module: typeVal === 'custom' ? (document.getElementById('cfg-lm-module').value || undefined) : undefined,
        },
        guardAgent: {
          id: document.getElementById('cfg-ga-id').value || undefined,
          workspace: document.getElementById('cfg-ga-workspace').value || undefined,
          model: document.getElementById('cfg-ga-model').value || undefined,
        },
        s2Policy: document.getElementById('cfg-s2policy').value,
        proxyPort: portVal ? parseInt(portVal) : undefined,
        localProviders: _tags['lp'].length > 0 ? _tags['lp'] : [],
        modelPricing: Object.keys(_pricing).length > 0 ? _pricing : undefined,
        session: {
          isolateGuardHistory: document.getElementById('cfg-sess-isolate').checked,
          baseDir: document.getElementById('cfg-sess-basedir').value || undefined,
        },
      },
    };
    var res = await fetch(BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var result = await res.json();
    if (result.ok) {
      showToast(t('cfg.saved'));
    } else {
      showToast(t('common.save_failed') + (result.error || 'unknown'), true);
    }
  } catch (e) {
    showToast(t('common.save_failed') + e.message, true);
  }
}

function showToast(msg, isError) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 3000);
}

function refreshAll() {
  refreshStats();
  refreshSessions();
  refreshDetections();
}

// ── Prompt Editors ──

var _prompts = {};

async function loadPrompts() {
  try {
    _prompts = await fetch(BASE + '/prompts').then(function(r) { return r.json(); });
    renderRouterPrompts('privacy-prompt-main', PRIVACY_PROMPTS_MAIN);
    renderRouterPrompts('privacy-prompt-adv', PRIVACY_PROMPTS_ADV);
    renderRouterPrompts('tokensaver-prompt-editors', TOKENSAVER_PROMPTS);
  } catch (e) { /* non-critical */ }
}

async function savePrompt(name) {
  var el = document.getElementById('prompt-' + name);
  if (!el) return;
  try {
    var res = await fetch(BASE + '/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, content: el.value }),
    });
    var result = await res.json();
    if (result.ok) {
      showToast('"' + name + t('common.prompt_saved'));
      loadPrompts();
    } else {
      showToast(t('common.save_failed') + (result.error || 'unknown'), true);
    }
  } catch (e) {
    showToast(t('common.save_failed') + e.message, true);
  }
}

function resetPrompt(name) {
  if (!_prompts[name]) return;
  var el = document.getElementById('prompt-' + name);
  if (el) el.value = _prompts[name].defaultContent;
}

// ── Test Classify ──

async function runTestClassify() {
  var msg = document.getElementById('test-message').value.trim();
  if (!msg) { showToast(t('test.enter_msg'), true); return; }
  var checkpoint = document.getElementById('test-checkpoint').value;
  var resultEl = document.getElementById('test-result');
  var loadingEl = document.getElementById('test-loading');
  resultEl.classList.remove('visible');
  loadingEl.style.display = 'block';
  try {
    var res = await fetch(BASE + '/test-classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, checkpoint: checkpoint }),
    });
    var data = await res.json();
    loadingEl.style.display = 'none';
    if (data.error) {
      showToast(t('test.failed') + data.error, true);
      return;
    }
    document.getElementById('tr-level').innerHTML = '<span class="level-tag level-' + data.level + '">' + data.level + '</span>';
    document.getElementById('tr-action').textContent = data.action || 'passthrough';
    document.getElementById('tr-target').textContent = data.target ? (data.target.provider + '/' + data.target.model) : t('common.none');
    document.getElementById('tr-router').textContent = data.routerId || t('common.none');
    document.getElementById('tr-reason').textContent = data.reason || t('common.none');
    document.getElementById('tr-confidence').textContent = data.confidence != null ? (data.confidence * 100).toFixed(0) + '%' : '-';
    var perEl = document.getElementById('tr-per-router');
    if (data.routers && data.routers.length > 0) {
      var html = '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-subtle)">' +
        '<div style="font-size:11px;text-transform:uppercase;color:var(--text-tertiary);letter-spacing:.06em;font-weight:700;margin-bottom:10px">' + t('test.individual') + '</div>';
      data.routers.forEach(function(r) {
        html += '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;padding:12px 16px;margin-bottom:6px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-weight:600;color:var(--text-primary);font-size:13px">' + (r.routerId || '?') + '</span>' +
          '<span class="level-tag level-' + r.level + '">' + r.level + '</span></div>' +
          '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px">' +
          (r.action || 'passthrough') +
          (r.target ? ' → ' + r.target.provider + '/' + r.target.model : '') +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">' + (r.reason || '-') + '</div>' +
          '</div>';
      });
      html += '</div>';
      perEl.innerHTML = html;
    } else {
      perEl.innerHTML = '';
    }
    resultEl.classList.add('visible');
  } catch (e) {
    loadingEl.style.display = 'none';
    showToast(t('test.failed') + e.message, true);
  }
}

// ── Section Collapse ──

function toggleSection(el) {
  el.classList.toggle('collapsed');
  var body = el.nextElementSibling;
  if (body) body.classList.toggle('collapsed');
}

function toggleAdv(el) {
  el.classList.toggle('open');
  var body = el.nextElementSibling;
  if (body) body.classList.toggle('open');
}

// ── Per-Router Prompt Rendering ──

var PRIVACY_PROMPTS_MAIN = ['detection-system'];
var PRIVACY_PROMPTS_ADV = ['pii-extraction'];
var TOKENSAVER_PROMPTS = ['token-saver-judge'];

function renderRouterPrompts(containerId, promptNames) {
  var c = document.getElementById(containerId);
  if (!c) return;
  var html = '';
  promptNames.forEach(function(name) {
    var p = _prompts[name];
    if (!p) return;
    var customBadge = p.isCustom ? '<span class="custom-badge">' + t('common.customized') + '</span>' : '';
    html += '<div style="margin-bottom:16px">' +
      '<div class="prompt-header">' +
        '<h4>' + escHtml(p.label) + customBadge + '</h4>' +
        '<div class="prompt-actions">' +
          '<button class="btn btn-sm btn-outline" onclick="resetPrompt(\\'' + escHtml(name) + '\\')">' + t('common.reset') + '</button>' +
          '<button class="btn btn-sm btn-primary" onclick="savePrompt(\\'' + escHtml(name) + '\\')">' + t('common.save') + '</button>' +
        '</div>' +
      '</div>' +
      '<textarea class="prompt-editor" id="prompt-' + escHtml(name) + '">' + escHtml(p.content) + '</textarea>' +
    '</div>';
  });
  c.innerHTML = html || '<div style="color:var(--text-tertiary);font-size:13px">' + t('common.loading') + '</div>';
}

// ── Per-Router Test ──

async function runRouterTest(routerId) {
  var msgEl = document.getElementById('test-' + routerId + '-message');
  var msg = msgEl ? msgEl.value.trim() : '';
  if (!msg) { showToast(t('test.enter_msg'), true); return; }
  var resultEl = document.getElementById('test-' + routerId + '-result');
  var loadingEl = document.getElementById('test-' + routerId + '-loading');
  resultEl.classList.remove('visible');
  loadingEl.style.display = 'block';
  try {
    var res = await fetch(BASE + '/test-classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, router: routerId }),
    });
    var data = await res.json();
    loadingEl.style.display = 'none';
    if (data.error) {
      showToast(t('test.failed') + data.error, true);
      return;
    }
    document.getElementById('tr-' + routerId + '-level').innerHTML = '<span class="level-tag level-' + data.level + '">' + data.level + '</span>';
    document.getElementById('tr-' + routerId + '-action').textContent = data.action || 'passthrough';
    document.getElementById('tr-' + routerId + '-target').textContent = data.target ? (data.target.provider + '/' + data.target.model) : t('common.none');
    document.getElementById('tr-' + routerId + '-reason').textContent = data.reason || t('common.none');
    document.getElementById('tr-' + routerId + '-confidence').textContent = data.confidence != null ? (data.confidence * 100).toFixed(0) + '%' : '-';
    resultEl.classList.add('visible');
  } catch (e) {
    loadingEl.style.display = 'none';
    showToast(t('test.failed') + e.message, true);
  }
}

// ── Save Privacy Router ──

async function savePrivacyRouter() {
  try {
    var payload = {
      privacy: {
        checkpoints: {
          onUserMessage: _checkpoints.um.length ? _checkpoints.um : undefined,
          onToolCallProposed: _checkpoints.tcp.length ? _checkpoints.tcp : undefined,
          onToolCallExecuted: _checkpoints.tce.length ? _checkpoints.tce : undefined,
        },
        rules: {
          keywords: { S2: _tags['kw-s2'], S3: _tags['kw-s3'] },
          patterns: { S2: _tags['pat-s2'], S3: _tags['pat-s3'] },
          tools: {
            S2: { tools: _tags['tool-s2'], paths: _tags['toolpath-s2'] },
            S3: { tools: _tags['tool-s3'], paths: _tags['toolpath-s3'] },
          },
        },
      },
    };
    var res = await fetch(BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var result = await res.json();
    if (result.ok) {
      showToast(t('priv.saved'));
    } else {
      showToast(t('common.save_failed') + (result.error || 'unknown'), true);
    }
  } catch (e) {
    showToast(t('common.save_failed') + e.message, true);
  }
}

// ── Save Pipeline Order ──

async function savePipelineOrder() {
  try {
    var payload = {
      privacy: {
        pipeline: {
          onUserMessage: _tags['pipe-um'].length ? _tags['pipe-um'] : undefined,
          onToolCallProposed: _tags['pipe-tcp'].length ? _tags['pipe-tcp'] : undefined,
          onToolCallExecuted: _tags['pipe-tce'].length ? _tags['pipe-tce'] : undefined,
        },
      },
    };
    var res = await fetch(BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var result = await res.json();
    if (result.ok) {
      showToast(t('pipe.saved'));
    } else {
      showToast(t('common.save_failed') + (result.error || 'unknown'), true);
    }
  } catch (e) {
    showToast(t('common.save_failed') + e.message, true);
  }
}

// ── Custom Routers ──

var BUILTIN_ROUTERS = ['privacy', 'token-saver'];
var _customRouterData = {};

function getCustomRouterIds() {
  return Object.keys(_routers).filter(function(id) {
    return BUILTIN_ROUTERS.indexOf(id) === -1 && _routers[id].type === 'configurable';
  });
}

function renderCustomRouterCards() {
  var container = document.getElementById('custom-router-cards');
  if (!container) return;
  var ids = getCustomRouterIds();
  if (!ids.length) { container.innerHTML = ''; return; }

  container.innerHTML = ids.map(function(id) {
    var r = _routers[id] || {};
    var opts = r.options || {};
    var checked = r.enabled !== false ? ' checked' : '';
    var kwS2 = (opts.keywords && opts.keywords.S2) ? opts.keywords.S2 : [];
    var kwS3 = (opts.keywords && opts.keywords.S3) ? opts.keywords.S3 : [];
    var patS2 = (opts.patterns && opts.patterns.S2) ? opts.patterns.S2 : [];
    var patS3 = (opts.patterns && opts.patterns.S3) ? opts.patterns.S3 : [];
    var prompt = opts.prompt || '';

    // init tag arrays for this custom router
    _tags['cr-kw-s2-' + id] = kwS2.slice();
    _tags['cr-kw-s3-' + id] = kwS3.slice();
    _tags['cr-pat-s2-' + id] = patS2.slice();
    _tags['cr-pat-s3-' + id] = patS3.slice();

    return '<div class="router-section" id="cr-card-' + escHtml(id) + '">' +
      '<div class="router-section-header" onclick="toggleSection(this)">' +
        '<span class="section-arrow">&#9660;</span>' +
        '<h3>' + escHtml(id) + '</h3>' +
        '<span class="router-id-badge">configurable</span>' +
        '<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="event.stopPropagation();removeCustomRouter(\\'' + escHtml(id) + '\\')">' + t('common.delete') + '</button>' +
      '</div>' +
      '<div class="router-section-body">' +
        '<div class="field-toggle" style="margin-bottom:18px">' +
          '<label>' + t('common.enabled') + '</label>' +
          '<label class="toggle"><input type="checkbox" id="cfg-cr-enabled-' + escHtml(id) + '"' + checked + '><span class="slider"></span></label>' +
        '</div>' +

        '<div class="subsection">' +
          '<h4>' + t('cr.kw_rules') + '</h4>' +
          '<div class="rules-grid">' +
            '<div class="rules-col">' +
              '<h4>' + t('cr.s2_kw') + '</h4>' +
              '<div class="tag-list" id="cfg-tags-cr-kw-s2-' + escHtml(id) + '"></div>' +
              '<div class="add-row">' +
                '<input id="cfg-tags-cr-kw-s2-' + escHtml(id) + '-input" placeholder="Add S2 keyword" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addTag(\\'cr-kw-s2-' + escHtml(id) + '\\')}"><button class="btn btn-sm btn-outline" onclick="addTag(\\'cr-kw-s2-' + escHtml(id) + '\\')">Add</button>' +
              '</div>' +
              '<div style="margin-top:14px"><h4 style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + t('cr.s2_pat') + '</h4></div>' +
              '<div class="tag-list" id="cfg-tags-cr-pat-s2-' + escHtml(id) + '"></div>' +
              '<div class="add-row">' +
                '<input id="cfg-tags-cr-pat-s2-' + escHtml(id) + '-input" placeholder="Add S2 pattern" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addTag(\\'cr-pat-s2-' + escHtml(id) + '\\')}"><button class="btn btn-sm btn-outline" onclick="addTag(\\'cr-pat-s2-' + escHtml(id) + '\\')">Add</button>' +
              '</div>' +
            '</div>' +
            '<div class="rules-col">' +
              '<h4>' + t('cr.s3_kw') + '</h4>' +
              '<div class="tag-list" id="cfg-tags-cr-kw-s3-' + escHtml(id) + '"></div>' +
              '<div class="add-row">' +
                '<input id="cfg-tags-cr-kw-s3-' + escHtml(id) + '-input" placeholder="Add S3 keyword" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addTag(\\'cr-kw-s3-' + escHtml(id) + '\\')}"><button class="btn btn-sm btn-outline" onclick="addTag(\\'cr-kw-s3-' + escHtml(id) + '\\')">Add</button>' +
              '</div>' +
              '<div style="margin-top:14px"><h4 style="font-size:11px;color:var(--text-tertiary);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em;font-weight:700">' + t('cr.s3_pat') + '</h4></div>' +
              '<div class="tag-list" id="cfg-tags-cr-pat-s3-' + escHtml(id) + '"></div>' +
              '<div class="add-row">' +
                '<input id="cfg-tags-cr-pat-s3-' + escHtml(id) + '-input" placeholder="Add S3 pattern" onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();addTag(\\'cr-pat-s3-' + escHtml(id) + '\\')}"><button class="btn btn-sm btn-outline" onclick="addTag(\\'cr-pat-s3-' + escHtml(id) + '\\')">Add</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="subsection">' +
          '<h4>' + t('cr.cls_prompt') + ' <span style="font-size:11px;color:var(--text-tertiary);text-transform:none;letter-spacing:0;font-weight:400">' + t('common.optional') + '</span></h4>' +
          '<div class="hint" style="margin-bottom:10px">' + t('cr.cls_hint') + '</div>' +
          '<textarea class="prompt-editor" id="cr-prompt-' + escHtml(id) + '">' + escHtml(prompt) + '</textarea>' +
        '</div>' +

        '<div class="subsection">' +
          '<h4>' + t('common.test') + ' (' + escHtml(id) + ')</h4>' +
          '<textarea class="test-input" id="test-' + escHtml(id) + '-message" placeholder="' + escHtml(t('test.enter_msg')) + '..."></textarea>' +
          '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">' +
            '<button class="btn btn-primary btn-sm" onclick="runRouterTest(\\'' + escHtml(id) + '\\')">' + t('common.test') + '</button>' +
          '</div>' +
          '<div class="test-result" id="test-' + escHtml(id) + '-result">' +
            '<div class="test-result-row"><span class="test-result-label">' + t('test.level') + '</span><span class="test-result-value" id="tr-' + escHtml(id) + '-level">-</span></div>' +
            '<div class="test-result-row"><span class="test-result-label">' + t('test.action') + '</span><span class="test-result-value" id="tr-' + escHtml(id) + '-action">-</span></div>' +
            '<div class="test-result-row"><span class="test-result-label">' + t('test.target') + '</span><span class="test-result-value" id="tr-' + escHtml(id) + '-target">-</span></div>' +
            '<div class="test-result-row"><span class="test-result-label">' + t('test.reason') + '</span><span class="test-result-value" id="tr-' + escHtml(id) + '-reason">-</span></div>' +
            '<div class="test-result-row"><span class="test-result-label">' + t('test.confidence') + '</span><span class="test-result-value" id="tr-' + escHtml(id) + '-confidence">-</span></div>' +
          '</div>' +
          '<div class="test-loading" id="test-' + escHtml(id) + '-loading" style="display:none">' + t('test.testing') + '</div>' +
        '</div>' +

        '<div class="save-bar"><button class="btn btn-primary" onclick="saveCustomRouter(\\'' + escHtml(id) + '\\')">' + t('common.save') + ' ' + escHtml(id) + '</button></div>' +
      '</div>' +
    '</div>';
  }).join('');

  // render tags for custom routers after DOM is built
  ids.forEach(function(id) {
    renderTags('cr-kw-s2-' + id);
    renderTags('cr-kw-s3-' + id);
    renderTags('cr-pat-s2-' + id);
    renderTags('cr-pat-s3-' + id);
  });
}

function getAllRouterIds() {
  var allIds = Object.keys(_routers);
  if (!allIds.length) allIds = BUILTIN_ROUTERS.slice();
  BUILTIN_ROUTERS.forEach(function(b) {
    if (allIds.indexOf(b) === -1) allIds.unshift(b);
  });
  return allIds;
}

function renderPipePicker(pipeKey) {
  var suffix = pipeKey.replace('pipe-', '');
  var container = document.getElementById('pipe-picker-' + suffix);
  if (!container) return;
  var current = _tags[pipeKey] || [];
  var allIds = getAllRouterIds();
  container.innerHTML = allIds.map(function(id) {
    var inUse = current.indexOf(id) !== -1;
    return '<button class="pipe-pick-btn' + (inUse ? ' in-use' : '') + '" onclick="togglePipeRouter(\\'' + escHtml(pipeKey) + '\\',\\'' + escHtml(id) + '\\')">' +
      '+ ' + escHtml(id) + '</button>';
  }).join('');
}

function renderPipeTags(pipeKey) {
  var c = document.getElementById('cfg-tags-' + pipeKey);
  if (!c) return;
  c.innerHTML = _tags[pipeKey].map(function(v, i) {
    return '<span class="tag pipe-tag" draggable="true" data-pipe="' + pipeKey + '" data-idx="' + i + '">' +
      '<span style="color:var(--text-tertiary);font-size:10px;margin-right:4px;font-weight:600">' + (i + 1) + '</span>' +
      escHtml(v) +
      ' <button data-key="' + pipeKey + '" data-idx="' + i + '" onclick="removePipeTag(this)">&times;</button></span>';
  }).join('');
  initPipeDrag(pipeKey);
  renderPipePicker(pipeKey);
}

function togglePipeRouter(pipeKey, routerId) {
  var arr = _tags[pipeKey];
  var idx = arr.indexOf(routerId);
  if (idx !== -1) return;
  arr.push(routerId);
  renderPipeTags(pipeKey);
}

function removePipeTag(el) {
  var key = el.getAttribute('data-key');
  var idx = parseInt(el.getAttribute('data-idx'));
  if (key && _tags[key]) {
    _tags[key].splice(idx, 1);
    renderPipeTags(key);
  }
}

function initPipeDrag(pipeKey) {
  var container = document.getElementById('cfg-tags-' + pipeKey);
  if (!container) return;
  var tags = container.querySelectorAll('.pipe-tag');
  tags.forEach(function(tag) {
    tag.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', tag.getAttribute('data-idx'));
      e.dataTransfer.effectAllowed = 'move';
      tag.classList.add('dragging');
    });
    tag.addEventListener('dragend', function() {
      tag.classList.remove('dragging');
    });
    tag.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    tag.addEventListener('drop', function(e) {
      e.preventDefault();
      var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      var toIdx = parseInt(tag.getAttribute('data-idx'));
      if (isNaN(fromIdx) || isNaN(toIdx) || fromIdx === toIdx) return;
      var arr = _tags[pipeKey];
      var item = arr.splice(fromIdx, 1)[0];
      arr.splice(toIdx, 0, item);
      renderPipeTags(pipeKey);
    });
  });
}

function updateAvailableRouters() {
  renderPipeTags('pipe-um');
  renderPipeTags('pipe-tcp');
  renderPipeTags('pipe-tce');
}

function addCustomRouter() {
  var idInput = document.getElementById('new-router-id');
  var id = idInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!id) { showToast(t('cr.enter_id'), true); return; }
  if (_routers[id]) { showToast('"' + id + t('cr.exists'), true); return; }
  _routers[id] = {
    enabled: true,
    type: 'configurable',
    options: { keywords: { S2: [], S3: [] }, patterns: { S2: [], S3: [] }, prompt: '' }
  };
  idInput.value = '';
  renderCustomRouterCards();
  updateAvailableRouters();
  showToast('"' + id + t('cr.created'));
}

function removeCustomRouter(id) {
  if (!confirm(t('cr.del_pre') + id + t('cr.del_suf'))) return;
  delete _routers[id];
  // Clean up tag arrays
  delete _tags['cr-kw-s2-' + id];
  delete _tags['cr-kw-s3-' + id];
  delete _tags['cr-pat-s2-' + id];
  delete _tags['cr-pat-s3-' + id];

  // Save the removal to config
  var currentRouters = Object.assign({}, _routers);
  var payload = { privacy: { routers: currentRouters } };
  fetch(BASE + '/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(function(r) { return r.json(); }).then(function(result) {
    if (result.ok) {
      showToast('"' + id + t('cr.deleted'));
      renderCustomRouterCards();
    } else {
      showToast(t('common.save_failed') + (result.error || 'unknown'), true);
    }
  }).catch(function(e) {
    showToast(t('common.save_failed') + e.message, true);
  });
}

async function saveCustomRouter(id) {
  try {
    var kwS2 = _tags['cr-kw-s2-' + id] || [];
    var kwS3 = _tags['cr-kw-s3-' + id] || [];
    var patS2 = _tags['cr-pat-s2-' + id] || [];
    var patS3 = _tags['cr-pat-s3-' + id] || [];
    var promptEl = document.getElementById('cr-prompt-' + id);
    var prompt = promptEl ? promptEl.value.trim() : '';
    var enabledEl = document.getElementById('cfg-cr-enabled-' + id);
    var enabled = enabledEl ? enabledEl.checked : true;

    var options = {
      keywords: { S2: kwS2, S3: kwS3 },
      patterns: { S2: patS2, S3: patS3 },
    };
    if (prompt) options.prompt = prompt;

    var currentRouters = Object.assign({}, _routers);
    currentRouters[id] = {
      enabled: enabled,
      type: 'configurable',
      options: options,
    };
    _routers[id] = currentRouters[id];

    var payload = { privacy: { routers: currentRouters } };
    var res = await fetch(BASE + '/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var result = await res.json();
    if (result.ok) {
      showToast('"' + id + t('cr.saved'));
    } else {
      showToast(t('common.save_failed') + (result.error || 'unknown'), true);
    }
  } catch (e) {
    showToast(t('common.save_failed') + e.message, true);
  }
}

// ── Init ──
refreshAll();
loadConfig();
loadPrompts();
setInterval(refreshAll, 30000);
if (LANG !== 'en') setLang(LANG);
</script>
</body>
</html>`;
}
