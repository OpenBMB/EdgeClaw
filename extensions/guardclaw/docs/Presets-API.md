# Provider Presets API 接口文档

> 适用范围：GuardClaw Dashboard Provider 快速切换功能  
> Base URL：`/plugins/guardclaw/stats/api`  
> 认证：与 Dashboard 共享同一 HTTP 认证（plugin auth）

---

## 概念

Provider Preset（供应商预设）将以下三项配置打包为一个可快速切换的组合：

| 配置项         | 说明                            | 生效方式                             |
| -------------- | ------------------------------- | ------------------------------------ |
| `localModel`   | 本地 LLM（隐私分类 + PII 脱敏） | 即时热加载，无需重启                 |
| `guardAgent`   | 隐私守护 Agent 使用的模型       | 即时热加载，无需重启                 |
| `defaultModel` | EdgeClaw 主模型（云端/本地）    | 写入 `openclaw.json`，需重启 Gateway |

预设分两类：

- **内置预设**（`builtin: true`）：代码中预定义，不可删除
- **自定义预设**（`builtin` 为 `false` 或缺失）：用户保存，存储在 `~/.openclaw/guardclaw.json` 的 `presets` 数组中

---

## 类型定义

### ProviderPreset

```typescript
type ProviderPreset = {
  id: string; // 唯一标识
  name: string; // 显示名称
  builtin?: boolean; // true 表示内置预设
  localModel: {
    type: "openai-compatible" | "ollama-native" | "custom";
    provider: string; // 如 "vllm", "ollama", "deepseek"
    model: string; // 模型名
    endpoint: string; // API 端点
    apiKey?: string; // 可选 API 密钥
  };
  guardAgent: {
    model: string; // "provider/model" 格式，如 "vllm/qwen3.5-35b"
  };
  defaultModel?: string; // 可选，"provider/model" 格式
};
```

---

## 接口列表

### 1. 获取所有预设

```
GET /api/presets
```

**响应 200：**

```json
{
  "presets": [
    {
      "id": "vllm-qwen35",
      "name": "vLLM / Qwen 3.5-35B",
      "builtin": true,
      "localModel": {
        "type": "openai-compatible",
        "provider": "vllm",
        "model": "qwen3.5-35b",
        "endpoint": "http://localhost:7999"
      },
      "guardAgent": { "model": "vllm/qwen3.5-35b" },
      "defaultModel": "vllm/qwen3.5-35b"
    },
    {
      "id": "deepseek-cloud",
      "name": "DeepSeek Chat (Cloud)",
      "builtin": true,
      "localModel": {
        "type": "openai-compatible",
        "provider": "deepseek",
        "model": "deepseek-chat",
        "endpoint": "https://api.deepseek.com"
      },
      "guardAgent": { "model": "deepseek/deepseek-chat" },
      "defaultModel": "deepseek/deepseek-chat"
    },
    {
      "id": "my-setup-1710734400000",
      "name": "My Custom Setup",
      "localModel": {
        "type": "openai-compatible",
        "provider": "vllm",
        "model": "qwen3.5-35b",
        "endpoint": "http://localhost:7999"
      },
      "guardAgent": { "model": "vllm/qwen3.5-35b" },
      "defaultModel": "vllm/qwen3.5-35b"
    }
  ],
  "activePreset": "vllm-qwen35",
  "currentDefaultModel": "vllm/qwen3.5-35b"
}
```

**字段说明：**

| 字段                  | 类型               | 说明                                                   |
| --------------------- | ------------------ | ------------------------------------------------------ |
| `presets`             | `ProviderPreset[]` | 所有预设（内置在前，自定义在后）                       |
| `activePreset`        | `string \| null`   | 最后一次 apply 的预设 ID，未应用过则为 `null`          |
| `currentDefaultModel` | `string \| null`   | 当前 `openclaw.json` 中的默认模型，读取失败则为 `null` |

---

### 2. 应用预设

```
POST /api/presets/apply
Content-Type: application/json
```

**请求体：**

```json
{
  "id": "vllm-qwen35",
  "applyDefaultModel": true
}
```

| 参数                | 类型      | 必填 | 说明                                                         |
| ------------------- | --------- | ---- | ------------------------------------------------------------ |
| `id`                | `string`  | 是   | 预设 ID                                                      |
| `applyDefaultModel` | `boolean` | 否   | 是否同时写入 `defaultModel` 到 `openclaw.json`。默认 `false` |

