---
name: xiaohongshu-publish
description: "小红书最简图文发布技能。读取用户指定路径的图片上传到小红书，填入标题和正文，停在发布按钮前等待用户确认。所有浏览器操作使用 profile=\"openclaw\"。"
---

# 小红书最简图文发布

读取本地图片 → 上传到小红书 → 填入配文 → 停在发布按钮前。**绝不自动点击发布。**

## 输入

| 参数 | 必填 | 说明 |
|------|------|------|
| 图片路径 | 是 | 本地图片文件或目录路径，支持多张（首张为封面） |
| 标题 | 是 | ≤20 字 |
| 正文 | 是 | 含话题标签（如 `#话题`） |

## 核心规则

- **profile 固定 `"openclaw"`**，所有 browser 调用都带 `profile: "openclaw"`。
- **绝对不点击「发布」按钮。**
- 每步最多重试 1 次，仍失败则 `snapshot` 截图汇报用户。
- 所有 snapshot 使用默认格式（不传 `refs` 或 `snapshotFormat`），避免兼容问题。

## ⚠️ 执行约束（极其重要）

**你必须通过调用 tool 来完成每一步操作。禁止在文本中"假装"已经完成了操作。**

- 每一步都必须产生真实的 tool call（browser、exec 等）。
- 在收到 tool 返回结果之前，不要声称该步骤已完成。
- 如果你发现自己在文字中描述"已上传"、"已填写"等，但没有先调用对应的 tool，那你做错了。
- **每次只执行一步操作**，等待结果后再执行下一步。不要在单次回复中规划所有步骤。

## Browser 工具调用格式速查

下面是本 skill 用到的所有 browser action 的参数格式。请严格按这些格式调用。

### 打开页面

```json
{ "action": "open", "url": "https://...", "profile": "openclaw" }
```

### 页面快照（读取页面结构）

```json
{ "action": "snapshot", "profile": "openclaw" }
```

返回页面 DOM 树，每个可交互元素都有 ref（如 `e12`）。后续 act 操作用这个 ref 定位元素。

### 点击元素

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "click", "ref": "e12" } }
```

### 输入文本（追加到现有内容）

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "type", "ref": "e12", "text": "要输入的文字" } }
```

### 清空并输入文本（覆盖式填写，适合标题输入框）

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "fill", "ref": "e12", "value": "新内容" } }
```

注意：`fill` 对 contenteditable 的 div 可能不生效。对这种情况，先 `click` 聚焦，然后用 `press` 全选 (`key: "Meta+a"`)，再 `type` 输入。

### 按键

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "press", "ref": "e12", "key": "Enter" } }
```

