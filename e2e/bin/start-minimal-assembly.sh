#!/bin/bash
set -e

# Separate worker/store from the full-assembly shards; tests unclaimed formats
# with only these two plugins compiled into Dashboard.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export VITE_PLUGINS=code-edit,text-edit
export E2E_WORKER_PORT=48309
export E2E_APP_PORT=48350
export E2E_LOG_TAG=minimal

exec "$SCRIPT_DIR/start-env.sh"
