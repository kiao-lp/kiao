#!/bin/bash
set -e

# Stage freshly built servers and runtime dependencies; targets need Node, not npm.
# Usage: bin/stage-kiao-mcp.sh <destination>

DEST="$1"
if [ -z "$DEST" ]; then
    echo "usage: $(basename "$0") <destination>" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC="$PROJECT_ROOT/reference/npm/kiao-mcp"

# Standalone runs need kiao-worker built before npm links this file: devDependency.
if [ ! -d "$PROJECT_ROOT/reference/npm/kiao-worker/dist" ]; then
    echo "Building kiao-worker (kiao-mcp tests pin its contract)..."
    (cd "$PROJECT_ROOT/reference/npm/kiao-worker" && npm install --no-audit --no-fund && npm run build)
fi

echo "Building kiao-mcp from source..."
(cd "$SRC" && npm install --no-audit --no-fund && npm test && npm run build)

if [ ! -d "$SRC/dist" ]; then
    echo "kiao-mcp build produced no $SRC/dist" >&2
    exit 1
fi

echo "Bundling kiao-mcp into $DEST..."
rm -rf "$DEST"
mkdir -p "$DEST"
cp -a "$SRC/dist" "$DEST/dist"
cp "$SRC/package.json" "$DEST/package.json"
# Consumers bundle shared.js themselves; it is not a server entrypoint.
rm -f "$DEST/dist/shared.js" "$DEST/dist/shared.d.ts"

# file: dependencies must stay dev-only; the smoke test catches unvendored runtime imports.
(cd "$DEST" && rm -f package-lock.json && npm install --omit=dev --omit=peer --no-audit --no-fund)

# Keep this list in sync with mcpEntrypoints in hybridflow-runner/claude_mcp.go.
for entry in index.js hybridflow-entry.js; do
    if [ ! -f "$DEST/dist/$entry" ]; then
        echo "kiao-mcp bundle is missing dist/$entry" >&2
        exit 1
    fi
    # Servers require a per-turn token. The stderr banner proves imports resolved; EOF stops them.
    if ! (cd "$DEST" && KIAO_MCP_ACCESS_TOKEN=smoke-test WORKER_URL=http://127.0.0.1:1 \
            node "dist/$entry" </dev/null 2>&1 | grep -q 'connected'); then
        echo "kiao-mcp bundle: dist/$entry does not start; the staged dependencies are incomplete" >&2
        exit 1
    fi
done

echo "kiao-mcp staged: $(du -sh "$DEST" | cut -f1)"
