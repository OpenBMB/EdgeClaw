/**
 * VoiceClaw — Edge Voice Processing Plugin for OpenClaw
 *
 * Adds local VAD, KWS (keyword spotting), ASR, and TTS capabilities
 * using sherpa-onnx-node. Integrates with GuardClaw's privacy pipeline
 * to ensure voice data stays on-device for S2/S3 scenarios.
 *
 * Architecture:
 *   Browser ──WebSocket──→ VoiceClaw Audio Server (:8501)
 *     │                      ├── Silero VAD (speech detection)
 *     │                      ├── KWS (wake word, optional)
 *     │                      ├── ASR (SenseVoice/Whisper/Paraformer)
 *     │                      └── TTS (VITS/edge-tts)
 *     │                             │
 *     └───────────────────────────→ GuardClaw Privacy Pipeline
 *                                    ├── S1: cloud ASR/TTS allowed
 *                                    ├── S2: local ASR, text desensitized
 *                                    └── S3: full local pipeline
 *
 * Key privacy guarantee: audio never leaves the device for S2/S3 sessions.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { voiceClawConfigSchema, defaultVoiceConfig } from "./src/config-schema.js";
import { registerHooks } from "./src/hooks.js";
import { startWsServer, type WsServerHandle } from "./src/ws-server.js";
import type { VoiceClawConfig } from "./src/types.js";

const OPENCLAW_DIR = join(process.env.HOME ?? "/tmp", ".openclaw");
const VOICECLAW_CONFIG_PATH = join(OPENCLAW_DIR, "voiceclaw.json");

function loadVoiceClawConfigFile(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(VOICECLAW_CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeVoiceClawConfigFile(config: Record<string, unknown>): void {
  try {
    mkdirSync(OPENCLAW_DIR, { recursive: true });
    writeFileSync(VOICECLAW_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch { /* best-effort */ }
}

function getVoiceConfig(pluginConfig: Record<string, unknown> | undefined): VoiceClawConfig {
  const userConfig = (pluginConfig?.voice ?? {}) as VoiceClawConfig;
  return { ...defaultVoiceConfig, ...userConfig };
}

const plugin = {
  id: "voiceclaw",
  name: "VoiceClaw",
  description: "Edge voice processing: local VAD, KWS, ASR, and TTS with privacy-aware routing",
  version: "2026.3.19",
  configSchema: voiceClawConfigSchema,

  register(api: OpenClawPluginApi) {
    // ── Resolve config ──
    let resolvedPluginConfig: Record<string, unknown>;
    const fileConfig = loadVoiceClawConfigFile();
    if (fileConfig) {
      resolvedPluginConfig = fileConfig;
      api.logger.info("[VoiceClaw] Config loaded from voiceclaw.json");
    } else {
      const userVoice = ((api.pluginConfig ?? {}) as Record<string, unknown>).voice as Record<string, unknown> | undefined;
      resolvedPluginConfig = { voice: { ...defaultVoiceConfig, ...(userVoice ?? {}) } };
      writeVoiceClawConfigFile(resolvedPluginConfig);
      api.logger.info("[VoiceClaw] Generated voiceclaw.json with defaults");
    }

    const voiceConfig = getVoiceConfig(resolvedPluginConfig);

    if (voiceConfig.enabled === false) {
      api.logger.info("[VoiceClaw] Plugin disabled via config");
      return;
    }

    // ── Register service for WebSocket audio server lifecycle ──
    let wsHandle: WsServerHandle | null = null;
    const wsPort = voiceConfig.port ?? 8501;

    api.registerService({
      id: "voiceclaw-audio",
      start: async () => {
        try {
          wsHandle = await startWsServer(wsPort, voiceConfig, api.logger);
          api.logger.info(`[VoiceClaw] Audio server started on port ${wsPort}`);
        } catch (err) {
          api.logger.error(`[VoiceClaw] Failed to start audio server: ${String(err)}`);
        }
      },
      stop: async () => {
        if (wsHandle) {
          try {
            await wsHandle.close();
            api.logger.info("[VoiceClaw] Audio server stopped");
          } catch (err) {
            api.logger.warn(`[VoiceClaw] Failed to close audio server: ${String(err)}`);
          }
        }
      },
    });

    // ── Register HTTP route for dashboard/status ──
    api.registerHttpRoute({
      path: "/plugins/voiceclaw/status",
      auth: "plugin",
      match: "prefix",
      handler: async (_req, res) => {
        const status = {
          plugin: "voiceclaw",
          version: "2026.3.19",
          enabled: voiceConfig.enabled,
          wsPort,
          sessions: wsHandle?.sessionManager.sessionCount ?? 0,
          engines: {
            vad: { enabled: voiceConfig.vad?.enabled ?? true },
            kws: { enabled: voiceConfig.kws?.enabled ?? false, keywords: voiceConfig.kws?.keywords },
            asr: { enabled: voiceConfig.asr?.enabled ?? true, provider: voiceConfig.asr?.provider },
            tts: { enabled: voiceConfig.tts?.enabled ?? true, provider: voiceConfig.tts?.provider },
          },
          privacy: voiceConfig.privacy,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status, null, 2));
      },
    });

    // ── Register hooks (deferred until WS server is ready) ──
    // Hooks need the WS handle to access session state.
    // We register a service-start callback that triggers hook registration.
    const originalStart = api.registerService;
    // Hooks are registered synchronously — they'll use wsHandle via closure
    // once the service starts. Before that, they gracefully no-op.
    if (wsHandle) {
      registerHooks(api, wsHandle);
    } else {
      // Register hooks with a deferred handle reference
      const deferredHandle: WsServerHandle = {
        close: async () => { await wsHandle?.close(); },
        port: wsPort,
        get sessionManager() {
          return wsHandle?.sessionManager as any;
        },
      };
      registerHooks(api, deferredHandle);
    }

    // ── Banner ──
    const c = "\x1b[35m", g = "\x1b[32m", y = "\x1b[33m", b = "\x1b[1m", d = "\x1b[2m", r = "\x1b[0m", bg = "\x1b[45m\x1b[37m";
    const W = 70;
    const bar = "═".repeat(W);
    const pad = (colored: string, visLen: number) => {
      const sp = " ".repeat(Math.max(0, W - visLen));
      return `${c}  ║${r}${colored}${sp}${c}║${r}`;
    };

    api.logger.info("");
    api.logger.info(`${c}  ╔${bar}╗${r}`);
    api.logger.info(pad(`  ${bg}${b} 🎙️  VoiceClaw ${r}${g}${b}  Ready!${r}`, 25));
    api.logger.info(pad("", 0));
    api.logger.info(pad(`  ${y}Audio WS${r}  ${d}→${r}  ${b}ws://127.0.0.1:${wsPort}/voice${r}`, 42 + String(wsPort).length));
    api.logger.info(pad(`  ${y}Status${r}    ${d}→${r}  ${b}http://127.0.0.1:18789/plugins/voiceclaw/status${r}`, 62));
    api.logger.info(pad(`  ${y}Config${r}    ${d}→${r}  ${b}~/.openclaw/voiceclaw.json${r}`, 40));
    api.logger.info(pad("", 0));
    api.logger.info(pad(`  ${d}VAD: Silero | ASR: ${voiceConfig.asr?.provider ?? "sensevoice"} | TTS: ${voiceConfig.tts?.provider ?? "edge-tts"}${r}`, 58));
    api.logger.info(`${c}  ╚${bar}╝${r}`);
    api.logger.info("");
  },
};

export default plugin;
