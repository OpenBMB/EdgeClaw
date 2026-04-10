---
name: xiaohongshu-audit
description: "小红书发布前审核技能。读取发布页当前内容，逐项检查标题/正文/图片/话题的合规与限流风险，输出审核报告。存在问题时直接在页面上修改。所有浏览器操作使用 profile=\"openclaw\"。"
---

# 小红书发布前审核

读取发布页 → 提取内容 → 逐项审核 → 输出报告 → 有问题就修改。**绝不点击「发布」按钮。**

## 核心规则

- **profile 固定 `"openclaw"`**，所有 browser 调用都带 `profile: "openclaw"`。
- **绝对不点击「发布」按钮。**
- 每步最多重试 1 次，仍失败则 snapshot 截图汇报。

## ⚠️ 执行约束（极其重要）

**你必须通过调用 tool 来完成每一步操作。禁止在文本中"假装"已经完成了操作。**

- 每一步都必须产生真实的 tool call（browser、exec 等）。
- 在收到 tool 返回结果之前，不要声称该步骤已完成。
- **每次只执行一步操作**，等待结果后再执行下一步。

## Browser 工具格式速查

### 页面快照
```json
{ "action": "snapshot", "profile": "openclaw" }
```

### 执行 JS
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => document.title" } }
```

### 点击元素
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "click", "ref": "e12" } }
```

### 输入文本
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "type", "ref": "e12", "text": "文字" } }
```

### 等待
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "wait", "timeMs": 2000 } }
```

## 流程

### Step 1: 读取发布页内容

假定浏览器已经在发布编辑页（publish skill 已停在发布按钮前）。用一条 JS 提取所有内容：

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { const title = (document.querySelector('#publisherInput input, input[placeholder*=\"标题\"], .c-input_inner input') || {}).value || ''; const bodyEl = document.querySelector('.ql-editor, [contenteditable=true].ProseMirror, div[contenteditable=\"true\"]'); const body = bodyEl ? bodyEl.innerText : ''; const imgs = document.querySelectorAll('.img-container img, .upload-item img, [class*=upload] img, [class*=cover] img').length; return JSON.stringify({title, body, imgs}); }" } }
```

如果返回为空或 title/body 为空，做一次 snapshot 查看页面状态，手动从 snapshot 中读取内容。

### Step 2: 文本审核

根据 Step 1 提取的内容，在文本回复中逐项检查（无需 tool call，用 LLM 推理即可）：

#### 标题检查
- 长度 ≤20 字（超限 → 🔴）
- 绝对化用语（"最好"、"第一"、"100%" → 🟡 广告法风险）
- 敏感词（政治、色情、赌博 → 🔴）
- 引流信号（微信号、QQ、"私我"、"链接在评论区" → 🔴）

#### 正文检查
- 外部引流（微信、淘宝口令、抖音号 → 🔴）
- 未报备商业信号（"下单"、"优惠"、未标注合作 → 🟡）
- 未证实功效声明（"治愈"、"根治" → 🔴 医疗违规）
- 极端表达（人身攻击、地域歧视 → 🔴）
- 平台调性（营销腔、公文腔 → 🟡）
- 长度合理性（<50字 → 🟡 / >1500字 → 🟡）

#### 话题检查
- 正文中 `#话题` 数量是否在 3-8 个
- 是否有蹭流量话题（🟡）
- 是否遗漏核心话题（🟡 建议补充）

### Step 3: 图片审核

做一次 snapshot 查看已上传图片：
```json
{ "action": "snapshot", "profile": "openclaw" }
```

从 snapshot 中观察图片缩略图，检查：
- 🔴 二维码、Logo/水印、其他平台水印（抖音/快手/微博）
- 🔴 违禁元素（烟草、酒精、管制器具、药物）
- 🔴 AI 生成痕迹明显但未声明
- 🟡 模糊/低分辨率、杂乱拼接、大面积纯文字截图
- 🟡 图文不符

### Step 4: 输出审核报告

```
📋 发布前审核报告
━━━━━━━━━━━━━━━━━━━━━━━━

📝 标题：{标题内容}
🖼️ 图片：{N} 张

── 文本审核 ──
• 标题长度：{N}/20 字 {🟢/🔴}
• 敏感词：{结果} {🟢/🟡/🔴}
• 引流信号：{结果} {🟢/🔴}
• 广告法用语：{结果} {🟢/🟡}
• 功效声明：{结果} {🟢/🔴}
• 正文长度：{N} 字 {🟢/🟡}
• 话题数量：{N} 个 {🟢/🟡}

── 图片审核 ──
• 图1：{🟢/🔴 具体问题}
• ...

━━━━━━━━━━━━━━━━━━━━━━━━
🏁 结论：{✅ 可发布 / ⚠️ 建议修改 / 🚫 必须修改}

{问题列表和修改建议}
```

