# EdgeClaw： 端云协同的AI智能体安全护栏

<div align="center">
  <img src="../assets/EdgeClaw-logo.png" alt="EdgeClaw 标志" width="400em"></img>
</div>

<p align="center">
    【中文 | <a href="./README.md"><b>English</b></a>】
</p>

## 新闻

- [2026-02-12] 🚀🚀🚀我们开源了EdgeClaw，一个端云协同的AI智能体安全护栏

## 概述

EdgeClaw是由THUNLP、中国人民大学RUCBM和ModelBest基于OpenClaw联合开发的开源AI智能体云端安全协同方案。

专为解决 AI Agent 数据泄露难题打造，EdgeClaw 构建了完善的可自定义三级安全体系（S1直通/S2脱敏/S3本地），将安全护栏标准化为通用的 Guard Protocol（Hooker→ Detector → Action）。配合 端云协同 的智能路由能力，开发者无需修改业务逻辑，即可在 OpenClaw 中实现“公开数据上云、私密数据落地”的无感隐私保护，兼顾大模型的极致效能与核心数据的绝对安全。

## 演示案例：

<div align="center">
  <a href="https://www.bilibili.com/video/BV1DYkLBNE6f"><img src="https://i0.hdslb.com/bfs/archive/05f18d5914b8691316161021298a5b63da54eaeb.jpg", width=70%></a>
</div>

## 安装

与 OpenClaw一致：

### 1. 克隆仓库

```bash
git clone https://github.com/openbmb/openclaw.git
cd openclaw
```

### 2. 安装依赖 + 构建

```bash
pnpm install
pnpm build
pnpm ui:build
pnpm openclaw --install-daemon
```

### 3. 安装扩展

GuardClaw 已包含在 `extensions/guardclaw` 目录中。在你的 `openclaw.json` 配置中启用：

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

### 4. 配置Guard

