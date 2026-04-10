---
name: brief-to-xhs-header
description: >-
  Dynamically generate social media header images (Xiaohongshu, WeChat, Douyin,
  etc.) from client briefs. Scrapes real posts from X/Twitter, Weibo, or any
  public page, then composes a fully custom HTML layout with localized text
  overlays and emoji, screenshots it, and optionally pushes to Figma. Use when
  user mentions "小红书头图", "XHS header", "brief to image", "甲方brief",
  "social screenshot", "营销图", or wants marketing visuals from social posts.
---

# Brief → Social Header Image

Dynamically generate marketing header images from a client brief. Every run
produces **fresh HTML** — no fixed templates. The agent decides layout, colors,
typography, and copy based on the brief content.

## Pipeline

```
User Brief (topic, platform, style, source)
  ├─ Step 0: Plan    — for multi-image sets, plan layout variants upfront
  ├─ Step 1: Gather  — serp_search / screenshot web pages / scrape posts
  ├─ Step 2: Compose — write a complete HTML file from scratch (per image)
  ├─ Step 3: Render  — Chrome headless screenshot → PNG
  ├─ Step 3b: Verify — read PNG, fix layout/cropping issues, re-render if needed
  └─ Step 4: Deliver — local PNG + figma_capture → Figma design URL
```

## Step 0: Plan Image Set (for multi-image briefs)

When the brief calls for a "组图" (image set), plan 2-4 images upfront:

- Each image uses a **different layout pattern** and **different source screenshot**
- Keep a consistent color mood across the set
- Number output files: `output-1.png`, `output-2.png`, etc.
- Use separate HTML files: `header-1.html`, `header-2.html`, etc.

## Step 1: Gather Source Material

Two primary methods — use whichever fits the source better.

### Method A: Chrome Headless Screenshot (preferred for most sources)

Directly screenshot any public web page. Works universally — no parsing needed.

```bash
mkdir -p /tmp/xhs/assets
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --screenshot=/tmp/xhs/assets/source-1.png \
  --window-size=900,600 --disable-gpu --force-device-scale-factor=2 \
  "<URL>"
```

Use `--force-device-scale-factor=2` for crisp retina screenshots.
Use `--window-size` to crop: `900,600` for landscape, `600,900` for portrait.

**Screenshot completeness rules (CRITICAL — source screenshots must be fully visible):**

**A. Capture phase — take a big enough screenshot:**

- Make `--window-size` wide/tall enough so key content (title, stats, description)
  is fully visible — NOT cut off at the edge.
- Recommended minimums:
  - HuggingFace model cards: `--window-size=1000,800`
  - GitHub repos: `--window-size=1000,800`
  - News articles: `--window-size=900,700`
  - General pages: `--window-size=1000,900`
- When in doubt, **increase height** — extra whitespace crops better than
  clipped text.
- After taking the screenshot, **read the PNG** to verify completeness.
  Re-take with larger dimensions if key content is cut off.

**B. Embedding phase — display the full screenshot in the HTML layout:**

- Use `object-fit: contain` (NOT `cover`) so the screenshot is fully visible.
- Do NOT constrain screenshots into tiny boxes that hide content.
- Give screenshot cards enough height in the layout — at least 400-500px
  per card so content is legible.
- If embedding multiple screenshots, use `flex: 1` with `min-height: 350px`
  per card so they share space proportionally.
- Screenshot cards should have `overflow: hidden; border-radius: 16px` for
  aesthetics, but the `<img>` inside must use:
  ```css
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #111;
  }
  ```
  The dark background fills any letterbox gaps.
- **Never** use `object-fit: cover` on source screenshots — it crops the
  very content the user wants to show.

**Common source URLs:**

| Source            | URL Pattern                            |
| ----------------- | -------------------------------------- |
| HuggingFace model | `https://huggingface.co/<org>/<model>` |
| GitHub repo       | `https://github.com/<org>/<repo>`      |
| ArXiv paper       | `https://arxiv.org/abs/<id>`           |
| News article      | Any news URL (Sina, 36kr, NBD, etc.)   |
| Product page      | Any public product/landing page        |

### Method B: Structured Scrape (for X/Twitter profile data)

Use **xcancel.com** to get structured tweet data (text, stats, avatar).
**Only works for profile pages** (`/username`), NOT search pages (blocked by CAPTCHA).

```bash
curl -s -L -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://xcancel.com/<username>" > /tmp/xhs/page.html
```

Extract with Python/regex from the HTML:

- `div.tweet-content.media-body` → post text
- `span.tweet-date a[title]` → date
- `span.tweet-stat` → comments, retweets, likes, views
- `img.avatar` → avatar URL (replace `_bigger` with `_400x400`)
- Check for `retweet-header` to skip retweets, `Pinned Tweet` to identify pins

