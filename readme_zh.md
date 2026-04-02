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

- **[2026.04.02]** 🚀 发布三大针对 OpenClaw 优化的 Claude Code liked 特性 — 🤖 [ClawXKairos](./extensions/clawxkairos/)（自驱动 Agent 循环）、🛡️ [ClawXGovernor](./extensions/clawxgovernor/)（工具治理）以及 📦 [ClawXSandbox](./extensions/clawxsandbox/)（Claude Code同款沙箱）
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
- **📦 沙箱执行** — [ClawXSandbox](./extensions/clawxsandbox/)：基于系统级沙箱（bwrap / sandbox-exec）实现完全隔离的本地执行环境。主打**轻量、快速、零依赖**，彻底免除 Docker 带来的所有开销。

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

## 🛡️ ClawXGovernor — 工具治理

[ClawXGovernor](./extensions/clawxgovernor/) 是三个 Hook 中间件的组合，为 OpenClaw 补充基础的上下文和工具治理能力。

**不是新增"工具"**——agent 不会获得新的动作能力。所有工作发生在 Hook 层，对 agent 透明。MCP Server 只暴露 9 个自身状态的查询接口，用于调试。

### 三个中间件

| 中间件             | 本质           | Hook                                                           | 实际做了什么                                                                                                                                   |
| ------------------ | -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **assembler**      | 上下文裁剪器   | `registerContextEngine`                                        | 保留最近 6 轮用户对话（tail-window）、token 估算（chars/4）、compact 时写一句文本 summary、失败时 fail-soft                                    |
| **tool-governor**  | 工具调用拦截器 | `before_tool_call` · `after_tool_call` · `before_prompt_build` | 按关键词 `includes()` 分 5 级风险、字符串匹配 block 危险命令（6 条规则）、环形计数器检测循环（窗口 10 / 阈值 3）、超 4000 字符截断、写审计日志 |
| **session-memory** | 会话笔记追加器 | `before_prompt_build` · `message_sending`                      | 正则匹配回复中的要点行、追加到 markdown 文件、下轮注入最后 5 行提示                                                                            |

### 工具风险分级规则

| 级别                 | 匹配方式                                           | 动作                           |
| -------------------- | -------------------------------------------------- | ------------------------------ |
| **read**             | 工具名包含 `find`/`grep`/`read`/`glob`/`search` 等 | 放行                           |
| **workspace_write**  | 包含 `edit`/`write`/`apply_patch`                  | 放行                           |
| **exec**             | 包含 `exec`/`shell`/`bash`                         | 需审批                         |
| **network**          | 包含 `web_search`/`fetch`                          | 放行                           |
| **subagent_control** | 包含 `sessions_spawn`/`subagent`                   | 需审批                         |
| **unknown**          | 不匹配任何规则                                     | 放行（`defaultAction: allow`） |

硬编码 block：`rm -rf /`、fork bomb、`mkfs`、`dd if=/dev/zero`。审计日志写入 `~/.openclaw/cc-tool-governor/audit.jsonl`。

### 当前状态

功能已通过 E2E 验证，但都是**最简实现**——compact 没有 LLM 摘要、风险分类没有语义理解、笔记提取没有 LLM 抽取、无定量 benchmark。

> 详细文档请参见 [ClawXGovernor README](./extensions/clawxgovernor/Readme_zh.md)。

---

## 🧩 Claude Code Liked Features

Claude Code 最让用户"上瘾"的不只是单轮回答质量，而是一系列**系统级能力**让 agent 用起来像一个有记忆、会自主行动、不怕搞坏环境的协作者。EdgeClaw 通过 extension 机制逐一复刻这些能力：

### 🤖 Kairos — 自驱动 Agent 循环

Claude Code 的 agent 能在用户不干预的情况下持续工作——读文件、跑测试、改代码、再跑测试——直到任务完成。[ClawXKairos](./extensions/clawxkairos/) 将这一行为带入 OpenClaw：

| 能力           | 机制                                                             |
| -------------- | ---------------------------------------------------------------- |
| **Tick 调度**  | agent 回合结束后自动注入 `<tick>` 唤醒消息，驱动下一轮工作       |
| **Sleep 工具** | agent 无事可做时调用 `Sleep({ duration_ms })` 主动休眠，避免空转 |
| **后台命令**   | 运行超过阈值的 shell 命令自动转入后台，不阻塞 agent 继续工作     |
| **异步子代理** | 子代理以非阻塞方式启动，主 agent 无需等待子任务完成              |
| **安全限制**   | `maxTurnsPerSession` 防止无限循环，`minSleepMs` 防止空转轰炸     |

运行时通过 `/kairos on|off|status` 命令即时切换，支持 `on-message`、`on-heartbeat`、`on-gateway-start` 三种启动模式。

### 🛡️ 简易上下文管理

Claude Code 对上下文窗口的管理极为精细——自动裁剪老旧对话、压缩冗长工具输出、在窗口接近上限时主动 compact。EdgeClaw 通过 [ClawXGovernor](./extensions/clawxgovernor/) 的三个中间件提供基础版本：

