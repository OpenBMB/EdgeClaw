<div align="center">

<img src="./assets/EdgeClaw-logo.png" alt="EdgeClaw Logo" width="200">

### Secure · Cost-Effective · Efficient

Edge-Cloud Collaborative AI Agent  
**EdgeClaw**: Bringing the Claude Code Experience to OpenClaw

【**[中文](./readme_zh.md)** | English】

👋 Join our community for discussion and support!

<a href="./assets/feishu-group.png"><img src="./assets/feishu-logo.png" width="16" height="16"> Feishu</a> &nbsp;|&nbsp; <a href="https://discord.com/invite/pC3N7ezpw"><img src="./assets/discord-logo.png" width="16" height="16"> Discord</a>

</div>

---

**What's New** 🔥

- **[2026.04.02]** 🚀 Released three Claude Code-liked features optimized for OpenClaw — 🤖 [ClawXKairos](./extensions/clawxkairos/) (Self-Driven Agent Loop), 🛡️ [ClawXGovernor](./extensions/clawxgovernor/) (Tool Governance), and 📦 [ClawXSandbox](./extensions/clawxsandbox/) (Claude Code-Style Sandbox)
- **[2026.04.01]** 🎉 EdgeClaw 2.0 is officially open-sourced, featuring a brand-new memory engine and cost-saving router — bringing the Claude Code experience to OpenClaw!
- **[2026.04.01]** 🎉 [ClawXMemory](https://github.com/OpenBMB/ClawXMemory) released — inspired by Claude Code's memory mechanism, it delivers a smoother experience for OpenClaw scenarios with multi-layered structured long-term memory and proactive reasoning!
- **[2026.03.25]** 🎉 [ClawXRouter](https://github.com/OpenBMB/clawxrouter) released — 5-tier cost-saving routing + three-tier privacy collaboration + visual Dashboard
- **[2026.03.13]** 🎉 EdgeClaw adds Cost-Aware Collaboration: automatically determines task complexity and matches the most economical cloud model
- **[2026.02.12]** 🎉 EdgeClaw is officially open-sourced — an Edge-Cloud Collaborative AI Agent

---

## 💡 About EdgeClaw

EdgeClaw is an **Edge-Cloud Collaborative AI Agent** jointly developed by [THUNLP (Tsinghua University)](https://nlp.csai.tsinghua.edu.cn), [Renmin University of China](http://ai.ruc.edu.cn/), [AI9Stars](https://github.com/AI9Stars), [ModelBest](https://modelbest.cn/en), and [OpenBMB](https://www.openbmb.cn/home), built on top of [OpenClaw](https://github.com/openclaw/openclaw).

### OpenClaw vs Claude Code vs EdgeClaw

|                                  | OpenClaw |     Claude Code      |                 **EdgeClaw**                  |
| -------------------------------- | :------: | :------------------: | :-------------------------------------------: |
| Cross-session project knowledge  |    ✗     |          ✓           |                     **✓**                     |
| Persistent user preference       |    ✗     |          ✓           |                     **✓**                     |
| Multi-layered structured memory  |    ✗     |          ✓           |                     **✓**                     |
| Memory integration strategy      |  Recall  |    On-demand read    |            **Proactive reasoning**            |
| Continuous memory consolidation  |    ✗     | Auto-Dream (backend) | **Auto-consolidation on idle & topic switch** |
| Cost-aware routing               |    ✗     |          ✗           |             **58% cost savings**              |
| Three-tier privacy collaboration |    ✗     |          ✗           |                 **S1/S2/S3**                  |
| Context working set management   |    ✗     |          ✓           |                     **✓**                     |
| Tool risk governance & audit     |    ✗     |          ✓           |                     **✓**                     |
| Self-driven agent loop           |    ✗     |          ✓           |                     **✓**                     |
| Sandboxed execution              |    ✗     |          ✓           |                     **✓**                     |
| Visual Dashboard                 |    ✗     |          ✗           |                     **✓**                     |

### ✨ Highlights at a Glance

**🌟 Claude Code-Liked Features**

- **🤖 Self-Driven Loop** — [ClawXKairos](./extensions/clawxkairos/): Tick scheduling + Sleep tool + background command automation + async sub-agents, enabling the agent to work autonomously and continuously
- **🛡️ Tool Governance** — [ClawXGovernor](./extensions/clawxgovernor/): Three hook middlewares — context tail-window trimming, tool call risk interception & audit, session note incremental append. Deeply optimized for OpenClaw scenarios, **saving 85% tokens over 30 rounds of calls**
- **📦 Sandbox Execution** — [ClawXSandbox](./extensions/clawxsandbox/): Fully isolated local execution environment based on system-level sandboxing (bwrap / sandbox-exec). Focused on being **lightweight, fast, and zero-dependency**, completely eliminating all Docker overhead.

**🔥 Other Core Features**

- **🧠 Memory Engine** — [ClawXMemory](https://github.com/OpenBMB/ClawXMemory): A structured long-term memory engine built for OpenClaw. Building on the ideas behind Claude Code's memory mechanism, it further introduces multi-layered structured memory and model-driven memory retrieval.
- **💰 Cost-Saving Router** — [ClawXRouter](https://github.com/openbmb/clawxrouter): LLM-as-Judge automatically determines complexity, routing 60–80% of requests to cheaper models. Real-world PinchBench testing shows **58% cost savings** with scores **6.3% higher**.
- **🔒 Three-Tier Privacy** — S1 direct cloud / S2 desensitized forwarding / S3 fully local processing — sensitive data never leaves the device.
- **🚀 Zero Configuration** — `pnpm build && node openclaw.mjs gateway run`, auto-generates config on first launch, just fill in your API Key.
- **📊 Dual Dashboard** — ClawXRouter routing config hot-reload + ClawXMemory memory canvas visualization.

---

## 🎬 Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/39487ce8-fc8e-4dd8-8182-27b130ba15f3" width="70%" controls></video>
</div>

---

## 📦 Quick Start

### 1. Build

```bash
git clone https://github.com/openbmb/edgeclaw.git
cd edgeclaw

pnpm install
pnpm build
```

### 2. Launch

```bash
node openclaw.mjs gateway run
```

> EdgeClaw uses `~/.edgeclaw/` as the data directory by default, completely isolated from OpenClaw (`~/.openclaw/`). To customize the path, set the `OPENCLAW_STATE_DIR` environment variable.

**On first launch**, a complete configuration skeleton is auto-generated (`~/.edgeclaw/openclaw.json` + `clawxrouter.json`), with ClawXRouter and ClawXMemory as bundled extensions — no manual plugin installation required.

### 3. Fill in API Key

The generated config has empty API Keys. Fill them in to get started:

- **Edit the config file**: Modify the `apiKey` for each provider under `models.providers` in `~/.edgeclaw/openclaw.json`
- **Dashboard hot-reload**: Visit `http://127.0.0.1:18790/plugins/clawxrouter/stats` and modify directly in the UI — changes take effect immediately

> Tip: Setting the `EDGECLAW_API_KEY` environment variable before launch will auto-fill it.

### 4. Verify

```bash
node openclaw.mjs agent --local --agent main -m "Hello"
```

When you see `[ClawXrouter] token-saver: S1 redirect →` and an agent reply, the deployment is successful.

### Dashboard

| Panel                                | URL                                                |
| ------------------------------------ | -------------------------------------------------- |
| ClawXRouter (routing config & stats) | `http://127.0.0.1:18790/plugins/clawxrouter/stats` |
| ClawXMemory (memory visualization)   | `http://127.0.0.1:39394/clawxmemory/`              |

> Having issues? Check the [Troubleshooting Guide](troubleshooting_zh.md)

---

## 🧠 ClawXMemory — Multi-Layered Long-Term Memory System

Developers who have used Claude Code know: what truly makes it indispensable isn't how good any single answer is, but that **it remembers you** — your coding style, project architecture, last week's discussion, even your preferred naming conventions.

**[ClawXMemory](https://github.com/OpenBMB/ClawXMemory) is the first plugin to bring Claude Code-like memory capabilities to the OpenClaw ecosystem.**

| Core Memory Capability          | Standard OpenClaw | Claude Code    | ClawXMemory                               |
| ------------------------------- | ----------------- | -------------- | ----------------------------------------- |
| Cross-session project knowledge | ✗                 | ✓              | ✓                                         |
| Persistent user preference      | ✗                 | ✓              | ✓                                         |
| Multi-layered structured memory | ✗                 | ✓              | ✓                                         |
| Memory integration strategy     | Recall            | On-demand read | Proactive reasoning                       |
| Continuous memory consolidation | ✗                 | Auto-Dream     | Auto-consolidation on idle & topic switch |

### Three-Layer Memory Architecture

The system automatically distills information during conversations, building structured memory layer by layer:

| Memory Layer | Type                             | Description                                                                |
| ------------ | -------------------------------- | -------------------------------------------------------------------------- |
| **L2**       | Project memory / Timeline memory | High-level long-term memory aggregated around specific topics or timelines |
| **L1**       | Memory fragments                 | Structured core summaries distilled from concluded topics                  |
| **L0**       | Raw conversations                | The lowest-level raw message records                                       |
| **Global**   | User profile                     | A continuously updated global user preference singleton                    |

When the model needs to recall, it **proactively navigates along the "memory tree" through reasoning** — first evaluating relevance from high-level memory (project/timeline/profile), drilling down into finer-grained fragments only when needed, and tracing back to specific conversations when necessary. This is closer to how a human expert reasons layer by layer than traditional vector retrieval.

### Core Features

- **Automatic memory construction**: No manual maintenance needed — automatically distills, aggregates, and updates during conversation
- **Model-driven retrieval**: Uses reasoning instead of matching, truly understanding vague questions like "How is this project progressing?"
- **Memory visualization Dashboard**: Canvas view and list view, with memory layers and relationships at a glance
- **Local storage, privacy-safe**: SQLite by default, data never leaves the device, supports one-click import/export

> For detailed documentation, see [ClawXMemory README](https://github.com/OpenBMB/ClawXMemory).

---

## 🔌 ClawXRouter — Edge-Cloud Collaborative Routing Plugin

[ClawXRouter](https://github.com/openbmb/clawxrouter) is EdgeClaw's routing brain — the edge perceives data attributes (sensitivity, complexity) while the cloud handles reasoning and generation. Through its Hook mechanism, it automatically intercepts and routes without any changes to business code, serving as a seamless drop-in replacement for OpenClaw.

### Cost-Aware Routing (Token-Saver)

Most requests involve browsing files, reading code, and simple Q&A — using the most expensive model for these tasks is pure waste. Token-Saver uses LLM-as-Judge to classify requests by complexity, automatically routing them to the most economical model:

| Complexity    | Task Examples                                             | Default Target Model |
| ------------- | --------------------------------------------------------- | -------------------- |
| **SIMPLE**    | Queries, translation, formatting, greetings               | `gpt-4o-mini`        |
| **MEDIUM**    | Code generation, single-file editing, email drafting      | `gpt-4o`             |
| **COMPLEX**   | System design, multi-file refactoring, cross-doc analysis | `claude-sonnet-4.6`  |
| **REASONING** | Mathematical proofs, formal logic, experiment design      | `o4-mini`            |

| Approach         | Pros                                     | Cons                                                |
| ---------------- | ---------------------------------------- | --------------------------------------------------- |
| Keyword Rules    | Fast                                     | No semantic understanding, high false-positive rate |
| **LLM-as-Judge** | **Semantic understanding, multilingual** | One additional local model call (~1–2s)             |

The Judge runs on a local small model (MiniCPM-4.1 / Qwen3.5), with prompt hash caching (SHA-256, TTL 5 min) to avoid re-judging identical requests. In typical workflows, **60–80% of requests** are forwarded to cheaper models.

### Three-Tier Security Collaboration (Privacy Router)

Every message, tool call, and tool result is inspected in real time and automatically classified into three levels:

| Level  | Meaning   | Routing Strategy                  | Example                          |
| ------ | --------- | --------------------------------- | -------------------------------- |
| **S1** | Safe      | Send directly to cloud model      | "Write a poem about spring"      |
| **S2** | Sensitive | Desensitize then forward to cloud | Addresses, phone numbers, emails |
| **S3** | Private   | Process locally only              | Pay slips, passwords, SSH keys   |

**Dual Detection Engines**: Rule detector (keywords + regex, ~0ms) + Local LLM detector (semantic understanding, ~1–2s) — the two can be combined and stacked.

**S2 Desensitized Forwarding**:

```
User Message (containing PII) → Local LLM Detection → S2 → Extract PII → Replace with [REDACTED:*]
    → Privacy Proxy → Strip markers → Forward to cloud → Pass through SSE response
```

**S3 Fully Local**: Forwarded to the local Guard Agent (Ollama / vLLM); cloud-side history only receives a placeholder.

**Dual-Track Memory & Dual-Track Sessions**:

```
~/.edgeclaw/workspace/
├── MEMORY.md           ← What the cloud model sees (auto-desensitized)
├── MEMORY-FULL.md      ← What the local model sees (complete data)
│
agents/{id}/sessions/
├── full/               ← Complete history (including Guard Agent interactions)
└── clean/              ← Clean history (for cloud model consumption)
```

The cloud model **never sees** `MEMORY-FULL.md` or `sessions/full/` — the Hook system intercepts at the file access layer.

### Composable Router Pipeline

The security router and cost-aware router run in the **same pipeline**, working together via weights and a two-phase short-circuit strategy:

```
User Message
    │
    ▼
RouterPipeline.run()
    │
    ├── Phase 1: Fast routers (weight ≥ 50) run in parallel
    │       └── privacy router → three-tier sensitivity detection
    │
    ├── Short-circuit: If Phase 1 detects sensitive data → skip Phase 2
    │
    └── Phase 2: Slow routers (weight < 50) run on demand
            └── token-saver → LLM Judge complexity classification
```

Security first — the security router runs first with high weight. If sensitive data is found, it short-circuits immediately. Cost-aware routing kicks in only after the security check passes (S1).

### 13 Hooks Covering the Complete Lifecycle

| Hook                   | Trigger Point              | Core Responsibility                         |
| ---------------------- | -------------------------- | ------------------------------------------- |
| `before_model_resolve` | Before model selection     | Run pipeline → routing decision             |
| `before_prompt_build`  | Before prompt construction | Inject Guard Prompt / S2 markers            |
| `before_tool_call`     | Before tool invocation     | File access guard + sub-agent guard         |
| `after_tool_call`      | After tool invocation      | Tool result detection                       |
| `tool_result_persist`  | Result persistence         | Dual-track session write                    |
| `before_message_write` | Before message write       | S3 → placeholder, S2 → desensitized version |
| `session_end`          | Session ends               | Memory synchronization                      |
| `message_sending`      | Outbound message           | Detect and desensitize/cancel               |
| `before_agent_start`   | Before sub-agent starts    | Task content guard                          |
| `message_received`     | Message received           | Observability logging                       |

> For detailed documentation, see [ClawXRouter README](https://github.com/openbmb/clawxrouter).

---

## 🛡️ ClawXGovernor — Tool Governance

[ClawXGovernor](./extensions/clawxgovernor/) is a combination of three hook middlewares that provide basic context and tool governance capabilities for OpenClaw.

**Not adding new "tools"** — the agent doesn't gain new action capabilities. All work happens at the hook layer, transparent to the agent. The MCP Server only exposes 9 self-state query interfaces for debugging.

### Three Middlewares

| Middleware         | Nature                | Hook                                                           | What It Does                                                                                                                                                                                            |
| ------------------ | --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **assembler**      | Context trimmer       | `registerContextEngine`                                        | Keeps the last 6 rounds of user dialogue (tail-window), token estimation (chars/4), writes a text summary on compact, fail-soft on failure                                                              |
| **tool-governor**  | Tool call interceptor | `before_tool_call` · `after_tool_call` · `before_prompt_build` | Classifies into 5 risk levels by keyword `includes()`, string-match blocks dangerous commands (6 rules), ring counter detects loops (window 10 / threshold 3), truncates >4000 chars, writes audit logs |
| **session-memory** | Session note appender | `before_prompt_build` · `message_sending`                      | Regex matches key points from replies, appends to markdown file, injects last 5 lines as hints in the next round                                                                                        |

### Tool Risk Classification Rules

| Level                | Matching Method                                              | Action                         |
| -------------------- | ------------------------------------------------------------ | ------------------------------ |
| **read**             | Tool name contains `find`/`grep`/`read`/`glob`/`search` etc. | Allow                          |
| **workspace_write**  | Contains `edit`/`write`/`apply_patch`                        | Allow                          |
| **exec**             | Contains `exec`/`shell`/`bash`                               | Requires approval              |
| **network**          | Contains `web_search`/`fetch`                                | Allow                          |
| **subagent_control** | Contains `sessions_spawn`/`subagent`                         | Requires approval              |
| **unknown**          | No rule matched                                              | Allow (`defaultAction: allow`) |

Hard-coded blocks: `rm -rf /`, fork bomb, `mkfs`, `dd if=/dev/zero`. Audit logs written to `~/.openclaw/cc-tool-governor/audit.jsonl`.

### Current Status

Features have been E2E verified, but all are **minimal implementations** — compact lacks LLM summarization, risk classification lacks semantic understanding, note extraction lacks LLM extraction, and there are no quantitative benchmarks.

> For detailed documentation, see [ClawXGovernor README](./extensions/clawxgovernor/Readme_zh.md).

---

## 🧩 Claude Code-Liked Features

What makes Claude Code truly "addictive" isn't just single-turn response quality, but a series of **system-level capabilities** that make the agent feel like a collaborator with memory, autonomous action, and an environment it can't break. EdgeClaw replicates these capabilities one by one through its extension mechanism:

### 🤖 Kairos — Self-Driven Agent Loop

Claude Code's agent can work continuously without user intervention — reading files, running tests, modifying code, running tests again — until the task is complete. [ClawXKairos](./extensions/clawxkairos/) brings this behavior to OpenClaw:

| Capability              | Mechanism                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| **Tick Scheduling**     | Automatically injects `<tick>` wake-up messages after agent turns end, driving the next round of work |
| **Sleep Tool**          | Agent calls `Sleep({ duration_ms })` to actively hibernate when idle, avoiding empty spinning         |
| **Background Commands** | Shell commands exceeding a threshold are automatically backgrounded, not blocking agent progress      |
| **Async Sub-agents**    | Sub-agents launch non-blocking, main agent doesn't need to wait for sub-task completion               |
| **Safety Limits**       | `maxTurnsPerSession` prevents infinite loops, `minSleepMs` prevents spin-bombing                      |

Toggle at runtime via `/kairos on|off|status` commands, supporting `on-message`, `on-heartbeat`, and `on-gateway-start` startup modes.

### 🛡️ Basic Context Management

Claude Code manages the context window with extreme precision — automatically trimming old conversations, compressing verbose tool outputs, and proactively compacting when approaching the window limit. EdgeClaw provides a basic version through [ClawXGovernor](./extensions/clawxgovernor/)'s three middlewares:

- **Tail-window trimming**: Keeps the last N rounds of dialogue (default 6), exceeded portions are trimmed with a text summary generated
- **Tool output compression**: Tool results exceeding 4000 characters are automatically truncated with a summary, preventing a single call from filling the context
- **Session note injection**: Extracts key points from agent replies, injected as lightweight hints in the next round, compensating for information loss from trimming

This is a minimal implementation — no LLM-driven summarization, no semantic understanding, but it already prevents context overflow in long sessions.

### 📦 Sandboxed Execution

Claude Code executes all commands in a sandbox — even if the agent accidentally runs `rm -rf`, it only affects the isolated environment, not the user's host. [OpenShell Sandbox](./extensions/openshell/) provides equivalent capability for EdgeClaw:

| Mode       | Description                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mirror** | Local workspace auto-mirrors to remote sandbox, agent's file reads/writes and command execution happen in the sandbox, synced back to local on completion |
| **Remote** | Fully remote workspace, suitable for CI/CD or cloud deployment scenarios                                                                                  |

The sandbox is SSH-based, supporting custom providers, GPU resource requests, and timeout control. Long-running commands are automatically backgrounded, and when paired with Kairos, enables the "agent dispatches build task → sleeps waiting → wakes to check results" autonomous workflow.

---

## ⚠️ Pitfall Guide

Below are practical lessons learned during EdgeClaw plugin development and integration testing, sorted by severity.

### 🔴 Plugin Hook Intercepts Its Own MCP Tools

The `before_tool_call` hook intercepts **all** tool calls, including its own MCP tools. MCP tool names follow the format `<server>__<tool>` (e.g., `clawxgovernor__tool_risk_classify`). If the hook's classification logic only recognizes built-in tool names, MCP tools will hit `defaultAction` and be incorrectly intercepted.

**Solution**: Cover MCP tool keywords in the tool classification whitelist, or set `defaultAction` to `allow`.

### 🔴 `--session-id` Does Not Isolate Session Context

`--session-id` only sets a metadata tag and doesn't create an independent session. All `--local` agent runs share `sessionKey: agent:<agentId>:main`, and old conversation history is fully injected into the new request's context.

**Solution**: Clear session state before testing:

```bash
node -e "
const fs = require('fs');
const p = require('os').homedir() + '/.openclaw/agents/main/sessions/sessions.json';
const d = JSON.parse(fs.readFileSync(p,'utf-8'));
delete d['agent:main:main'];
fs.writeFileSync(p, JSON.stringify(d, null, 2));
"
```

### 🟠 ClawXRouter Token-Saver May Hijack Model Routing

Configured `primary: "yeysai/minimax-m2.5"`, but logs show `model overridden to gpt-5-mini`. The token-saver router automatically redirects to different tier models based on message complexity. If a tier's corresponding provider uses a local proxy that isn't running, it will cause a 504 timeout.

**Solution**: Disable token-saver for debugging (`"token-saver": { "enabled": false }`), or ensure all providers referenced in tiers are reachable. Note that `clawxrouter.json` takes priority over routing config in `openclaw.json`.

### 🟡 `tools.alsoAllow` Reports "unknown entries" at Startup

MCP tools are registered dynamically at runtime. Gateway's static validation of `alsoAllow` at startup will report unknown entries warnings. **Can be safely ignored** — check that `systemPromptReport.tools.entries` contains the corresponding MCP tools to confirm successful registration.

### 🟡 OpenClaw Plugin SDK Type Import Paths

Types like `ContextEngineFactory` are not in `openclaw/plugin-sdk/context-engine`, but at the `openclaw/plugin-sdk` root path. The `requireApproval` return value cannot be `boolean` — it needs to be a `{ title, description, severity }` object. It's recommended to use `grep` to search for specific type export locations in `node_modules/openclaw`.

### 🟢 Thinking Model Latency and Long System Prompts

Thinking models like minimax-m2.5 have a reasoning process per request, combined with ~31K chars of system prompts (AGENTS.md + Skills + 35 tool schemas), latency is typically 30–120 seconds. E2E test timeouts should be 300+ seconds. You can mitigate this by setting `"thinking": "low"` to reduce reasoning depth, or by reducing the number of registered tools.

---

### Usage Modes

**Mode 1: Token-Saver Cost-Saving Mode (Default)** — Fill in your API Key and it's ready to use. ClawXRouter automatically routes requests to the most economical model. Tiers can be customized in `openclaw.json` or via the Dashboard.

**Mode 2: Privacy + Cost-Saving Dual Routing** — Enable the privacy router in `~/.edgeclaw/clawxrouter.json`; requires a local LLM backend (Ollama / vLLM):

```json
{
  "privacy": {
    "routers": {
      "privacy": { "enabled": true, "type": "builtin", "weight": 90 },
      "token-saver": { "enabled": true, "type": "builtin", "weight": 40 }
    },
    "pipeline": {
      "onUserMessage": ["privacy", "token-saver"],
      "onToolCallProposed": ["privacy"],
      "onToolCallExecuted": ["privacy"]
    },
    "localModel": {
      "enabled": true,
      "endpoint": "http://localhost:11434",
      "model": "openbmb/minicpm4.1"
    }
  }
}
```

---

## 🔧 Custom Configuration

### Custom Detection Rules

```json
{
  "privacy": {
    "rules": {
      "keywords": {
        "S2": ["password", "api_key", "token"],
        "S3": ["ssh", "id_rsa", "private_key", ".pem"]
      },
      "patterns": {
        "S2": ["(?:mysql|postgres|mongodb)://[^\\s]+"],
        "S3": ["-----BEGIN (?:RSA |EC )?PRIVATE KEY-----"]
      },
      "tools": {
        "S2": { "tools": ["exec", "shell"], "paths": ["~/secrets"] },
        "S3": { "tools": ["sudo"], "paths": ["~/.ssh", "~/.aws"] }
      }
    }
  }
}
```

### Detector Composition

```json
{
  "privacy": {
    "checkpoints": {
      "onUserMessage": ["ruleDetector", "localModelDetector"],
      "onToolCallProposed": ["ruleDetector"],
      "onToolCallExecuted": ["ruleDetector"]
    }
  }
}
```

### Custom Routers

The ClawXRouter pipeline is fully extensible — implement the `GuardClawRouter` interface to inject custom routing logic:

```typescript
const myRouter: GuardClawRouter = {
  id: "content-filter",
  async detect(context, pluginConfig): Promise<RouterDecision> {
    if (context.message && context.message.length > 10000) {
      return {
        level: "S1",
        action: "redirect",
        target: { provider: "anthropic", model: "claude-sonnet-4.6" },
        reason: "Message too long, using larger context model",
      };
    }
    return { level: "S1", action: "passthrough" };
  },
};
```

```json
{
  "privacy": {
    "routers": {
      "content-filter": {
        "enabled": true,
        "type": "custom",
        "module": "./my-routers/content-filter.js",
        "weight": 40
      }
    },
    "pipeline": {
      "onUserMessage": ["privacy", "token-saver", "content-filter"]
    }
  }
}
```

### Prompt Customization

Edit the Markdown files under `extensions/clawxrouter/prompts/` to adjust behavior — no code changes needed:

| File                    | Purpose                        |
| ----------------------- | ------------------------------ |
| `detection-system.md`   | S1/S2/S3 classification rules  |
| `guard-agent-system.md` | Guard Agent behavior           |
| `token-saver-judge.md`  | Task complexity classification |

### Provider Preset Quick Switch

Built-in presets allow one-click switching between local model + cloud model combinations:

| Preset          | Local Model         | Cloud Model        | Use Case                                      |
| --------------- | ------------------- | ------------------ | --------------------------------------------- |
| `vllm-qwen35`   | vLLM / Qwen 3.5-35B | Same (fully local) | Full local deployment, maximum privacy        |
| `minimax-cloud` | vLLM / Qwen 3.5-35B | MiniMax M2.5       | Local privacy detection + cloud primary model |

Custom presets for Ollama, LMStudio, SGLang, and other backends are also supported.

---

## 🏗️ Code Structure

```
EdgeClaw/
├── openclaw.mjs                         # CLI entry point
├── src/config/
│   ├── edgeclaw-defaults.ts             # EdgeClaw default config template (auto-seed)
│   ├── paths.ts                         # State directory / port resolution (18790)
│   └── io.ts                            # Config loading (with auto-seed logic)
├── scripts/
│   ├── deploy-edgeclaw.sh               # One-click deployment script
│   └── lib/optional-bundled-clusters.mjs # Build exclusion list (guardclaw)
│
├── extensions/
│   ├── clawxrouter/                     # [Built-in] ClawXRouter cost-saving router
│   │   ├── index.ts                     # Plugin entry point
│   │   ├── src/
│   │   │   ├── router-pipeline.ts       # Router pipeline (two-phase + weighted merge)
│   │   │   ├── hooks.ts                 # 13 Hooks
│   │   │   ├── privacy-proxy.ts         # HTTP privacy proxy
│   │   │   ├── config-schema.ts         # Default config schema
│   │   │   ├── live-config.ts           # Config hot-reload
│   │   │   ├── stats-dashboard.ts       # Visual Dashboard
│   │   │   └── routers/
│   │   │       ├── privacy.ts           # Privacy router (security)
│   │   │       └── token-saver.ts       # Cost-aware router (cost savings)
│   │   └── prompts/                     # Customizable prompt templates
│   │
│   ├── openbmb-clawxmemory/             # [Built-in] ClawXMemory long-term memory
│   │   ├── src/
│   │   │   ├── index.ts                 # Plugin entry point
│   │   │   ├── core/                    # L0/L1/L2 three-layer memory engine
│   │   │   └── tools.ts                 # memory_overview / memory_list / memory_flush
│   │   └── ui-source/                   # Dashboard frontend
│   │
│   ├── clawxkairos/                     # [Built-in] ClawXKairos self-driven loop
│   │   ├── index.ts                     # Plugin entry point
│   │   └── src/
│   │       ├── tick-scheduler.ts        # Tick scheduling (agent_end → requestHeartbeatNow)
│   │       ├── sleep-tool.ts            # Sleep tool (controlled hibernation)
│   │       ├── background-commands.ts   # Long command auto-backgrounding
│   │       ├── async-subagent.ts        # Async sub-agents
│   │       ├── kairos-prompt.ts         # Autonomous mode system prompt injection
│   │       └── heartbeat-ack-guard.ts   # HEARTBEAT_OK interception → forced Sleep
│   │
│   ├── openshell/                       # [Built-in] OpenShell sandbox execution
│   │   ├── index.ts                     # Plugin entry point
│   │   └── src/
│   │       ├── backend.ts              # SSH sandbox backend
│   │       ├── mirror.ts              # Local-remote workspace mirroring
│   │       ├── fs-bridge.ts           # File system bridge
│   │       └── config.ts             # Sandbox configuration
│   │
│   ├── guardclaw/                       # [Optional] Privacy guard (excluded from build by default)
│   │
│   └── clawxgovernor/                   # [Built-in] ClawXGovernor tool governance
│       ├── index.ts                     # Unified entry (3 hook middlewares)
│       ├── src/
│       │   ├── assembler.ts             # Context trimmer (tail-window / compact / reinjection)
│       │   ├── tool-governor.ts         # Tool call interceptor (risk classification / block / loop detection / audit)
│       │   └── session-memory.ts        # Session note appender (delta note / lightweight hint injection)
│       ├── mcp-server/                  # State query interfaces (9 debug tools)
│       └── skills/                      # 4 Agent Skills
│
└── ~/.edgeclaw/                         # Runtime state directory (auto-generated)
    ├── openclaw.json                    # Main config (auto-seeded on first launch)
    ├── clawxrouter.json                 # ClawXRouter config (auto-generated)
    ├── clawxrouter-stats.json           # Token statistics
    ├── clawxmemory/                     # ClawXMemory SQLite data
    ├── cc-context-engine/state.json     # Context engine state
    ├── cc-tool-governor/audit.jsonl     # Tool audit logs
    ├── cc-session-memory/notes/         # Session notes
    └── workspace-main/                  # Agent workspace
```

---

## 🤝 Contributing

Thanks to all contributors for their code submissions and testing. We welcome new members to join us in building the edge-cloud collaborative Agent ecosystem!

Contributing workflow: **Fork this repo → Submit Issues → Create Pull Requests (PRs)**

---

## ⭐ Support Us

If this project is helpful to your research or work, please give us a ⭐!

---

## 💬 Contact Us

- For technical questions and feature requests, please use [GitHub Issues](https://github.com/openbmb/edgeclaw/issues)

---

## 📖 References

### Dependencies

- [OpenClaw](https://github.com/openclaw/openclaw) — Base AI assistant framework
- [MiniCPM](https://github.com/OpenBMB/MiniCPM) — Recommended local detection model
- [Ollama](https://ollama.ai) — Recommended local inference backend

### Ecosystem Projects

- [ClawXRouter](https://github.com/openbmb/clawxrouter) — Edge-Cloud collaborative routing plugin (privacy routing + cost-aware routing + Dashboard)
- [ClawXMemory](https://github.com/OpenBMB/ClawXMemory) — Multi-layered memory system for long-term context
- [ClawXGovernor](./extensions/clawxgovernor/) — Tool governance (context trimming + tool call interception & audit + session notes), EdgeClaw built-in extension
- [ClawXKairos](./extensions/clawxkairos/) — Self-driven agent loop (tick scheduling + sleep + background commands + async sub-agents)
- [ClawXSandbox](./extensions/clawxsandbox/) — Lightweight, zero-dependency isolated execution environment based on system-level sandboxing (bwrap / sandbox-exec)

### License

MIT
