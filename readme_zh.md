<div align="center">
  <img src="./assets/EdgeClaw-logo.png" alt="EdgeClaw Logo" width="25%"></img>
</div>

<h3 align="center">
安全 · 省钱 · 高效
</h3>

<p align="center">
  端云协同的AI智能体<br>
  <b>EdgeClaw</b>：让敏感数据绝不上云，让便宜模型承担 80% 请求
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/openbmb/edgeclaw"><img src="https://img.shields.io/github/stars/openbmb/edgeclaw?style=for-the-badge" alt="Stars"></a>
  <a href="https://github.com/openbmb/edgeclaw/issues"><img src="https://img.shields.io/github/issues/openbmb/edgeclaw?style=for-the-badge" alt="Issues"></a>
</p>

<p align="center">
    【中文 | <a href="./README.md"><b>English</b></a>】
</p>

---

**最新动态** 🔥

- **[2026.03.13]** 🎉 EdgeClaw 新增成本感知协同：自动判断任务复杂度，为云端匹配最经济的模型
- **[2026.02.12]** 🎉 EdgeClaw 正式开源，端云协同 AI 智能体

---

## 💡 关于 EdgeClaw

EdgeClaw 是一个**端云协同的 AI 智能体**，由 [THUNLP（清华大学）](https://nlp.csai.tsinghua.edu.cn)、[中国人民大学](http://ai.ruc.edu.cn/)、[AI9Stars](https://github.com/AI9Stars)、[面壁智能（ModelBest）](https://modelbest.cn/en) 和 [OpenBMB](https://www.openbmb.cn/home) 联合开发，构建于 [OpenClaw](https://github.com/openclaw/openclaw) 之上。

当下 AI Agent 架构中，端侧长期被忽视——所有数据与任务一股脑涌向云端，隐私泄露与算力浪费由此而生。EdgeClaw 重新激活端侧的价值，构建可自定义的三级安全体系（S1 直通 / S2 脱敏 / S3 本地），通过端侧双引擎（规则检测 ~0ms + 本地 LLM 语义检测 ~1-2s）实时判别每条请求的敏感度与复杂度，再经统一可组合管线，将其转发至隐私安全与性价比最合适的处理路径。配合端云协同的智能转发能力，开发者无需修改业务逻辑，即可在 EdgeClaw 中实现“公开数据上云、敏感数据脱敏、私密数据落地”的无感端云协同隐私保护与性价比节省。

<div align="center">
  <img src="./assets/EdgeClaw-arch.png" alt="EdgeClaw Architecture" width="90%"></img>
</div>

---

## ✨ 核心亮点

<table>
<tr>
<td width="50%">

**🤝 端云各有分工**

端侧负责感知数据属性（敏感度、复杂度），云端负责推理和生成。端侧补云端的盲区（敏感数据不上云），云端补端侧的短板（做不了的复杂任务交给云）。

</td>
<td width="50%">

**🔒 三级安全协同模式**

安全数据（S1）——直接上云；敏感数据（S2）——端侧脱敏后转发云端推理；私密数据（S3）——端侧独立处理，云端仅维持上下文连贯。

</td>
</tr>
<tr>
<td width="50%">

**💰 性价比感知协同**

本地 LLM 语义判断任务复杂度，简单任务转发到便宜模型，只在复杂任务上用贵模型。典型工作流下 60–80% 的请求被转发到低价模型，大幅削减云端 token 开支。

</td>
<td width="50%">

**🚀 即插即用，一行不改**

EdgeClaw 通过 Hook 机制自动拦截和转发，无需修改任何业务逻辑代码，可无缝替换 OpenClaw。

</td>
</tr>
</table>

---

## 🔒 三级安全协同模式

### 三级灵敏度分类

每条用户消息、工具调用、工具结果都经过实时检测，自动分为三个等级：

| 等级   | 含义 | 转发策略       | 示例                   |
| ------ | ---- | -------------- | ---------------------- |
| **S1** | 安全 | 直接发云侧模型 | "写一首春天的诗"       |
| **S2** | 敏感 | 脱敏后转发云侧 | 地址、电话、邮箱       |
| **S3** | 私密 | 仅本地模型处理 | 工资单、密码、SSH 密钥 |

### 双检测引擎

| 引擎                | 机制                       | 延迟  | 覆盖场景                                    |
| ------------------- | -------------------------- | ----- | ------------------------------------------- |
| **规则检测器**      | 关键词 + 正则匹配          | ~0ms  | 已知模式：API Key、数据库连接串、PEM 密钥头 |
| **本地 LLM 检测器** | 语义理解（跑在本地小模型） | ~1-2s | 上下文推理："帮我分析这张工资单"、中文地址  |

两个引擎可组合叠加，通过 `checkpoints` 配置按场景灵活启用。

### S2 数据流：脱敏转发

```
User Message (含 PII)
    │
    ▼
本地 LLM 检测 → S2
    │
    ▼
本地 LLM 提取 PII → JSON 数组
    │
    ▼
编程替换 PII → [REDACTED:PHONE], [REDACTED:ADDRESS]
    │
    ▼
Privacy Proxy (localhost:8403)
    ├── 剥离 PII 标记
    ├── 转发到云侧模型
    └── 透传响应 (支持 SSE streaming)
```

### S3 数据流：完全本地处理

```
User Message (含私密数据)
    │
    ▼
检测 → S3
    │
    ▼
转发到本地 Guard Agent
    ├── 使用本地 LLM（Ollama / vLLM）
    ├── 完整数据可见，全本地推理
    └── 云侧历史只写入 🔒 占位符
```

### 双轨记忆 & 双轨会话

```
~/.openclaw/workspace/
├── MEMORY.md           ← 云侧模型看到的（自动脱敏）
├── MEMORY-FULL.md      ← 本地模型看到的（完整数据）
│
agents/{id}/sessions/
├── full/               ← 完整历史（含 Guard Agent 交互）
└── clean/              ← 清洁历史（供云侧模型使用）
```

云侧模型**永远看不到** `MEMORY-FULL.md` 和 `sessions/full/`，由 Hook 系统在文件访问层拦截。

### 安全保证

**定理 1（云侧不可见性）**：对任意 S3 级数据 _x_，其原始内容在云侧完全不可见：

<p align="center">∀ <i>x</i>, &nbsp; Detect(<i>x</i>) = S₃ &nbsp;⟹&nbsp; <i>x</i> ∉ Cloud(<i>x</i>)</p>

**定理 2（脱敏完整性）**：对任意 S2 级数据 _x_，其云侧可见形式不包含原始隐私实体值：

<p align="center">∀ <i>x</i>, &nbsp; Detect(<i>x</i>) = S₂ &nbsp;⟹&nbsp; ∀ (<i>t<sub>i</sub></i>, <i>v<sub>i</sub></i>) ∈ Extract(<i>x</i>), &nbsp; <i>v<sub>i</sub></i> ∉ Cloud(<i>x</i>)</p>

---

## 💰 功能二：性价比感知协同

### 为什么需要性价比感知协同？

在典型的 AI 编程助手工作流中，大部分请求是查文件、看代码、简单问答——用最贵的模型处理这些任务纯属浪费。性价比感知协同用本地小模型做 LLM-as-Judge，把请求按复杂度分级转发到不同价位的云侧模型。

| 复杂度        | 任务示例                         | 默认目标模型        |
| ------------- | -------------------------------- | ------------------- |
| **SIMPLE**    | 查询、翻译、格式化、打招呼       | `gpt-4o-mini`       |
| **MEDIUM**    | 代码生成、单文件编辑、邮件撰写   | `gpt-4o`            |
| **COMPLEX**   | 系统设计、多文件重构、跨文档分析 | `claude-sonnet-4.6` |
| **REASONING** | 数学证明、形式逻辑、实验设计     | `o4-mini`           |

### 为什么用 LLM-as-Judge 而不用关键词规则？

| 方案             | 优点                     | 缺点                        |
| ---------------- | ------------------------ | --------------------------- |
| 关键词规则       | 快                       | 不理解语义，误判率高        |
| **LLM-as-Judge** | **理解语义，多语言通用** | 多一次本地模型调用（~1-2s） |

Judge 跑在本地小模型上（如 MiniCPM-4.1 / Qwen3.5），延迟约 1-2 秒。

### 智能缓存

Prompt 哈希缓存（SHA-256，TTL 5 分钟），相同请求不重复 Judge，进一步降低延迟开销。

### 省多少？

以典型编程助手工作流为例，Token-Saver 可将 **60–80% 的请求** 转发到更便宜的模型。

---

## 🚀 可组合路由管线

安全协同和性价比感知协同运行在**同一管线**中，通过权重和两阶段短路策略协同工作：

```
User Message
    │
    ▼
RouterPipeline.run()
    │
    ├── Phase 1: 快速路由器 (weight ≥ 50) 并行执行
    │       └── security router → 三级灵敏度检测
    │
    ├── 短路判断: 若 Phase 1 发现敏感数据 → 跳过 Phase 2
    │
    └── Phase 2: 慢速路由器 (weight < 50) 按需执行
            └── cost-aware router → LLM Judge 任务复杂度分类
```

**设计哲学**：安全优先——安全路由器高权重先跑，有敏感数据就直接短路处理，不浪费时间再判断复杂度。只有安全通过（S1）后，才启动性价比感知协同优化成本。

### 端到端管线形式化

```
                                                    ⎧ θ_cloud(m)        if a = passthrough
m ─[c_msg]→ Detect(m) → l ─[c_route]→ R(l) → a → ⎨ θ_cloud(De(m))    if a = desensitize
                                                    ⎩ θ_local(m)        if a = redirect

  ─[c_persist]→ W(m, l) ─[c_end]→ Sync
```

### 10 个 Hook 覆盖完整生命周期

| Hook                   | 触发时机      | 核心职责                    |
| ---------------------- | ------------- | --------------------------- |
| `before_model_resolve` | 模型选择前    | 运行管线 → 路由决策         |
| `before_prompt_build`  | Prompt 构建前 | 注入 Guard Prompt / S2 标记 |
| `before_tool_call`     | 工具调用前    | 文件访问守卫 + 子代理守卫   |
| `after_tool_call`      | 工具调用后    | 工具结果检测                |
| `tool_result_persist`  | 结果持久化    | 双轨会话写入                |
| `before_message_write` | 消息写入前    | S3→占位符, S2→脱敏版        |
| `session_end`          | 会话结束      | 记忆同步                    |
| `message_sending`      | 出站消息      | 检测并脱敏/取消             |
| `before_agent_start`   | 子代理启动前  | 任务内容守卫                |
| `message_received`     | 收到消息      | 观察性日志                  |

---

## 📦 安装

我们提供两种安装方式：源码安装（推荐）和本地 LLM 环境配置。

### 方式一：源码安装

```bash
git clone https://github.com/openbmb/edgeclaw.git
cd edgeclaw

pnpm install
pnpm build
pnpm ui:build
pnpm openclaw onboard --install-daemon
```

### 方式二：本地 LLM 环境

EdgeClaw 需要一个本地推理后端用于隐私检测和 Guard Agent。推荐 Ollama：

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# 拉取推荐模型
ollama pull openbmb/minicpm4.1

# 启动服务
ollama serve
```

也支持 vLLM、LMStudio、SGLang、TGI 等所有 OpenAI 兼容 API。详见 `config.example.json` 中的各后端配置示例。

### 验证安装

```bash
pnpm openclaw gateway run
```

如果看到 GuardClaw 插件加载日志，说明安装成功。

---

## 🚀 快速开始

### 1. 启用 GuardClaw 插件

在 `openclaw.json` 中添加：

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

### 2. 配置 Guard Agent

在 `openclaw.json` 的 `agents` 中注册 Guard Agent：

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

### 3. 启动

```bash
pnpm openclaw gateway run
```

EdgeClaw 自动拦截和转发，无需修改任何业务逻辑。

### 4.（可选）启用 Token-Saver

在 `privacy.routers` 中开启：

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

## 🔧 自定义配置

### 检测规则自定义

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

### 检测器组合

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

### 自定义路由器

EdgeClaw 协同管线完全可扩展，实现 `GuardClawRouter` 接口即可注入自定义协同逻辑：

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

### Prompt 自定义

修改 `extensions/guardclaw/prompts/` 下的 Markdown 文件即可调整行为，无需改代码：

| 文件                    | 用途              |
| ----------------------- | ----------------- |
| `detection-system.md`   | S1/S2/S3 分类规则 |
| `guard-agent-system.md` | Guard Agent 行为  |
| `token-saver-judge.md`  | 任务复杂度分类    |

### Provider Preset 快速切换

内置预设支持一键切换本地模型 + 云侧模型组合：

| 预设            | 本地模型            | 云侧模型       | 适用场景                  |
| --------------- | ------------------- | -------------- | ------------------------- |
| `vllm-qwen35`   | vLLM / Qwen 3.5-35B | 同上（全本地） | 完全本地化，最大隐私      |
| `minimax-cloud` | vLLM / Qwen 3.5-35B | MiniMax M2.5   | 本地隐私检测 + 云侧主模型 |

也支持 Ollama、LMStudio、SGLang 等后端的自定义预设。

---

## 🏗️ 代码结构

```
extensions/guardclaw/
├── index.ts                    # 插件入口
├── openclaw.plugin.json        # 插件元数据
├── config.example.json         # 配置示例
│
├── src/
│   ├── detector.ts             # 检测引擎（协调双检测器）
│   ├── rules.ts                # 规则检测器（关键词 + 正则）
│   ├── local-model.ts          # 本地 LLM 检测器 + 脱敏引擎
│   ├── router-pipeline.ts      # 路由管线（两阶段 + 加权合并）
│   ├── hooks.ts                # 10 个 Hook
│   ├── privacy-proxy.ts        # HTTP 隐私代理
│   ├── guard-agent.ts          # Guard Agent 管理
│   ├── session-state.ts        # 会话隐私状态
│   ├── session-manager.ts      # 双轨会话历史
│   ├── memory-isolation.ts     # 双轨记忆管理
│   └── routers/
│       ├── privacy.ts          # 隐私路由器（安全）
│       └── token-saver.ts      # Token-Saver 路由器（省钱）
│
├── prompts/                    # 可自定义 Prompt 模板
│   ├── detection-system.md
│   ├── guard-agent-system.md
│   └── token-saver-judge.md
│
└── test/                       # 测试套件
    ├── rules.test.ts
    ├── detector.test.ts
    ├── router-pipeline.test.ts
    ├── token-saver.test.ts
    ├── privacy-proxy.test.ts
    └── integration.test.ts
```

---

## 🤝 Contributing

感谢所有贡献者的代码提交和测试。欢迎新成员加入，共同构建边端云协同 Agent 生态！

贡献流程：**Fork 本仓库 → 提交 Issues → 创建 Pull Requests（PRs）**

---

## ⭐ 支持我们

如果这个项目对你的研究或工作有帮助，请给一个 ⭐ 支持我们！

---

## 💬 联系我们

- 技术问题和功能请求请使用 [GitHub Issues](https://github.com/openbmb/edgeclaw/issues)

---

## 📖 相关引用

### 依赖项目

- [OpenClaw](https://github.com/openclaw/openclaw) — 基础 AI 助手框架
- [MiniCPM](https://github.com/OpenBMB/MiniCPM) — 推荐的本地检测模型
- [Ollama](https://ollama.ai) — 推荐的本地推理后端

### License

MIT
