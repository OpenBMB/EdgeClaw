# XHS Header Generator — Setup Guide

One-click generate Xiaohongshu (小红书) header images from a brief:
search the web, screenshot pages, compose HTML layout, render PNG, push to Figma.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed (`npm i -g openclaw`)
- Google Chrome (for headless screenshots)
- Node.js 22+

## Step 1: Copy files

```bash
# 1. Skill (design rules + workflow)
mkdir -p ~/.openclaw/workspace-xhs/skills/brief-to-xhs-header
cp -r skills/brief-to-xhs-header/* ~/.openclaw/workspace-xhs/skills/brief-to-xhs-header/

# 2. Search plugin
cp -r extensions/serp-search ~/.openclaw/extensions/serp-search

# 3. Figma plugin (optional — skip if you don't need Figma export)
cp -r extensions/figma-capture ~/.openclaw/extensions/figma-capture

# 4. Agent workspace files
cp workspace-xhs/AGENTS.md ~/.openclaw/workspace-xhs/
cp workspace-xhs/SOUL.md ~/.openclaw/workspace-xhs/
cp workspace-xhs/IDENTITY.md ~/.openclaw/workspace-xhs/
cp workspace-xhs/TOOLS.md ~/.openclaw/workspace-xhs/
cp workspace-xhs/USER.md ~/.openclaw/workspace-xhs/
cp workspace-xhs/BOOTSTRAP.md ~/.openclaw/workspace-xhs/
cp workspace-xhs/HEARTBEAT.md ~/.openclaw/workspace-xhs/
```

## Step 2: Get API keys

You need two API keys:

| Key             | For                            | Where to get                                                                                                      |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| LLM API key     | Running the agent (Claude/GPT) | [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com), or any OpenAI-compatible proxy |
| serp.hk API key | Web search (Google proxy)      | [serp.hk](https://serp.hk) — works in China without VPN                                                           |

The Figma plugin needs no API key — it handles OAuth automatically on first use.

## Step 3: Configure openclaw.json

Add the following to `~/.openclaw/openclaw.json`. Replace the placeholder values with your own.

```json5
{
  // Add your model provider (example using Anthropic direct)
  modelProviders: {
    anthropic: {
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "<YOUR_ANTHROPIC_API_KEY>",
      models: [{ id: "claude-sonnet-4-20250514", maxTokens: 16384 }],
    },
    // Or use any OpenAI-compatible proxy:
    // "openai": {
    //   "baseURL": "https://your-proxy.com/v1",
    //   "apiKey": "<YOUR_KEY>",
    //   "models": [
    //     { "id": "claude-opus-4-6", "maxTokens": 16384, "reasoning": false }
    //   ]
    // }
  },

  // Add the XHS agent
  agents: {
    list: [
      {
        id: "xhs",
        name: "XHS Header Agent",
        workspace: "~/.openclaw/workspace-xhs",
        model: {
          primary: "anthropic/claude-sonnet-4-20250514",
          // Or: "openai/claude-opus-4-6" if using a proxy
        },
        skills: ["brief-to-xhs-header"],
        identity: { name: "XHS Designer", emoji: "🎨" },
        sandbox: { mode: "off" },
      },
    ],
  },

  // Plugin configs
  plugins: {
    entries: {
      "serp-search": {
        config: {
          apiKey: "<YOUR_SERP_HK_API_KEY>",
          region: "cn",
        },
      },
    },
  },

  // Chrome screenshots need longer timeout
  tools: {
    exec: {
      backgroundMs: 60000,
    },
  },
}
```

> **Note:** If you already have an `openclaw.json`, merge these sections into your existing config — don't overwrite the whole file.

## Step 4: Test

```bash
# Clear any stale sessions
rm -f ~/.openclaw/agents/xhs/sessions/*.jsonl

# Run a test
openclaw agent --agent xhs --message "帮我生成一张 VoxCPM2 的小红书头图，搜一下相关信息然后截图 GitHub 页面" --local --timeout 300
```

Output PNG will be at `/tmp/xhs/output.png` (or similar path shown by the agent).

## Chrome path

The skill assumes Chrome is at the macOS default path:

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

On Linux, change the path in your prompt to:

```
google-chrome --headless=new --disable-gpu --no-sandbox --screenshot=...
```

## Figma integration (optional)

On first `figma_capture` call, a browser window opens asking you to authorize Figma.
Click "Allow access" — tokens are saved to `~/.openclaw/credentials/figma-mcp.json`
and auto-refresh for ~90 days.

Requires a browser with display — won't work on headless servers.

## Troubleshooting

| Problem                                | Fix                                                             |
| -------------------------------------- | --------------------------------------------------------------- |
| Agent returns "No reply" or 0 tokens   | Clear sessions: `rm -f ~/.openclaw/agents/xhs/sessions/*.jsonl` |
| Chrome screenshot times out            | Increase `tools.exec.backgroundMs` to 90000                     |
| `serp_search` returns 401              | Check your serp.hk API key is valid                             |
| `web_search` fails with "fetch failed" | Normal in China — use `serp_search` instead                     |
| Figma capture times out                | Ensure browser is visible, not headless                         |
| Plugin not found                       | Check extension dirs exist under `~/.openclaw/extensions/`      |

## File structure

```
~/.openclaw/
├── openclaw.json                         ← config (you edit this)
├── extensions/
│   ├── serp-search/                      ← Google search tool
│   │   ├── index.ts
│   │   ├── openclaw.plugin.json
│   │   └── package.json
│   └── figma-capture/                    ← Figma export tool (optional)
│       ├── index.ts
│       ├── figma-capture.ts
│       ├── figma-mcp-client.ts
│       ├── openclaw.plugin.json
│       └── package.json
├── workspace-xhs/                        ← agent workspace
│   ├── AGENTS.md
│   ├── SOUL.md
│   ├── IDENTITY.md
│   ├── ...
│   └── skills/
│       └── brief-to-xhs-header/
│           ├── SKILL.md                  ← design rules + recipes
│           ├── examples/x-card.html
│           └── scripts/scrape-tweet.sh
└── credentials/
    └── figma-mcp.json                    ← auto-generated on first Figma auth
```
