/**
 * figma_capture tool — pushes local HTML to Figma as an editable design.
 *
 * Flow:
 * 1. Ensure Figma OAuth (one-time browser auth)
 * 2. Init MCP session
 * 3. Call generate_figma_design → captureId
 * 4. Inject capture.js + start local server
 * 5. Open page in browser with capture hash
 * 6. Poll until capture completes → return Figma URL
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { jsonResult } from "openclaw/plugin-sdk/provider-web-search";
import { ensureAuth, mcpInit, mcpToolCall, clearCreds } from "./figma-mcp-client.js";

const CAPTURE_SCRIPT =
  '<script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>';

export function registerFigmaCaptureTool(api: OpenClawPluginApi) {
  api.logger.info("figma_capture: registered");

  api.registerTool({
    name: "figma_capture",
    label: "Figma Capture",
    description:
      "Push a local HTML file to Figma as an editable design. " +
      "On first use, opens browser for Figma authorization (one-time). " +
      "Returns a Figma file URL on success.",
    parameters: {
      type: "object",
      properties: {
        htmlPath: {
          type: "string",
          description: "Absolute path to the HTML file to capture.",
        },
        fileName: {
          type: "string",
          description: "Name for the Figma file (auto-generated if omitted).",
        },
      },
      required: ["htmlPath"],
    },
    execute: async (_toolCallId: string, rawArgs: unknown) => {
      const args = rawArgs as Record<string, unknown>;
      const htmlPath = args.htmlPath as string;
      const fileName = (args.fileName as string) || "OpenClaw Design";

      if (!existsSync(htmlPath)) {
        return jsonResult({ error: `File not found: ${htmlPath}` });
      }

      let fileServer: ReturnType<typeof createServer> | undefined;

      try {
        // 1. Auth
        const cred = await ensureAuth();

        // 2. MCP session
        await mcpInit(cred.accessToken);

        // 3. Get captureId via generate_figma_design
        const genText = await mcpToolCall(cred.accessToken, "generate_figma_design", {
          outputMode: "newFile",
          fileName,
        });

        // Parse captureId from response text
        const captureIdMatch =
          genText.match(/capture ID[^`]*`([^`]+)`/i) ||
          genText.match(/captureId[":=\s]+([0-9a-f-]{36})/i) ||
          genText.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);

        if (!captureIdMatch) {
          return jsonResult({
            error: "Could not extract captureId from Figma MCP response",
            detail: genText.slice(0, 500),
          });
        }
        const captureId = captureIdMatch[1];

        // 4. Inject capture.js if needed
        let html = await readFile(htmlPath, "utf-8");
        if (!html.includes("capture.js")) {
          html = html.replace("</head>", `${CAPTURE_SCRIPT}\n</head>`);
          await writeFile(htmlPath, html, "utf-8");
        }

        // 5. Start local HTTP server
        const dir = htmlPath.substring(0, htmlPath.lastIndexOf("/"));
        const filename = htmlPath.substring(htmlPath.lastIndexOf("/") + 1);
        const port = 18765 + Math.floor(Math.random() * 100);

        fileServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
          const reqPath = (req.url || "/").split("?")[0].split("#")[0];
          const filePath = join(dir, reqPath === "/" ? filename : reqPath.slice(1));
          try {
            const content = await readFile(filePath);
            const ext = filePath.split(".").pop() || "";
            const mimeTypes: Record<string, string> = {
              html: "text/html",
              css: "text/css",
              js: "application/javascript",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              svg: "image/svg+xml",
            };
            res.writeHead(200, {
              "Content-Type": mimeTypes[ext] || "application/octet-stream",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(content);
          } catch {
            res.writeHead(404);
            res.end("Not found");
          }
        });

        await new Promise<void>((resolve) => fileServer!.listen(port, resolve));

        // 6. Open in browser with capture hash
        const endpoint = encodeURIComponent(
          `https://mcp.figma.com/mcp/capture/${captureId}/submit`,
        );
        const url = `http://localhost:${port}/${filename}#figmacapture=${captureId}&figmaendpoint=${endpoint}&figmadelay=3000`;
        exec(`open "${url}"`);

        // 7. Poll for completion (up to 75 s)
        let figmaUrl = "";
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const pollText = await mcpToolCall(cred.accessToken, "generate_figma_design", {
              captureId,
            });
            const urlMatch = pollText.match(/https:\/\/www\.figma\.com\/design\/[a-zA-Z0-9]+/);
            if (urlMatch) {
              figmaUrl = urlMatch[0];
              break;
            }
            // Also check for file_key or claim URL
            const claimMatch = pollText.match(
              /https:\/\/www\.figma\.com\/integrations\/claim\/[a-zA-Z0-9]+/,
            );
            if (claimMatch) {
              figmaUrl = claimMatch[0];
              break;
            }
          } catch {
            // Keep polling
          }
        }

        fileServer.close();
        fileServer = undefined;

        if (figmaUrl) {
          return jsonResult({ success: true, figmaUrl, captureId });
        }
        return jsonResult({ error: "Capture timed out (75 s)", captureId });
      } catch (err) {
        if (fileServer) fileServer.close();
        const msg = err instanceof Error ? err.message : String(err);

        // Clear creds on auth errors so next call re-auths
        if (/unauthorized|401|403|token/i.test(msg)) {
          await clearCreds();
        }

        return jsonResult({ error: msg });
      }
    },
  });
}