在 `openclaw.json` 中`plugins.entries.guardclaw.config`编辑配置（下方 [Customization](#customization) 部分有完整说明）：

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

同时，在 `openclaw.json` 中`agents`字段下新增 `list`字段：

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

5. 启动 Ollama

```bash
# 安装 Ollama (如果没有)
# macOS: brew install ollama
# Linux: curl -fsSL https://ollama.ai/install.sh | sh

# 拉取模型
ollama pull openbmb/minicpm4.1

# 启动服务 (默认端口 11434)
ollama serve
```

然后正常启动 OpenClaw 即可：

```bash
pnpm openclaw gateway run
```

GuardClaw 会自动拦截和路由敏感请求。

## 自定义配置

GuardClaw 可自定义配置与规则等：

### JSON 配置 — 规则与模型

在 `openclaw.json` 中`plugins.entries.guardclaw.config`编辑`privacy`字段：

### 自定义检测规则

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

### 自定义检查点与检查类型

控制哪些检测器在哪个时机运行：

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

- `ruleDetector` — 快速规则检测
- `localModelDetector` — 基于LLM的语义理解 (~1-2s)，建议用在 `onUserMessage`

### 自定义模型

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

支持任何 Ollama 兼容模型。推荐 8B+ 参数量以确保分类准确性。

### 自定义 Markdown 提示词 — 分类与行为

`prompts/` 目录下有三个 Markdown 文件，直接编辑即可改变 GuardClaw 的行为：

#### `prompts/detection-system.md` — 分类规则

控制 LLM 如何判定 S1/S2/S3。可以：

- 调整各级别的分类标准
- 添加特定的敏感类型
- 修改边界情况的判定规则

#### `prompts/guard-agent-system.md` — Guard Agent 行为

控制 S3 本地模型如何回复。可以：

- 调整回复风格和详细程度
- 添加特定领域的分析指令
- 修改语言规则
- 或者接入Openclaw原始system prompt等

#### `prompts/pii-extraction.md` — 敏感信息提取规则

控制 S2 脱敏时提取哪些敏感信息类型。可以：

- 添加新的敏感信息类型（如行业编号、内部 ID）
- 调整提取示例以提高准确率
  修改 `.md` 文件后，内置 fallback 机制确保变更在下次请求时生效，无需重启。

## Guard Protocol 规范

Guard Protocol 是一个面向 AI Agent 框架的隐私安全中间件协议，定义了在 Agent 生命周期中如何检测、分类和处理敏感数据。

### 形式化定义

#### 基本集合

设 Agent 系统中存在以下基本集合：

- 隐私级别集合 $\mathcal{L} = \{S_1, S_2, S_3\}$，配备全序关系 $S_1 \prec S_2 \prec S_3$，其中$S_1$ 表示无隐私数据，$S_2$ 表示含可脱敏的隐私信息，$S_3$ 表示深度隐私数据。
- 检查点集合 $\mathcal{C} = \{c_{\text{msg}},\; c_{\text{route}},\; c_{\text{tool\_pre}},\; c_{\text{tool\_post}},\; c_{\text{persist}},\; c_{\text{end}}\}$，分别对应消息接收、模型路由、工具调用前、工具调用后、结果持久化、会话结束六个生命周期阶段。
- 检测器集合 $\mathcal{D} = \{d_{\text{rule}},\; d_{\text{model}}\}$，其中 $d_{\text{rule}}$ 为基于正则与关键词的规则检测器，$d_{\text{model}}$ 为基于本地语言模型的语义检测器。
- 动作集合 $\mathcal{A} = \{\text{passthrough},\; \text{desensitize},\; \text{redirect}\}$，分别表示直通放行、脱敏后转发、重定向至本地模型。

#### 定义 1：检测函数

每个检测器 $d \in \mathcal{D}$ 定义为一个函数，将上下文映射到隐私级别：

$$d : \mathcal{X} \to \mathcal{L}$$

其中上下文 $x \in \mathcal{X}$ 可能包含消息内容、工具调用信息、文件内容等，具体取决于检查点类型。具体地，规则检测器 $d_{\text{rule}}$ 基于预定义规则集 $\mathcal{R} = \{r_l\}_{l \in \mathcal{L}}$ 进行确定性匹配，模型检测器 $d_{\text{model}}$ 使用本地 LLM $\theta_{\text{local}}$ 进行语义分类。

在检查点 $c \in \mathcal{C}$ 上，配置函数 $\Phi(c) \subseteq \mathcal{D}$ 返回该检查点启用的检测器子集。所有检测器并行运行，聚合结果取最高级别：

$$\text{Detect}(x, c) = \max_{\preceq}\;\bigl\{d(x) \;\big|\; d \in \Phi(c)\bigr\}$$

#### 定义 2：路由函数

路由函数 $R$ 将检测结果映射到动作空间，决定消息如何处理：

$$R : \mathcal{L} \to \mathcal{A}$$

$$R(l) = \begin{cases} \text{passthrough} & \text{if } l = S_1 \\ \text{desensitize} & \text{if } l = S_2 \\ \text{redirect} & \text{if } l = S_3 \end{cases}$$

#### 定义 3：脱敏函数

对于 $S_2$ 级内容，脱敏函数 $\text{De}$ 将含隐私信息的原始内容映射为安全内容：

$$\text{De} : \mathcal{M}_{\text{raw}} \to \mathcal{M}_{\text{safe}}$$

满足：原始内容 $m$ 中的所有隐私实体均被替换为不可逆的脱敏标记，输出 $\text{De}(m)$ 不含任何原始隐私信息，同时保留语义可用性。

#### 定义 4：双轨持久化

定义两个历史轨道 $H_{\text{full}}$（完整）和 $H_{\text{clean}}$（干净），持久化函数 $W$ 基于级别选择写入策略：

$$W(m, l) = \begin{cases} H_{\text{full}} \leftarrow m, \quad H_{\text{clean}} \leftarrow m & \text{if } l = S_1 \\ H_{\text{full}} \leftarrow m, \quad H_{\text{clean}} \leftarrow \text{De}(m) & \text{if } l = S_2 \\ H_{\text{full}} \leftarrow m, \quad H_{\text{clean}} \leftarrow \bot & \text{if } l = S_3 \end{cases}$$

其中 $\bot$ 表示占位符（如 🔒 [Private content]）。

云端模型 $\theta_{\text{cloud}}$ 仅可见 $H_{\text{clean}}$，本地模型 $\theta_{\text{local}}$ 可见 $H_{\text{full}}$：

$$\theta_{\text{cloud}}.\text{context} = H_{\text{clean}}, \quad \theta_{\text{local}}.\text{context} = H_{\text{full}}$$

#### 定义 5：记忆同步

会话结束时，同步函数 $\text{Sync}$ 在双轨记忆 $M_{\text{full}}$ 与 $M_{\text{clean}}$ 之间执行双向更新：

$$\text{Sync}: \quad M_{\text{clean}} = \text{De}\bigl(\text{Filter}(M_{\text{full}})\bigr)$$

其中 $\text{Filter}$ 移除 Guard Agent 交互内容，$\text{De}$ 对残留 隐私信息 做最终脱敏。

### 端到端流程

一条用户消息 $m$ 经过 Guard Protocol 的完整处理管道：

$$m \xrightarrow{c_{\text{msg}}} \text{Detect}(m) \to l \xrightarrow{c_{\text{route}}} R(l) \to a \xrightarrow{} \begin{cases} \theta_{\text{cloud}}(m) & a = \text{passthrough} \\ \theta_{\text{cloud}}(\text{De}(m)) & a = \text{desensitize} \\ \theta_{\text{local}}(m) & a = \text{redirect} \end{cases} \xrightarrow{c_{\text{persist}}} W(m, l) \xrightarrow{c_{\text{end}}} \text{Sync}$$

### 安全性保证

设 $x$ 为任意数据单元（消息 $m$ 或记忆条目 $e$），$\text{Cloud}(x)$ 表示 $x$ 在云端的可见形式（含 $\text{View}(\theta_{\text{cloud}})$ 与 $M_{\text{clean}}$）。

定理 1（云端不可见性）： 对于任意 $S_3$ 级数据单元 $x$，其原始内容在云端侧完全不可见：

$$\forall x,\; \text{Detect}(x) = S_3 \implies x \notin \text{Cloud}(x)$$

定理 2（脱敏完整性）： 对于任意 $S_2$ 级数据单元 $x$，其云端可见形式中不包含任何原始隐私实体值：

$$\forall x,\; \text{Detect}(x) = S_2 \implies \forall (t_i, v_i) \in \text{Extract}(x),\; v_i \notin \text{Cloud}(x)$$

### 设计结构

#### 多钩子 (Multi-Hooker)

6 个 Hook 覆盖 Agent 完整生命周期：

```

用户消息 ──▶ ① message_received    检测消息敏感度
                    │
          ② resolve_model          ★ 核心路由: S1→云 / S2→脱敏→云 / S3→本地
                    │
工具调用 ──▶ ③ before_tool_call    拦截敏感路径/工具
                    │
工具结果 ──▶ ④ after_tool_call     检测返回内容
                    │
持久化   ──▶ ⑤ tool_result_persist 写入双轨历史
                    │
会话结束 ──▶ ⑥ session_end         同步记忆文件
```

#### 双会话 (Dual Session)

```
~/.openclaw/agents/main/sessions/
├── full/                    ← 完整历史 (本地模型 + 审计)
│   └── session-abc.jsonl       所有消息，含本地模型交互
└── clean/                   ← 干净历史 (云端模型)
    └── session-abc.jsonl       过滤掉敏感内容
```

- 普通消息 → 写入 full + clean
- 敏感消息 → 仅写入 full，clean 中不可见
- 云端模型加载 clean 历史，本地模型加载 full 历史

#### 双记忆 (Dual Memory)

```
工作区/
├── MEMORY.md           ← 云端模型可见 (过滤后)
├── MEMORY-FULL.md      ← 本地模型可见 (完整)
├── memory/             ← 云端记忆目录
└── memory-full/        ← 本地记忆目录
```

会话结束时自动同步：`MEMORY-FULL.md` → 过滤敏感内容 → `MEMORY.md`

### License

MIT

### 合作共建

感谢以下贡献者在代码提交和测试中的付出。我们也欢迎新的成员加入，共同构建完善的端云协同智能体生态！

### 联系我们

- 关于技术问题及功能请求，请使用 GitHub Issues 功能。
- 如果您有任何疑问、反馈或想与我们取得联系，请随时通过电子邮件发送至 yanyk.thu@gmail.com。