**xcancel limitations:**

- Search pages (`/search?q=...`) require browser JS verification — `curl` fails
- Profile pages work reliably
- If blocked, fall back to Method A or WebSearch

### Method C: Search for topic-based research

When the brief specifies a topic (not a specific URL/account):

1. **Search** — use whichever search tool is available:
   - `serp_search` (preferred in OpenClaw — uses Google via serp.hk, works in China)
   - `web_search` (Cursor/Brave/Perplexity — needs accessible endpoint)
   - As last resort: `exec` with `curl` to serp.hk API directly
2. **Screenshot** — use Chrome headless (Method A) on the best URLs from results
3. **Extract** — pull key quotes/numbers from search results for overlay text

### Download Additional Assets

```bash
curl -s -o /tmp/xhs/assets/avatar.jpg "<avatar_url>"
curl -s -o /tmp/xhs/assets/media-1.jpg "<image_url>"
```

## Step 2: Compose HTML — Write From Scratch

**Do NOT use a fixed template.** Write a complete, self-contained HTML file
tailored to the brief. The file must render correctly when opened in Chrome.

### Working Directory

All files go in `/tmp/xhs/`. The main file is `/tmp/xhs/header.html`.
Reference local assets with relative paths (e.g. `src="assets/avatar.jpg"`).

### Size Presets

| Platform     | Dimensions  | Aspect Ratio |
| ------------ | ----------- | ------------ |
| 小红书 (XHS) | 1242 x 1660 | 3:4          |
| 小红书方图   | 1242 x 1242 | 1:1          |
| 微信公众号   | 900 x 500   | 16:9 (ish)   |
| 抖音封面     | 1080 x 1920 | 9:16         |
| Instagram    | 1080 x 1350 | 4:5          |

Default to **1242x1660** (XHS 3:4) unless the brief specifies otherwise.

### Design Principles

**DIVERSITY RULE (CRITICAL):** Every generation MUST look visually distinct.
Before writing HTML, pick ONE **layout recipe** from the catalog below.
NEVER default to the same recipe twice in a row. If the last run used a dark
background, pick a light or colored one next. If the last run was text-heavy,
try a screenshot-dominant layout next.

**ANTI-PATTERNS — NEVER DO THESE (they make designs look "AI-generated"):**

- ❌ `radial-gradient` / `linear-gradient` backgrounds (use FLAT solid colors)
- ❌ Ambient glows (`filter: blur(120px)`, luminous circles, bokeh effects)
- ❌ `backdrop-filter: blur()` / glass-morphism / frosted glass
- ❌ Gradient text (`-webkit-background-clip: text`)
- ❌ Neon / glow effects (`box-shadow` with bright colored blur)
- ❌ Browser chrome frames around screenshots (paste screenshot raw)
- ❌ Decorative grid lines, dot patterns, mesh backgrounds
- ❌ Multiple competing visual effects on one page
- ❌ "Data dashboard" stat rows with dark rounded-pill backgrounds
- ❌ Semi-transparent `rgba()` backgrounds on tags/cards (use SOLID colors)
- ❌ Subtle borders with low-opacity colors (use solid borders or no borders)

**THE REFERENCE STYLE — what real high-performing XHS covers look like:**

- ✅ **Flat solid colors** — pure `#000`, pure `#fff`, pure `#e63930`
- ✅ **Big bold text** — beauty comes from font size, weight, and spacing
- ✅ **1 accent color** — one keyword in a different flat color (e.g. pink `#f0b8b8`)
- ✅ **Wavy underlines** — `text-decoration: underline wavy` (only decoration allowed)
- ✅ **Simple pill tags** — white or pastel bg, rounded, no effects
- ✅ **Raw screenshots** — pasted directly, no borders, no browser chrome
- ✅ **Generous whitespace** — let elements breathe
- ✅ **Emoji as decoration** — used sparingly, inline or standalone

**Typography:**

- Chinese: `'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif`
  (load via `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;900&display=swap')`)
- English: system fonts or load `'Inter'` as needed
- Title size: 56–90px bold/black. Vary weight (700 vs 900) and placement.
- Body: 20–28px, 1.5 line-height
- Text colors: FLAT only — `#fff`, `#000`, `#1a1a1a`, `#f0b8b8` (pink accent). No gradients.

---

#### Layout Recipe Catalog

Each recipe is a self-contained design pattern derived from real high-performing
XHS covers. Pick one, adapt colors/content to the brief.

**Recipe 1: 黑底大字 + 散落标签 (Black + Scattered Tags)**

