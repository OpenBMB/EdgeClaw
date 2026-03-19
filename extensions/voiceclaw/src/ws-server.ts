/**
 * VoiceClaw WebSocket Audio Server
 *
 * Handles browser audio I/O via WebSocket:
 *   Client → Server: Binary PCM (16kHz 16bit mono, 32ms frames)
 *   Server → Client: JSON events + Binary TTS audio
 *
 * Integrates with AudioSessionManager for VAD/KWS/ASR/TTS processing.
 */

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { WebSocket as WsType } from "ws";
import { AudioSessionManager } from "./audio-session.js";
import type { VoiceClawConfig } from "./types.js";

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export type WsServerHandle = {
  close: () => Promise<void>;
  port: number;
  sessionManager: AudioSessionManager;
};

export async function startWsServer(
  port: number,
  config: VoiceClawConfig,
  logger: Logger,
): Promise<WsServerHandle> {
  const sessionManager = new AudioSessionManager(config);
  await sessionManager.initialize();

  // Dynamic import ws (may not be in all environments)
  const { WebSocketServer } = await import("ws");

  const httpServer: HttpServer = createServer((_req, res) => {
    // Health check endpoint
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      plugin: "voiceclaw",
      status: "running",
      sessions: sessionManager.sessionCount,
    }));
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/voice" });

  wss.on("connection", (ws: WsType, req: IncomingMessage) => {
    const sessionId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = sessionManager.createSession(sessionId);
    logger.info(`[VoiceClaw] WS connected: ${sessionId} from ${req.socket.remoteAddress}`);

    sendJson(ws, {
      type: "state",
      state: session.state,
      privacyLevel: session.privacyLevel,
    });

    ws.on("message", async (data: Buffer | string) => {
      try {
        if (typeof data === "string" || (data instanceof Buffer && data[0] === 0x7b)) {
          // JSON control message
          const msg = JSON.parse(data.toString());
          handleControlMessage(ws, sessionId, msg, sessionManager, logger);
          return;
        }

        // Binary PCM audio data (16kHz, 16bit, mono)
        const pcmBuffer = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
        const samples = pcm16ToFloat32(pcmBuffer);

        const events = await sessionManager.processAudio(sessionId, samples);

        for (const event of events) {
          sendJson(ws, event);
        }
      } catch (err) {
        logger.error(`[VoiceClaw] Error processing message: ${String(err)}`);
        sendJson(ws, { type: "error", message: String(err) });
      }
    });

    ws.on("close", () => {
      sessionManager.removeSession(sessionId);
      logger.info(`[VoiceClaw] WS disconnected: ${sessionId}`);
    });

    ws.on("error", (err) => {
      logger.error(`[VoiceClaw] WS error ${sessionId}: ${String(err)}`);
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.listen(port, () => {
      logger.info(`[VoiceClaw] WebSocket audio server listening on port ${port}`);
      resolve({
        close: async () => {
          wss.close();
          httpServer.close();
          sessionManager.destroy();
        },
        port,
        sessionManager,
      });
    });
    httpServer.on("error", reject);
  });
}

function handleControlMessage(
  ws: WsType,
  sessionId: string,
  msg: Record<string, unknown>,
  sessionManager: AudioSessionManager,
  logger: Logger,
): void {
  switch (msg.type) {
    case "ping":
      sendJson(ws, { type: "pong" });
      break;

    case "stop":
      sessionManager.removeSession(sessionId);
      sendJson(ws, { type: "state", state: "idle", privacyLevel: "S1" });
      break;

    case "tts": {
      const text = msg.text as string;
      if (text) {
        sessionManager.synthesize(sessionId, text).then((result) => {
          if (!result) return;
          sendJson(ws, { type: "tts_start", turnId: result.turnId });
          for (const chunk of result.chunks) {
            ws.send(chunk.audio);
          }
          sendJson(ws, { type: "tts_end", turnId: result.turnId });
        }).catch((err) => {
          logger.error(`[VoiceClaw] TTS error: ${String(err)}`);
        });
      }
      break;
    }

    default:
      logger.warn(`[VoiceClaw] Unknown control message type: ${String(msg.type)}`);
  }
}

function sendJson(ws: WsType, data: unknown): void {
  try {
    ws.send(JSON.stringify(data));
  } catch { /* connection may be closing */ }
}

/**
 * Convert 16-bit signed PCM buffer to Float32Array [-1, 1].
 */
function pcm16ToFloat32(buffer: Buffer): Float32Array {
  const samples = new Float32Array(buffer.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buffer.readInt16LE(i * 2) / 32768.0;
  }
  return samples;
}
