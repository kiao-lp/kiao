#!/bin/sh
# Builds the worker binary for linux servers (linux/amd64, static, no CGO).
#
# Usage: ./build.sh [output-path]
#   output-path defaults to ./worker in this directory.
#
# Requires Go 1.27.2+. The toolchain is located on PATH, then in a few common install dirs so the
# script works whether Go is installed system-wide (/usr/local/go) or per-user.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/worker}"

find_go() {
  if command -v go >/dev/null 2>&1; then command -v go; return; fi
  for c in /usr/local/go/bin/go "$HOME/go-sdk/go/bin/go" "$HOME/sdk/go/bin/go"; do
    if [ -x "$c" ]; then echo "$c"; return; fi
  done
  echo "ERROR: Go toolchain not found. Install Go 1.27.2+ (https://go.dev/dl/) and ensure 'go' is on PATH." >&2
  exit 1
}

GO="$(find_go)"
echo "Building worker with $("$GO" version) -> $OUT"

cd "$SCRIPT_DIR"
# GOTOOLCHAIN=local: use the installed toolchain, never auto-download one mid-build.
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOTOOLCHAIN=local "$GO" build -trimpath -ldflags "-s -w" -o "$OUT" .

echo "Built $OUT"
