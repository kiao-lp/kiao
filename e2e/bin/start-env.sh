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
AGENTIC_PORT="${E2E_AGENTIC_PORT:-$((WORKER_PORT + 50))}"
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

if listening "$AGENTIC_PORT"; then
  echo "[E2E $LOG_TAG] resource port $AGENTIC_PORT is taken; set E2E_AGENTIC_PORT to a free port." >&2
  exit 1
fi

TEMP_DCMS_ROOT="$(mktemp -d "/tmp/kiao-e2e-$LOG_TAG-XXXXXX")"
# Worker state in <root>/.kiao-config stays isolated and is removed with the temp store.
mkdir -p "$REPO_ROOT/log"
cp -r "$DATA_TEMPLATE/." "$TEMP_DCMS_ROOT/"
echo "[E2E $LOG_TAG] Created temporary DCMS root at $TEMP_DCMS_ROOT"

# VITE_PLUGIN_PATHS also controls assembly and spec selection. Overlay each project
# fixture and add its id to the template's pinned plugin list so the store loads it.
IFS=',' read -ra PLUGIN_PATHS <<< "${VITE_PLUGIN_PATHS:-}"
for path in "${PLUGIN_PATHS[@]}"; do
  path="$(echo "$path" | xargs)"
  [ -n "$path" ] || continue
  dir="$(cd "$DASHBOARD_DIR" && cd "$path" && pwd)"
  if [ -d "$dir/e2e/files" ]; then cp -r "$dir/e2e/files/." "$TEMP_DCMS_ROOT/"; fi
  node -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const [config, manifest] = process.argv.slice(1);
    const id = JSON.parse(readFileSync(manifest, "utf-8")).kiaoPlugin.id;
    const store = JSON.parse(readFileSync(config, "utf-8"));
    if (!store.plugins.includes(id)) store.plugins.push(id);
    writeFileSync(config, JSON.stringify(store, null, 2) + "\n");
  ' "$TEMP_DCMS_ROOT/.kiao-config/dashboard.json" "$dir/package.json"
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
  kill_tree "$AGENTIC_PID"

  if [ -d "$TEMP_DCMS_ROOT/.kiao-config/agentic-packages" ]; then
    find "$TEMP_DCMS_ROOT/.kiao-config/agentic-packages" -type d -exec chmod u+w {} +
  fi
  if [ -d "$TEMP_DCMS_ROOT" ]; then rm -rf "$TEMP_DCMS_ROOT"; fi
  echo "[E2E $LOG_TAG] Cleanup complete."
}
trap cleanup EXIT INT TERM

echo "[E2E $LOG_TAG] Starting Worker on $WORKER_PORT..."
GO="$("$REPO_ROOT/bin/find-go.sh")"
# Let this Go locate its SDK instead of inheriting another installation's root.
unset GOROOT
cd "$WORKER_DIR"
export KIAO_WORKER_AUTH_MODE=debug
export KIAO_WORKER_DCMS_ROOT="$TEMP_DCMS_ROOT"
export KIAO_WORKER_MIGRATIONS_ENABLED=false
export SERVER_PORT="$WORKER_PORT"
export GOTOOLCHAIN=local
export KIAO_AGENTIC_RESOURCE_MANAGER_URL="http://localhost:$AGENTIC_PORT"
export KIAO_AGENTIC_RESOURCE_MANAGER_AUTH_MODE=debug
export KIAO_AGENTIC_RESOURCE_MANAGER_PORT="$AGENTIC_PORT"
resource_root="$TEMP_DCMS_ROOT/agentic-resource-management"
export KIAO_AGENTIC_RESOURCES_PATH="$resource_root/agents"
export KIAO_AGENTIC_DEPENDENCIES_PATH="$resource_root/dependencies"
export KIAO_AGENTIC_RESOURCE_MANAGER_CACHE="$TEMP_DCMS_ROOT/.kiao-config/agentic-cache"
export KIAO_AGENTIC_RESOURCE_MANAGER_SERVICE_TOKEN=""
python3 "$REPO_ROOT/bin/stage-agentic-repositories.py" prepare "$resource_root"
cp -r "$REPO_ROOT/e2e/data/agentic-dependencies" "$KIAO_AGENTIC_DEPENDENCIES_PATH"
for fixture in "$KIAO_AGENTIC_DEPENDENCIES_PATH"/*/; do
  git -C "$fixture" init -q -b main
  git -C "$fixture" add --all
  git -C "$fixture" -c user.name=Test -c user.email=test@localhost commit -qm 'add dependency fixture'
done
( cd "$REPO_ROOT/operation/agentic-resource-manager" && exec "$GO" run . ) > "$REPO_ROOT/log/agentic-$LOG_TAG.log" 2>&1 &
AGENTIC_PID=$!
"$GO" run . > "$REPO_ROOT/log/worker-$LOG_TAG.log" 2>&1 &
WORKER_PID=$!

# go run compiles before binding; watch for early exit while waiting for its port.
for _ in $(seq 120); do
  if ! kill -0 "$WORKER_PID" 2>/dev/null; then
    echo "[E2E $LOG_TAG] worker exited before it was listening — see log/worker-$LOG_TAG.log:" >&2
    tail -3 "$REPO_ROOT/log/worker-$LOG_TAG.log" >&2
    exit 1
  fi
  if ! kill -0 "$AGENTIC_PID" 2>/dev/null; then
    echo "[E2E $LOG_TAG] resource manager exited; see log/agentic-$LOG_TAG.log" >&2
    tail -3 "$REPO_ROOT/log/agentic-$LOG_TAG.log" >&2
    exit 1
  fi
  listening "$WORKER_PORT" && listening "$AGENTIC_PORT" && break
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