Pure black bg. Centered oversized title (white + one accent-color keyword).
Below title: row of circular avatars/logos. Below that: colored pill tags
scattered in organic rows (mix of `#f5c6c6` pink, white, light gray bg pills
with rounded corners). Top-left: small category badges in outlined rectangles.

```
┌─────────────────────────┐
│  [大模型] [具身智能]      │  ← small outlined badges, top-left
│                         │
│    #AskMeAnything       │  ← italic, 36px, cream/pink
│    我们的 梦导            │  ← 80px black, "梦导" in #f0b8b8 + wavy underline
│        ~~~              │
│    ○ ○ ○ ○ ○ ○ ○        │  ← circular avatars/logos, 64px
│    ○ ○ ○ ○              │
│                         │
│ ┌────┐ ┌────┐ ┌────┐    │  ← pill tags: white bg + rounded, or pink bg
│ │北京大学│ │清华大学│ │西湖大学│    │     scattered in 4-5 rows, varied sizes
│ ┌────────┐ ┌────┐       │
│ │华东师范大学│ │复旦大学│       │
│ └────────┘ └────┘       │
└─────────────────────────┘
```

Key CSS: `body { background: #000; }` Tags: `background: #fff; border-radius:
24px; padding: 10px 28px; font-size: 26px; font-weight: 700;` Pink tags:
`background: #f5c6c6;` Accent keyword: `color: #f0b8b8;` with wavy underline
(`text-decoration: wavy underline #f0b8b8;`). Category badges: `border: 2px
solid #666; border-radius: 8px; padding: 6px 16px; color: #aaa; font-size: 18px;`

**Recipe 2: 大色块 + 截图 + Logo叠加 (Color Block + Screenshot)**

Top 35%: solid bright color block (e.g. `#e63930` red). Contains stock ticker
or short bold text in white. Bottom 65%: full-width screenshot of a webpage/app
(no border, edge-to-edge). A large app logo/icon (120px, rounded-2xl, with
shadow) overlaid at the junction of color block and screenshot. Optional:
celebration emoji (confetti 🎉) in bottom-right corner.

```
┌─────────────────────────┐
│  ██████████████████████  │  ← solid red/blue/green block
│       02513.HK          │  ← white, 36px, bold
│   让我们恭喜 智谱         │  ← white+accent, 72px, "智谱" wavy underline
│         ┌──────┐        │
│─────────│ LOGO │────────│  ← logo overlaid at boundary
│         └──────┘        │
│  ┌───────────────────┐  │
│  │   (screenshot)     │  │  ← screenshot fills bottom area
│  │   招股价 116.200    │  │
│  │   每手股数 100      │  │
│  └───────────────────┘  │
│                    🎉   │
└─────────────────────────┘
```

Key CSS: Color block: `background: #e63930;` Logo: `width: 120px; height: 120px;
border-radius: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); position: absolute;
top: 50%; left: 50%; transform: translate(-50%, -50%);` Screenshot: `width: 100%;
object-fit: cover; object-position: top;`

**Recipe 3: 截图全铺 + 粗描边大字 (Full-Bleed + Stroke Text)**

Screenshot fills the entire canvas. Oversized Chinese text (60-80px) overlaid
in the center with thick white/black stroke so it reads over any background.
Optional: thinking emoji (🤔) above text. The text describes what's happening
in the screenshot — punchy, meme-like.

```
┌─────────────────────────┐
│  (screenshot fills all)  │
│                         │
│          🤔             │
│   GLM-5快发布了           │  ← 72px, white fill + 4px black stroke
│   这个模型是 GLM-5       │  ← or black fill + 4px white stroke
│                         │
│  (screenshot continues)  │
└─────────────────────────┘
```

Key CSS: Text: `font-size: 72px; font-weight: 900; color: #fff;
-webkit-text-stroke: 4px #000; text-shadow: 0 4px 16px rgba(0,0,0,0.5);
position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
text-align: center; width: 90%;` Background image: `width: 100%; height: 100%;
object-fit: cover;`

**Recipe 4: 双调拼接 (Dual-Tone Split)**

Top half: light bg (`#f5f5f5` or white) with text metadata (repo name, model
info, date, small logos). Bottom half: dark bg (`#1e293b`) with a screenshot
card (rounded, with shadow) and large accent text overlaid. Clean boundary
between halves.

```
┌─────────────────────────┐
│  openrouter/pony-alpha   │  ← light area: small text, metadata
│  Pony Alpha              │  ← product name, 48px
│  🐎 Pony 国产实锤         │  ← 64px, bold, emoji prefix
│  ⚡ Created Feb 6, 2026  │  ← small metadata line
│═════════════════════════│  ← split line
│  ┌───────────────────┐  │  ← dark area
│  │   (screenshot)     │  │  ← rounded card with shadow
│  │   GLM-5 !         │  │  ← accent text overlaid on card
│  └───────────────────┘  │
│     ≪ OpenRouter        │  ← footer logo
└─────────────────────────┘
```

