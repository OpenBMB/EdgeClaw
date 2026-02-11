# EdgeClaw: Edge-Cloud Collaborative AI Agent Safety Guardrails

<div align="center">
  <img src="../assets/EdgeClaw-logo.png" alt="EdgeClaw Logo" width="400em"></img>
</div>

<p align="center">
    【<a href="./readme_zh.md"><b>中文</b></a> | English】
</p>

## News

- [2026-02-12] 🚀🚀🚀 We open-source EdgeClaw, an edge-cloud collaborative AI agent safety guardrail

## Overview

EdgeClaw is an open-source edge-cloud collaborative safety solution for AI agents, jointly developed by THUNLP, RUC BM (Renmin University of China), and ModelBest, built on top of OpenClaw.

Designed to tackle the AI Agent data leakage challenge, EdgeClaw provides a comprehensive, customizable three-tier security system (S1 passthrough / S2 desensitization / S3 local). It standardizes safety guardrails into a universal Guard Protocol (Hooker → Detector → Action). Combined with intelligent edge-cloud routing capabilities, developers can achieve seamless privacy protection — "public data to the cloud, private data stays local" — within OpenClaw without modifying any business logic, balancing the peak performance of large models with absolute security of sensitive data.

## Demo

<div align="center">
  <a href="https://www.bilibili.com/video/BV1DYkLBNE6f"><img src="https://i0.hdslb.com/bfs/archive/05f18d5914b8691316161021298a5b63da54eaeb.jpg", width=70%></a>
</div>

## Installation

Same as OpenClaw:

### 1. Clone the Repository

```bash
git clone https://github.com/openbmb/openclaw.git
cd openclaw
```

### 2. Install Dependencies + Build

```bash
pnpm install
pnpm build
pnpm ui:build
pnpm openclaw --install-daemon
```

### 3. Install the Extension

GuardClaw is included in the `extensions/guardclaw` directory. Enable it in your `openclaw.json` configuration:

```json

{
  "plugins": {
    "entries": {
      "guardclaw": {
        "enabled": true,
        "config": {
          "privacy": {...}
        }
      }
    }
  }
}
```

### 4. Configure Guard

