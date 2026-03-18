# Provider Hub — EdgeClaw LLM Provider 管理插件

**Provider Hub** 是一个 EdgeClaw 插件，提供预置的 LLM Provider 目录和简化的 API Key 管理接口。

前端开发者通过 3 个 Gateway RPC 方法 + 1 个已有的 `config.patch` 方法，即可实现完整的 Provider 配置 UI，无需了解 OpenClaw 配置系统的内部细节。

---

## 快速开始

### 启用插件

在 `openclaw.json` 中添加：

```json
{
  "plugins": ["@edgeclaw/provider-hub"]
}
```

或将 `extensions/provider-hub` 放在工作区 `extensions/` 目录下（会自动发现）。

### 验证加载

启动 Gateway 后，日志中应出现：

```
Provider Hub loaded — catalog ready, gateway methods: hub.providers.{list,probe,discover}
```

---

## 架构概览

```
┌─────────────┐                         ┌──────────────────┐
│  前端 UI     │   hub.providers.list    │  Provider Hub    │
│             │ ──────────────────────→ │  (Extension)     │
│  Provider    │                        │                  │
│  卡片列表    │   hub.providers.probe   │  ┌────────────┐  │
│             │ ──────────────────────→ │  │  Catalog    │  │
│  API Key    │                        │  │  (28+ 预置)  │  │
│  输入/删除   │   hub.providers.discover│  └────────────┘  │
│             │ ──────────────────────→ │                  │
│  保存生效    │                        │                  │
│             │   config.patch (核心)    │  ┌────────────┐  │
│             │ ──────────────────────→ │  │  openclaw   │  │
│             │                        │  │  .json      │  │
└─────────────┘                        └──┴────────────┴──┘
```

**关键设计**：插件只读配置和提供目录数据，配置写入复用核心的 `config.patch`（自带乐观锁 + 重启），不引入额外存储。

---

## API 参考

### 1. `hub.providers.list` — 获取 Provider 列表

返回预置目录 + 用户自定义的 provider，附带当前配置状态。

**请求参数**：`{}`（无参数）

**响应**：

```typescript
{
  providers: Array<{
    id: string; // "openai", "deepseek", "ollama"
    label: string; // "OpenAI", "DeepSeek (深度求索)"
    region: "global" | "cn" | "local";
    category: "cloud" | "local";
    defaultBaseUrl: string; // "https://api.openai.com/v1"
    defaultApi: string; // "openai-completions"
    authMode: "api-key" | "aws-sdk" | "oauth" | "none";
    keyPrefix?: string; // "sk-"
    keyPlaceholder?: string; // "sk-proj-..."
    docsUrl?: string; // 获取 Key 的页面 URL
    envVar?: string; // "OPENAI_API_KEY"
    defaultModels: Array<{
      id: string;
      label?: string;
      capabilities?: string[];
    }>;
    notes?: string;
    // ── 运行时状态 ──
    configured: boolean; // 是否已在 models.providers 中配置
    hasKey: boolean; // 是否已设置 API Key
  }>;
}
```

**前端使用示例**：

```typescript
const res = await client.request("hub.providers.list", {});
const { providers } = res;

// 分组展示
const global = providers.filter((p) => p.region === "global");
const cn = providers.filter((p) => p.region === "cn");
const local = providers.filter((p) => p.region === "local");
```

---

### 2. `hub.providers.probe` — 验证 API Key

向 provider 发起一次真实的轻量请求来验证 Key 是否有效。

**请求参数**：

```typescript
{
  provider: string;    // 必填，provider ID
  apiKey?: string;     // 可选，临时 Key（不会保存到配置）
  baseUrl?: string;    // 可选，覆盖默认 baseUrl
}
```

**响应**：

```typescript
{
  provider: string;
  reachable: boolean;  // 网络是否可达
  status: "ok" | "auth" | "rate_limit" | "billing" | "timeout" | "network" | "unknown";
  error?: string;      // 错误详情
  latencyMs?: number;  // 请求耗时
}
```

**前端使用示例**：

```typescript
// 用户填完 Key 后，点击「验证」按钮
const result = await client.request("hub.providers.probe", {
  provider: "openai",
  apiKey: "sk-proj-abc123...",
});

if (result.status === "ok") {
  showSuccess("API Key 验证成功");
} else if (result.status === "auth") {
  showError("API Key 无效，请检查是否正确");
} else if (result.status === "billing") {
  showWarning("API Key 有效，但账户余额不足");
}
```

**注意事项**：