Key CSS: Top: `background: #f8f9fa;` Bottom: `background: #1a1f2e;`
Screenshot card: `border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
margin: 0 auto; max-width: 85%;`

**Recipe 5: 白底图文 (Clean White + Charts/Images)**

Pure white bg. Structured content: charts, benchmark images, or product
comparison photos at the top. Below: clean text blocks with bold headings,
bullet points, feature lists. Feels like a polished document or product page.
Good for data-heavy or product showcase content.

```
┌─────────────────────────┐
│  ┌─────────────────────┐│
│  │ (benchmark chart)    ││  ← bar chart, comparison image
│  │ ImgEdit  GEdit  Red  ││
│  └─────────────────────┘│
│                         │
│  新功能效果               │  ← 32px bold heading
│  大幅强化ID一致性...       │  ← 22px body text
│                         │
│  极致的性能体验            │  ← 32px bold heading
│  Lora训练代码开源...       │  ← 22px body text
│  端到端速度4.5s 🚀        │  ← inline emoji
└─────────────────────────┘
```

Key CSS: `body { background: #fff; color: #1a1a1a; padding: 48px; }`
Headings: `font-size: 32px; font-weight: 900;` Body: `font-size: 22px;
line-height: 1.7; color: #333;` Image: `border-radius: 12px;
border: 1px solid #eee;`

**Recipe 6: 聊天截图 + 表情包 (Chat + Meme)**

Top area: chat bubble screenshots (light blue/gray bubble UI). Middle: a
meme-style photo/image that's humorous or attention-grabbing. Bottom: huge
bold black text on white — the punchline or CTA. Very viral/humor-oriented.

```
┌─────────────────────────┐
│  ┌─────────────────┐    │  ← chat bubble (light blue bg, rounded)
│  │给我一个邀测码      │    │
│  └─────────────────┘    │
│  邀测码需要通过官方渠道... │  ← reply text (no bubble, gray)
│                         │
│  ┌───────────────────┐  │
│  │                   │  │  ← meme photo (person bowing, funny img)
│  │   (meme image)    │  │
│  │                   │  │
│  └───────────────────┘  │
│                         │
│   替我上班码              │  ← 80px, black, ultra-bold
│                         │
└─────────────────────────┘
```

Key CSS: Chat bubble: `background: #e3f2fd; border-radius: 16px 16px 16px 4px;
padding: 16px 24px; max-width: 75%; font-size: 24px;` Punchline:
`font-size: 80px; font-weight: 900; color: #000; text-align: center;`
White bg, meme image: `max-width: 90%; border-radius: 8px;`

**Recipe 7: 编号彩格 (Numbered Color Grid)**

Black bg. Top section: large bold title (white + pink accent, wavy underline).
Middle: illustration or diagram image. Bottom: 2x2 grid of colored cells,
each with a number (01, 02, 03, 04) and short label. Each cell has a different
pastel color (yellow, pink, lavender, peach).

```
┌─────────────────────────┐
│                         │  ← black bg
│  数字生命卡兹课            │  ← 56px white, bold
│  创作全流程分享    ~~~     │  ← accent color + wavy underline
│                         │
│     课代表笔记             │  ← pink block badge
│                         │
│  ┌───────────────────┐  │
│  │   (illustration)   │  │  ← diagram/flowchart/illustration
│  └───────────────────┘  │
│                         │
│ ┌──────┐ ┌──────┐       │  ← 2x2 pastel grid
│ │ 01   │ │ 02   │       │     yellow, pink, lavender, peach
│ │如何选题│ │角度切入│       │
│ ├──────┤ ├──────┤       │
│ │ 03   │ │ 04   │       │
│ │结构节奏│ │数据复盘│       │
│ └──────┘ └──────┘       │
└─────────────────────────┘
```

Key CSS: Grid cells: `border-radius: 16px; padding: 24px; font-size: 24px;
font-weight: 700;` Colors: `#fef3c7` (yellow), `#fce7f3` (pink),
`#ede9fe` (lavender), `#fed7aa` (peach). Numbers: `font-size: 36px;
font-weight: 900; color: inherit; opacity: 0.7;`

**Recipe 8: 产品对比 (Product Comparison)**

White bg. Top area: 2 side-by-side product photos (before/after, input/output).
Middle: large bold title centered. Bottom: 3+ smaller comparison images in a
row with labels underneath. Footer: descriptive text paragraph.

