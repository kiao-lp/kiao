#!/bin/bash
# Shared prerequisites for build-kiao-image.sh and install-kiao-executable.sh.
# Run first; the end scripts check these outputs with require-build-all.sh.
# Dashboard bundles stay target-specific because VITE_* values are baked in.
# The image uses linux/amd64 binaries; the executable installer builds native ones.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Build reference libraries before their consumers.
"$SCRIPT_DIR/build-reference.sh"

# The image consumes operation/worker/worker, cross-compiled for linux/amd64.
echo "Building Worker (Go, linux/amd64)..."
if [ -d "$PROJECT_ROOT/operation/worker" ]; then
    "$PROJECT_ROOT/operation/worker/build.sh"
    echo "Worker built."
else
    echo "Warning: worker not found."
fi

# Build hybridflow-store for linux/amd64 alongside the worker that calls it.
echo "Building Hybridflow Store (Go, linux/amd64)..."
if [ -d "$PROJECT_ROOT/operation/hybridflow-store" ]; then
    "$PROJECT_ROOT/operation/hybridflow-store/build.sh"
    echo "Hybridflow Store built."
else
    echo "Warning: hybridflow-store not found."
fi

# Stage a self-contained bundle (dependencies included) so the image needs no npm.
echo "Staging kiao-mcp..."
bash "$SCRIPT_DIR/stage-kiao-mcp.sh" "$PROJECT_ROOT/dist/kiao-mcp"

# Share dependencies only; each end script bundles its own VITE_* configuration.
DASHBOARD_DIR="$PROJECT_ROOT/exchange/dashboard"
if [ -d "$DASHBOARD_DIR" ]; then
    echo "Installing Dashboard dependencies in $DASHBOARD_DIR..."
    pushd "$DASHBOARD_DIR" > /dev/null
    npm install --no-audit --no-fund
    popd > /dev/null
    echo "Dashboard dependencies installed."
else
    echo "Warning: Dashboard directory not found."
fi

echo "------------------------------------------------"
echo "Shared build complete. The end scripts can now run without repeating any of it:"
echo "  ./bin/build-kiao-image.sh          the kiao Docker image"
echo "  ./bin/install-kiao-executable.sh   the kiao executable on this machine"
echo "------------------------------------------------"