- **Tail-window 裁剪**：保留最近 N 轮对话（默认 6 轮），超出部分被裁剪并生成文本摘要
- **工具输出压缩**：超过 4000 字符的工具结果自动截断摘要，避免单次调用占满上下文
- **会话笔记注入**：从 agent 回复中提取要点，下一轮以轻量提示注入，弥补被裁剪内容的信息损失

这是最简实现——没有 LLM 驱动的摘要、没有语义理解，但已能防止长会话的上下文溢出。

### 📦 沙箱隔离执行

Claude Code 的所有命令都在沙箱中执行——即使 agent 误操作 `rm -rf`，也只影响隔离环境而非用户主机。[OpenShell Sandbox](./extensions/openshell/) 为 EdgeClaw 提供等价能力：

| 模式       | 说明                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| **Mirror** | 本地工作区自动镜像到远程沙箱，agent 的文件读写和命令执行都发生在沙箱中，完成后同步回本地 |
| **Remote** | 完全远程工作区，适合 CI/CD 或云端部署场景                                                |

沙箱基于 SSH 连接，支持自定义 provider、GPU 资源请求、超时控制。长时间运行的命令自动后台化，与 Kairos 配合可实现"agent 下发构建任务 → 休眠等待 → 唤醒检查结果"的自主工作流。

---

## ⚠️ 踩坑指南

以下是 EdgeClaw 插件开发和集成测试中积累的实战经验，按严重程度排序。

### 🔴 Plugin Hook 会拦截自己的 MCP 工具

`before_tool_call` hook 拦截**所有**工具调用，包括自己的 MCP 工具。MCP 工具名格式为 `<server>__<tool>`（如 `clawxgovernor__tool_risk_classify`），如果 hook 的分类逻辑只识别内置工具名，MCP 工具会命中 `defaultAction` 被错误拦截。

**解决**：在工具分类白名单中覆盖 MCP 工具的关键词，或把 `defaultAction` 设为 `allow`。

### 🔴 `--session-id` 不隔离会话上下文

`--session-id` 只设置元数据标记，不创建独立会话。所有 `--local` agent 运行共享 `sessionKey: agent:<agentId>:main`，旧对话历史会被完整注入新请求的上下文。

**解决**：测试前清除 session 状态：

```bash
node -e "
const fs = require('fs');
const p = require('os').homedir() + '/.openclaw/agents/main/sessions/sessions.json';
const d = JSON.parse(fs.readFileSync(p,'utf-8'));
delete d['agent:main:main'];
fs.writeFileSync(p, JSON.stringify(d, null, 2));
"
```

### 🟠 ClawXRouter token-saver 可能劫持模型路由

配置了 `primary: "yeysai/minimax-m2.5"`，日志却显示 `model overridden to gpt-5-mini`。token-saver 路由器根据消息复杂度自动重定向到不同 tier 的模型。如果 tier 对应的 provider 使用本地代理且未运行，会导致 504 超时。

**解决**：调试时关闭 token-saver（`"token-saver": { "enabled": false }`），或确保 tier 中引用的所有 provider 都可达。注意 `clawxrouter.json` 优先级高于 `openclaw.json` 中的路由配置。

### 🟡 `tools.alsoAllow` 启动时报 "unknown entries"

MCP 工具是运行时动态注册的，Gateway 启动时静态校验 `alsoAllow` 会报 unknown entries 警告。**可安全忽略**——检查 `systemPromptReport.tools.entries` 包含对应 MCP 工具即可确认注册成功。

### 🟡 OpenClaw Plugin SDK 类型导入路径

`ContextEngineFactory` 等类型不在 `openclaw/plugin-sdk/context-engine`，而在 `openclaw/plugin-sdk` 根路径。`requireApproval` 返回值不能是 `boolean`，需要是 `{ title, description, severity }` 对象。建议用 `grep` 在 `node_modules/openclaw` 中搜索具体类型的导出位置。

### 🟢 Thinking 模型延迟与系统提示过长

minimax-m2.5 等 thinking 模型每次请求有推理过程，加上 ~31K chars 的系统提示（AGENTS.md + Skills + 35 个工具 schema），延迟通常 30-120 秒。E2E 测试 timeout 建议 300 秒以上。可通过 `"thinking": "low"` 降低推理深度，或减少注册的工具数量来缓解。

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
│   ├── openshell/                       # [内置] OpenShell 沙箱执行
│   │   ├── index.ts                     # 插件入口
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
    ├── cc-context-engine/state.json     # 上下文引擎状态
    ├── cc-tool-governor/audit.jsonl     # 工具审计日志
    ├── cc-session-memory/notes/         # 会话笔记
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
- [ClawXSandbox](./extensions/clawxsandbox/) — 基于系统级沙箱（bwrap / sandbox-exec）的轻量零依赖隔离执行环境

### License

MIT