```
┌─────────────────────────┐
│  ┌──────┐  ┌──────┐     │  ← two main images side by side
│  │input │  │output│     │
│  └──────┘  └──────┘     │
│                         │
│     古风换背景            │  ← 64px, bold, centered
│                         │
│  输入         FireRed 1.1│  ← labels
│  ┌────┐ ┌────┐ ┌────┐   │  ← 3 comparison thumbnails
│  │img1│ │img2│ │img3│   │
│  └────┘ └────┘ └────┘   │
│  Qwen   Longcat  Flux   │  ← model/source labels
│                         │
│  将背景换为带自然光效...    │  ← 18px description paragraph
└─────────────────────────┘
```

Key CSS: `body { background: #fff; }` Main images: `border-radius: 16px;
width: 48%; object-fit: cover;` Title: `font-size: 64px; font-weight: 900;`
Thumbnails: `border-radius: 12px; width: 30%;` Labels: `font-size: 18px;
color: #666; text-align: center;`

---

**Recipe Selection Rules:**

- NEVER use the same recipe twice in a row
- Match recipe to content type:
  - Tech/AI announcements → Recipe 1, 3, or 4
  - IPO/business news → Recipe 2
  - Tutorials/courses → Recipe 7
  - Product demos → Recipe 5 or 8
  - Viral/humor → Recipe 6
  - Multi-person/org showcase → Recipe 1
- For multi-image sets: use 2-3 DIFFERENT recipes but keep consistent
  color accent across the set
- Freely remix: e.g. Recipe 1 structure with Recipe 2 color scheme
- Dark bg recipes (1, 3, 7) work for tech/AI; light bg recipes (5, 6, 8)
  for product/lifestyle; colored bg recipes (2) for news/celebration

**Color Palette Quick Reference:**

| Use Case         | Primary       | Accent         | Tags        |
| ---------------- | ------------- | -------------- | ----------- |
| Tech/AI          | `#000000`     | `#f0b8b8` pink | white pills |
| News/Celebration | `#e63930` red | `#ffffff`      | —           |
| Product/Demo     | `#ffffff`     | `#000000`      | —           |
| Tutorial         | `#000000`     | `#f0b8b8`      | pastel grid |
| Lifestyle        | `#f8f9fa`     | `#1a1a1a`      | —           |

**Reusable CSS Snippets (flat, simple, no effects):**

```css
/* ── Backgrounds (always flat solid) ── */
.bg-black {
  background: #000;
  color: #fff;
}
.bg-white {
  background: #fff;
  color: #1a1a1a;
}
.bg-red {
  background: #e63930;
  color: #fff;
}

/* ── Pill tags ── */
.tag-pill {
  display: inline-block;
  padding: 12px 28px;
  border-radius: 24px;
  font-size: 26px;
  font-weight: 700;
  margin: 6px;
}
.tag-pill.white {
  background: #fff;
  color: #1a1a1a;
}
.tag-pill.pink {
  background: #f5c6c6;
  color: #1a1a1a;
}

/* ── Category badge (thin outlined box) ── */
.cat-badge {
  display: inline-block;
  border: 2px solid #666;
  border-radius: 8px;
  padding: 6px 16px;
  color: #aaa;
  font-size: 18px;
  font-weight: 600;
}

/* ── Accent keyword (flat color + optional wavy underline) ── */
.accent {
  color: #f0b8b8;
}
.accent-wavy {
  color: #f0b8b8;
  text-decoration: underline wavy #f0b8b8;
  text-underline-offset: 8px;
}

/* ── Stroke text (for Recipe 3 overlay only) ── */
.stroke-text {
  font-size: 72px;
  font-weight: 900;
  color: #fff;
  -webkit-text-stroke: 4px #000;
}

/* ── Chat bubble (Recipe 6) ── */
.chat-bubble {
  background: #e3f2fd;
  border-radius: 16px 16px 16px 4px;
  padding: 16px 24px;
  max-width: 75%;
  font-size: 24px;
  color: #1a1a1a;
}

/* ── Pastel grid cell (Recipe 7) ── */
.grid-cell {
  border-radius: 16px;
  padding: 24px 20px;
  text-align: center;
  font-weight: 700;
  font-size: 24px;
}
.grid-yellow {
  background: #fef3c7;
  color: #92400e;
}
.grid-pink {
  background: #fce7f3;
  color: #9d174d;
}
.grid-lavender {
  background: #ede9fe;
  color: #5b21b6;
}
.grid-peach {
  background: #fed7aa;
  color: #9a3412;
}

/* ── Avatar circles ── */
.avatar-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid #333;
}

/* ── Screenshot embed (raw, no browser chrome) ── */
.screenshot img {
  width: 100%;
  object-fit: contain;
}
```

