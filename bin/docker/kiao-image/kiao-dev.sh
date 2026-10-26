#!/bin/sh
# Durable development tools for the kiao container.
#
# The image ships what Dashboard needs to run and nothing more: a JDK, a compiler or an
# extra CLI belongs to whoever develops inside the container, not to everyone the image is
# handed to. Those installs go under /opt/kiao/dev — one directory, meant to carry a
# volume — and are replayed into a new container at startup, so replacing the container
# (which is how this image is upgraded) costs an unpack rather than a re-download and a
# re-decision. Nothing of it is in the delivered image.
#
# Two different things persist there, and conflating them is what makes such a setup rot:
#   * the DECLARATION — `packages`, `setup.sh` — which says what this box is. It is the
#     thing to back up, and the thing to edit when the needs change;
#   * the BYTES — apk-cache/, npm/, cargo/, go/, opt/, cache/ — which make replaying the
#     declaration cheap, and possible with no network at all.
# An Alpine package installs into /usr, i.e. into the container's writable layer, which is
# why the declaration is replayed at every start rather than merely found. The cache is
# what keeps that replay a local unpack: `apk add -U` refreshes the index when there is a
# network and warns and uses the cached one when there is not.
#
# The path is fixed on purpose, not configurable: a JDK unpacked under it, an npm shebang
# and a Go binary all bake it in, so a directory that moved would take a broken toolchain
# with it. Mount whatever you like AT /opt/kiao/dev instead.
#
# Usage: kiao-dev {sync|add <pkg>…|del <pkg>…|list|search <term>…|status|help}
set -eu

DEV=/opt/kiao/dev
PACKAGES_FILE="$DEV/packages"
SETUP_FILE="$DEV/setup.sh"
ENV_FILE="$DEV/env.sh"
CACHE_DIR="$DEV/apk-cache"
# The real apk, not the /usr/local/bin/apk wrapper that follows a bare `apk add` with a note
# saying the install was not declared. Everything here installs *because* it is declared, so
# that note would be exactly wrong.
APK=/sbin/apk

log() { echo "[kiao-dev] $*"; }
die() { echo "[kiao-dev] ERROR: $*" >&2; exit 1; }

# --- The tree ----------------------------------------------------------------
# Created here rather than in the image, because the interesting case is an empty volume
# mounted over it. Each directory is the target of an environment variable set in the
# Dockerfile, so a `npm i -g`, a `go install`, a `cargo install` or a `pip install --user`
# typed without a thought still lands on the volume instead of the writable layer.
ensure_tree() {
    mkdir -p "$CACHE_DIR" "$DEV/bin" "$DEV/lib" "$DEV/opt" "$DEV/home" \
        "$DEV/npm" "$DEV/go" "$DEV/cargo" "$DEV/cache"
    # apk keeps downloaded packages and the repository index wherever /etc/apk/cache
    # points; the Dockerfile makes that this directory, so an `apk add` typed straight into
    # a shell also fills the cache the next start replays from. Recreated here only if
    # something removed it — never on top of a directory somebody bind-mounted there.
    if [ ! -e /etc/apk/cache ] && [ ! -L /etc/apk/cache ]; then
        ln -sfn "$CACHE_DIR" /etc/apk/cache
    fi
}

# `docker rm` keeps a volume and discards the writable layer, so whether this directory is
# a mount point is exactly the difference between "durable" and "gone on the next upgrade".
# Nothing here can create that mount, hence a warning rather than an error.
is_mounted() { grep -q " $DEV " /proc/self/mountinfo 2>/dev/null; }

warn_if_ephemeral() {
    is_mounted && return 0
    log "WARNING: $DEV is not a mount, so everything installed there dies with the"
    log "         container (it survives restart/stop-start, not \`docker rm\`)."
    log "         Add  -v kiao-dev:$DEV  to the docker run."
    return 0
}

# --- The declaration ---------------------------------------------------------
# The file and KIAO_DEV_PACKAGES say the same thing by two routes: the file is the box
# somebody built up over time, the variable is a compose file or a run command declaring a
# box from the outside. Both are read, in that order, deduplicated.
declared_packages() {
    {
        if [ -f "$PACKAGES_FILE" ]; then cat "$PACKAGES_FILE"; fi
        echo "${KIAO_DEV_PACKAGES:-}"
    } | sed 's/#.*//' | tr ',\r\t ' '\n\n\n\n' | awk 'NF && !seen[$0]++'
}