**响应 200（仅 localModel + guardAgent）：**

```json
{ "ok": true }
```

**响应 200（含 defaultModel 成功写入）：**

```json
{
  "ok": true,
  "defaultModelApplied": true,
  "needsRestart": true
}
```

**响应 200（defaultModel 写入失败，localModel + guardAgent 仍已生效）：**

```json
{
  "ok": true,
  "defaultModelApplied": false,
  "defaultModelError": "openclaw.json not found. Run: openclaw onboard"
}
```

**响应 404：**

```json
{ "ok": false, "error": "Preset not found: invalid-id" }
```

**前端推荐交互流程：**

```
1. 用户选择预设并点击 Apply
2. 检查预设是否包含 defaultModel
   └─ 无 defaultModel → 直接调用 { id, applyDefaultModel: false }
   └─ 有 defaultModel 且 !== currentDefaultModel
       → 弹出确认框："此操作会将默认模型切换为 X，需要重启 Gateway。是否同时切换？"
       → 确认 → { id, applyDefaultModel: true }
       → 取消 → { id, applyDefaultModel: false }（仅应用本地配置）
   └─ 有 defaultModel 但 === currentDefaultModel
       → 直接调用 { id, applyDefaultModel: false }（无需重复写入）
3. 根据响应展示提示
   └─ needsRestart: true → 提示 "已应用，请重启 Gateway 使默认模型生效"
   └─ defaultModelError → 提示 "本地配置已应用。默认模型切换失败：" + error
   └─ 其他 → 提示 "预设已应用"
4. 调用 GET /api/presets 刷新预设列表
5. 调用 GET /api/config 刷新配置表单
```

---

### 3. 保存当前配置为预设

```
POST /api/presets/save
Content-Type: application/json
```

**请求体：**

```json
{ "name": "My Production Setup" }
```

| 参数   | 类型     | 必填 | 说明                               |
| ------ | -------- | ---- | ---------------------------------- |
| `name` | `string` | 是   | 预设名称（去除首尾空格后不能为空） |

**响应 200：**

```json
{ "ok": true, "id": "my-production-setup-1710734400000" }
```

**说明：**

- 自动快照当前 `localModel`、`guardAgent` 和 `defaultModel`（从 `openclaw.json` 读取）
- ID 由名称 kebab-case 化 + 时间戳生成
- 保存后该预设自动成为 `activePreset`
- `apiKey` 不为空时会被保存到预设中（注意安全性）

**响应 400：**

```json
{ "ok": false, "error": "name required" }
```

---

### 4. 删除自定义预设

```
DELETE /api/presets/{id}
```

URL 中的 `{id}` 需要做 `encodeURIComponent` 编码。

**响应 200：**

```json
{ "ok": true }
```

**响应 400（尝试删除内置预设）：**

```json
{ "ok": false, "error": "Cannot delete built-in preset" }
```

**响应 400（预设不存在）：**

```json
{ "ok": false, "error": "Preset not found" }
```

---

## 当前部署环境

本地 LLM 为 vLLM 推理服务，运行在 `127.0.0.1:7999`，模型 `qwen3.5-35b`。

对应的 `guardclaw.json` 关键配置：

```json
{
  "privacy": {
    "localModel": {
      "enabled": true,
      "type": "openai-compatible",
      "provider": "vllm",
      "model": "qwen3.5-35b",
      "endpoint": "http://localhost:7999"
    },
    "guardAgent": {
      "id": "guard",
      "workspace": "~/.openclaw/workspace-guard",
      "model": "vllm/qwen3.5-35b"
    }
  }
}
```

对应的 `openclaw.json` provider 配置：

```json
{
  "models": {
    "providers": {
      "vllm": {
        "baseUrl": "http://127.0.0.1:7999/v1",
        "apiKey": "VLLM_API_KEY",
        "api": "openai-completions",
        "models": [
          {
            "id": "qwen3.5-35b",
            "name": "qwen3.5-35b",
            "contextWindow": 131072,
            "maxTokens": 65536
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "vllm/qwen3.5-35b" }
    }
  }
}
```

## 内置预设一览

