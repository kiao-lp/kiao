#!/bin/sh
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/agentic-resource-manager}"
GO="$("$SCRIPT_DIR/../../bin/find-go.sh")"
unset GOROOT
export GOTOOLCHAIN=local
cd "$SCRIPT_DIR"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$GO" build -trimpath -ldflags "-s -w" -o "$OUT" .
