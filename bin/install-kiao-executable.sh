#!/bin/bash
# Installs `kiao`, the executable that runs KIAO over a folder without Docker.
#
# It builds the three halves — the Dashboard SPA, the worker and the hybridflow-store that
# holds the boards — plus the launcher in bin/kiao-launcher, stages the kiao-mcp bundle a turn is
# handed through --mcp-config, fetches the PlantUML jar that renders the diagrams, and lays them
# all out in one install directory. After it, `kiao ~/some/project` starts an instance on the next free
# ports and opens a browser on it, the way an editor is opened on a project. See
# docs/user-manual/deep-dive/kiao-executable.md.
#
# Targets a Debian-based system (Debian, Ubuntu, Mint) and needs Go and Node to build with; to run,
# git, plus a JRE and graphviz for the diagrams.
#
# Run ./bin/build-all.sh first: the reference libraries and the Dashboard dependency tree come from
# there, shared with the other kiao end script. This one only does what is specific to the
# installed executable.
#
# Usage: ./bin/install-kiao-executable.sh [--skip-spa] [--system]
#                                         [--prefix DIR] [--bindir DIR] [--uninstall]
#                                         [--plantuml-jar PATH] [--skip-plantuml]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$PROJECT_ROOT/exchange/dashboard"
SERVICE_DIR="$PROJECT_ROOT/operation/worker"
HYBRIDFLOW_DIR="$PROJECT_ROOT/operation/hybridflow-store"
LAUNCHER_DIR="$SCRIPT_DIR/kiao-launcher"
STAGE_DIR="$PROJECT_ROOT/dist/kiao-executable"

# PlantUML is a core feature of KIAO, not something the machine is asked to provide: the jar is
# installed with the executable and found there, so a diagram renders on a fresh machine with no jar to
# hunt down and nothing sent to plantuml.com. Pinned rather than latest, so that two installs of the
# same commit draw the same thing, and checked against the SHA-256 the release publishes — bumping
# it is this version and this checksum, both from
# https://api.github.com/repos/plantuml/plantuml/releases/latest.
PLANTUML_VERSION="1.2026.6"
PLANTUML_SHA256="89948f14c93756c7a3fb7b69078ff37e8489fd79dd430c582b931e2f65358690"
PLANTUML_CACHE_DIR="$PROJECT_ROOT/dist/cache/plantuml"
PLANTUML_URL="https://github.com/plantuml/plantuml/releases/download/v$PLANTUML_VERSION/plantuml-$PLANTUML_VERSION.jar"

# A user install by default: nothing here needs root, and a command that runs one person's editor
# on one person's folders belongs in their own PATH. --system puts it under /usr/local instead.
PREFIX="$HOME/.local"
BINDIR=""
LIBDIR=""
SKIP_SPA=0
SKIP_PLANTUML=0
PLANTUML_JAR=""
UNINSTALL=0

while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
        --skip-spa)       SKIP_SPA=1 ;;
        --skip-plantuml)  SKIP_PLANTUML=1 ;;
        --plantuml-jar) shift; PLANTUML_JAR="${1:?--plantuml-jar requires a path}" ;;
        --plantuml-jar=*) PLANTUML_JAR="${arg#--plantuml-jar=}" ;;
        --uninstall)      UNINSTALL=1 ;;
        --system)         PREFIX="/usr/local" ;;
        --prefix)  shift; PREFIX="${1:?--prefix requires a directory}" ;;
        --prefix=*)       PREFIX="${arg#--prefix=}" ;;
        --bindir)  shift; BINDIR="${1:?--bindir requires a directory}" ;;
        --bindir=*)       BINDIR="${arg#--bindir=}" ;;
        -h|--help)        sed -n '2,19p' "$0" | cut -c 3-; exit 0 ;;
        *) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
    esac
    shift
done

