#!/bin/sh
# Builds the hybridflow-store binary for linux servers (linux/amd64, static, no CGO).
#
# Usage: ./build.sh [output-path]
#   output-path defaults to ./hybridflow-store in this directory.
#
# The same script worker ships, for the same reasons: one static binary, no runtime,
# and the toolchain installed by bin/install-go-toolchain.sh preferred over PATH.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$SCRIPT_DIR/hybridflow-store}"

GO="$("$SCRIPT_DIR/../../bin/find-go.sh")"
# An inherited GOROOT may point at a different or removed installation.
unset GOROOT
# Use the selected installation without auto-downloading another toolchain.
export GOTOOLCHAIN=local
GO_DESCRIPTION="$("$GO" version)"
echo "Building hybridflow-store with $GO_DESCRIPTION -> $OUT"

cd "$SCRIPT_DIR"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 "$GO" build -trimpath -ldflags "-s -w" -o "$OUT" .

echo "Built $OUT"
