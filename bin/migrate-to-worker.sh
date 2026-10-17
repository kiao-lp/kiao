#!/bin/sh
# Migrates this machine's kiao state after the files-service -> worker rename, and after
# the kiao-dcms -> kiao rename that moved the directories below.
#
# What lives outside the repository and names the old service:
#
#   - ${XDG_CONFIG_HOME:-~/.config}/kiao/config.env — the machine's standing answers,
#     read by `kiao` and bin/local-start-kiao.sh. KIAO_FILES_SERVICE_* keys are
#     rewritten to KIAO_WORKER_* in place. Idempotent: a second run changes nothing.
#   - The installed executable's binaries — removed by bin/install-kiao-executable.sh, which
#     swaps them atomically with the new ones and calls this script. This script only
#     reports them, because removing the old binary without installing the new one would
#     strand the installed executable.
#
# What lives outside the repository and names the old executable:
#
#   - ${XDG_CONFIG_HOME:-~/.config}/kiao-dcms/config.env — moved to .../kiao/config.env
#     when the new file is absent, keys migrated after the move. When both exist the new
#     one is the answer and the old one is left alone: the launcher reads the new one
#     first either way.
#
# Deliberately untouched:
#
#   - ${XDG_STATE_HOME:-~/.local/state}/kiao/instances/*.json — a cache, never an
#     authority. The launcher confirms every entry against its port and drops stale ones,
#     so old entries age out on their own. The kiao-dcms registry beside it is read the
#     same way, so instances an upgrade did not restart are still seen.
#   - Running instances keep the environment they started with; they are unaffected until
#     restarted. Restart them (`kiao --stop all`) after reinstalling.
#
# Usage: ./bin/migrate-to-worker.sh [--quiet]
#   --quiet  say nothing unless a key is dropped in favour of an already-set new one
set -eu

QUIET=0
if [ "${1:-}" = "--quiet" ]; then QUIET=1; fi

say() { if [ "$QUIET" -eq 0 ]; then echo "migrate-to-worker: $*"; fi; }

CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}"
CONFIG_FILE="$CONFIG_BASE/kiao/config.env"
LEGACY_CONFIG_FILE="$CONFIG_BASE/kiao-dcms/config.env"

move_legacy_config() {
    if [ -f "$CONFIG_FILE" ] || [ ! -f "$LEGACY_CONFIG_FILE" ]; then
        return 0
    fi
    mkdir -p "$(dirname "$CONFIG_FILE")"
    # A move keeps the file's own mode: it holds a token and is 0600.
    mv "$LEGACY_CONFIG_FILE" "$CONFIG_FILE"
    rmdir "$(dirname "$LEGACY_CONFIG_FILE")" 2>/dev/null || true
    say "moved $LEGACY_CONFIG_FILE to $CONFIG_FILE"
}

migrate_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        say "no $CONFIG_FILE — nothing to migrate"
        return 0
    fi
    # The old keys this file still sets. Word characters only: a KEY= line names a variable,
    # and anything else on the line is a value or a comment, never a second key.
    old_keys=$(grep -oE 'KIAO_FILES_SERVICE_[A-Za-z_][A-Za-z0-9_]*' "$CONFIG_FILE" | sort -u || true)
    if [ -z "$old_keys" ]; then
        say "$CONFIG_FILE already migrated"
        return 0
    fi
    tmp=$(mktemp)
    cp "$CONFIG_FILE" "$tmp"
    migrated=0
    for old in $old_keys; do
        new=$(printf '%s' "$old" | sed 's/^KIAO_FILES_SERVICE_/KIAO_WORKER_/')
        # A key position is a KEY= line, live or commented out (the template this
        # installer writes is commented keys). A mention inside a value or a sentence
        # is inert prose and is left alone.
        if ! grep -qE "^[[:space:]]*(#[[:space:]]*)?(export[[:space:]]+)?$old[[:space:]]*=" "$tmp"; then
            continue
        fi
        migrated=1
        if grep -qE "^[[:space:]]*(export[[:space:]]+)?$new[[:space:]]*=" "$tmp"; then
            # Both spellings set: the new one wins and the old line goes. Said aloud even
            # when quiet, because a value is being thrown away.
            echo "migrate-to-worker: $CONFIG_FILE sets both $old and $new; keeping $new" >&2
            sed -i -E "/^[[:space:]]*(export[[:space:]]+)?$old[[:space:]]*=/d" "$tmp"
        else
            say "$old -> $new"
        fi
        sed -i -E -e "s/^([[:space:]]*(export[[:space:]]+)?)$old([[:space:]]*=)/\1$new\3/" \
            -e "s/^([[:space:]]*#[[:space:]]*)$old([[:space:]]*=)/\1$new\2/" "$tmp"
    done
    if [ "$migrated" -eq 0 ]; then
        say "$CONFIG_FILE already migrated"
        rm -f "$tmp"
        return 0
    fi
    # Keep the file's own mode: it holds a token and is 0600.
    cat "$tmp" > "$CONFIG_FILE"
    rm -f "$tmp"
}

report_leftovers() {
    # An old binary still installed: reinstalling swaps it (bin/install-kiao-executable.sh).
    # Both install directories: a files-service may predate the kiao-dcms -> kiao move too.
    for bin in "$HOME/.local/share/kiao/bin/files-service" \
               /usr/local/lib/kiao/bin/files-service \
               "$HOME/.local/share/kiao-dcms/bin/files-service" \
               /usr/local/lib/kiao-dcms/bin/files-service; do
        if [ -e "$bin" ]; then
            say "$bin is still installed — reinstall kiao to swap it for worker"
        fi
    done
    # Old workers still running: they hold the stores' state locks under the old name, so a
    # new launcher would refuse to start beside them rather than take over.
    if command -v pgrep >/dev/null 2>&1 && pgrep -f 'bin/files-service' >/dev/null 2>&1; then
        say "a files-service is still running — restart instances after reinstalling (kiao --stop all)"
    fi
}

move_legacy_config
migrate_config
report_leftovers
say "done ($CONFIG_FILE)"