# /usr/local keeps its libraries in lib/, a home prefix keeps them in share/ — both are where the
# rest of the system would look for them.
if [ -z "$LIBDIR" ]; then
    case "$PREFIX" in
        "$HOME"/*) LIBDIR="$PREFIX/share/kiao" ;;
        *)         LIBDIR="$PREFIX/lib/kiao" ;;
    esac
fi
# Where the parts lived when the executable was still called kiao-dcms: an upgrade moves
# the toolbox out of it and retires the rest, and --uninstall removes both.
case "$PREFIX" in
    "$HOME"/*) LEGACY_LIBDIR="$PREFIX/share/kiao-dcms" ;;
    *)         LEGACY_LIBDIR="$PREFIX/lib/kiao-dcms" ;;
esac
[ -n "$BINDIR" ] || BINDIR="$PREFIX/bin"
COMMAND="$BINDIR/kiao"
LEGACY_COMMAND="$BINDIR/kiao-dcms"

# --- Uninstall ---------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
    for cmd in "$COMMAND" "$LEGACY_COMMAND"; do
        if [ -x "$cmd" ] && "$cmd" --list 2>/dev/null | grep -q "http://"; then
            echo "Stopping the running instances..."
            "$cmd" --stop all || true
        fi
    done
    rm -f "$COMMAND" "$LEGACY_COMMAND"
    rm -rf "$LIBDIR" "$LEGACY_LIBDIR"
    echo "Removed $COMMAND and $LIBDIR."
    echo "The instance registry and the logs of detached instances are left in"
    echo "  ${XDG_STATE_HOME:-$HOME/.local/state}/kiao"
    exit 0
fi

# The pre-rename spellings of the overlay variables, honoured so existing wrappers and
# exports keep working: what the new name says wins, the old one is the fallback.
: "${KIAO_EXTRA_MCP_ENTRIES:=${KIAO_DCMS_EXTRA_MCP_ENTRIES:-}}"
: "${KIAO_EXTRA_TOOLBOX_CATALOGS:=${KIAO_DCMS_EXTRA_TOOLBOX_CATALOGS:-}}"

# --- Toolchains --------------------------------------------------------------
# Go is looked up the way operation/worker/build.sh does: PATH first, then the usual
# per-user install directories, since /usr/local/go/bin is not on every PATH.
find_go() {
    if command -v go > /dev/null 2>&1; then command -v go; return; fi
    for candidate in /usr/local/go/bin/go "$HOME/go-sdk/go/bin/go" "$HOME/sdk/go/bin/go"; do
        if [ -x "$candidate" ]; then echo "$candidate"; return; fi
    done
    echo "ERROR: no Go toolchain. Run ./bin/install-go-toolchain.sh, or install Go 1.24+." >&2
    exit 1
}
GO="$(find_go)"
export GOTOOLCHAIN=local

if ! command -v npm > /dev/null 2>&1; then
    echo "ERROR: no npm. Install Node.js 20+ (sudo apt install nodejs npm, or nvm)." >&2
    exit 1
fi

# What kiao will need at *run* time. None of it stops the install: a machine that only edits
# markdown needs none of it, and each is one apt line away. PlantUML itself is no longer on this
# list — it is installed below — but the JVM that runs it, and the graphviz `dot` that lays out the
# diagrams other than sequence ones, still come from the machine.
missing=""
command -v git    > /dev/null 2>&1 || missing="$missing git"
command -v claude > /dev/null 2>&1 || missing="$missing claude(the-Claude-Code-CLI)"
command -v java   > /dev/null 2>&1 || missing="$missing default-jre-headless(diagrams)"
command -v dot    > /dev/null 2>&1 || missing="$missing graphviz(diagram-layout)"

VERSION="$(git -C "$PROJECT_ROOT" describe --always --dirty 2>/dev/null || date +%Y%m%d)"

echo "== Installing kiao $VERSION =="
echo "   parts   -> $LIBDIR"
echo "   executable -> $COMMAND"

# --- 1. What bin/build-all.sh has already produced ---------------------------
# Only the SPA needs the reference libraries and the dependency tree; --skip-spa reuses its bundle
# and the Go builds that remain depend on nothing outside operation/worker and
# bin/kiao-launcher. The kiao-mcp bundle is needed either way — --skip-spa skips the SPA, not the
# turns' servers.
if [ "$SKIP_SPA" -eq 0 ]; then
    "$SCRIPT_DIR/require-build-all.sh" reference dashboard-deps kiao-mcp
else
    "$SCRIPT_DIR/require-build-all.sh" kiao-mcp
fi

# --- 2. Dashboard SPA ---------------------------------------------------------
# Built almost as the image builds it, and for the same reasons: VITE_NO_SECURITY because there is
# no identity provider in front of a folder on someone's own machine, and VITE_PLANTUML_SERVER_URL
# pointing at this origin so that diagram sources go to the local renderer rather than out to
# plantuml.com. The heap bump is what the bundle needs to render at all.
#
# VITE_NO_SERVICE_WORKER is the one the image does not set. A precache is for a bundle that came
# over a network; this one is on the same disk as the files it edits. What it does buy is a broken
# reinstall: this script reruns often, every run rehashes the bundle, and a worker still serving the
# previous precached index.html boots a bundle whose lazily imported chunks are gone — a mermaid
# diagram then fails to load its renderer. The launcher evicts any worker an earlier install left
# behind (bin/kiao-launcher/web.go).
#
# VITE_PLUGIN_PATHS is passed through when set, so a caller assembling its own copy can drop
# plugin projects of its own into the bundle — the same variable the dev server and the e2e
# harness read. Unset, this is the delivered lot and nothing else.
if [ "$SKIP_SPA" -eq 1 ]; then
    echo "== Reusing the existing SPA build (--skip-spa) =="
    if [ ! -f "$DASHBOARD_DIR/build/index.html" ]; then
        echo "ERROR: --skip-spa, but there is no build at $DASHBOARD_DIR/build" >&2
        exit 1
    fi
else
    echo "== Building the Dashboard SPA =="
    pushd "$DASHBOARD_DIR" > /dev/null
    rm -rf build
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
    VITE_NO_SECURITY=true \
    VITE_NO_SERVICE_WORKER=true \
    VITE_PLANTUML_SERVER_URL=/plantuml \
    VITE_PLUGIN_PATHS="${VITE_PLUGIN_PATHS:-}" \
        npm run build
    popd > /dev/null
    if [ ! -f "$DASHBOARD_DIR/build/index.html" ]; then
        echo "ERROR: the SPA build produced no index.html at $DASHBOARD_DIR/build" >&2
        exit 1
    fi
fi

# --- 3. Stage everything -----------------------------------------------------
# Staged first, installed second: the install step then only moves files about, so a build that
# fails halfway leaves the working kiao alone.
rm -rf "$STAGE_DIR"
# The pre-rename stage directory, retired: nothing writes it any more.
rm -rf "$PROJECT_ROOT/dist/dcms-executable"
mkdir -p "$STAGE_DIR/bin"

echo "== Building worker =="
# The one part of the shared build this script cannot reuse. bin/build-all.sh builds the binary
# operation/worker/build.sh produces — always linux/amd64, because the image runs
# that — while this one runs on whatever machine is doing the install.
( cd "$SERVICE_DIR" && CGO_ENABLED=0 "$GO" build -trimpath -ldflags "-s -w" -o "$STAGE_DIR/bin/worker" . )

echo "== Building hybridflow-store =="
# The boards and the flow nodes. It is installed unconditionally and started only on
# an instance that names a database (KIAO_HYBRIDFLOW_STORE_DATABASE_URL): a folder that is not a
# store with boards runs the worker alone, and 11 MB on disk is cheaper than an install that
# has to be redone the day somebody points this command at a boards database.
( cd "$HYBRIDFLOW_DIR" && CGO_ENABLED=0 "$GO" build -trimpath -ldflags "-s -w" -o "$STAGE_DIR/bin/hybridflow-store" . )

echo "== Building the kiao launcher =="
( cd "$LAUNCHER_DIR" && "$GO" build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION -X main.installedHome=$LIBDIR" \
    -o "$STAGE_DIR/bin/kiao" . )

cp -a "$DASHBOARD_DIR/build" "$STAGE_DIR/web"
# The migration machinery travels with the executable so that `kiao --migrations` has something
# to run. It carries no script at present, by design (see migrations/README.md).
cp -a "$PROJECT_ROOT/migrations" "$STAGE_DIR/migrations"
# The kiao-mcp servers a turn is handed through --mcp-config — units, files, boards — staged
# from the shared build like the image stages them: this script never builds npm packages itself.
echo "== Staging the kiao-mcp bundle =="
cp -a "$PROJECT_ROOT/dist/kiao-mcp" "$STAGE_DIR/kiao-mcp"
# Entry points of one's own, overlaid beside the bundle's: a directory of self-contained *.js.
# worker reads the directory, so an overlaid entry is handed to a turn like a bundled one once
# its short name is configured. Unset, the bundle is the three above.
if [ -n "${KIAO_EXTRA_MCP_ENTRIES:-}" ]; then
    echo "== Overlaying extra MCP entrypoints from $KIAO_EXTRA_MCP_ENTRIES =="
    cp "$KIAO_EXTRA_MCP_ENTRIES"/*.js "$STAGE_DIR/kiao-mcp/dist/"
fi
# The toolbox catalogue the panel reads: pub.json, refreshed at every install from the worker
# source. A directory rather than a file, so that an assembly with components of its own can
# overlay them beside it: KIAO_EXTRA_TOOLBOX_CATALOGS names a directory of *.json.
echo "== Staging the toolbox catalogue =="
mkdir -p "$STAGE_DIR/catalog"
cp "$SERVICE_DIR/internal/toolbox/pub.json" "$STAGE_DIR/catalog/pub.json"
if [ -n "${KIAO_EXTRA_TOOLBOX_CATALOGS:-}" ]; then
    echo "== Overlaying extra toolbox catalogues from $KIAO_EXTRA_TOOLBOX_CATALOGS =="
    cp "$KIAO_EXTRA_TOOLBOX_CATALOGS"/*.json "$STAGE_DIR/catalog/"
fi
printf '%s\n' "$VERSION" > "$STAGE_DIR/VERSION"
chmod 0755 "$STAGE_DIR/bin/worker" "$STAGE_DIR/bin/hybridflow-store" "$STAGE_DIR/bin/kiao"

# --- 4. The PlantUML renderer ------------------------------------------------
# Fetched once into dist/cache and staged from there, so a reinstall — the common thing, when only
# the Go code changed — does not pull 30 MB down again.
mkdir -p "$STAGE_DIR/lib"
if [ "$SKIP_PLANTUML" -eq 1 ]; then
    echo "== Skipping PlantUML (--skip-plantuml) =="
    PLANTUML_STAGED="not fetched (--skip-plantuml)"
elif [ -n "$PLANTUML_JAR" ]; then
    if [ ! -f "$PLANTUML_JAR" ]; then
        echo "ERROR: --plantuml-jar $PLANTUML_JAR is not a file" >&2
        exit 1
    fi
    echo "== Staging PlantUML from $PLANTUML_JAR =="
    cp "$PLANTUML_JAR" "$STAGE_DIR/lib/plantuml.jar"
    PLANTUML_STAGED="PlantUML from $PLANTUML_JAR"
else
    echo "== Staging PlantUML $PLANTUML_VERSION =="
    mkdir -p "$PLANTUML_CACHE_DIR"
    plantuml_cached="$PLANTUML_CACHE_DIR/plantuml-$PLANTUML_VERSION.jar"
    if [ -f "$plantuml_cached" ] && [ "$(sha256sum "$plantuml_cached" | cut -d" " -f1)" = "$PLANTUML_SHA256" ]; then
        echo "   reusing the cached jar ($plantuml_cached)"
    elif curl -fSL --progress-bar -o "$plantuml_cached.part" "$PLANTUML_URL"; then
        plantuml_actual="$(sha256sum "$plantuml_cached.part" | cut -d" " -f1)"
        if [ "$plantuml_actual" != "$PLANTUML_SHA256" ]; then
            rm -f "$plantuml_cached.part"
            echo "ERROR: the PlantUML download does not match the pinned checksum" >&2
            echo "       (expected $PLANTUML_SHA256, got $plantuml_actual)" >&2
            exit 1
        fi
        mv "$plantuml_cached.part" "$plantuml_cached"
    else
        rm -f "$plantuml_cached.part"
        # Offline over an install that already has a jar: keeping it beats failing a build that is
        # otherwise fine — the renderer changes far less often than the code being reinstalled.
        if [ ! -f "$LIBDIR/lib/plantuml.jar" ]; then
            echo "ERROR: cannot download PlantUML $PLANTUML_VERSION, and none is installed yet." >&2
            echo "       $PLANTUML_URL" >&2
            echo "       Offline: --plantuml-jar PATH stages a jar you already have, and" >&2
            echo "       --skip-plantuml installs without one (diagrams then say so)." >&2
            exit 1
        fi
        echo "   WARNING: github.com is unreachable; keeping the jar already installed"
    fi
    if [ -f "$plantuml_cached" ]; then
        cp "$plantuml_cached" "$STAGE_DIR/lib/plantuml.jar"
        PLANTUML_STAGED="PlantUML $PLANTUML_VERSION"
    else
        PLANTUML_STAGED="the PlantUML jar already installed"
    fi
fi

# --- 5. Install --------------------------------------------------------------
if ! mkdir -p "$LIBDIR/bin" "$BINDIR" 2> /dev/null; then
    echo "ERROR: cannot write to $LIBDIR or $BINDIR. Re-run with sudo for a --system install." >&2
    exit 1
fi

# Unlink before copying rather than copying over: a binary that a running instance is executing
# cannot be written to (ETXTBSY), but it can be replaced — the instance keeps the file it opened
# and the next one gets the new binary.
rm -f "$LIBDIR/bin/worker" "$LIBDIR/bin/hybridflow-store" "$LIBDIR/bin/kiao"
# The old binary, retired by the rename: without this it would stay beside the new one.
rm -f "$LIBDIR/bin/files-service"
cp "$STAGE_DIR/bin/worker" "$STAGE_DIR/bin/hybridflow-store" "$STAGE_DIR/bin/kiao" "$LIBDIR/bin/"
rm -rf "$LIBDIR/web" "$LIBDIR/migrations" "$LIBDIR/kiao-mcp" "$LIBDIR/catalog"
cp -a "$STAGE_DIR/web" "$STAGE_DIR/migrations" "$STAGE_DIR/kiao-mcp" "$STAGE_DIR/catalog" "$STAGE_DIR/VERSION" "$LIBDIR/"

# The jar goes in the same way, and only when one was staged: --skip-plantuml and an unreachable
# github.com both mean "keep the one that is already there". Unlinked first for the reason above —
# a running instance may have this very file mapped into a JVM.
if [ -f "$STAGE_DIR/lib/plantuml.jar" ]; then
    mkdir -p "$LIBDIR/lib"
    rm -f "$LIBDIR/lib/plantuml.jar"
    cp "$STAGE_DIR/lib/plantuml.jar" "$LIBDIR/lib/plantuml.jar"
fi

# A symlink rather than a copy: the launcher resolves it to find the parts beside it, and an
# upgrade then reaches the executable without touching $BINDIR at all.
ln -sfn "$LIBDIR/bin/kiao" "$COMMAND"

# The pre-rename install, retired: the toolbox — a JDK, an agent CLI installed from the
# panel — moves into the new directory, and the binaries built under the old name go. The
# old executable goes too, so `kiao-dcms` stops resolving rather than running the old parts.
if [ "$LEGACY_LIBDIR" != "$LIBDIR" ] && [ -d "$LEGACY_LIBDIR" ]; then
    if [ -d "$LEGACY_LIBDIR/toolbox" ] && [ ! -e "$LIBDIR/toolbox" ]; then
        echo "   moving the installed tools from $LEGACY_LIBDIR/toolbox to $LIBDIR/toolbox"
        mv "$LEGACY_LIBDIR/toolbox" "$LIBDIR/toolbox"
    fi
    rm -rf "$LEGACY_LIBDIR"
fi
rm -f "$LEGACY_COMMAND"

# --- 6. The standing configuration ------------------------------------------
# A commented template, written once and never again: an install that overwrote it would throw away
# the answers it exists to hold. It is what keeps starting an instance down to `kiao .`, and
# writing it here is the only thing that makes it discoverable — nobody looks for a file they were
# not told about.
#
# 0600 from the start, because the token belongs in it and the launcher refuses to read a
# credential out of a file others can read. Skipped for a --system install running as root: the
# file is one person's answers, and root's home is nobody's.
#
# An existing file is migrated first (KIAO_FILES_SERVICE_* keys become KIAO_WORKER_*), so a
# reinstall is also the rename: the next instance starts with the new names. Skipped for root
# with the template — that person's next local start migrates it instead.
if [ "$(id -u)" -ne 0 ]; then
    "$SCRIPT_DIR/migrate-to-worker.sh"
fi
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/kiao/config.env"
if [ "$(id -u)" -ne 0 ] && [ ! -e "$CONFIG_FILE" ]; then
    mkdir -p "$(dirname "$CONFIG_FILE")"
    cat > "$CONFIG_FILE" <<'CONFIG'
# kiao — this machine's standing answers, read at every start.
#
# KEY=value a line, # comments, `export` tolerated, quotes optional. **What is already exported
# wins**, so trying something out for one run is still one export and this file stays put.
#
# Every variable here reaches the worker and the hybridflow-store too: they are children of
# the command and inherit its environment.

# ── The boards ───────────────────────────────────────────────────────────────
# Where the boards live. Every instance pointed at the same service shares the same boards;
# the token is the service token that hybridflow-store was started with.
#
#KIAO_WORKER_HYBRIDFLOW_URL=https://boards.example.com/api/hybridflow
#KIAO_WORKER_HYBRIDFLOW_TOKEN=

# Who the work is recorded as. A machine running one folder for one person has no Keycloak session,
# so the launcher presents the deployment's token and names you beside it. Your login name by default.
#KIAO_HYBRIDFLOW_ACTOR=

# Instead of the two above: a database this instance serves itself, for developing against
# something that is not production. Setting both is refused at startup.
#KIAO_HYBRIDFLOW_STORE_DATABASE_URL=postgres://hybridflow:glg203@localhost:48233/hybridflow?sslmode=disable

# ── The machine ──────────────────────────────────────────────────────────────
# How a flow node that asks for it turns this machine off; empty makes the box on a flow node do nothing.
#KIAO_WORKER_SHUTDOWN_COMMAND=systemctl poweroff
# Where the configuration panel may install a JDK, Node, Python, an MCP server. Empty makes it read-only.
#KIAO_WORKER_TOOLBOX_PATH=
CONFIG
    chmod 600 "$CONFIG_FILE"
    WROTE_CONFIG="$CONFIG_FILE"
fi

echo "------------------------------------------------"
echo "Installed kiao $VERSION"
echo "  executable  $COMMAND"
echo "  parts    $LIBDIR ($(du -sh "$LIBDIR" 2> /dev/null | cut -f1))"
echo "  diagrams $PLANTUML_STAGED"
echo "  config   ${CONFIG_FILE:-(none)}${WROTE_CONFIG:+   (written now — fill in the boards)}"
[ -n "$missing" ] && echo "  missing at run time:$missing"
case ":$PATH:" in
    *":$BINDIR:"*) ;;
    *) echo "  NOTE: $BINDIR is not on your PATH — add it to ~/.profile:"
       echo "        export PATH=\"$BINDIR:\$PATH\"" ;;
esac
echo "------------------------------------------------"
echo "Run kiao on a folder:"
echo "  kiao ~/some/project      # next free ports, opens a browser"
echo "  kiao -d ~/some/project   # in the background"
echo "  kiao --list / --stop all"
echo "See docs/user-manual/deep-dive/kiao-executable.md."
