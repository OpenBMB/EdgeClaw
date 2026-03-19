<div align="center">
  <img src="./assets/EdgeClaw-logo.png" alt="EdgeClaw Logo" width="25%"></img>
</div>

<h3 align="center">
Secure · Cost-Effective · Efficient
</h3>

<p align="center">
  Edge-Cloud Collaborative AI Agent<br>
  <b>EdgeClaw</b>: Keep sensitive data off the cloud, let cheap models handle 80% of requests
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/openbmb/edgeclaw"><img src="https://img.shields.io/github/stars/openbmb/edgeclaw?style=for-the-badge" alt="Stars"></a>
  <a href="https://github.com/openbmb/edgeclaw/issues"><img src="https://img.shields.io/github/issues/openbmb/edgeclaw?style=for-the-badge" alt="Issues"></a>
</p>

<p align="center">
    【<a href="./readme_zh.md"><b>中文</b></a> | English】
</p>

---

**What's New** 🔥

- **[2026.03.13]** 🎉 EdgeClaw adds Cost-Aware Collaboration: automatically determines task complexity and matches the most economical cloud model
- **[2026.02.12]** 🎉 EdgeClaw is officially open-sourced — an Edge-Cloud Collaborative AI Agent

---

## 💡 About EdgeClaw

EdgeClaw is an **Edge-Cloud Collaborative AI Agent** jointly developed by [THUNLP (Tsinghua University)](https://nlp.csai.tsinghua.edu.cn), [Renmin University of China](http://ai.ruc.edu.cn/), [AI9Stars](https://github.com/AI9Stars), [ModelBest](https://modelbest.cn/en), and [OpenBMB](https://www.openbmb.cn/home), built on top of [OpenClaw](https://github.com/openclaw/openclaw).

In current AI Agent architectures, the edge side has long been overlooked — all data and tasks are funneled to the cloud, leading to privacy leaks and wasted compute. EdgeClaw reactivates the value of edge computing by constructing a customizable three-tier security system (S1 Passthrough / S2 Desensitization / S3 Local). Through a dual-engine on the edge (rule-based detection ~0ms + local LLM semantic detection ~1–2s), it classifies the sensitivity and complexity of every request in real time, then routes each request through a unified composable pipeline to the most privacy-safe and cost-effective processing path. With intelligent edge-cloud forwarding, developers can achieve seamless privacy protection — "public data to cloud, sensitive data desensitized, private data stays local" — without modifying any business logic.

<div align="center">
  <img src="./assets/EdgeClaw-arch.png" alt="EdgeClaw Architecture" width="90%"></img>
</div>

---

## ✨ Key Highlights

<table>
<tr>
<td width="50%">

**🤝 Edge-Cloud Division of Labor**

The edge perceives data attributes (sensitivity, complexity); the cloud handles reasoning and generation. The edge covers the cloud's blind spots (sensitive data never leaves the device), while the cloud compensates for the edge's limitations (complex tasks are offloaded to the cloud).

</td>
<td width="50%">

**🔒 Three-Tier Security Collaboration**

Safe data (S1) — sent directly to the cloud; Sensitive data (S2) — desensitized on-device before forwarding to the cloud; Private data (S3) — processed entirely on-device, with the cloud only maintaining context continuity.

</td>
</tr>
<tr>
<td width="50%">

**💰 Cost-Aware Collaboration**

A local LLM semantically judges task complexity, routing simple tasks to cheap models and reserving expensive models for complex tasks only. In typical workflows, 60–80% of requests are forwarded to low-cost models, drastically cutting cloud token expenses.

</td>
<td width="50%">

**🚀 Plug-and-Play, Zero Code Changes**

EdgeClaw automatically intercepts and routes via its Hook mechanism — no modifications to any business logic required. It serves as a seamless drop-in replacement for OpenClaw.

</td>
</tr>
</table>

---

## 🔒 Three-Tier Security Collaboration

### Three-Level Sensitivity Classification

Every user message, tool call, and tool result is inspected in real time and automatically classified into one of three levels:

| Level  | Meaning   | Routing Strategy                  | Example                          |
| ------ | --------- | --------------------------------- | -------------------------------- |
| **S1** | Safe      | Send directly to cloud model      | "Write a poem about spring"      |
| **S2** | Sensitive | Desensitize then forward to cloud | Addresses, phone numbers, emails |
| **S3** | Private   | Process locally only              | Pay slips, passwords, SSH keys   |

### Dual Detection Engines

| Engine                 | Mechanism                                            | Latency | Coverage                                                                             |
| ---------------------- | ---------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| **Rule Detector**      | Keywords + Regex matching                            | ~0ms    | Known patterns: API keys, DB connection strings, PEM key headers                     |
| **Local LLM Detector** | Semantic understanding (runs on a local small model) | ~1–2s   | Contextual reasoning: "Analyze this pay slip for me", addresses in various languages |

The two engines can be stacked and combined, flexibly enabled per scenario via the `checkpoints` configuration.

### S2 Data Flow: Desensitized Forwarding

```
User Message (containing PII)
    │
    ▼
Local LLM Detection → S2
    │
    ▼
Local LLM Extracts PII → JSON Array
    │
    ▼
Programmatic PII Replacement → [REDACTED:PHONE], [REDACTED:ADDRESS]
    │
    ▼
Privacy Proxy (localhost:8403)
    ├── Strips PII markers
    ├── Forwards to cloud model
    └── Passes through response (supports SSE streaming)
```

### S3 Data Flow: Fully Local Processing

```
User Message (containing private data)
    │
    ▼
Detection → S3
    │
    ▼
Forward to Local Guard Agent
    ├── Uses local LLM (Ollama / vLLM)
    ├── Full data visible, entirely local inference
    └── Cloud-side history only receives 🔒 placeholder
```

### Dual-Track Memory & Dual-Track Sessions

```
~/.openclaw/workspace/
├── MEMORY.md           ← What the cloud model sees (auto-desensitized)
├── MEMORY-FULL.md      ← What the local model sees (complete data)
│
agents/{id}/sessions/
├── full/               ← Complete history (including Guard Agent interactions)
└── clean/              ← Clean history (for cloud model consumption)
```

The cloud model **never sees** `MEMORY-FULL.md` or `sessions/full/` — the Hook system intercepts at the file access layer.

### Security Guarantees

**Theorem 1 (Cloud-Side Invisibility)**: For any S3-level data _x_, its original content is completely invisible to the cloud:

<p align="center">∀ <i>x</i>, &nbsp; Detect(<i>x</i>) = S₃ &nbsp;⟹&nbsp; <i>x</i> ∉ Cloud(<i>x</i>)</p>

**Theorem 2 (Desensitization Completeness)**: For any S2-level data _x_, the cloud-visible form contains none of the original privacy entity values:

<p align="center">∀ <i>x</i>, &nbsp; Detect(<i>x</i>) = S₂ &nbsp;⟹&nbsp; ∀ (<i>t<sub>i</sub></i>, <i>v<sub>i</sub></i>) ∈ Extract(<i>x</i>), &nbsp; <i>v<sub>i</sub></i> ∉ Cloud(<i>x</i>)</p>

---

## 💰 Feature Two: Cost-Aware Collaboration

### Why Cost-Aware Collaboration?

In a typical AI coding assistant workflow, most requests involve browsing files, reading code, and simple Q&A — using the most expensive model for these tasks is pure waste. Cost-Aware Collaboration uses a local small model as an LLM-as-Judge, classifying requests by complexity and routing them to cloud models at different price tiers.

| Complexity    | Task Examples                                                  | Default Target Model |
| ------------- | -------------------------------------------------------------- | -------------------- |
| **SIMPLE**    | Queries, translation, formatting, greetings                    | `gpt-4o-mini`        |
| **MEDIUM**    | Code generation, single-file editing, email drafting           | `gpt-4o`             |
| **COMPLEX**   | System design, multi-file refactoring, cross-document analysis | `claude-sonnet-4.6`  |
| **REASONING** | Mathematical proofs, formal logic, experiment design           | `o4-mini`            |

### Why LLM-as-Judge Instead of Keyword Rules?

| Approach         | Pros                                     | Cons                                                |
| ---------------- | ---------------------------------------- | --------------------------------------------------- |
| Keyword Rules    | Fast                                     | No semantic understanding, high false-positive rate |
| **LLM-as-Judge** | **Semantic understanding, multilingual** | One additional local model call (~1–2s)             |

The Judge runs on a local small model (e.g., MiniCPM-4.1 / Qwen3.5), with latency of approximately 1–2 seconds.

### Smart Caching

Prompt hash caching (SHA-256, TTL 5 minutes) — identical requests are not re-judged, further reducing latency overhead.

### How Much Do You Save?

In a typical coding assistant workflow, Cost-Aware Collaboration can route **60–80% of requests** to cheaper models.

---

## 🚀 Composable Router Pipeline

Security collaboration and cost-aware collaboration run in the **same pipeline**, working together via weights and a two-phase short-circuit strategy:

```
User Message
    │
    ▼
RouterPipeline.run()
    │
    ├── Phase 1: Fast routers (weight ≥ 50) run in parallel
    │       └── security router → three-tier sensitivity detection
    │
    ├── Short-circuit: If Phase 1 detects sensitive data → skip Phase 2
    │
    └── Phase 2: Slow routers (weight < 50) run on demand
            └── cost-aware router → LLM Judge task complexity classification
```

**Design Philosophy**: Security first — the security router runs first with high weight. If sensitive data is found, it short-circuits immediately without wasting time on complexity judgment. Cost-aware collaboration kicks in only after the security check passes (S1).

### End-to-End Pipeline Formalization

```
                                                    ⎧ θ_cloud(m)        if a = passthrough
m ─[c_msg]→ Detect(m) → l ─[c_route]→ R(l) → a → ⎨ θ_cloud(De(m))    if a = desensitize
                                                    ⎩ θ_local(m)        if a = redirect

  ─[c_persist]→ W(m, l) ─[c_end]→ Sync
```

### 10 Hooks Covering the Complete Lifecycle

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

---

## 📦 Installation

We provide two installation methods: from source (recommended) and local LLM environment setup.

### Method 1: Install from Source

```bash
git clone https://github.com/openbmb/edgeclaw.git
cd edgeclaw

pnpm install
pnpm build
pnpm ui:build
pnpm openclaw onboard --install-daemon
```

### Method 2: Local LLM Environment

EdgeClaw requires a local inference backend for privacy detection and the Guard Agent. We recommend Ollama:

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Pull the recommended model
ollama pull openbmb/minicpm4.1

# Start the service
ollama serve
```

All OpenAI-compatible APIs are also supported, including vLLM, LMStudio, SGLang, TGI, etc. See `config.example.json` for backend configuration examples.

### Verify Installation

```bash
pnpm openclaw gateway run
```

If you see the GuardClaw plugin loading logs, the installation was successful.

---

## 🚀 Quick Start

### 1. Enable the GuardClaw Plugin

Add the following to `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "GuardClaw": {
        "enabled": true,
        "config": {
          "privacy": {
            "enabled": true,
            "localModel": {
              "enabled": true,
              "provider": "ollama",
              "model": "openbmb/minicpm4.1",
              "endpoint": "http://localhost:11434"
            },
            "guardAgent": {
              "id": "guard",
              "workspace": "~/.openclaw/workspace-guard",
              "model": "ollama/openbmb/minicpm4.1"
            }
          }
        }
      }
    }
  }
}
```

### 2. Configure the Guard Agent

Register the Guard Agent in the `agents` section of `openclaw.json`:

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "~/.openclaw/workspace-main",
        "subagents": { "allowAgents": ["guard"] }
      },
      {
        "id": "guard",
        "workspace": "~/.openclaw/workspace-guard",
        "model": "ollama/openbmb/minicpm4.1"
      }
    ]
  }
}
```