**What NOT to put in CSS (reminder):** no `filter: blur`, no `radial-gradient`,
no `backdrop-filter`, no `-webkit-background-clip: text`, no `box-shadow` with
colored blur, no `linear-gradient` on backgrounds.

### Source Post Card Rendering

When embedding a social post, render it faithfully to match the original platform:

**X/Twitter dark card** — `#16181c` bg, `#e7e9ea` text, `#71767b` muted,
round avatar, verified badge SVG (see [examples/x-card.html](examples/x-card.html)),
stat row with comments/reposts/likes.

**X/Twitter light card** — `#fff` bg, `#0f1419` text, `#536471` muted, same layout.

**Weibo card** — `#fff` bg, orange accent `#ff8200`, user level badge.

Adapt card styles to match the actual source platform. Don't use X card styles
for a Weibo post.

### Chinese Copy Generation

From the scraped content, generate all Chinese text fresh each time:

| Element       | Guidelines                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tag badge** | 2-4 chars, category label. E.g. "AI 前沿", "科技热点", "财经速报", "娱乐八卦"                                                                                             |
| **Title**     | 2-3 lines, max 15 chars/line. Highlight 1-2 keywords with a FLAT accent color (`#f0b8b8` on dark, `#e63930` on light) or wavy underline. 0-2 emoji max. NO gradient text. |
| **Subtitle**  | 1 line, smaller font, 60% opacity. Summarize the "so what". Optional — skip if layout is already clear.                                                                   |
| **Hashtags**  | 3-5 tags as simple pill tags (white/pink bg). Optional emoji prefix.                                                                                                      |
| **CTA**       | Optional. 1 line max. Only if the recipe calls for it.                                                                                                                    |

**Tone rules (vary based on recipe):**

- **Recipe 1 (黑底大字)**: bold hashtag + punchy keyword title ("我们的梦导", "业界AI大厂")
- **Recipe 2 (大色块)**: celebratory, news-style ("让我们恭喜智谱！")
- **Recipe 3 (截图+描边)**: meme-like, attention-grabbing ("GLM-5快发布了")
- **Recipe 4 (双调拼接)**: factual + opinionated mix ("Pony 国产实锤")
- **Recipe 5 (白底图文)**: professional, feature-list ("新功能效果", "极致的性能体验")
- **Recipe 6 (聊天+表情包)**: viral humor, punchline-driven ("替我上班码")
- **Recipe 7 (编号彩格)**: structured tutorial ("课代表笔记", "01 如何选题")
- **Recipe 8 (产品对比)**: descriptive, comparison-oriented ("古风换背景")
- Match the emotion of the source content; use emoji sparingly but naturally

### HTML 文件写入方式（Agent exec 环境）

在 OpenClaw agent 的 exec 工具中写入 HTML 文件时，**heredoc 会超时或丢失内容**。
请使用以下替代方案（按可靠性排序）：

**方案 1（推荐）：Python 写文件**
```bash
python3 -c "
html = '''<!DOCTYPE html>
<html><head><meta charset=\"utf-8\">
<style>body{width:1080px;height:1440px;background:#000;color:#fff}</style>
</head><body><h1>标题</h1></body></html>'''
with open('/tmp/xhs/header.html','w') as f: f.write(html)
print('written')
"
```

**方案 2：echo 分段写入**
```bash
echo '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' > /tmp/xhs/header.html
echo 'body{width:1080px;height:1440px;background:#000;color:#fff}' >> /tmp/xhs/header.html
echo '</style></head><body><h1>标题</h1></body></html>' >> /tmp/xhs/header.html
```

**方案 3（禁止）：heredoc**
```bash
# ⛔ 不要用 heredoc——在 agent exec 环境中会超时
cat > /tmp/xhs/header.html << 'EOF'
...
EOF
```

### HTML Structure Checklist

Before writing the HTML, verify it includes:

- [ ] `<!DOCTYPE html>` + `<meta charset="utf-8">`
- [ ] Google Fonts import for Noto Sans SC
- [ ] `body` with fixed `width` and `height` matching the size preset
- [ ] `overflow: hidden` on body
- [ ] All images use relative paths to `/tmp/xhs/assets/`
- [ ] No external dependencies besides Google Fonts
- [ ] All emoji as HTML entities (e.g. `&#128293;`) not raw emoji (Chrome headless may not render them)

## Step 3: Render to PNG

Screenshot the HTML with Chrome headless:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --screenshot=/tmp/xhs/output.png \
  --window-size=<WIDTH>,<HEIGHT> \
  --disable-gpu \
  --force-device-scale-factor=1 \
  "file:///tmp/xhs/header.html"