### 执行 JS（获取页面信息）

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => document.title" } }
```

`fn` 是一个字符串形式的 JS 函数，会在页面上下文中执行。

### 上传文件

```json
{ "action": "upload", "profile": "openclaw", "paths": ["/tmp/openclaw/uploads/xhs-publish/photo.jpg"], "ref": "e15" }
```

**重要**：
- `paths` 中的文件必须位于 `/tmp/openclaw/uploads/` 目录下，否则会被拒绝。
- `ref` 必须是 snapshot 返回的 file input 元素 ID（如 `e15`），不能用 CSS selector。
- 如果 file input 是隐藏的，先用 JS evaluate 让它可见，再做 snapshot 获取 ref。

### 等待

```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "wait", "timeMs": 3000 } }
```

## ⛔ 致命错误速查（实战踩坑，必须避免）

### 错误 1：ref 传了文字而非 snapshot ID

snapshot 返回的每个元素都有唯一 ID（格式为 `e3`、`e15`、`e42` 等数字编号）。
**所有 `ref` 参数必须使用这个 ID，绝不能用元素的文字内容。**

```
❌ 错误：{ "kind": "click", "ref": "上传图文" }     ← 会 TimeoutError
✅ 正确：{ "kind": "click", "ref": "e7" }          ← snapshot 返回的 ID
```

**实际报错**：`TimeoutError: locator.click: Timeout 8000ms exceeded. waiting for locator('aria-ref=上传图文')`

### 错误 2：evaluate 的 fn 缺少箭头函数包装

`fn` 必须是 `() => { ... }` 或 `() => expression` 格式的字符串。裸代码会报语法错误。

```
❌ 错误："fn": "document.title"
❌ 错误："fn": "const x = 1; return x;"
❌ 错误："fn": "Array.from(...).forEach(...); 'done'"   ← 缺少箭头函数包装
✅ 正确："fn": "() => document.title"
✅ 正确："fn": "() => { const x = 1; return x; }"
✅ 正确："fn": "() => { Array.from(...).forEach(...); return 'done'; }"
```

**实际报错**：`Error: Invalid evaluate function: Unexpected token ';'`

### 错误 3：在 open 之后立即 snapshot（页面未加载）

必须在 open 和 snapshot 之间加 wait 3000ms。

```
❌ 错误：open → snapshot（页面还在加载，DOM 不完整）
✅ 正确：open → wait 3000 → snapshot
```

### 错误 4：单轮想完成所有步骤

Opus 系模型收到复杂多步指令后，倾向于输出文字计划然后停止（不调用工具）。
**必须每条消息只要求完成一步操作。**

```
❌ 无效："打开发布页，上传图片，填标题正文"  → 模型只输出计划文字
✅ 有效："直接调用browser工具（不要解释）：打开 https://creator.xiaohongshu.com/publish/publish"
```

## 流程

### Step 0: 准备图片 + 确认登录（合并执行减少 API 轮次）

用一条 exec 命令完成图片准备：
```bash
mkdir -p /tmp/openclaw/uploads/xhs-publish && cp "<用户图片路径>" /tmp/openclaw/uploads/xhs-publish/ 2>/dev/null; ls /tmp/openclaw/uploads/xhs-publish/
```
如果图片已在 `/tmp/openclaw/uploads/xhs-publish/` 下则跳过复制。

### Step 1: 直接打开发布页

直接打开发布页（会自动跳转到登录页如果未登录）：
```json
{ "action": "open", "url": "https://creator.xiaohongshu.com/publish/publish", "profile": "openclaw" }
```

等 3 秒让页面完全加载，然后做 snapshot：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "wait", "timeMs": 3000 } }
```
```json
{ "action": "snapshot", "profile": "openclaw" }
```

如果看到"登录"、二维码 → 未登录，终止。如果看到"上传"相关内容 → 已登录。

### Step 2: 切换到图文 + 上传图片