Edit the `privacy` field under `plugins.entries.guardclaw.config` in `openclaw.json` (see the [Customization](#customization) section below for full details):

```json
{
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
```

Also, add a `list` field under the `agents` section in `openclaw.json`:

```json
"list": [
  {
    "id": "main",
    "workspace": "~/.openclaw/workspace-main",
    "subagents": {
      "allowAgents": ["guard"]
    }
  },
  {
    "id": "guard",
    "workspace": "~/.openclaw/workspace-guard",
    "model": "ollama/openbmb/minicpm4.1"
  }
]
```

5. Start Ollama

```bash
# Install Ollama (if not already installed)
# macOS: brew install ollama
# Linux: curl -fsSL https://ollama.ai/install.sh | sh

# Pull the model
ollama pull openbmb/minicpm4.1

# Start the service (default port 11434)
ollama serve
```

Then start OpenClaw as usual:

```bash
pnpm openclaw gateway run
```

GuardClaw will automatically intercept and route sensitive requests.

## Customization

GuardClaw supports custom configuration, rules, and more:

### JSON Configuration — Rules & Models

Edit the `privacy` field under `plugins.entries.guardclaw.config` in `openclaw.json`:

### Custom Detection Rules

```json
{
  "privacy": {
    "rules": {
      "keywords": {
        "S2": ["password", "api_key", "token", "credential"],
        "S3": ["ssh", "id_rsa", "private_key", ".pem", "master_password"]
      },
      "patterns": {
        "S2": [
          "\\b(?:10|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b",
          "(?:mysql|postgres|mongodb)://[^\\s]+"
        ],
        "S3": ["-----BEGIN (?:RSA |EC )?PRIVATE KEY-----", "AKIA[0-9A-Z]{16}"]
      },
      "tools": {
        "S2": {
          "tools": ["exec", "shell"],
          "paths": ["~/secrets", "~/private"]
        },
        "S3": {
          "tools": ["system.run", "sudo"],
          "paths": ["~/.ssh", "/etc", "~/.aws", "/root"]
        }
      }
    }
  }
}
```

### Custom Checkpoints & Detector Types

Control which detectors run at which stage:

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

- `ruleDetector` — Fast rule-based detection
- `localModelDetector` — LLM-based semantic understanding (~1–2s), recommended for `onUserMessage`

### Custom Models

```json
{
  "privacy": {
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
```

Any Ollama-compatible model is supported. Models with 8B+ parameters are recommended for classification accuracy.

### Custom Markdown Prompts — Classification & Behavior

Three Markdown files in the `prompts/` directory can be edited directly to change GuardClaw's behavior:

#### `prompts/detection-system.md` — Classification Rules

Controls how the LLM classifies S1/S2/S3. You can:

- Adjust classification criteria for each level
- Add specific sensitive data types
- Modify edge-case decision rules

#### `prompts/guard-agent-system.md` — Guard Agent Behavior

Controls how the S3 local model responds. You can:

- Adjust response style and verbosity
- Add domain-specific analysis instructions
- Modify language rules
- Integrate with the original OpenClaw system prompt, etc.

#### `prompts/pii-extraction.md` — Sensitive Information Extraction Rules

Controls which sensitive information types are extracted during S2 desensitization. You can:

- Add new sensitive information types (e.g., industry codes, internal IDs)
- Adjust extraction examples to improve accuracy

After modifying `.md` files, the built-in fallback mechanism ensures changes take effect on the next request — no restart needed.

## Guard Protocol Specification

Guard Protocol is a privacy-security middleware protocol for AI Agent frameworks, defining how sensitive data is detected, classified, and processed throughout the Agent lifecycle.

### Formal Definitions

#### Basic Sets

Let the following basic sets exist in an Agent system:

- Privacy level set $\mathcal{L} = \{S_1, S_2, S_3\}$, equipped with a total order $S_1 \prec S_2 \prec S_3$, where $S_1$ denotes no private data, $S_2$ denotes desensitizable private information, and $S_3$ denotes deeply private data.
- Checkpoint set $\mathcal{C} = \{c\_{\text{msg}},\; c\_{\text{route}},\; c\_{\text{tool\\_pre}},\; c\_{\text{tool\\_post}},\; c\_{\text{persist}},\; c\_{\text{end}}\}$, corresponding to the six lifecycle stages: message received, model routing, pre-tool-call, post-tool-call, result persistence, and session end.
- Detector set $\mathcal{D} = \{d\_{\text{rule}},\; d\_{\text{model}}\}$, where $d\_{\text{rule}}$ is a rule-based detector using regex and keywords, and $d\_{\text{model}}$ is a semantic detector based on a local language model.
- Action set $\mathcal{A} = \{\text{passthrough},\; \text{desensitize},\; \text{redirect}\}$, representing pass-through, desensitize-then-forward, and redirect-to-local-model respectively.

#### Definition 1: Detection Function

Each detector $d \in \mathcal{D}$ is defined as a function mapping context to a privacy level:

$$d : \mathcal{X} \to \mathcal{L}$$

where context $x \in \mathcal{X}$ may contain message content, tool call information, file contents, etc., depending on the checkpoint type. Specifically, the rule detector $d\_{\text{rule}}$ performs deterministic matching based on a predefined rule set $\mathcal{R} = \{r_l\}\_{l \in \mathcal{L}}$, and the model detector $d\_{\text{model}}$ uses a local LLM $\theta\_{\text{local}}$ for semantic classification.

At checkpoint $c \in \mathcal{C}$, the configuration function $\Phi(c) \subseteq \mathcal{D}$ returns the subset of detectors enabled for that checkpoint. All detectors run in parallel, and the aggregated result takes the highest level:

$$\text{Detect}(x, c) = \max\_{\preceq}\;\bigl\{d(x) \;\big|\; d \in \Phi(c)\bigr\}$$

#### Definition 2: Routing Function

The routing function $R$ maps detection results to the action space, determining how a message is processed:

$$R : \mathcal{L} \to \mathcal{A}$$

$$R(l) = \begin{cases} \text{passthrough} & \text{if } l = S_1 \\ \text{desensitize} & \text{if } l = S_2 \\ \text{redirect} & \text{if } l = S_3 \end{cases}$$

#### Definition 3: Desensitization Function

For $S_2$-level content, the desensitization function $\text{De}$ maps raw content containing private information to safe content:

$$\text{De} : \mathcal{M}\_{\text{raw}} \to \mathcal{M}\_{\text{safe}}$$

Constraint: all privacy entities in the original content $m$ are replaced with irreversible desensitization tokens, the output $\text{De}(m)$ contains no original private information, while preserving semantic usability.

#### Definition 4: Dual-Track Persistence

Define two history tracks $H\_{\text{full}}$ (complete) and $H\_{\text{clean}}$ (sanitized). The persistence function $W$ selects a write strategy based on the privacy level:

$$W(m, l) = \begin{cases} H\_{\text{full}} \leftarrow m, \quad H\_{\text{clean}} \leftarrow m & \text{if } l = S_1 \\ H\_{\text{full}} \leftarrow m, \quad H\_{\text{clean}} \leftarrow \text{De}(m) & \text{if } l = S_2 \\ H\_{\text{full}} \leftarrow m, \quad H\_{\text{clean}} \leftarrow \bot & \text{if } l = S_3 \end{cases}$$

where $\bot$ denotes a placeholder (e.g., 🔒 [Private content]).

The cloud model $\theta\_{\text{cloud}}$ can only see $H\_{\text{clean}}$, while the local model $\theta\_{\text{local}}$ can see $H\_{\text{full}}$:

$$\theta\_{\text{cloud}}.\text{context} = H\_{\text{clean}}, \quad \theta\_{\text{local}}.\text{context} = H\_{\text{full}}$$

#### Definition 5: Memory Synchronization

At session end, the synchronization function $\text{Sync}$ performs bidirectional updates between the dual-track memories $M\_{\text{full}}$ and $M\_{\text{clean}}$:

$$\text{Sync}: \quad M\_{\text{clean}} = \text{De}\bigl(\text{Filter}(M\_{\text{full}})\bigr)$$

where $\text{Filter}$ removes Guard Agent interaction content, and $\text{De}$ performs final desensitization on residual private information.

### End-to-End Pipeline

A user message $m$ passes through the full Guard Protocol processing pipeline:

$$m \xrightarrow{c\_{\text{msg}}} \text{Detect}(m) \to l \xrightarrow{c\_{\text{route}}} R(l) \to a \xrightarrow{} \begin{cases} \theta\_{\text{cloud}}(m) & a = \text{passthrough} \\ \theta\_{\text{cloud}}(\text{De}(m)) & a = \text{desensitize} \\ \theta\_{\text{local}}(m) & a = \text{redirect} \end{cases} \xrightarrow{c\_{\text{persist}}} W(m, l) \xrightarrow{c\_{\text{end}}} \text{Sync}$$

### Security Guarantees

Let $x$ be an arbitrary data unit (message $m$ or memory entry $e$), and $\text{Cloud}(x)$ denote the visible form of $x$ on the cloud side (including $\text{View}(\theta\_{\text{cloud}})$ and $M\_{\text{clean}}$).

**Theorem 1 (Cloud Invisibility):** For any $S_3$-level data unit $x$, its original content is completely invisible on the cloud side:

$$\forall x,\; \text{Detect}(x) = S_3 \implies x \notin \text{Cloud}(x)$$

**Theorem 2 (Desensitization Completeness):** For any $S_2$-level data unit $x$, its cloud-visible form contains no original privacy entity values:

$$\forall x,\; \text{Detect}(x) = S_2 \implies \forall (t_i, v_i) \in \text{Extract}(x),\; v_i \notin \text{Cloud}(x)$$

### Design Structure

#### Multi-Hooker

6 hooks cover the complete Agent lifecycle:

```

User Message  ──▶ ① message_received     Detect message sensitivity
                        │
              ② resolve_model             ★ Core routing: S1→cloud / S2→desensitize→cloud / S3→local
                        │
Tool Call     ──▶ ③ before_tool_call      Intercept sensitive paths/tools
                        │
Tool Result   ──▶ ④ after_tool_call       Detect returned content
                        │
Persistence   ──▶ ⑤ tool_result_persist   Write to dual-track history
                        │
Session End   ──▶ ⑥ session_end           Synchronize memory files
```

#### Dual Session

```
~/.openclaw/agents/main/sessions/
├── full/                    ← Complete history (local model + audit)
│   └── session-abc.jsonl       All messages, including local model interactions
└── clean/                   ← Sanitized history (cloud model)
    └── session-abc.jsonl       Sensitive content filtered out
```

- Normal messages → written to both full + clean
- Sensitive messages → written to full only, invisible in clean
- Cloud model loads clean history, local model loads full history

#### Dual Memory

```
workspace/
├── MEMORY.md           ← Visible to cloud model (filtered)
├── MEMORY-FULL.md      ← Visible to local model (complete)
├── memory/             ← Cloud memory directory
└── memory-full/        ← Local memory directory
```

Automatic synchronization at session end: `MEMORY-FULL.md` → filter sensitive content → `MEMORY.md`

### License

MIT

### Contributing

Thanks to all contributors for their efforts in code submissions and testing. We welcome new members to join and build a robust edge-cloud collaborative agent ecosystem together!

### Contact Us

- For technical issues and feature requests, please use GitHub Issues.
- If you have any questions, feedback, or would like to get in touch, feel free to email us at yanyk.thu@gmail.com.