### Step 5: 自动修改（存在问题时）

如果存在 🔴 或 🟡 问题，**直接在页面上修改**，无需等待用户确认（🔴 必须改，🟡 自动优化）。

#### 修改标题
用 JS 直接覆盖（和 publish skill 相同方式）：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { const el = document.querySelector('#publisherInput input, input[placeholder*=\"标题\"], .c-input_inner input'); if(!el) return 'not found'; const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; nativeSet.call(el, '修改后的标题'); el.dispatchEvent(new Event('input', {bubbles:true})); return 'title updated'; }" } }
```

#### 修改正文
先全选再输入新内容：
1. 点击正文区聚焦：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "click", "ref": "<正文ref>" } }
```
2. 全选现有内容：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "press", "ref": "<正文ref>", "key": "Meta+a" } }
```
3. 用 JS 插入新文本（会替换选中内容）：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { document.execCommand('insertText', false, '修改后的正文内容'); return 'body updated'; }" } }
```

#### 修改后重新验证
修改完成后，回到 Step 1 重新提取内容并审核，直到所有 🔴 清除。

### Step 6: 最终确认

所有审核通过后：
```
✅ 审核通过，内容可以发布
- 标题: {标题}
- 正文: {前30字...}
- 图片: {N} 张

⚠️ 未点击发布。请在浏览器中手动点击「发布」按钮。
```

## 快速审核模式

用户只给文本（标题+正文），未在发布页时：
- 跳过 Step 1 页面提取和 Step 3 图片审核
- 只做 Step 2 文本审核
- 图片部分标注「⏭️ 未审核」

## 故障处理

| 故障 | 处理 |
|------|------|
| 发布页提取失败 | snapshot 截图，从中读取内容 |
| 不在发布页 | 尝试打开 `https://creator.xiaohongshu.com/publish/publish` |
| snapshot 失败 | 标注「⚠️ 无法审核，建议人工确认」 |
| "No reply from agent" | 清理 session：`rm -rf ~/.openclaw/agents/xhs/sessions/` 后重试 |
| evaluate 返回空值 | 做 snapshot 查看实际页面状态，可能 DOM 结构有变化 |

## Agent 运行经验

### 审核步骤的模型行为

- 审核是最容易被模型"跳过"的步骤——Opus 系模型倾向于直接在文本中输出审核结论而不先调 evaluate 提取内容
- **必须先通过 evaluate tool call 提取实际页面内容**，再基于提取结果做审核判断
- 如果 evaluate 提取的 title/body 为空字符串，说明 DOM selector 不匹配，此时做 snapshot 手动从中读取

### 修改操作的可靠性

- 自动修改标题/正文后，**必须再次 evaluate 验证修改是否生效**
- ProseMirror 编辑器的 `execCommand('insertText')` 在某些版本不触发内部状态更新，导致看似修改成功但提交时仍是旧内容
- 如果验证发现修改未生效，用 `click` → `press Meta+a` → `type` 备用方案

### 与发布步骤的衔接

- audit skill 假设浏览器已在发布编辑页（publish skill 停在发布按钮前）
- 如果从新 session 恢复，需要先 `browser.open` 打开发布页，等待 3 秒后再做 snapshot
- gateway 重启后 browser profile 的 cookie 仍然有效，但页面 tab 需要重新打开

### evaluate fn 语法（必须遵守）

所有 `evaluate` 的 `fn` 参数必须是箭头函数格式的字符串：

```
✅ "fn": "() => document.title"
✅ "fn": "() => { const title = ...; return JSON.stringify({title}); }"
❌ "fn": "const title = ...; return title;"  ← 缺少箭头函数包装，会报语法错误
```

实际报错：`Error: Invalid evaluate function: Unexpected token ';'`

### browser ref 格式（必须遵守）

snapshot 返回的元素 ref 格式为 `e数字`（如 `e3`、`e15`、`e42`）。所有 `click`、`type`、`press` 操作的 `ref` 必须使用此 ID。

```
✅ "ref": "e12"        ← snapshot 返回的数字编号
❌ "ref": "发布"        ← 文字内容，会 TimeoutError
❌ "ref": "button.publish"  ← CSS 选择器，不被支持
```

### 修改操作的顺序

修改标题/正文时，每次只做一个操作，等返回后再做下一个：

```
1. evaluate 修改标题 → 等待返回
2. evaluate 修改正文 → 等待返回  
3. evaluate 验证修改结果 → 等待返回
```

不要在一次回复中同时发出多个 evaluate 调用。
