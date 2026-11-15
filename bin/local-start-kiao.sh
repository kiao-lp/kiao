#!/bin/bash

# Ensure script is executed from the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source .env-local
set -a
source "$PROJECT_ROOT/config/local/.env-local"
set +a

# ── The machine's standing answers ───────────────────────────────────────────
#
# The same ~/.config/kiao/config.env the installed executable reads, so a machine is configured
# once and both entry points agree — above all about where the boards are, which is the one thing
# it would be maddening to have to say twice.
#
# Read rather than sourced: `source` would run whatever is in it, and what is already exported must
# win, so that an export before one run still overrides the file for that run.
#
# Migrated before it is read (KIAO_FILES_SERVICE_* keys become KIAO_WORKER_*), so a machine that
# never runs the installer still picks up the rename. Quiet and idempotent — a migrated machine
# pays one file test.
"$SCRIPT_DIR/migrate-to-worker.sh" --quiet
kiao_config="${XDG_CONFIG_HOME:-$HOME/.config}/kiao/config.env"
# The pre-rename file, read when the new one is absent — the installer moves it on its next
# run, and until then both entry points agree on the old one rather than on nothing.
if [ ! -f "$kiao_config" ]; then
  legacy_config="${XDG_CONFIG_HOME:-$HOME/.config}/kiao-dcms/config.env"
  [ -f "$legacy_config" ] && kiao_config="$legacy_config"
fi
if [ -f "$kiao_config" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    case "$line" in '#'*) continue ;; esac
    line="${line#export }"
    [ "${line%%=*}" = "$line" ] && continue
    key="${line%%=*}"
    key="${key//[[:space:]]/}"
    case "$key" in [A-Za-z_]*) ;; *) continue ;; esac
    value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    [ -z "${!key+set}" ] && export "$key=$value"
  done < "$kiao_config"
  echo "Configuration: $kiao_config"
fi

# --- Start Worker (Go) ---

GO="$("$SCRIPT_DIR/find-go.sh")" || exit 1
# Let this Go locate its SDK instead of inheriting another installation's root.
unset GOROOT
export GOTOOLCHAIN=local

export KIAO_WORKER_AUTH_MODE=debug
export SERVER_PORT="$LOCAL_WORKER_PORT"
# Root path: taken from the environment if set, otherwise the directory this runs from.
# A wrapper assembling its own copy may offer a menu of its own and export the answer —
# what is already set wins here.
if [ -z "$KIAO_WORKER_ROOT_PATH" ]; then
  if [ -t 0 ]; then
    read -r -p "Store root path [$(pwd)]: " answer
    KIAO_WORKER_ROOT_PATH="${answer:-$(pwd)}"
  else
    KIAO_WORKER_ROOT_PATH="$(pwd)"
  fi
fi
export KIAO_WORKER_ROOT_PATH
echo "Root path: $KIAO_WORKER_ROOT_PATH"
# No state path is set: it defaults to <root>/.kiao-config, so each store above keeps its own
# ledger, trust registry and config documents. Picking a root another worker is already
# serving is then refused at startup over the shared process lock — which is right, as the two
# would be writing the same store.
if [ -z "${KIAO_WORKER_MIGRATIONS_PATH:-}" ]; then
  export KIAO_WORKER_MIGRATIONS_SOURCES="${KIAO_WORKER_MIGRATIONS_SOURCES-$PROJECT_ROOT/migrations/sources.json}"
fi
# Where the configuration panel may install what a turn asks for — a JDK, the Node LTS, Python, an
# MCP server. The same directory the installed `kiao` executable uses, so a tool installed from
# one is there in the other: it is the machine that has it, not the instance. Nothing here runs as
# root or asks for sudo; set it empty to make the panel read-only.
# The pre-rename prefix, kept while the new one has nothing: a machine whose tools were
# installed under it finds them here until the installer moves them across.
if [ -z "${KIAO_WORKER_TOOLBOX_PATH+set}" ]; then
    if [ ! -d "$HOME/.local/share/kiao/toolbox" ] && [ -d "$HOME/.local/share/kiao-dcms/toolbox" ]; then
        KIAO_WORKER_TOOLBOX_PATH="$HOME/.local/share/kiao-dcms/toolbox"
    else
        KIAO_WORKER_TOOLBOX_PATH="$HOME/.local/share/kiao/toolbox"
    fi
    export KIAO_WORKER_TOOLBOX_PATH
fi
# And that prefix's own bin ahead of PATH, which is what makes an agent CLI installed from the panel
# an agent the tab offers: the service resolves an agent's CLI on its own PATH, and the panel
# installs into the prefix and nowhere else. The launcher does the same for `kiao`, and the
# container image in its Dockerfile.
if [ -n "$KIAO_WORKER_TOOLBOX_PATH" ]; then
    export PATH="$KIAO_WORKER_TOOLBOX_PATH/bin:$PATH"
fi
mkdir -p "$KIAO_WORKER_ROOT_PATH"