```

**After rendering:** Read the output PNG to verify. If layout is broken (overlap,
clipping, misalignment), fix the HTML and re-render. Iterate until it looks right.

### Multi-Image Sets

For image sets, render each HTML file separately:

```bash
for i in 1 2 3; do
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --headless=new --screenshot=/tmp/xhs/output-$i.png \
    --window-size=1242,1660 --disable-gpu --force-device-scale-factor=1 \
    "file:///tmp/xhs/header-$i.html"
done
```

### Retina Output (optional)

For 2x resolution: set `--force-device-scale-factor=2`, keep same `--window-size`.
Output will be 2x pixel dimensions.

## Step 4: Deliver (always push to Figma + local PNG)

Every run should produce **both** local PNG files AND a Figma link.

### 4a. Local files

Output PNGs at `/tmp/xhs/output.png` (or `output-1.png`, `output-2.png`).
Tell the user the file paths.

### 4b. Push to Figma (default — always do this)

Convert the HTML to an editable Figma design so the user gets a clickable link.
Use whichever method is available in your environment.

**Environment A: Cursor (with Figma MCP)**

1. Inject the Figma capture script into **each** HTML `<head>` (before `</head>`):

   ```html
   <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async></script>
   ```

2. Start a local HTTP server (required — Figma cannot capture `file://` URLs):

   ```bash
   cd /tmp/xhs && python3 -m http.server 8765 &
   SERVER_PID=$!
   ```

3. Call `generate_figma_design` MCP tool:
   - `outputMode`: `"newFile"` (creates a new Figma file per run)
   - `fileName`: descriptive name for the design

4. Open the page with the captureId hash from the MCP response:

   ```bash
   open "http://localhost:8765/header.html#figmacapture=<captureId>&figmaendpoint=<endpoint>&figmadelay=3000"
   ```

5. Poll `generate_figma_design` with `captureId` until status is `completed`.

6. Kill the server and return the Figma URL.

**Environment B: OpenClaw agent (with `figma_capture` tool)**

The `figma_capture` tool is a built-in OpenClaw plugin tool that handles
the full Figma MCP flow automatically (OAuth + capture + polling).

```
figma_capture({ htmlPath: "/tmp/xhs/header.html", fileName: "VoxCPM2 头图" })
```

**What it does internally:**

1. Authenticates with Figma MCP via OAuth (first run opens browser for
   one-time authorization; tokens are stored and auto-refreshed)
2. Calls `generate_figma_design` to get a captureId
3. Injects capture.js into the HTML
4. Starts a local HTTP server and opens the page in the browser
5. Polls until capture completes
6. Returns a Figma design URL

**First-time setup:**

- On first call, a browser window opens asking you to authorize with Figma
- Click "Allow access" — tokens are saved to `~/.openclaw/credentials/figma-mcp.json`
- Subsequent calls are fully automatic (token auto-refreshes for ~90 days)

If `figma_capture` is not available, deliver local PNG files only and note
the limitation.

## Examples

### Example 1: Tech tweet → XHS dark header

> Brief: "马斯克关于AI的最新推文，做小红书科技头图"

Agent actions:

1. Scrape @elonmusk via xcancel → get latest AI-related tweet
2. Choose: Tech/AI mood (dark bg, blue/purple accent), Title-Card layout
3. Write HTML: robot emoji title, blue gradient highlights, X dark card, tech hashtags
4. Render 1242x1660 PNG

### Example 2: Fashion influencer → XHS light header

> Brief: "截图某时尚博主的穿搭帖子，做一张小红书种草图"

Agent actions:

1. Scrape the specified account
2. Choose: Lifestyle mood (light bg, pink accent), Full-Bleed layout
3. Write HTML: outfit photo as blurred background, post text overlay, pink tags
4. Render 1242x1660 PNG

### Example 3: Breaking news → WeChat cover

> Brief: "用这条新闻链接做一张公众号封面"

Agent actions:

1. WebFetch the news URL → extract headline + key quote
2. Choose: Hot take mood, Quote Hero layout, 900x500 dimensions
3. Write HTML: centered quote, news source attribution, red accent
4. Render 900x500 PNG

## Running via OpenClaw Agent

This skill can also be invoked through the OpenClaw CLI agent:

```bash
openclaw agent --agent xhs --message "<your brief>" --local --timeout 300
```

**Setup (one-time):**

1. Add your model to `~/.openclaw/openclaw.json` under `models.providers`:

```json5
{
  models: {
    providers: {
      "openrouter-api": {
        baseUrl: "https://<your-proxy-host>/v1",  // any OpenAI-compatible proxy
        apiKey: "<your-api-key>",
        api: "openai-completions",
        models: [
          {
            id: "claude-opus-4-5-20251101",  // recommended for complex tasks
            name: "Claude Opus 4.5",
            reasoning: false,
            input: ["text"],
            contextWindow: 200000,
            maxTokens: 16384,
            compat: {
              maxTokensField: "max_tokens",
              supportsDeveloperRole: true,
              supportsStrictMode: true,
            },
          },
          {
            id: "claude-sonnet-4-5-20250929",  // recommended for speed
            name: "Claude Sonnet 4.5",
            reasoning: false,
            input: ["text"],
            contextWindow: 200000,
            maxTokens: 16384,
            compat: {
              maxTokensField: "max_tokens",
              supportsDeveloperRole: true,
              supportsStrictMode: true,
            },
          },
          // ⚠️ DO NOT use claude-opus-4-6 — tool calling returns 0 tokens on proxies
        ],
      },
    },
  },
}
```

2. Add the XHS agent entry under `agents.list`:

```json5
{
  agents: {
    list: [
      {
        id: "xhs",
        name: "XHS Header Agent",
        workspace: "~/.openclaw/workspace-xhs",
        model: { primary: "openrouter-api/claude-sonnet-4-5-20250929" },
        skills: ["brief-to-xhs-header"],
        sandbox: { mode: "off" }, // Chrome headless needs unsandboxed exec
      },
    ],
  },
}
```

3. Copy the skill files to the agent workspace:

```bash
mkdir -p ~/.openclaw/workspace-xhs/skills/brief-to-xhs-header
cp SKILL.md examples/ scripts/ ~/.openclaw/workspace-xhs/skills/brief-to-xhs-header/
```

4. Install plugins (two separate extensions):

```bash
# Search tool — ~/.openclaw/extensions/serp-search/
# Files: index.ts, openclaw.plugin.json, package.json

# Figma tool — ~/.openclaw/extensions/figma-capture/
# Files: index.ts, figma-capture.ts, figma-mcp-client.ts,
#        openclaw.plugin.json, package.json
```

Configure in `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    entries: {
      "serp-search": {
        config: {
          apiKey: "<your-serp.hk-api-key>", // for serp_search tool
        },
      },
      // figma-capture needs no config — handles OAuth automatically on first use
    },
  },
}
```

**Known limitations & operational lessons:**

- Chrome headless via `exec` can be slower than direct shell (page load timeouts).
  If Chrome hangs, increase the exec `timeout` or use pre-screenshotted assets.
- If a privacy/router plugin overrides the model provider, disable it for XHS
  agent sessions or set `plugins.deny` in config.
- Figma capture requires a browser on the host machine (opens a tab for capture).
  On headless/remote servers without a display, skip the Figma step and deliver
  PNG files only.
- On first `figma_capture` call, a browser window opens for Figma authorization.
  This is one-time only; tokens are stored and auto-refreshed.
- Clear stale sessions (`rm -rf ~/.openclaw/agents/xhs/sessions/`) if the
  agent returns "No reply" — large session history can cause 0-token responses
  with some model providers.

**Model compatibility (critical for OpenClaw agent mode):**

| Model | Tool Calling | Notes |
|-------|-------------|-------|
| `claude-sonnet-4-5-20250929` | ✅ stable | **Recommended** — fast, reliable tool calling |
| `claude-opus-4-5-20251101` | ✅ works | Slower (~50-70s/turn) but stronger reasoning |
| `claude-opus-4-6` | ❌ broken | 0 output tokens on third-party proxies |
| `gemini-2.5-flash` | ⚠️ unstable | Text-only works; tool calling may fail silently |

**Agent prompting tips:**

- Opus models tend to output a text plan instead of executing tools. Use explicit
  prefixes like `直接调用exec工具（不要解释）：` to force immediate tool invocation.
- Avoid multi-step instructions in a single `--message`; split into one tool call
  per agent invocation for reliability.
- Heredoc (`cat > file << 'EOF'`) in agent `exec` can timeout or lose content.
  For writing HTML files, prefer shorter `echo` commands or split the write into
  multiple steps.

**Browser screenshot pixel limit:**

- OpenClaw's browser `snapshot` tool has a 25-million-pixel limit. Full-page
  screenshots of long pages (e.g. GitHub READMEs) may exceed this and fail.
- Prefer viewport-only screenshots using Chrome headless `--window-size` instead
  of browser `snapshot` for source material capture.
- Use `exec` with Chrome headless for screenshot tasks — it's more reliable than
  the browser tool's built-in screenshot for large pages.

## Reference

- Example X card: [examples/x-card.html](examples/x-card.html)
- Figma MCP client: `~/.openclaw/extensions/figma-capture/figma-mcp-client.ts`
- Figma credentials: `~/.openclaw/credentials/figma-mcp.json`
- Figma skills (Cursor): load `figma-use` before any `use_figma` call; load `figma-generate-design` for screen building