**2a.** 用 evaluate 点击"上传图文"标签（⚠️ 不要用 `act.click`+文字 ref，会超时）：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { const tabs = document.querySelectorAll('span, div, a'); for(const t of tabs){ if(t.textContent.trim() === '上传图文' && t.offsetParent !== null){ t.click(); return 'clicked'; } } return 'tab not found'; }" } }
```

**2b.** 等 3 秒让 DOM 完全更新，然后用 evaluate 让 file input 可见（⚠️ `fn` 必须是箭头函数）：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "wait", "timeMs": 3000 } }
```
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { const inputs = document.querySelectorAll('input[type=file]'); inputs.forEach(input => { input.style.cssText = 'opacity:1!important;width:200px!important;height:50px!important;position:relative!important;z-index:99999!important;display:block!important;visibility:visible!important'; }); return 'found ' + inputs.length + ' file inputs'; }" } }
```

**2c.** 做 snapshot 找到 file input 的 ref：
```json
{ "action": "snapshot", "profile": "openclaw" }
```
在结果中找 `input` 或 `Choose File` 类元素，记下其 **数字编号 ref**（如 `e3`、`e15`）。

⚠️ **关键**：ref 是 snapshot 返回的形如 `e数字` 的 ID，不是文字内容。例如 snapshot 返回 `[e3] input[type=file]`，则 ref 为 `"e3"`。

**2d.** 用 snapshot 返回的 **精确 ref** 上传图片：
```json
{ "action": "upload", "profile": "openclaw", "paths": ["/tmp/openclaw/uploads/xhs-publish/photo1.jpg"], "ref": "e3" }
```
> ⛔ `ref` 必须是上一步 snapshot 返回的 `e数字` ID。**绝不能**写成 `"input[type=file]"` 或 `"Choose File"` 或任何 CSS 选择器。

**2e.** 等待上传完成（5 秒——图片较大时需要更久），然后 snapshot 确认缩略图出现：
```json
{ "action": "act", "profile": "openclaw", "request": { "kind": "wait", "timeMs": 5000 } }
```
```json
{ "action": "snapshot", "profile": "openclaw" }
```
确认 snapshot 中出现图片缩略图后才继续下一步。

### Step 4: 填写标题和正文

小红书的编辑器使用 ProseMirror（contenteditable），标准 type/fill 可能不生效。优先使用 JS 方式。

1. 做 snapshot 找到标题输入框和正文输入区的 ref。

2. **填写标题**：用 JS 直接设置值（最可靠）：
   ```json
   { "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { const el = document.querySelector('#publisherInput input, input[placeholder*=\"标题\"], .c-input_inner input'); if(!el) return 'title input not found'; const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; nativeSet.call(el, '用户的标题'); el.dispatchEvent(new Event('input', {bubbles:true})); return 'title set'; }" } }
   ```
   如果上面的选择器不匹配，先做 snapshot 找到标题 input 的实际选择器，替换 `querySelector` 中的内容。

3. **填写正文**：正文区是 ProseMirror contenteditable div，用 `execCommand` 插入文字：
   - 先点击正文区聚焦：
     ```json
     { "action": "act", "profile": "openclaw", "request": { "kind": "click", "ref": "<正文ref>" } }
     ```
   - 然后用 JS 插入文字：
     ```json
     { "action": "act", "profile": "openclaw", "request": { "kind": "evaluate", "fn": "() => { const el = document.querySelector('.ql-editor, [contenteditable=true].ProseMirror, div[contenteditable=\"true\"]'); if(!el){ return 'editor not found'; } el.focus(); document.execCommand('insertText', false, '用户的正文内容'); return 'body text inserted'; }" } }
     ```

4. 做 snapshot 验证标题和正文是否已正确填入。如果没有，可尝试备用方案：先 click 聚焦，再 type 输入。

### Step 5: 校验并停手

1. 做最终 snapshot 截图：
   ```json
   { "action": "snapshot", "profile": "openclaw" }
   ```

2. 在结果中确认：
   - ✅ 图片缩略图可见
   - ✅ 标题已填
   - ✅ 正文已填
   - ✅ "发布"按钮可见

3. 告知用户：
   ```
   ✅ 图文准备完成，已停在发布按钮前
   - 封面: [已上传 N 张图片]
   - 标题: [标题内容]
   - 正文: [前30字...]

   ⚠️ 未点击发布。请在浏览器中确认内容无误后手动点击「发布」按钮。
   ```

## 故障处理

| 故障 | 处理 |
|------|------|
| 图片路径不存在 | 终止，提示用户检查路径 |
| upload 失败 | 重试 1 次；仍失败 snapshot 截图汇报 |
| 标题超 20 字 | 提示用户缩短，不截断 |
| 未登录 | 终止，引导用户先用 xiaohongshu-login 登录 |
| snapshot 显示意外页面 | 截图汇报，建议刷新重试 |
| act 点击/输入超时 | 重做 snapshot 确认元素 ref 仍有效，重试 1 次 |
| "No reply from agent" | 清理 session：`rm -rf ~/.openclaw/agents/xhs/sessions/` 后重试 |

## Agent 运行经验

### 图片路径与安全限制

- OpenClaw 的 upload action 要求文件位于 `/tmp/openclaw/uploads/` 下，其他路径会被拒绝
- 从 `/tmp/xhs/output.png`（头图生成产出）到 upload 目录的 cp 命令必须在 upload 之前执行
- 多张图片时用通配符：`cp /tmp/xhs/output*.png /tmp/openclaw/uploads/xhs-publish/`

### contenteditable 填写陷阱

- 小红书编辑器使用 ProseMirror（contenteditable div），标准 `fill` action 不生效
- **正确做法**：先 `click` 聚焦 → `evaluate` 执行 `document.execCommand('insertText', false, '...')`
- 标题输入框是标准 `<input>`，用 `evaluate` 配合 React native setter 最可靠
- 如果 `execCommand` 不生效，备用方案：`click` → `press Meta+a` 全选 → `type` 输入

### Opus 模型行为

- Opus 系模型可能在填写步骤中只输出"已填写标题"文字而未实际调用 tool
- **每步之后做 snapshot 验证**——确认标题/正文确实已出现在页面上
- 如果验证失败，用"直接调用browser工具"前缀重试该步骤