# --- The boards: a shared service, or a database this machine serves ---
#
# Either every instance reads and writes the same boards, as a client of one shared
# hybridflow-store — no database credential on this machine, no tunnel, nothing to keep in step:
#
#   export KIAO_WORKER_HYBRIDFLOW_URL=https://boards.example.com/api/hybridflow
#   export KIAO_WORKER_HYBRIDFLOW_TOKEN=<the service token that store was started with>
#
# Or a database served from here, for developing against something that is not
# production. It starts a hybridflow-store of its own, which creates and migrates the schema at
# startup, so an empty database is enough — the boards in it are not, and are made from the Boards
# tab once the stack is up:
#
#   export KIAO_HYBRIDFLOW_STORE_DATABASE_URL="postgres://hybridflow:glg203@localhost:$LOCAL_DB_PORT/hybridflow?sslmode=disable"
#
# Neither is defaulted. The two look identical from the screen and only one of them is a place to
# try things out.
hybridflow_store_pid=""
export KIAO_WORKER_HYBRIDFLOW_URL="${KIAO_WORKER_HYBRIDFLOW_URL:-}"
export KIAO_WORKER_HYBRIDFLOW_TOKEN="${KIAO_WORKER_HYBRIDFLOW_TOKEN:-}"
# Who the work is recorded as. Only a caller bearing the service token may name one, which is why
# this travels with it; a card moved from here then says who moved it instead of "worker".
export KIAO_HYBRIDFLOW_ACTOR="${KIAO_HYBRIDFLOW_ACTOR:-${USER:-}}"

if [ -n "$KIAO_WORKER_HYBRIDFLOW_URL" ] && [ -n "${KIAO_HYBRIDFLOW_STORE_DATABASE_URL:-}" ]; then
  echo "ERROR: KIAO_WORKER_HYBRIDFLOW_URL and KIAO_HYBRIDFLOW_STORE_DATABASE_URL are both set." >&2
  echo "       The first is a service to send the boards to, the second a database to serve them" >&2
  echo "       from — two different places to write a card. Unset one." >&2
  exit 1
fi

if [ -n "$KIAO_WORKER_HYBRIDFLOW_URL" ]; then
  echo "Boards: $KIAO_WORKER_HYBRIDFLOW_URL (as ${KIAO_HYBRIDFLOW_ACTOR:-the service itself})"
elif [ -n "${KIAO_HYBRIDFLOW_STORE_DATABASE_URL:-}" ]; then
  # The credential the two halves share when this machine serves its own database: a run outlives
  # the request that started it, so the worker runner cannot carry the user's token. Minted
  # per start and never written down — nothing to leave behind.
  export KIAO_HYBRIDFLOW_STORE_SERVICE_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=')"
  export KIAO_HYBRIDFLOW_STORE_PORT="$LOCAL_HYBRIDFLOW_STORE_PORT"
  export KIAO_HYBRIDFLOW_STORE_AUTH_MODE=debug
  # No CORS list: the SPA reaches this service through the vite dev server's proxy, so every call
  # it makes is same-origin and no browser ever asks.
  export KIAO_HYBRIDFLOW_STORE_CORS_ORIGINS=""
  # The one name for the address, read by the dev server's proxy and by the worker alike.
  export KIAO_WORKER_HYBRIDFLOW_URL="http://localhost:$LOCAL_HYBRIDFLOW_STORE_PORT"
  export KIAO_WORKER_HYBRIDFLOW_TOKEN="$KIAO_HYBRIDFLOW_STORE_SERVICE_TOKEN"

  echo "Starting Hybridflow Store on port $LOCAL_HYBRIDFLOW_STORE_PORT..."
  echo "Boards database: ${KIAO_HYBRIDFLOW_STORE_DATABASE_URL%%\?*}"
  ( cd "$PROJECT_ROOT/operation/hybridflow-store" && exec "$GO" run . ) &
  hybridflow_store_pid=$!
else
  echo "Boards: off — set KIAO_WORKER_HYBRIDFLOW_URL to a hybridflow-store, or"
  echo "        KIAO_HYBRIDFLOW_STORE_DATABASE_URL to a PostgreSQL to serve them from here."
fi

echo "Starting Worker on port $LOCAL_WORKER_PORT..."
( cd "$PROJECT_ROOT/operation/worker" && exec "$GO" run . ) &
worker_pid=$!

# --- Start Dashboard ---

echo "Starting Dashboard on port $LOCAL_DASHBOARD_PORT..."
cd "$PROJECT_ROOT/exchange/dashboard"
if [ ! -d "node_modules" ]; then
  echo "Installing Dashboard dependencies..."
  npm install --no-audit --no-fund
fi
# Plugin projects dropped into the assembly from outside this tree arrive as VITE_PLUGIN_PATHS,
# already set by the caller; the same variable is read by `npm run build`, by vitest and by
# the e2e harness. Unset, this is the delivered lot and nothing else.
VITE_NO_SECURITY=true VITE_BACKEND_URL=http://localhost:$LOCAL_WORKER_PORT \
  VITE_PLUGIN_PATHS="${VITE_PLUGIN_PATHS:-}" \
  npm start -- --port $LOCAL_DASHBOARD_PORT &
dashboard_pid=$!

# If sourced by another script, let it handle the wait/trap
if [ -z "$SKIP_WAIT" ]; then
  echo "... READY ..."
  echo "Dashboard services started."
  echo "  - Worker: http://localhost:$LOCAL_WORKER_PORT"
  if [ -n "$hybridflow_store_pid" ]; then
    echo "  - Hybridflow Store: http://localhost:$LOCAL_HYBRIDFLOW_STORE_PORT"
  elif [ -n "$KIAO_WORKER_HYBRIDFLOW_URL" ]; then
    echo "  - Boards: $KIAO_WORKER_HYBRIDFLOW_URL"
  fi
  echo "  - Dashboard: http://localhost:$LOCAL_DASHBOARD_PORT"
  echo "Press Ctrl+C to stop all services."

  # --- Cleanup Function ---

  cleanup() {
      echo "Stopping processes..."
      kill $dashboard_pid 2>/dev/null
      kill $worker_pid 2>/dev/null
      [ -n "$hybridflow_store_pid" ] && kill $hybridflow_store_pid 2>/dev/null
      echo "Stopped."
      exit 0
  }

  # Trap SIGINT and SIGTERM
  trap cleanup SIGINT SIGTERM

  # Wait for background processes to finish
  wait
fi
