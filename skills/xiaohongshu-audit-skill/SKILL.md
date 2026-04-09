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
