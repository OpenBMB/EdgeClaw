#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "═══════════════════════════════════════════"
echo "  EdgeClaw 安装脚本"
echo "  目标: $OPENCLAW_HOME"
echo "═══════════════════════════════════════════"
echo

# ── 1. Extensions ─────────────────────────────────────────────

echo "▶ 安装 extensions..."

for ext in serp-search figma-capture; do
  src="$SCRIPT_DIR/extensions/$ext"
  dst="$OPENCLAW_HOME/extensions/$ext"
  if [ ! -d "$src" ]; then
    echo "  ⚠ 跳过 $ext（源目录不存在）"
    continue
  fi
  mkdir -p "$dst"
  cp -r "$src"/* "$dst"/
  echo "  ✓ $ext → $dst"
done

echo

# ── 2. Skills → agent workspace ──────────────────────────────

WORKSPACE="$OPENCLAW_HOME/workspace-xhs"
SKILLS_DIR="$WORKSPACE/skills"

echo "▶ 安装 skills 到 $SKILLS_DIR ..."

for skill_dir in "$SCRIPT_DIR"/skills/*/; do
  skill_name="$(basename "$skill_dir")"
  dst="$SKILLS_DIR/$skill_name"
  mkdir -p "$dst"
  cp -r "$skill_dir"* "$dst"/
  echo "  ✓ $skill_name → $dst"
done

echo

# ── 3. 示例配置 ──────────────────────────────────────────────

CONFIG_FILE="$OPENCLAW_HOME/openclaw.json"
EXAMPLE_FILE="$SCRIPT_DIR/openclaw.json.example"

if [ ! -f "$CONFIG_FILE" ]; then
  if [ -f "$EXAMPLE_FILE" ]; then
    cp "$EXAMPLE_FILE" "$CONFIG_FILE"
    echo "▶ 已创建配置文件: $CONFIG_FILE"
    echo "  ⚠ 请编辑该文件，填入你的 API Key"
  fi
else
  echo "▶ 配置文件已存在: $CONFIG_FILE"
  echo "  请手动合并 openclaw.json.example 中的内容"
fi

echo

# ── 4. 清理旧 session ────────────────────────────────────────

SESSIONS_DIR="$OPENCLAW_HOME/agents/xhs/sessions"
if [ -d "$SESSIONS_DIR" ] && [ "$(ls -A "$SESSIONS_DIR" 2>/dev/null)" ]; then
  echo "▶ 清理旧 agent session..."
  rm -f "$SESSIONS_DIR"/*.jsonl
  echo "  ✓ 已清理"
else
  echo "▶ 无旧 session 需要清理"
fi

echo
echo "═══════════════════════════════════════════"
echo "  ✅ 安装完成！"
echo ""
echo "  下一步："
echo "  1. 编辑 $CONFIG_FILE"
echo "     填入 LLM API Key 和 serp.hk API Key"
echo ""
echo "  2. 测试头图生成："
echo "     openclaw agent --agent xhs \\"
echo "       --message \"生成一张 AI 话题的小红书头图\" \\"
echo "       --local --timeout 300"
echo ""
echo "  3. 测试小红书发布："
echo "     openclaw agent --agent xhs \\"
echo "       --message \"登录小红书\" \\"
echo "       --local --timeout 120"
echo "═══════════════════════════════════════════"
