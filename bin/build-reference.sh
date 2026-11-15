#!/bin/bash
set -e

# Resolve the directory of the script and the project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
REFERENCE_DIR="$PROJECT_ROOT/reference"

echo "Building reference libraries from $REFERENCE_DIR..."

if [ -d "$REFERENCE_DIR" ]; then
    echo "------------------------------------------------"
    echo "Found NPM reference projects. Building..."
    echo "------------------------------------------------"
    
    build_npm_project() {
        local project_name="$1"
        local project_dir="$REFERENCE_DIR/$project_name"

        if [ ! -d "$project_dir" ]; then
             echo "Warning: Project directory for '$project_name' not found at $project_dir"
             return
        fi

        echo "Building NPM project: $project_name"
        
        pushd "$project_dir" > /dev/null
        
        if [ -f "package.json" ]; then
            # --no-audit: the audit POST to registry.npmjs.org/-/npm/v1/security/advisories/bulk
            # can black-hole (request sent, no bytes ever returned), and npm then blocks for
            # minutes per project before giving up. The install itself takes under a second.
            # --no-fund matches bin/build-all.sh and bin/stage-kiao-mcp.sh.
            echo "Running npm install..."
            npm install --no-audit --no-fund
            echo "Running npm run build..."
            npm run build
        else
            echo "Skipping $project_name (no package.json found)"
        fi
        
        popd > /dev/null
        echo "Finished $project_name"
        echo "------------------------------------------------"
    }

    # Explicit build order
    # You can reorder these lines to change the build order
    build_npm_project "kiao-style"
    build_npm_project "kiao-worker"

    # KIAO MCP servers. They run only inside a worker turn, so what actually ships them is
    # bin/stage-kiao-mcp.sh — which builds them itself. Built here too, to keep a full reference
    # build a full type-check of the reference packages.
    build_npm_project "kiao-mcp"
    echo "NPM build completed."
else
    echo "No reference directory found."
fi

echo "All reference libraries built successfully."
