#!/usr/bin/env bash
set -euo pipefail

on_error() {
  echo "A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle" >&2
  echo "If this persists, verify pnpm deps and try again." >&2
}
trap on_error ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH_FILE="$ROOT_DIR/src/canvas-host/a2ui/.bundle.hash"
OUTPUT_FILE="$ROOT_DIR/src/canvas-host/a2ui/a2ui.bundle.js"
A2UI_RENDERER_DIR="$ROOT_DIR/vendor/a2ui/renderers/lit"
A2UI_APP_DIR="$ROOT_DIR/apps/shared/OpenClawKit/Tools/CanvasA2UI"
NODE_USES_WINDOWS_PATHS=0
NODE_BIN="$(command -v node || true)"
NODE_SHIM_DIR=""

if [[ -z "$NODE_BIN" ]]; then
  WINDOWS_NODE_BIN="$(command -v node.exe || true)"
  if [[ -z "$WINDOWS_NODE_BIN" ]]; then
    echo "Node.js runtime not found on PATH." >&2
    exit 1
  fi
  NODE_USES_WINDOWS_PATHS=1
  NODE_SHIM_DIR="$(mktemp -d)"
  export OPENCLAW_WINDOWS_NODE_BIN="$WINDOWS_NODE_BIN"
  cat > "$NODE_SHIM_DIR/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

convert_arg() {
  local candidate="$1"
  if [[ "$candidate" != /* || ! -e "$candidate" ]]; then
    printf '%s' "$candidate"
    return
  fi
  if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$candidate"
    return
  fi
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$candidate"
    return
  fi
  printf '%s' "$candidate"
}

converted_args=()
for arg in "$@"; do
  converted_args+=("$(convert_arg "$arg")")
done

exec "$OPENCLAW_WINDOWS_NODE_BIN" "${converted_args[@]}"
EOF
  chmod +x "$NODE_SHIM_DIR/node"
  export PATH="$NODE_SHIM_DIR:$PATH"
  NODE_BIN="node"
fi

cleanup() {
  if [[ -n "$NODE_SHIM_DIR" && -d "$NODE_SHIM_DIR" ]]; then
    rm -rf "$NODE_SHIM_DIR"
  fi
}
trap cleanup EXIT

node_path() {
  local input_path="$1"
  if [[ "$NODE_USES_WINDOWS_PATHS" -eq 0 ]]; then
    printf '%s' "$input_path"
    return
  fi
  if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$input_path"
    return
  fi
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$input_path"
    return
  fi
  printf '%s' "$input_path"
}

ROOT_DIR_FOR_NODE="$(node_path "$ROOT_DIR")"

# Docker builds exclude vendor/apps via .dockerignore.
# In that environment we can keep a prebuilt bundle only if it exists.
if [[ ! -d "$A2UI_RENDERER_DIR" || ! -d "$A2UI_APP_DIR" ]]; then
  if [[ -f "$OUTPUT_FILE" ]]; then
    echo "A2UI sources missing; keeping prebuilt bundle."
    exit 0
  fi
  echo "A2UI sources missing and no prebuilt bundle found at: $OUTPUT_FILE" >&2
  exit 1
fi

INPUT_PATHS=(
  "$ROOT_DIR/package.json"
  "$ROOT_DIR/pnpm-lock.yaml"
  "$A2UI_RENDERER_DIR"
  "$A2UI_APP_DIR"
)
INPUT_PATHS_FOR_NODE=()
for input_path in "${INPUT_PATHS[@]}"; do
  INPUT_PATHS_FOR_NODE+=("$(node_path "$input_path")")
done
ROLLEDOWN_CONFIG_FOR_NODE="$(node_path "$A2UI_APP_DIR/rolldown.config.mjs")"

compute_hash() {
  ROOT_DIR="$ROOT_DIR_FOR_NODE" "$NODE_BIN" --input-type=module --eval '
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = process.env.ROOT_DIR ?? process.cwd();
const inputs = process.argv.slice(1);
const files = [];

async function walk(entryPath) {
  const st = await fs.stat(entryPath);
  if (st.isDirectory()) {
    const entries = await fs.readdir(entryPath);
    for (const entry of entries) {
      await walk(path.join(entryPath, entry));
    }
    return;
  }
  files.push(entryPath);
}

for (const input of inputs) {
  await walk(input);
}

function normalize(p) {
  return p.split(path.sep).join("/");
}

files.sort((a, b) => normalize(a).localeCompare(normalize(b)));

const hash = createHash("sha256");
for (const filePath of files) {
  const rel = normalize(path.relative(rootDir, filePath));
  hash.update(rel);
  hash.update("\0");
  hash.update(await fs.readFile(filePath));
  hash.update("\0");
}

process.stdout.write(hash.digest("hex"));
' "${INPUT_PATHS_FOR_NODE[@]}"
}

current_hash="$(compute_hash)"
if [[ -f "$HASH_FILE" ]]; then
  previous_hash="$(cat "$HASH_FILE")"
  if [[ "$previous_hash" == "$current_hash" && -f "$OUTPUT_FILE" ]]; then
    echo "A2UI bundle up to date; skipping."
    exit 0
  fi
fi

pnpm -s exec tsc -p "$A2UI_RENDERER_DIR/tsconfig.json"
if command -v rolldown >/dev/null 2>&1 && rolldown --version >/dev/null 2>&1; then
  rolldown -c "$A2UI_APP_DIR/rolldown.config.mjs"
elif [[ -f "$ROOT_DIR/node_modules/.pnpm/node_modules/rolldown/bin/cli.mjs" ]]; then
  "$NODE_BIN" "$(node_path "$ROOT_DIR/node_modules/.pnpm/node_modules/rolldown/bin/cli.mjs")" \
    -c "$ROLLEDOWN_CONFIG_FOR_NODE"
elif [[ -f "$ROOT_DIR/node_modules/.pnpm/rolldown@1.0.0-rc.9/node_modules/rolldown/bin/cli.mjs" ]]; then
  "$NODE_BIN" "$(node_path "$ROOT_DIR/node_modules/.pnpm/rolldown@1.0.0-rc.9/node_modules/rolldown/bin/cli.mjs")" \
    -c "$ROLLEDOWN_CONFIG_FOR_NODE"
else
  pnpm -s dlx rolldown -c "$A2UI_APP_DIR/rolldown.config.mjs"
fi

echo "$current_hash" > "$HASH_FILE"