- 验证会产生一次真实 API 调用（对 OpenAI-compatible 是 `GET /models`，对 Anthropic 是一次最小化的 messages 调用）
- 验证失败不应阻止保存（用户可能还没充值）
- 本地 provider 不需要 apiKey，probe 只检查服务是否可达

---

### 3. `hub.providers.discover` — 发现本地模型

自动发现本地推理服务器上已加载的模型。

**请求参数**：

```typescript
{
  provider: string;    // 必填，如 "ollama", "vllm", "llamacpp"
  baseUrl?: string;    // 可选，覆盖默认地址
}
```

**响应**：

```typescript
{
  provider: string;
  reachable: boolean;
  models: Array<{
    id: string;        // 模型 ID，如 "llama3.3:70b"
    label?: string;
  }>;
  error?: string;
}
```

**前端使用示例**：

```typescript
// 用户选择 Ollama 后，自动发现已安装的模型
const result = await client.request("hub.providers.discover", {
  provider: "ollama",
});

if (result.reachable) {
  showModelList(result.models); // 展示可用模型列表
} else {
  showHint("Ollama 服务未启动，请先运行 ollama serve");
}
```

---

### 4. 保存/删除 API Key（使用核心 `config.patch`）

Provider Hub 不提供写入方法——直接使用核心的 `config.patch`。

#### 设置 API Key

```typescript
// 1. 先获取当前配置的 hash（乐观锁）
const snapshot = await client.request("config.get", {});

// 2. 构造 merge patch — 只修改目标 provider 的 apiKey
await client.request("config.patch", {
  raw: JSON.stringify({
    models: {
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-proj-abc123...",
          api: "openai-responses",
          models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
        },
      },
    },
  }),
  baseHash: snapshot.hash,
});
// config.patch 自动触发 Gateway 重启，Key 立即生效
```

#### 快速设置（仅 API Key）

如果 provider 已配置，只需更新 apiKey：

```typescript
await client.request("config.patch", {
  raw: JSON.stringify({
    models: {
      providers: {
        openai: {
          apiKey: "sk-new-key...",
        },
      },
    },
  }),
  baseHash: snapshot.hash,
});
```

#### 删除 Provider

JSON Merge Patch 中 `null` 表示删除：

```typescript
await client.request("config.patch", {
  raw: JSON.stringify({
    models: {
      providers: {
        openai: null, // 删除整个 provider
      },
    },
  }),
  baseHash: snapshot.hash,
});
```

#### 仅删除 API Key（保留其他配置）

```typescript
await client.request("config.patch", {
  raw: JSON.stringify({
    models: {
      providers: {
        openai: {
          apiKey: null, // 只删除 Key
        },
      },
    },
  }),
  baseHash: snapshot.hash,
});
```

---

## 前端集成完整流程

```
┌──────────────────────────────────────────────────────────────┐
│  1. 页面加载                                                  │
│     hub.providers.list  → 获取 provider 列表 + 配置状态       │
│     config.get          → 获取 baseHash（后续写入需要）        │
│                                                              │
│  2. 用户选择 provider                                         │
│     • 已知 provider → 自动填充 baseUrl, api, defaultModels    │
│     • 自定义 provider → 用户手动填写                           │
│     • 本地 provider → hub.providers.discover 发现模型          │
│                                                              │
│  3. 用户填写 API Key                                          │
│     • keyPrefix 做即时格式提示（纯 UX，非安全校验）             │
│     • 可选：点击「验证」→ hub.providers.probe                  │
│                                                              │
│  4. 用户点击「保存并应用」                                     │
│     config.patch → 写入 + 自动重启 Gateway                    │
│     ⚠️ 必须带 baseHash，否则被拒绝                            │
│                                                              │
│  5. 刷新列表                                                  │
│     hub.providers.list → 更新 configured/hasKey 状态          │
└──────────────────────────────────────────────────────────────┘
```

---

## 预置 Provider 目录

### 国际云端 (region: "global")

| ID           | 名称               | API 类型             | 认证    |
| ------------ | ------------------ | -------------------- | ------- |
| `openai`     | OpenAI             | openai-responses     | api-key |
| `anthropic`  | Anthropic          | anthropic-messages   | api-key |
| `google`     | Google AI (Gemini) | google-generative-ai | api-key |
| `groq`       | Groq               | openai-completions   | api-key |
| `together`   | Together AI        | openai-completions   | api-key |
| `fireworks`  | Fireworks AI       | openai-completions   | api-key |
| `mistral`    | Mistral AI         | openai-completions   | api-key |
| `openrouter` | OpenRouter         | openai-completions   | api-key |
| `cohere`     | Cohere             | openai-completions   | api-key |
| `sambanova`  | SambaNova          | openai-completions   | api-key |

