#!/bin/bash
set -e

# One stack per Playwright worker isolates concurrent specs. Ports match tests/harness.ts
# and stay below the Windows ephemeral range (49152+). Default shard: 0.
# E2E_WORKER_PORT / E2E_APP_PORT override ports; VITE_PLUGINS narrows the assembly.

SHARD="${1:-0}"

# Inherited by all descendants so run-tests.sh can reap interrupted stacks via
# /proc/<pid>/environ without touching the developer's own kiao.
export KIAO_E2E=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
WORKER_DIR="$REPO_ROOT/operation/worker"
DASHBOARD_DIR="$REPO_ROOT/exchange/dashboard"
DATA_TEMPLATE="$REPO_ROOT/e2e/data/files-template"

WORKER_PORT="${E2E_WORKER_PORT:-$((48310 + SHARD))}"
APP_PORT="${E2E_APP_PORT:-$((48332 + SHARD))}"
LOG_TAG="${E2E_LOG_TAG:-shard-$SHARD}"

# Refuse an occupied worker port: Playwright probes only Dashboard and could otherwise
# run against another store even after this worker fails to bind.
listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if listening "$WORKER_PORT"; then
  echo "[E2E $LOG_TAG] port $WORKER_PORT is taken — refusing to run against a store that is not this stack's." >&2
  echo "[E2E $LOG_TAG]   A kiao container publishing it, or a stack an interrupted run left behind." >&2
  echo "[E2E $LOG_TAG]   Free that port, or give this stack another with E2E_WORKER_PORT." >&2
  exit 1
fi

TEMP_DATA_DIR="$(mktemp -d "/tmp/kiao-e2e-$LOG_TAG-XXXXXX")"
# Worker state in <root>/.kiao-config stays isolated and is removed with the temp store.
mkdir -p "$REPO_ROOT/log"
cp -r "$DATA_TEMPLATE/." "$TEMP_DATA_DIR/"
echo "[E2E $LOG_TAG] Created temp data at $TEMP_DATA_DIR"

# VITE_PLUGIN_PATHS also controls assembly and spec selection. Overlay each project
# fixture and add its id to the template's pinned plugin list so the store loads it.
IFS=',' read -ra PLUGIN_PATHS <<< "${VITE_PLUGIN_PATHS:-}"
for path in "${PLUGIN_PATHS[@]}"; do
  path="$(echo "$path" | xargs)"
  [ -n "$path" ] || continue
  dir="$(cd "$DASHBOARD_DIR" && cd "$path" && pwd)"
  if [ -d "$dir/e2e/files" ]; then cp -r "$dir/e2e/files/." "$TEMP_DATA_DIR/"; fi
  node -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const [config, manifest] = process.argv.slice(1);
    const id = JSON.parse(readFileSync(manifest, "utf-8")).kiaoPlugin.id;
    const store = JSON.parse(readFileSync(config, "utf-8"));
    if (!store.plugins.includes(id)) store.plugins.push(id);
    writeFileSync(config, JSON.stringify(store, null, 2) + "\n");
  ' "$TEMP_DATA_DIR/.kiao-config/dashboard.json" "$dir/package.json"
  echo "[E2E $LOG_TAG] Dropped in $(basename "$dir")"
done

# go run and npm fork the port holders. Kill descendants first to avoid stale services
# serving a deleted store when Playwright reuses an existing server.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

# TERM and EXIT can both invoke cleanup; keep it idempotent.
CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return 0
  CLEANED=1

  echo "[E2E $LOG_TAG] Stopping services..."
  kill_tree "$WORKER_PID"
  kill_tree "$CMS_PID"

  if [ -d "$TEMP_DATA_DIR" ]; then rm -rf "$TEMP_DATA_DIR"; fi
  echo "[E2E $LOG_TAG] Cleanup complete."
}
trap cleanup EXIT INT TERM

echo "[E2E $LOG_TAG] Starting Worker on $WORKER_PORT..."
# Keep toolchain lookup aligned with operation/worker/build.sh.
find_go() {
  if command -v go >/dev/null 2>&1; then command -v go; return; fi
  for c in /usr/local/go/bin/go "$HOME/go-sdk/go/bin/go" "$HOME/sdk/go/bin/go"; do
    if [ -x "$c" ]; then echo "$c"; return; fi
  done
  echo "ERROR: Go toolchain not found. Install Go 1.24+ (https://go.dev/dl/)." >&2
  exit 1
}
GO="$(find_go)"
cd "$WORKER_DIR"
export KIAO_WORKER_AUTH_MODE=debug
export KIAO_WORKER_ROOT_PATH="$TEMP_DATA_DIR"
export SERVER_PORT="$WORKER_PORT"
export GOTOOLCHAIN=local
"$GO" run . > "$REPO_ROOT/log/worker-$LOG_TAG.log" 2>&1 &
WORKER_PID=$!

# go run compiles before binding; watch for early exit while waiting for its port.
for _ in $(seq 120); do
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[E2E $LOG_TAG] worker exited before it was listening — see log/worker-$LOG_TAG.log:" >&2
    tail -3 "$REPO_ROOT/log/worker-$LOG_TAG.log" >&2
    exit 1
  fi
  listening "$WORKER_PORT" && break
  sleep 0.5
done

# Start Dashboard last: Playwright uses it as the stack readiness signal.
echo "[E2E $LOG_TAG] Starting Dashboard on $APP_PORT..."
cd "$DASHBOARD_DIR"
export VITE_NO_SECURITY=true
export VITE_BACKEND_URL="http://localhost:$WORKER_PORT"
if [ "${E2E_BUILT:-0}" = "1" ]; then
  # Exercise the delivered import map and lazy modules after `npm run build` (sequentially).
  npm run serve -- --port "$APP_PORT" > "$REPO_ROOT/log/dashboard-$LOG_TAG.log" 2>&1 &
else
  npm start -- --port "$APP_PORT" > "$REPO_ROOT/log/dashboard-$LOG_TAG.log" 2>&1 &
fi
CMS_PID=$!

echo "[E2E $LOG_TAG] Environment running..."
wait
