#!/bin/bash
# Builds/stages on Linux/WSL; Docker is needed only for build/save.
# Run ./bin/build-all.sh first for reference libraries, Dashboard dependencies,
# linux/amd64 binaries and the kiao-mcp bundle. PostgreSQL is installed by the Dockerfile.
# Usage: ./bin/build-kiao-image.sh [--skip-save] [--tag name]
#                                 [--preinstall ids | --no-preinstall]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$PROJECT_ROOT/exchange/dashboard"
SERVICE_DIR="$PROJECT_ROOT/operation/worker"
HYBRIDFLOW_DIR="$PROJECT_ROOT/operation/hybridflow-store"
DOCKER_DIR="$SCRIPT_DIR/docker/kiao-image"
STAGE_NAME="kiao-image"
STAGE_DIR="$PROJECT_ROOT/dist/$STAGE_NAME"
# docker load -i decompresses gzip archives transparently.
TAR_OUT="$PROJECT_ROOT/dist/kiao-image.tar.gz"
LEGACY_TAR_OUT="$PROJECT_ROOT/dist/kiao-image.tar"

IMAGE_NAME="kiao:latest"
SKIP_SAVE=0
# No CLIs by default: the panel installs/removes them on the persistent dev volume.
# --preinstall accepts toolbox ids, optionally pinned as id@version; unpinned uses latest.
PREINSTALL=""
while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
        --skip-save) SKIP_SAVE=1 ;;
        --no-preinstall) PREINSTALL="" ;;
        --preinstall)
            shift
            if [ "$#" -eq 0 ]; then
                echo "ERROR: --preinstall requires a value, e.g. --preinstall claude-cli,codex-cli,muse-cli,opencode-cli" >&2
                exit 1
            fi
            PREINSTALL="$1"
            ;;
        --preinstall=*) PREINSTALL="${arg#--preinstall=}" ;;
        --tag)
            shift
            if [ "$#" -eq 0 ]; then
                echo "ERROR: --tag requires a value, e.g. --tag kiao:v1" >&2
                exit 1
            fi
            IMAGE_NAME="$1"
            ;;
        --tag=*) IMAGE_NAME="${arg#--tag=}" ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 1
            ;;
    esac
    shift
done

"$SCRIPT_DIR/require-build-all.sh" reference dashboard-deps worker hybridflow-store kiao-mcp

# No identity provider for E2E; PlantUML goes through nginx on the same origin.
# The Dashboard build exceeds Node’s default 2 GB heap.
echo "== Building the Dashboard SPA =="
pushd "$DASHBOARD_DIR" > /dev/null
rm -rf build
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
VITE_NO_SECURITY=true \
VITE_PLANTUML_SERVER_URL=/plantuml \
    npm run build
popd > /dev/null

if [ ! -f "$DASHBOARD_DIR/build/index.html" ]; then
    echo "ERROR: the SPA build produced no index.html at exchange/dashboard/build" >&2
    exit 1
fi

rm -rf "$STAGE_DIR"
rm -rf "$PROJECT_ROOT/dist/dcms-image"
mkdir -p "$STAGE_DIR"

echo "== Staging worker =="
cp "$SERVICE_DIR/worker" "$STAGE_DIR/worker"

echo "== Staging hybridflow-store =="
cp "$HYBRIDFLOW_DIR/hybridflow-store" "$STAGE_DIR/hybridflow-store"

echo "== Staging the build context in $STAGE_DIR =="
cp -a "$DASHBOARD_DIR/build" "$STAGE_DIR/dashboard"
node "$SCRIPT_DIR/stage-file-migrations.js" "$PROJECT_ROOT/migrations/sources.json" "$STAGE_DIR/migrations"
# Include dependencies: the image has Node.js but no npm.
cp -a "$PROJECT_ROOT/dist/kiao-mcp" "$STAGE_DIR/kiao-mcp"
# The catalogue is a directory so assemblies can add component catalogues beside pub.json.
mkdir -p "$STAGE_DIR/catalog"
cp "$SERVICE_DIR/internal/toolbox/catalog/pub.json" "$STAGE_DIR/catalog/pub.json"
cp -a "$PROJECT_ROOT/e2e/data/files-template" "$STAGE_DIR/data"
cp "$DOCKER_DIR/Dockerfile" "$STAGE_DIR/Dockerfile"
cp "$SERVICE_DIR/internal/toolbox/install/pi/kiao-node-check.cjs" "$STAGE_DIR/kiao-node-check.cjs"
cp "$DOCKER_DIR/docker-entrypoint.sh" "$STAGE_DIR/docker-entrypoint.sh"
cp "$DOCKER_DIR/kiao.conf.template" "$STAGE_DIR/kiao.conf.template"
# These wrappers install tools on /opt/kiao/dev, outside image layers.
cp "$DOCKER_DIR/kiao-dev.sh" "$STAGE_DIR/kiao-dev.sh"
cp "$DOCKER_DIR/apt-hint.sh" "$STAGE_DIR/apt-hint.sh"
cp "$DOCKER_DIR/apk-nudge.sh" "$STAGE_DIR/apk-nudge.sh"
cp "$DOCKER_DIR/claude-container-memory.md" "$STAGE_DIR/claude-container-memory.md"

