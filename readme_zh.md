<div align="center">

<img src="./assets/EdgeClaw-logo.png" alt="EdgeClaw Logo" width="200">

### 安全 · 省钱 · 高效

端云协同 AI 智能体  
**EdgeClaw**：Claude Code 体验带到 OpenClaw

【中文 | **[English](./README.md)**】

👋 欢迎加入我们的社群交流讨论！

<a href="./assets/feishu-group.png"><img src="./assets/feishu-logo.png" width="16" height="16"> 飞书</a> &nbsp;|&nbsp; <a href="https://discord.com/invite/pC3N7ezpw"><img src="./assets/discord-logo.png" width="16" height="16"> Discord</a>

</div>

---

**最新动态** 🔥

- **[2026.04.02]** 🚀 发布三大针对 OpenClaw 优化的 Claude Code liked 特性 — 🤖 [ClawXKairos](./extensions/clawxkairos/)（自驱动 Agent 循环）、🛡️ [ClawXGovernor](./extensions/clawxgovernor/)（工具治理）以及 📦 [ClawXSandbox](./extensions/ClawXSandbox/)（Claude Code同款沙箱）
- **[2026.04.01]** 🎉 EdgeClaw 2.0 正式开源，携全新记忆引擎与省钱路由，把 CC 体验带到 OpenClaw！
- **[2026.04.01]** 🎉 [ClawXMemory](https://github.com/OpenBMB/ClawXMemory) 发布 — 参考 Claude Code memory 机制，针对 OpenClaw 场景提供更丝滑的体验，搭载多层结构化长期记忆与主动推理！
- **[2026.03.25]** 🎉 [ClawXRouter](https://github.com/OpenBMB/clawxrouter) 发布 — 5 级省钱路由 + 三级隐私协同 + 可视化 Dashboard
- **[2026.03.13]** 🎉 EdgeClaw 新增成本感知协同：自动判断任务复杂度，为云端匹配最经济的模型
- **[2026.02.12]** 🎉 EdgeClaw 正式开源，端云协同 AI 智能体

---

## 💡 关于 EdgeClaw

EdgeClaw 是一个**端云协同的 AI 智能体**，由 [THUNLP（清华大学）](https://nlp.csai.tsinghua.edu.cn)、[中国人民大学](http://ai.ruc.edu.cn/)、[AI9Stars](https://github.com/AI9Stars)、[面壁智能（ModelBest）](https://modelbest.cn/en) 和 [OpenBMB](https://www.openbmb.cn/home) 联合开发，构建于 [OpenClaw](https://github.com/openclaw/openclaw) 之上。

### OpenClaw vs Claude Code vs EdgeClaw

|                    | OpenClaw |     Claude Code     |         **EdgeClaw**          |
| ------------------ | :------: | :-----------------: | :---------------------------: |
| 跨会话项目知识保留 |    ✗     |          ✓          |             **✓**             |
| 用户偏好持续积累   |    ✗     |          ✓          |             **✓**             |
| 多层结构化长期记忆 |    ✗     |          ✓          |             **✓**             |
| 记忆融入策略       | 召回补充 |      按需读取       |         **主动推理**          |
| 记忆持续沉淀与归档 |    ✗     | Auto-Dream 后台整理 | **空闲 & 话题切换时自动整理** |
| 成本感知路由       |    ✗     |          ✗          |        **省 58% 成本**        |
| 三级隐私协同       |    ✗     |          ✗          |         **S1/S2/S3**          |
| 上下文工作集管理   |    ✗     |          ✓          |             **✓**             |
| 工具风险治理与审计 |    ✗     |          ✓          |             **✓**             |
| 自驱动 Agent 循环  |    ✗     |          ✓          |             **✓**             |
| 沙箱隔离执行       |    ✗     |          ✓          |             **✓**             |
| 可视化 Dashboard   |    ✗     |          ✗          |             **✓**             |

### ✨ 亮点速览

**🌟 Claude Code liked Feature**

- **🤖 自驱动循环** — [ClawXKairos](./extensions/clawxkairos/)：Tick 调度 + Sleep 工具 + 后台命令自动化 + 异步子代理，agent 自主持续工作
- **🛡️ 工具治理** — [ClawXGovernor](./extensions/clawxgovernor/)：三个 Hook 中间件——上下文 tail-window 裁剪、工具调用风险拦截与审计、会话笔记增量追加， 针对 OpenClaw 场景深度优化，**30 轮调用节省 85% Token**
- **📦 沙箱执行** — [ClawXSandbox](./extensions/ClawXSandbox/)：基于系统级沙箱（bwrap / sandbox-exec）实现完全隔离的本地执行环境。主打**轻量、快速、零依赖**，彻底免除 Docker 带来的所有开销。

**🔥 其他核心特性**

- **🧠 记忆引擎** — [ClawXMemory](https://github.com/OpenBMB/ClawXMemory)：面向 OpenClaw 打造的结构化长期记忆引擎，在借鉴 Claude Code 记忆机制思路的基础上，进一步构建了多层结构化记忆与模型驱动的记忆检索机制
- **💰 省钱路由** — [ClawXRouter](https://github.com/openbmb/clawxrouter)：LLM-as-Judge 自动判断复杂度，60–80% 的请求路由到便宜模型，PinchBench 实测省 **58% 成本**，分数还高 **6.3%**
- **🔒 三级隐私** — S1 直连云端 / S2 脱敏转发 / S3 完全本地处理，敏感数据不出端
- **🚀 零配置** — `pnpm build && node openclaw.mjs gateway run`，首次启动自动生成配置，填入 API Key 即用
- **📊 双 Dashboard** — ClawXRouter 路由配置热更新 + ClawXMemory 记忆画布可视化

---

## 🎬 Demo

<div align="center">
  <video src="https://github.com/user-attachments/assets/39487ce8-fc8e-4dd8-8182-27b130ba15f3" width="70%" controls></video>
</div>

---

## 📦 快速开始

### 1. 构建

```bash
git clone https://github.com/openbmb/edgeclaw.git
cd edgeclaw

pnpm install
pnpm build
```

### 2. 启动

```bash
node openclaw.mjs gateway run
```

> EdgeClaw 默认使用 `~/.edgeclaw/` 作为数据目录，与 OpenClaw (`~/.openclaw/`) 完全隔离。如需自定义路径，设置 `OPENCLAW_STATE_DIR` 环境变量。

**首次启动**自动生成完整配置骨架（`~/.edgeclaw/openclaw.json` + `clawxrouter.json`），内置 ClawXRouter 和 ClawXMemory 作为 bundled extension，无需手动安装插件。

### 3. 填入 API Key

生成的配置中 API Key 为空，填入后即可使用：

- **编辑配置文件**：修改 `~/.edgeclaw/openclaw.json` 中 `models.providers` 各 provider 的 `apiKey`
- **Dashboard 热更新**：访问 `http://127.0.0.1:18790/plugins/clawxrouter/stats`，在界面中直接修改，保存即时生效

> 提示：启动前设置 `EDGECLAW_API_KEY` 环境变量可自动填入。

### 4. 验证

```bash
node openclaw.mjs agent --local --agent main -m "你好"
```

看到 `[ClawXrouter] token-saver: S1 redirect →` 和 agent 回复即部署成功。

### Dashboard

| 面板                           | 地址                                               |
| ------------------------------ | -------------------------------------------------- |
| ClawXRouter（路由配置 & 统计） | `http://127.0.0.1:18790/plugins/clawxrouter/stats` |
| ClawXMemory（记忆可视化）      | `http://127.0.0.1:39394/clawxmemory/`              |

> 遇到问题？查看 [排查指南](troubleshooting_zh.md)

---

## 🧠 ClawXMemory — 多层级长期记忆系统

用过 Claude Code 的开发者都知道：真正让你离不开它的，不是某一次回答有多好，而是**它记得你**——记得你的代码风格、项目架构、上周的讨论、甚至你偏好的命名规范。

**[ClawXMemory](https://github.com/OpenBMB/ClawXMemory) 是首个将类 Claude Code 记忆能力带入 OpenClaw 生态的插件。**

| 核心记忆能力       | 标准 OpenClaw | Claude Code | ClawXMemory               |
| ------------------ | ------------- | ----------- | ------------------------- |
| 跨会话项目知识保留 | ✗             | ✓           | ✓                         |
| 用户偏好持续积累   | ✗             | ✓           | ✓                         |
| 多层结构化长期记忆 | ✗             | ✓           | ✓                         |
| 记忆融入策略       | 召回补充      | 按需读取    | 主动推理                  |
| 记忆持续沉淀与归档 | ✗             | Auto-Dream  | 空闲 & 话题切换时自动整理 |

### 三层记忆架构

系统在对话过程中自动蒸馏信息，逐层构建结构化记忆：

| 记忆层级   | 类型                  | 说明                                   |
| ---------- | --------------------- | -------------------------------------- |
| **L2**     | 项目记忆 / 时间线记忆 | 围绕特定主题或时间线聚合的高层长期记忆 |
| **L1**     | 记忆片段              | 对已结束话题提炼的结构化核心摘要       |
| **L0**     | 原始对话              | 最底层的原始消息记录                   |
| **Global** | 用户画像              | 持续更新的全局用户偏好单例             |

当模型需要回忆时，**主动沿"记忆树"推理导航**——先从高层记忆（项目/时间线/画像）评估相关性，不够才向下钻入更细粒度的片段，必要时追溯到具体对话。这比传统向量检索更接近人类专家的逐层推理方式。

### 核心特性

- **自动记忆构建**：无需手动维护，对话中自动蒸馏、聚合、更新
- **模型驱动检索**：用推理替代匹配，真正理解"这个项目进展如何？"这样的模糊问题
- **记忆可视化 Dashboard**：画布视图与列表视图，记忆层级与关联关系一目了然
- **本地存储，隐私安全**：默认 SQLite，数据不上云，支持一键导入导出

> 详细文档请参见 [ClawXMemory README](https://github.com/OpenBMB/ClawXMemory)。

---

## 🔌 ClawXRouter — 端云协同路由插件

[ClawXRouter](https://github.com/openbmb/clawxrouter) 是 EdgeClaw 的路由大脑——端侧感知数据属性（敏感度、复杂度），云端负责推理和生成。通过 Hook 机制自动拦截和转发，无需修改任何业务代码，可无缝替换 OpenClaw。

### 性价比感知路由（Token-Saver）

大部分请求是查文件、看代码、简单问答——用最贵的模型处理这些纯属浪费。Token-saver 用 LLM-as-Judge 把请求按复杂度分级，自动路由到最经济的模型：

| 复杂度        | 任务示例                         | 默认目标模型        |
| ------------- | -------------------------------- | ------------------- |
| **SIMPLE**    | 查询、翻译、格式化、打招呼       | `gpt-4o-mini`       |
| **MEDIUM**    | 代码生成、单文件编辑、邮件撰写   | `gpt-4o`            |
| **COMPLEX**   | 系统设计、多文件重构、跨文档分析 | `claude-sonnet-4.6` |
| **REASONING** | 数学证明、形式逻辑、实验设计     | `o4-mini`           |

| 方案             | 优点                     | 缺点                        |
| ---------------- | ------------------------ | --------------------------- |
| 关键词规则       | 快                       | 不理解语义，误判率高        |
| **LLM-as-Judge** | **理解语义，多语言通用** | 多一次本地模型调用（~1-2s） |

Judge 跑在本地小模型上（MiniCPM-4.1 / Qwen3.5），配合 Prompt 哈希缓存（SHA-256，TTL 5 min），相同请求不重复判断。典型工作流下 **60–80% 的请求** 被转发到更便宜的模型。

### 三级安全协同（Privacy Router）

每条消息、工具调用、工具结果都经过实时检测，自动分为三个等级：

| 等级   | 含义 | 转发策略       | 示例                   |
| ------ | ---- | -------------- | ---------------------- |
| **S1** | 安全 | 直接发云侧模型 | "写一首春天的诗"       |
| **S2** | 敏感 | 脱敏后转发云侧 | 地址、电话、邮箱       |
| **S3** | 私密 | 仅本地模型处理 | 工资单、密码、SSH 密钥 |

**双检测引擎**：规则检测器（关键词 + 正则，~0ms）+ 本地 LLM 检测器（语义理解，~1-2s），两者可组合叠加。

**S2 脱敏转发**：

```
User Message (含 PII) → 本地 LLM 检测 → S2 → 提取 PII → 替换为 [REDACTED:*]
    → Privacy Proxy → 剥离标记 → 转发云侧 → 透传 SSE 响应
```

**S3 完全本地**：转发到本地 Guard Agent（Ollama / vLLM），云侧历史只写入占位符。

**双轨记忆 & 双轨会话**：

```
~/.edgeclaw/workspace/
├── MEMORY.md           ← 云侧模型看到的（自动脱敏）
├── MEMORY-FULL.md      ← 本地模型看到的（完整数据）
│
agents/{id}/sessions/
├── full/               ← 完整历史（含 Guard Agent 交互）
└── clean/              ← 清洁历史（供云侧模型使用）
```

云侧模型**永远看不到** `MEMORY-FULL.md` 和 `sessions/full/`，由 Hook 系统在文件访问层拦截。

### 可组合路由管线

安全路由与性价比路由运行在**同一管线**中，通过权重和两阶段短路策略协同工作：

```
User Message
    │
    ▼
RouterPipeline.run()
    │
    ├── Phase 1: 快速路由器 (weight ≥ 50) 并行执行
    │       └── privacy router → 三级灵敏度检测
    │
    ├── 短路判断: 若 Phase 1 发现敏感数据 → 跳过 Phase 2
    │
    └── Phase 2: 慢速路由器 (weight < 50) 按需执行
            └── token-saver → LLM Judge 复杂度分类
```

安全优先——安全路由器高权重先跑，有敏感数据就直接短路处理。只有安全通过（S1）后，才启动性价比路由优化成本。

### 13 个 Hook 覆盖完整生命周期

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

> 详细文档请参见 [ClawXRouter README](https://github.com/openbmb/clawxrouter)。

---

### 使用模式

**模式一：Token-Saver 省钱模式（默认）** — 填入 API Key 即开箱可用，ClawXRouter 自动把请求路由到最经济的模型。Tiers 可在 `openclaw.json` 或 Dashboard 中自定义。

**模式二：隐私 + 省钱双路由** — 在 `~/.edgeclaw/clawxrouter.json` 中启用 privacy 路由器，需本地 LLM 后端（Ollama / vLLM）：

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

ClawXRouter 管线完全可扩展，实现 `GuardClawRouter` 接口即可注入自定义路由逻辑：

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

修改 `extensions/clawxrouter/prompts/` 下的 Markdown 文件即可调整行为，无需改代码：

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
EdgeClaw/
├── openclaw.mjs                         # CLI 入口
├── src/config/
│   ├── edgeclaw-defaults.ts             # EdgeClaw 默认配置模板（自动种子）
│   ├── paths.ts                         # 状态目录/端口解析（18790）
│   └── io.ts                            # 配置加载（含自动种子逻辑）
├── scripts/
│   ├── deploy-edgeclaw.sh               # 一键部署脚本
│   └── lib/optional-bundled-clusters.mjs # 构建排除清单（guardclaw）
│
├── extensions/
│   ├── clawxrouter/                     # [内置] ClawXRouter 省钱路由
│   │   ├── index.ts                     # 插件入口
│   │   ├── src/
│   │   │   ├── router-pipeline.ts       # 路由管线（两阶段 + 加权合并）
│   │   │   ├── hooks.ts                 # 13 个 Hook
│   │   │   ├── privacy-proxy.ts         # HTTP 隐私代理
│   │   │   ├── config-schema.ts         # 默认配置 schema
│   │   │   ├── live-config.ts           # 配置热更新
│   │   │   ├── stats-dashboard.ts       # 可视化 Dashboard
│   │   │   └── routers/
│   │   │       ├── privacy.ts           # 隐私路由器（安全）
│   │   │       └── token-saver.ts       # 性价比感知路由器（省钱）
│   │   └── prompts/                     # 可自定义 Prompt 模板
│   │
│   ├── openbmb-clawxmemory/             # [内置] ClawXMemory 长期记忆
│   │   ├── src/
│   │   │   ├── index.ts                 # 插件入口
│   │   │   ├── core/                    # L0/L1/L2 三层记忆引擎
│   │   │   └── tools.ts                 # memory_overview / memory_list / memory_flush
│   │   └── ui-source/                   # Dashboard 前端
│   │
│   ├── clawxkairos/                     # [内置] ClawXKairos 自驱动循环
│   │   ├── index.ts                     # 插件入口
│   │   └── src/
│   │       ├── tick-scheduler.ts        # Tick 调度（agent_end → requestHeartbeatNow）
│   │       ├── sleep-tool.ts            # Sleep 工具（受控休眠）
│   │       ├── background-commands.ts   # 长命令自动后台化
│   │       ├── async-subagent.ts        # 异步子代理
│   │       ├── kairos-prompt.ts         # 自主模式系统提示注入
│   │       └── heartbeat-ack-guard.ts   # HEARTBEAT_OK 拦截 → 强制 Sleep
│   │
│   ├── ClawXSandbox/                    # [内置] ClawXSandbox 系统级沙箱
│   │   ├── src/
│   │   │   ├── index.ts                # 插件入口
│   │   │   ├── bwrap-backend.ts        # bwrap/sandbox-exec 沙箱后端
│   │   │   ├── fs-bridge.ts            # 文件系统桥接
│   │   │   └── config.ts              # 沙箱配置
│   │   └── tests/                      # 单元测试
│   │
# 插件入口
│   │   └── src/
│   │       ├── backend.ts              # SSH 沙箱后端
│   │       ├── mirror.ts              # 本地-远程工作区镜像
│   │       ├── fs-bridge.ts           # 文件系统桥接
│   │       └── config.ts             # 沙箱配置
│   │
│   ├── guardclaw/                       # [可选] 隐私守卫（默认构建时排除）
│   │
│   └── clawxgovernor/                   # [内置] ClawXGovernor 工具治理
│       ├── index.ts                     # 统一入口（3 个 Hook 中间件）
│       ├── src/
│       │   ├── assembler.ts             # 上下文裁剪器（tail-window / compact / reinjection）
│       │   ├── tool-governor.ts         # 工具调用拦截器（风险分级 / block / 循环检测 / 审计）
│       │   └── session-memory.ts        # 会话笔记追加器（delta note / 轻量提示注入）
│       ├── mcp-server/                  # 状态查询接口（9 个调试工具）
│       └── skills/                      # 4 个 Agent Skills
│
└── ~/.edgeclaw/                         # 运行时状态目录（自动生成）
    ├── openclaw.json                    # 主配置（首次启动时自动种子）
    ├── clawxrouter.json                 # ClawXRouter 配置（自动生成）
    ├── clawxrouter-stats.json           # Token 统计
    ├── clawxmemory/                     # ClawXMemory SQLite 数据
    ├── clawxgovernor/
    │   ├── context-state.json           # 上下文引擎状态
    │   ├── audit.jsonl                  # 工具审计日志
    │   └── notes/                       # 会话笔记
    └── workspace-main/                  # Agent 工作区
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

### 生态项目

- [ClawXRouter](https://github.com/openbmb/clawxrouter) — 端云协同路由插件（隐私路由 + 成本感知路由 + Dashboard）
- [ClawXMemory](https://github.com/OpenBMB/ClawXMemory) — 面向长期上下文的多层记忆系统
- [ClawXGovernor](./extensions/clawxgovernor/) — 工具治理（上下文裁剪 + 工具调用拦截与审计 + 会话笔记），EdgeClaw 内置 extension
- [ClawXKairos](./extensions/clawxkairos/) — 自驱动 Agent 循环（Tick 调度 + Sleep + 后台命令 + 异步子代理）
- [ClawXSandbox](./extensions/ClawXSandbox/) — 基于系统级沙箱（bwrap / sandbox-exec）的轻量零依赖隔离执行环境

### License

MIT
