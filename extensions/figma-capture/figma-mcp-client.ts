/**
 * Lightweight Figma MCP client for OpenClaw.
 *
 * Implements:
 * - RFC 7591 dynamic client registration
 * - OAuth 2.0 PKCE authorization code flow
 * - Token refresh
 * - MCP Streamable HTTP transport (JSON-RPC over POST)
 */

import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

const FIGMA_MCP_ENDPOINT = "https://mcp.figma.com/mcp";
const FIGMA_REGISTER_URL = "https://api.figma.com/v1/oauth/mcp/register";
const FIGMA_AUTH_URL = "https://www.figma.com/oauth/mcp";
const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token";

const CRED_DIR = join(process.env.HOME || "~", ".openclaw", "credentials");
const CRED_FILE = join(CRED_DIR, "figma-mcp.json");
const CALLBACK_PORT = 19876;

// RFC 7591 dynamic registration client name
const CLIENT_NAME = "Claude Code";

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ── Credential persistence ─────────────────────────────────────────

async function loadCreds(): Promise<StoredCredentials | null> {
  if (!existsSync(CRED_FILE)) return null;
  try {
    return JSON.parse(await readFile(CRED_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function saveCreds(c: StoredCredentials): Promise<void> {
  await mkdir(CRED_DIR, { recursive: true });
  await writeFile(CRED_FILE, JSON.stringify(c, null, 2), "utf-8");
}

// ── PKCE helpers ───────────────────────────────────────────────────

function generateVerifier(): string {
  return randomBytes(32).toString("base64url");
}

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

// ── Step 1: Dynamic client registration ────────────────────────────

async function registerClient(): Promise<{ clientId: string; clientSecret: string }> {
  const res = await fetch(FIGMA_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [`http://localhost:${CALLBACK_PORT}/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:connect",
      token_endpoint_auth_method: "client_secret_post",
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Figma client registration failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return {
    clientId: data.client_id as string,
    clientSecret: data.client_secret as string,
  };
}

// ── Step 2: OAuth authorization code flow with PKCE ────────────────

async function authorizeInteractive(
  clientId: string,
  clientSecret: string,
): Promise<StoredCredentials> {
  const state = randomBytes(16).toString("hex");
  const codeVerifier = generateVerifier();
  const codeChallenge = await s256Challenge(codeVerifier);

  const authUrl = new URL(FIGMA_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", `http://localhost:${CALLBACK_PORT}/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "mcp:connect");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return new Promise((resolve, reject) => {
    const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const params = new URL(req.url, `http://localhost:${CALLBACK_PORT}`).searchParams;
      if (params.get("state") !== state || !params.get("code")) {
        res.writeHead(400);
        res.end("OAuth state mismatch or missing code");
        srv.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      try {
        const tokenRes = await fetch(FIGMA_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: params.get("code")!,
            redirect_uri: `http://localhost:${CALLBACK_PORT}/callback`,
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: codeVerifier,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
        const tok = (await tokenRes.json()) as Record<string, unknown>;

        const cred: StoredCredentials = {
          clientId,
          clientSecret,
          accessToken: tok.access_token as string,
          refreshToken: tok.refresh_token as string,
          expiresAt: Date.now() + ((tok.expires_in as number) || 3600) * 1000,
        };

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>✅ Figma connected to OpenClaw! You can close this tab.</h2>");
        srv.close();
        resolve(cred);
      } catch (err) {
        res.writeHead(500);
        res.end("Token exchange failed");
        srv.close();
        reject(err);
      }
    });

    srv.listen(CALLBACK_PORT, () => {
      exec(`open "${authUrl.toString()}"`);
    });

    setTimeout(() => {
      srv.close();
      reject(new Error("OAuth timeout — no browser callback in 120 s"));
    }, 120_000);
  });
}

// ── Step 3: Token refresh ──────────────────────────────────────────

async function refreshToken(c: StoredCredentials): Promise<StoredCredentials> {
  const res = await fetch(FIGMA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: c.refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const tok = (await res.json()) as Record<string, unknown>;
  c.accessToken = tok.access_token as string;
  if (tok.refresh_token) c.refreshToken = tok.refresh_token as string;
  c.expiresAt = Date.now() + ((tok.expires_in as number) || 3600) * 1000;
  return c;
}

// ── Public: ensure we have a valid access token ────────────────────

export async function ensureAuth(): Promise<StoredCredentials> {
  let cred = await loadCreds();

  if (!cred) {
    const { clientId, clientSecret } = await registerClient();
    cred = await authorizeInteractive(clientId, clientSecret);
    await saveCreds(cred);
    return cred;
  }

  // Refresh if expiring within 60 s
  if (Date.now() > cred.expiresAt - 60_000) {
    try {
      cred = await refreshToken(cred);
      await saveCreds(cred);
    } catch {
      // Refresh failed — re-auth from scratch
      const { clientId, clientSecret } = await registerClient();
      cred = await authorizeInteractive(clientId, clientSecret);
      await saveCreds(cred);
    }
  }

  return cred;
}

// ── MCP Streamable HTTP transport ──────────────────────────────────

let sessionId: string | undefined;
let rpcId = 1;

/**
 * Send a JSON-RPC request to the Figma MCP endpoint.
 * Handles both JSON and SSE response modes.
 */
export async function mcpRequest(
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const body = JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params });

  const res = await fetch(FIGMA_MCP_ENDPOINT, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(60_000),
  });

  // Persist session
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP ${method} → ${res.status}: ${text.slice(0, 300)}`);
  }

  const ct = res.headers.get("content-type") || "";

  // SSE response
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const evt = JSON.parse(line.slice(6));
      if (evt.result !== undefined) return evt.result;
      if (evt.error) throw new Error(`MCP error: ${JSON.stringify(evt.error)}`);
    }
    throw new Error("No result in SSE stream");
  }

  // Plain JSON
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
  return data.result;
}

/** Initialize (or re-initialize) the MCP session. */
export async function mcpInit(accessToken: string): Promise<void> {
  sessionId = undefined;
  rpcId = 1;
  await mcpRequest(accessToken, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "openclaw-figma", version: "1.0" },
  });
  // initialized notification (no response expected, but some servers need it)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}`,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  await fetch(FIGMA_MCP_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

/** Call a Figma MCP tool and return its text content. */
export async function mcpToolCall(
  accessToken: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = (await mcpRequest(accessToken, "tools/call", {
    name: toolName,
    arguments: args,
  })) as { content?: Array<{ text?: string }> };
  return result?.content?.map((c) => c.text || "").join("\n") || "";
}

/** Invalidate stored credentials (call on auth errors). */
export async function clearCreds(): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(CRED_FILE);
  } catch {
    /* ignore */
  }
  sessionId = undefined;
}