# Set modes before COPY to avoid duplicating binaries in a RUN chmod layer.
chmod 0755 "$STAGE_DIR/worker" "$STAGE_DIR/hybridflow-store" "$STAGE_DIR/docker-entrypoint.sh" \
    "$STAGE_DIR/kiao-dev.sh" "$STAGE_DIR/apt-hint.sh" "$STAGE_DIR/apk-nudge.sh"

# --target alpine selects musl binaries even on a glibc build host.
# Preinstall preserves cached installs; delete the prefix or request a version to update.
CLI_PREFIX="$PROJECT_ROOT/dist/cache/toolbox/alpine"

# The Dockerfile copies this directory even when no CLIs are requested.
mkdir -p "$STAGE_DIR/toolbox"

if [ -z "$PREINSTALL" ]; then
    echo "== No agent CLI in this image — the configuration panel installs one on demand =="
    CLIS_STAGED="none — installed on demand from the configuration panel"
else
    echo "== Staging the agent CLIs: $PREINSTALL =="
    # The static linux/amd64 worker from build-all.sh runs on the build host.
    IFS=',' read -r -a preinstall_ids <<< "$PREINSTALL"
    "$SERVICE_DIR/worker" toolbox preinstall \
        --prefix "$CLI_PREFIX" --target alpine "${preinstall_ids[@]}"
    # Exclude the drivers’ download scratch directory from the image.
    cp -a "$CLI_PREFIX/." "$STAGE_DIR/toolbox/"
    rm -rf "$STAGE_DIR/toolbox/download"
    CLIS_STAGED="$PREINSTALL"
fi

# Match the linux/amd64 worker even on arm64 hosts.
echo "== Building image $IMAGE_NAME =="
# BuildKit enables --platform on Docker 20.10 as well.
export DOCKER_BUILDKIT=1
docker build --platform linux/amd64 -t "$IMAGE_NAME" "$STAGE_DIR"

if [ "$SKIP_SAVE" -eq 0 ]; then
    echo "== Saving image to $TAR_OUT =="
    if command -v pigz > /dev/null 2>&1; then
        docker save "$IMAGE_NAME" | pigz > "$TAR_OUT"
    else
        docker save "$IMAGE_NAME" | gzip > "$TAR_OUT"
    fi
    # Remove stale archives so they cannot be mistaken for this build.
    if [ -f "$LEGACY_TAR_OUT" ]; then
        echo "   (removing the superseded $LEGACY_TAR_OUT)"
        rm -f "$LEGACY_TAR_OUT"
    fi
    for old in "$PROJECT_ROOT/dist/dcms-image.tar.gz" "$PROJECT_ROOT/dist/dcms-image.tar"; do
        if [ -f "$old" ]; then
            echo "   (removing the superseded $old)"
            rm -f "$old"
        fi
    done
else
    echo "== Skipping docker save (--skip-save) =="
fi

echo "------------------------------------------------"
echo "Image: $IMAGE_NAME"
echo "Context: $STAGE_DIR ($(du -sh "$STAGE_DIR" 2>/dev/null | cut -f1))"
# With the containerd image store, inspect .Size reports compressed size; use image ls.
echo "Size: $(docker image ls --format '{{.Size}}' "$IMAGE_NAME" | head -1) (docker image ls)"
echo "Agent CLIs: $CLIS_STAGED"
echo "Boards: PostgreSQL + hybridflow-store, in this image"
echo "Claude permissions: Manual / Manual Live only"
echo "  (add -e KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=true to allow --dangerously-skip-permissions)"
echo "Dev tools: none in the image — \`kiao-dev add <pkg>\` installs into a container and"
echo "  a volume at /opt/kiao/dev replays it into the next one (-v kiao-dev:/opt/kiao/dev)"
[ -f "$TAR_OUT" ] && echo "Archive: $TAR_OUT ($(du -h "$TAR_OUT" | cut -f1))"