seed_packages_file() {
    [ -f "$PACKAGES_FILE" ] && return 0
    cat > "$PACKAGES_FILE" <<'EOF'
# Alpine packages installed into this container at every start (`kiao-dev sync`, which the
# entrypoint runs). One name per line; everything after a # is a comment.
#
# `kiao-dev add <pkg>` installs and appends here; `kiao-dev del <pkg>` does the reverse.
# Names are Alpine's, not Debian's — `kiao-dev search jdk` finds them.
#
# openjdk17-jdk
# maven
EOF
    return 0
}

record_packages() {
    seed_packages_file
    for pkg in "$@"; do
        if ! declared_packages | grep -qx -- "$pkg"; then
            printf '%s\n' "$pkg" >> "$PACKAGES_FILE"
        fi
    done
}

# Comment lines and hand-written spacing are kept: this file is edited by hand as often as
# by this script, and a `del` that reformatted it would be an unpleasant surprise.
forget_packages() {
    [ -f "$PACKAGES_FILE" ] || return 0
    for pkg in "$@"; do
        awk -v p="$pkg" '
            { bare = $0; sub(/#.*/, "", bare); gsub(/[ \t\r]/, "", bare) }
            bare == p { next }
            { print }
        ' "$PACKAGES_FILE" > "$PACKAGES_FILE.tmp"
        mv "$PACKAGES_FILE.tmp" "$PACKAGES_FILE"
    done
}

# --- Commands ----------------------------------------------------------------
# Deliberately not `set -e`-fatal: a typo in the package list, or a network that is down on
# a box whose cache is cold, must leave Dashboard running and say what happened. It is the
# entrypoint's slowest step and the one most likely to fail, and it is not what the
# container is for.
cmd_sync() {
    ensure_tree
    warn_if_ephemeral
    rc=0

    pkgs=$(declared_packages | tr '\n' ' ')
    if [ -n "${pkgs% }" ]; then
        log "installing declared packages: ${pkgs% }"
        # -U refreshes the repository index into the cache when the network allows, and
        # warns and falls back to the cached index when it does not — which is what makes a
        # container recreated on a disconnected machine come back with its tools.
        # $pkgs unquoted on purpose: one apk call resolving N packages together, rather
        # than N calls that could each pick a different revision of a shared dependency.
        if "$APK" add -U --no-progress $pkgs; then
            log "packages ready"
        else
            rc=1
            log "WARNING: apk add failed. Dashboard still starts; the tools are missing."
            log "         Check the names with \`kiao-dev search <term>\`, or the network"
            log "         if this is a first install with a cold $CACHE_DIR."
        fi
    else
        log "no package declared (write them in $PACKAGES_FILE or KIAO_DEV_PACKAGES)"
    fi

    run_setup || rc=1
    return $rc
}

# Everything a package manager cannot express: an SDK tarball, `npm i -g`, a private CLI.
# Run at every start, so it has to be idempotent — which is cheap to be, since what it
# installs is on the volume and it can return early when it finds it there.
run_setup() {
    [ -f "$SETUP_FILE" ] || return 0
    log "running $SETUP_FILE"
    rc=0
    set +e
    # An `apk add` written in this script is replayed at every start like everything else
    # here, so it is durable and the wrapper's note about it would mislead.
    export KIAO_DEV_APK_QUIET=1
    # A bind mount from Windows reports every file executable and a named volume reports
    # what was actually set, so both cases have to work.
    if [ -x "$SETUP_FILE" ]; then "$SETUP_FILE"; else bash "$SETUP_FILE"; fi
    rc=$?
    unset KIAO_DEV_APK_QUIET
    set -e
    if [ "$rc" -eq 0 ]; then
        log "$SETUP_FILE done"
    else
        log "WARNING: $SETUP_FILE exited $rc"
    fi
    return $rc
}

cmd_add() {
    [ "$#" -gt 0 ] || die "add needs at least one package name"
    ensure_tree
    # Installed first, recorded second: a name that does not exist must not end up in the
    # declaration, where it would fail every subsequent start.
    "$APK" add -U --no-progress "$@"
    record_packages "$@"
    log "declared in $PACKAGES_FILE: $*"
}

cmd_del() {
    [ "$#" -gt 0 ] || die "del needs at least one package name"
    forget_packages "$@"
    # `apk del` also uninstalls something the image itself put there (git, bash, nginx…),
    # which breaks this container until it is replaced. It is a deliberate command, so it
    # is obeyed; the declaration is what matters and it is already updated.
    "$APK" del --no-progress "$@" || log "not all of them were installed here"
    log "no longer declared: $*"
}

cmd_list() {
    pkgs=$(declared_packages)
    if [ -z "$pkgs" ]; then
        log "no package declared ($PACKAGES_FILE)"
        return 0
    fi
    printf '%-32s %s\n' "PACKAGE" "IN THIS CONTAINER"
    for pkg in $pkgs; do
        if [ -n "$("$APK" info -e "$pkg" 2>/dev/null)" ]; then
            state="installed"
        else
            state="MISSING (run: kiao-dev sync)"
        fi
        printf '%-32s %s\n' "$pkg" "$state"
    done
}

# Alpine names are not Debian names — openjdk17-jdk, not openjdk-17-jdk — and guessing is
# the first thing that goes wrong on this image, so searching is one command away.
cmd_search() {
    [ "$#" -gt 0 ] || die "search needs a term, e.g. \`kiao-dev search jdk\`"
    ensure_tree
    "$APK" update > /dev/null 2>&1 || true
    "$APK" search -v -- "$@"
}

cmd_status() {
    ensure_tree
    if is_mounted; then
        mount_state="a volume is mounted here — installs survive \`docker rm\`"
    else
        mount_state="NOT a mount — installs die with the container"
    fi
    echo "dev home     : $DEV ($mount_state)"
    echo "size         : $(du -sh "$DEV" 2>/dev/null | cut -f1) total," \
        "$(du -sh "$CACHE_DIR" 2>/dev/null | cut -f1) of it apk cache"
    echo "declaration  : $PACKAGES_FILE ($(declared_packages | wc -l | tr -d ' ') package(s))"
    if [ -n "${KIAO_DEV_PACKAGES:-}" ]; then
        echo "               plus KIAO_DEV_PACKAGES=$KIAO_DEV_PACKAGES"
    fi
    [ -f "$SETUP_FILE" ] && echo "setup script : $SETUP_FILE" || echo "setup script : none ($SETUP_FILE)"
    [ -f "$ENV_FILE" ] && echo "environment  : $ENV_FILE" || echo "environment  : none ($ENV_FILE)"
    echo "PATH         : $PATH"
    echo "HOME         : ${HOME:-}"
    echo "installs to  : npm=$DEV/npm go=$DEV/go cargo=$DEV/cargo python=$DEV/lib"
    echo
    cmd_list
}

usage() {
    cat <<EOF
kiao-dev — development tools that outlive this container, kept in $DEV

  kiao-dev add <pkg>…     install Alpine packages now and at every future start
  kiao-dev del <pkg>…     stop declaring them, and uninstall them here
  kiao-dev list           declared packages, and whether this container has them
  kiao-dev search <term>  find the Alpine name of something (they differ from Debian's)
  kiao-dev sync           replay the declaration — what the entrypoint runs at startup
  kiao-dev status         where everything lives, and whether it is actually persisted

Anything a package cannot express goes in $SETUP_FILE (run at every
start, so keep it idempotent); extra environment variables go in $ENV_FILE.
Mount a volume at $DEV or none of it is durable.
EOF
}

command="${1:-help}"
[ "$#" -gt 0 ] && shift
case "$command" in
    sync | install) cmd_sync "$@" ;;
    add) cmd_add "$@" ;;
    del | delete | remove | rm) cmd_del "$@" ;;
    list | ls) cmd_list "$@" ;;
    search) cmd_search "$@" ;;
    status) cmd_status "$@" ;;
    help | --help | -h) usage ;;
    *)
        echo "kiao-dev: unknown command '$command'" >&2
        usage >&2
        exit 1
        ;;
esac
