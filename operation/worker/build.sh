#!/bin/sh
# Builds the worker binary for linux servers (linux/amd64, static, no CGO).
#
# Usage: ./build.sh [output-path]
#   output-path defaults to ./worker in this directory.
#
# Requires Go 1.27.3+. Prefer the toolchain installed by bin/install-go-toolchain.sh.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/worker}"

GO="$("$SCRIPT_DIR/../../bin/find-go.sh")"
# An inherited GOROOT may point at a different or removed installation.
unset GOROOT
# Use the selected installation without auto-downloading another toolchain.
export GOTOOLCHAIN=local
GO_DESCRIPTION="$("$GO" version)"
echo "Building worker with $GO_DESCRIPTION -> $OUT"

cd "$SCRIPT_DIR"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$GO" build -trimpath -ldflags "-s -w" -o "$OUT" .

echo "Built $OUT"