### 国内云端 (region: "cn")

| ID            | 名称                 | API 类型           | 认证    |
| ------------- | -------------------- | ------------------ | ------- |
| `deepseek`    | DeepSeek (深度求索)  | openai-completions | api-key |
| `qwen`        | 通义千问 (DashScope) | openai-completions | api-key |
| `zhipu`       | 智谱 AI (GLM)        | openai-completions | api-key |
| `moonshot`    | 月之暗面 (Kimi)      | openai-completions | api-key |
| `baichuan`    | 百川智能             | openai-completions | api-key |
| `minimax`     | MiniMax (海螺 AI)    | openai-completions | api-key |
| `stepfun`     | 阶跃星辰             | openai-completions | api-key |
| `yi`          | 零一万物             | openai-completions | api-key |
| `doubao`      | 豆包 (火山引擎)      | openai-completions | api-key |
| `spark`       | 讯飞星火             | openai-completions | api-key |
| `hunyuan`     | 腾讯混元             | openai-completions | api-key |
| `siliconflow` | 硅基流动             | openai-completions | api-key |

### 本地推理 (region: "local")

| ID         | 名称               | 默认地址          | 认证 |
| ---------- | ------------------ | ----------------- | ---- |
| `ollama`   | Ollama             | `localhost:11434` | 无   |
| `lmstudio` | LM Studio          | `localhost:1234`  | 无   |
| `vllm`     | vLLM               | `localhost:8000`  | 无   |
| `llamacpp` | llama.cpp (server) | `localhost:8080`  | 无   |
| `sglang`   | SGLang             | `localhost:30000` | 无   |
| `localai`  | LocalAI            | `localhost:8080`  | 无   |

---

## 添加新的 Provider

在 `src/catalog/` 中对应文件添加一个 `ProviderCatalogEntry` 即可：

```typescript
// src/catalog/cloud-cn.ts
{
  id: "new-provider",
  label: "新 Provider",
  region: "cn",
  category: "cloud",
  defaultBaseUrl: "https://api.new-provider.com/v1",
  defaultApi: "openai-completions",
  authMode: "api-key",
  keyPlaceholder: "...",
  docsUrl: "https://new-provider.com/docs",
  envVar: "NEW_PROVIDER_API_KEY",
  defaultModels: [
    { id: "model-a", label: "Model A", capabilities: ["tools"] },
  ],
},
```

重启 Gateway 后自动生效。

---

## 目录结构

```
extensions/provider-hub/
├── index.ts                        # 插件入口
├── package.json
├── README.md                       # 本文档
└── src/
    ├── types.ts                    # 类型定义
    ├── catalog/
    │   ├── index.ts                # 目录聚合 + 查找
    │   ├── cloud-global.ts         # 国际云端 provider
    │   ├── cloud-cn.ts             # 国内云端 provider
    │   └── local.ts                # 本地推理 provider
    └── methods/
        ├── index.ts                # RPC 方法注册
        ├── provider-list.ts        # hub.providers.list 实现
        ├── provider-probe.ts       # hub.providers.probe 实现
        └── provider-discover.ts    # hub.providers.discover 实现
```

---

## 设计决策记录

### 为什么是 Extension 而不是核心修改？

1. **Upstream Rebase 零冲突** — EdgeClaw 定期从 OpenClaw 上游 rebase，Extension 完全不碰核心代码
2. **Plugin API 完全足够** — `registerGatewayMethod` 提供自定义 RPC，`config.patch` 提供配置写入
3. **先例** — `extensions/guardclaw` 就是同样的模式

### 为什么写入用 `config.patch` 而不是自定义方法？

1. **Single Source of Truth** — 配置统一存储在 `openclaw.json`，不引入第二个存储
2. **乐观锁** — `config.patch` 自带 `baseHash` 并发控制
3. **自动重启** — `config.patch` 写入后自动触发 Gateway 重启，配置立即生效
4. **敏感字段脱敏** — 核心的 `config.get` 已自动对 `apiKey` 脱敏

### 为什么 probe 做在后端？

1. **安全** — API Key 不需要传到浏览器端
2. **CORS** — 浏览器直接调 LLM API 会被 CORS 阻止
3. **统一** — 不同 provider 的认证方式不同，后端统一处理