| ID               | 名称                  | localModel               | endpoint                   | defaultModel             | 适用场景                      |
| ---------------- | --------------------- | ------------------------ | -------------------------- | ------------------------ | ----------------------------- |
| `vllm-qwen35`    | vLLM / Qwen 3.5-35B   | vllm / qwen3.5-35b       | `http://localhost:7999`    | `vllm/qwen3.5-35b`       | 全本地，隐私 + 主模型均在本地 |
| `deepseek-cloud` | DeepSeek Chat (Cloud) | deepseek / deepseek-chat | `https://api.deepseek.com` | `deepseek/deepseek-chat` | 全 DeepSeek 云端              |

---

## 生效范围与时序

```
┌───────────────────────────────────────────────────────┐
│  Apply Preset                                         │
│                                                       │
│  localModel + guardAgent ──── 即时生效（热加载）        │
│    ├ 写入 guardclaw.json                              │
│    └ 更新内存中的 liveConfig                           │
│                                                       │
│  defaultModel ──────────────── 需要重启 Gateway        │
│    └ 写入 openclaw.json 的 agents.defaults.model       │
│      （保留已有的 fallbacks 等字段）                    │
└───────────────────────────────────────────────────────┘
```

| 操作                             | 影响文件         | 生效时机               |
| -------------------------------- | ---------------- | ---------------------- |
| Apply（localModel + guardAgent） | `guardclaw.json` | 立即                   |
| Apply（defaultModel）            | `openclaw.json`  | 重启 Gateway 后        |
| Save                             | `guardclaw.json` | 仅存储，不改变当前配置 |
| Delete                           | `guardclaw.json` | 仅删除存储             |

---

## 错误处理

所有接口遵循统一的错误响应格式：

```json
{ "ok": false, "error": "错误描述" }
```

或参数校验错误：

```json
{ "error": "id required" }
```

| HTTP 状态码 | 含义                                                             |
| ----------- | ---------------------------------------------------------------- |
| 200         | 成功（`ok: true`）或部分成功（`ok: true` + `defaultModelError`） |
| 400         | 参数缺失、JSON 解析失败、删除内置预设                            |
| 404         | 预设 ID 不存在（仅 apply）                                       |

**defaultModel 写入可能的错误：**

| 错误信息                                     | 原因                   | 建议处理                                   |
| -------------------------------------------- | ---------------------- | ------------------------------------------ |
| `openclaw.json not found`                    | 全新安装未完成 onboard | 提示用户运行 `openclaw onboard`            |
| `openclaw.json parse failed (may use JSON5)` | 配置文件含 JSON5 语法  | 提示用户运行 `openclaw models set <model>` |
| `Failed to write openclaw.json: ...`         | 文件权限等 I/O 错误    | 展示原始错误                               |

---

## 前端集成示例

```javascript
const BASE = "/plugins/guardclaw/stats/api";

// 加载预设列表
async function loadPresets() {
  const data = await fetch(BASE + "/presets").then((r) => r.json());
  // data.presets         - ProviderPreset[]
  // data.activePreset    - string | null
  // data.currentDefaultModel - string | null
  return data;
}

// 应用预设（含 defaultModel 确认逻辑）
async function applyPreset(id, presets, currentDefaultModel) {
  const preset = presets.find((p) => p.id === id);
  let applyDefaultModel = false;

  // 如果预设包含 defaultModel 且与当前不同，需要用户确认（会触发 Gateway 重启）
  if (preset?.defaultModel && preset.defaultModel !== currentDefaultModel) {
    applyDefaultModel = confirm(
      `将同时切换默认模型为 ${preset.defaultModel}，需要重启 Gateway。是否继续？`,
    );
  }

  const res = await fetch(BASE + "/presets/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, applyDefaultModel }),
  });
  const result = await res.json();
  // result.ok                  - 操作是否成功
  // result.needsRestart        - 是否需要重启 Gateway
  // result.defaultModelApplied - defaultModel 是否已写入
  // result.defaultModelError   - defaultModel 写入失败的原因
  return result;
}

// 保存当前配置为预设
async function savePreset(name) {
  const res = await fetch(BASE + "/presets/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

// 删除自定义预设
async function deletePreset(id) {
  const res = await fetch(BASE + "/presets/" + encodeURIComponent(id), { method: "DELETE" });
  return res.json();
}
```
