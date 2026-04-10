# EdgeClaw

小红书内容生产 + 自动发布工具包，基于 [OpenClaw](https://github.com/openclaw/openclaw) agent 平台。

两条可独立或串联使用的管线：

| 管线 | 功能 | 涉及组件 |
|------|------|----------|
| **头图生成** | Brief → 搜索素材 → 截图 → HTML 排版 → PNG → Figma | `brief-to-xhs-header` + `serp-search` + `figma-capture` |
| **小红书发布** | 登录 → 上传图片 → 填标题正文 → 审核 → 停在发布按钮前 | `xiaohongshu-login` + `xiaohongshu-publish` + `xiaohongshu-audit` |

通过编排技能 `xhs-orchestrator` 串联：一句话从 Brief 生成头图并发布到小红书。

## 快速开始

### 前置要求

- [OpenClaw](https://github.com/openclaw/openclaw)（`npm i -g openclaw`）
- Node.js 22+
- Google Chrome（headless 截图用）
- LLM API Key（Anthropic / OpenAI / 兼容代理）
- [serp.hk](https://serp.hk) API Key（Google 搜索，国内免翻墙）

### 一键安装

```bash
git clone https://github.com/OpenBMB/EdgeClaw.git
cd EdgeClaw
bash install.sh
```

脚本会把 skills 拷到 agent workspace，extensions 拷到 `~/.openclaw/extensions/`。

### 配置

```bash
cp openclaw.json.example ~/.openclaw/openclaw.json
# 然后编辑，填入你的 API Key
```

如果你已经有 `openclaw.json`，把示例里的 `agents`、`plugins`、`modelProviders` 部分合并进去即可。

### 运行

```bash
# 生成小红书头图
openclaw agent --agent xhs \
  --message "帮我生成一张关于 Claude 4 的小红书科技头图" \
  --local --timeout 300

# 发布到小红书（需要先扫码登录一次）
openclaw agent --agent xhs \
  --message "把 /tmp/xhs/output.png 发布到小红书，标题：Claude 4 来了" \
  --local --timeout 300
```

产出 PNG 在 `/tmp/xhs/output.png`，Figma 链接会在 agent 回复中给出。


## 管线详解

### 编排技能（xhs-orchestrator）

编排技能是全链路的入口，根据用户意图自动决定执行路径：

| 用户说 | 执行路径 |
|--------|----------|
| "帮我做个头图" | 仅头图生成 |
| "帮我发小红书" + 给了图片 | 登录 → 发布 → 审核 |
| "帮我发小红书" + 给了话题 | 头图生成 → 登录 → 发布 → 审核 |
| "一条龙" / "从 brief 到发布" | 全链路 |

### 管线 A：头图生成

```
用户 Brief（话题 / 风格 / 来源 URL）
  ├─ Step 1  serp_search 搜索 + Chrome 截图网页
  ├─ Step 2  从零写 HTML（8 套版式 recipe，每次不重复）
  ├─ Step 3  Chrome headless → PNG（支持 Retina 2x）
  └─ Step 4  figma_capture → Figma 设计链接
```

8 套内置版式：黑底大字、大色块截图、截图描边字、双调拼接、白底图文、聊天表情包、编号彩格、产品对比。每次生成自动切换，避免重复。

### 管线 B：小红书发布

```
login-skill    用 OpenClaw 浏览器登录 creator.xiaohongshu.com
                 ↓
publish-skill  上传图片 + 填标题/正文 → 停在发布按钮前
                 ↓
audit-skill    提取页面内容 → 合规审核 → 自动修改问题项
                 ↓
              用户手动点击「发布」
```

所有浏览器操作使用 `profile="openclaw"`，首次需要扫码登录，后续复用 session。

## Figma 集成（可选）

首次调用 `figma_capture` 时会弹出浏览器授权 Figma，点击 Allow 即可。Token 保存在 `~/.openclaw/credentials/figma-mcp.json`，约 90 天自动续期。

无需 Figma API Key，全程 OAuth 自动处理。


## 致谢
感谢[xiaohongshu-ops-skill](https://github.com/Xiangyu-CAS/xiaohongshu-ops-skill)提供的登录和发布技能。

## License

MIT