### 3. Launch

```bash
pnpm openclaw gateway run
```

EdgeClaw automatically intercepts and routes — no modifications to any business logic required.

### 4. (Optional) Enable Cost-Aware Collaboration

Enable it in `privacy.routers`:

```json
{
  "privacy": {
    "routers": {
      "token-saver": {
        "enabled": true,
        "weight": 30,
        "options": {
          "tiers": {
            "SIMPLE": { "provider": "openai", "model": "gpt-4o-mini" },
            "MEDIUM": { "provider": "openai", "model": "gpt-4o" },
            "COMPLEX": { "provider": "anthropic", "model": "claude-sonnet-4.6" },
            "REASONING": { "provider": "openai", "model": "o4-mini" }
          }
        }
      }
    }
  }
}
```

---

## 🎬 Demo

<div align="center">
  <a href="https://youtu.be/xggfxybLVHw"><img src="https://img.youtube.com/vi/xggfxybLVHw/maxresdefault.jpg" width="70%"></a>
</div>

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

The EdgeClaw collaboration pipeline is fully extensible — implement the `GuardClawRouter` interface to inject custom collaboration logic:

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

Edit the Markdown files under `extensions/guardclaw/prompts/` to adjust behavior — no code changes needed:

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
extensions/guardclaw/
├── index.ts                    # Plugin entry point
├── openclaw.plugin.json        # Plugin metadata
├── config.example.json         # Configuration example
│
├── src/
│   ├── detector.ts             # Detection engine (coordinates dual detectors)
│   ├── rules.ts                # Rule detector (keywords + regex)
│   ├── local-model.ts          # Local LLM detector + desensitization engine
│   ├── router-pipeline.ts      # Router pipeline (two-phase + weighted merge)
│   ├── hooks.ts                # 10 Hooks
│   ├── privacy-proxy.ts        # HTTP privacy proxy
│   ├── guard-agent.ts          # Guard Agent management
│   ├── session-state.ts        # Session privacy state
│   ├── session-manager.ts      # Dual-track session history
│   ├── memory-isolation.ts     # Dual-track memory management
│   └── routers/
│       ├── privacy.ts          # Privacy router (security)
│       └── token-saver.ts      # Cost-Aware router (cost savings)
│
├── prompts/                    # Customizable prompt templates
│   ├── detection-system.md
│   ├── guard-agent-system.md
│   └── token-saver-judge.md
│
└── test/                       # Test suite
    ├── rules.test.ts
    ├── detector.test.ts
    ├── router-pipeline.test.ts
    ├── token-saver.test.ts
    ├── privacy-proxy.test.ts
    └── integration.test.ts
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

### License

MIT
