# GuardClaw 插件化重构计划

## 当前侵入式修改清单

### ✅ 可保留在核心（通用扩展点）

| 文件 | 修改 | 理由 |
|------|------|------|
| `src/plugins/types.ts` | `resolve_model` hook 类型 | 通用 hook，任何插件可用 |
| `src/plugins/hooks.ts` | `runResolveModel` 函数 | hook runner 的一部分 |
| `src/commands/agent.ts` | 调用 resolve_model hook | 让 hook 生效的必要调用点 |
| `src/auto-reply/reply/get-reply-directives.ts` | 调用 resolve_model hook | 同上 |

### ❌ 需要移除的 GuardClaw 特定代码

| 文件 | 修改 | 影响 |
|------|------|------|
| `src/plugins/guardclaw-events.ts` | 整个文件 | GuardClaw 特定事件系统 |
| `src/gateway/server.impl.ts` | `onGuardClawEvent` 订阅 | 硬编码 GuardClaw 逻辑 |
| `src/gateway/server-close.ts` | `guardClawUnsub` | 清理 GuardClaw 订阅 |
| `src/gateway/server-methods-list.ts` | `"guardclaw"` 事件 | 硬编码事件名 |
| `src/gateway/server-methods/chat.ts` | 会话重定向、响应注入 | 大量 GuardClaw 逻辑 |
| `src/auto-reply/templating.ts` | `GuardClawRedirect` | 特定类型定义 |

---

## 重构方案

### 方案：通用插件事件广播系统

#### 1. 创建通用的插件事件机制

```typescript
// src/plugins/plugin-events.ts (新文件，通用)
export type PluginEventPayload = Record<string, unknown>;

type PluginEventListener = (pluginId: string, eventType: string, payload: PluginEventPayload) => void;

const listeners = new Set<PluginEventListener>();

export function emitPluginEvent(pluginId: string, eventType: string, payload: PluginEventPayload): void {
  for (const listener of listeners) {
    try {
      listener(pluginId, eventType, payload);
    } catch { /* ignore */ }
  }
}

export function onPluginEvent(listener: PluginEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

#### 2. 在插件 API 中暴露事件发射

```typescript
// src/plugins/types.ts - 扩展 OpenClawPluginApi
export type OpenClawPluginApi = {
  // ... 现有方法 ...
  
  /** Emit a custom event that will be broadcast to Gateway clients */
  emitEvent: (eventType: string, payload: Record<string, unknown>) => void;
};
```

#### 3. Gateway 自动广播插件事件

```typescript
// src/gateway/server.impl.ts - 通用插件事件处理
import { onPluginEvent } from "../plugins/plugin-events.js";

// 在 Gateway 启动时
const pluginEventUnsub = onPluginEvent((pluginId, eventType, payload) => {
  // 广播格式: { plugin: "guardclaw", type: "privacy_activated", ... }
  broadcast("plugin_event", { plugin: pluginId, type: eventType, ...payload });
});
```

#### 4. 扩展 resolve_model hook 返回值

```typescript
// src/plugins/types.ts
export type PluginHookResolveModelResult = {
  provider?: string;
  model?: string;
  reason?: string;
  sessionKey?: string;  // 会话重定向
  
  // 新增：通用的回调钩子
  onComplete?: (result: { response: string; sessionKey: string }) => Promise<void>;
};
```

#### 5. 使用 `before_agent_start` 和 `agent_end` hooks

GuardClaw 插件可以使用这些现有 hooks 来处理会话管理：

```typescript
// extensions/guardclaw/src/hooks.ts
api.on("before_agent_start", async (event, ctx) => {
  // 检查是否需要重定向到 guard 会话
});

api.on("agent_end", async (event, ctx) => {
  // 完成后注入响应到主会话
});
```

---

## 重构步骤

### Phase 1: 创建通用插件事件系统

1. 创建 `src/plugins/plugin-events.ts`
2. 扩展 `OpenClawPluginApi` 添加 `emitEvent` 方法
3. 在 `src/plugins/registry.ts` 中实现 `emitEvent`
4. 修改 Gateway 使用通用事件系统

### Phase 2: 移除 GuardClaw 特定代码

1. 删除 `src/plugins/guardclaw-events.ts`
2. 从 `server.impl.ts` 移除 `onGuardClawEvent`
3. 从 `server-close.ts` 移除 `guardClawUnsub`
4. 从 `server-methods-list.ts` 移除 `"guardclaw"`
5. 从 `templating.ts` 移除 `GuardClawRedirect`

### Phase 3: 重构 chat.ts

1. 将会话重定向逻辑移到 `resolve_model` hook 返回值
2. 将响应注入逻辑移到 `agent_end` hook
3. chat.ts 只读取通用的 hook 返回值

### Phase 4: 更新 GuardClaw 插件

1. 使用 `api.emitEvent()` 发射事件
2. 使用 `before_agent_start` / `agent_end` hooks
3. 自包含的会话管理逻辑

---

## 重构后的架构

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Core                             │
├─────────────────────────────────────────────────────────────┤
│  Plugins API                                                 │
│  ├── on("resolve_model", ...) → { model, sessionKey }       │
│  ├── on("before_agent_start", ...) → pre-processing         │
│  ├── on("agent_end", ...) → post-processing                 │
│  └── emitEvent(type, payload) → broadcast to UI             │
├─────────────────────────────────────────────────────────────┤
│  Gateway                                                     │
│  └── onPluginEvent() → broadcast("plugin_event", ...)       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    GuardClaw Plugin                          │
├─────────────────────────────────────────────────────────────┤
│  resolve_model hook                                          │
│  ├── 检测敏感度                                              │
│  ├── 返回 { model: "ollama/...", sessionKey: "...:guard" }  │
│  └── 触发 emitEvent("privacy_activated", {...})             │
├─────────────────────────────────────────────────────────────┤
│  agent_end hook                                              │
│  └── 注入响应到主会话                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 好处

1. **零侵入核心代码** - GuardClaw 完全自包含
2. **通用事件系统** - 其他插件也可使用
3. **更好的可维护性** - 插件逻辑不散落在核心代码中
4. **易于移植** - 插件可独立发布和更新

