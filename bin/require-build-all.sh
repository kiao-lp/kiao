#!/bin/bash
# Checks that bin/build-all.sh has produced the shared artefacts named on the command line, and
# stops with one pointer back to it when it has not.
#
# The two kiao end scripts no longer build anything they have in common (see the header of
# bin/build-all.sh); they assume it. This is what turns that assumption into a sentence an operator
# can act on, instead of a Vite error about an unresolved `file:` import or a `cp` on a path that
# is not there.
#
# It checks *presence*, not freshness: nothing here can tell a binary built this morning from one
# built last month. Rerunning bin/build-all.sh is cheap where it matters — npm and Go both skip
# what has not changed — so the rule is simply to run it after a pull.
#
# Usage: bin/require-build-all.sh <artefact>...
#   reference         the reference libraries (reference/)
#   dashboard-deps     the Dashboard dependency tree
#   worker            the linux/amd64 worker binary
#   hybridflow-store the linux/amd64 hybridflow-store binary
#   kiao-mcp          the staged, self-contained kiao-mcp bundle
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

missing=""

# $1 the path that proves the artefact is there, $2 what to call it
want() {
    if [ ! -e "$PROJECT_ROOT/$1" ]; then
        missing="$missing  $2 (expected at $1)
"
    fi
}

for artefact in "$@"; do
    case "$artefact" in
        # kiao-mcp is the last project build-reference.sh builds, so its dist is also the proof
        # that the whole ordered list before it went through.
        reference)     want "reference/kiao-mcp/dist" "the reference libraries" ;;
        dashboard-deps) want "exchange/dashboard/node_modules" "the Dashboard dependency tree" ;;
        worker)        want "operation/worker/worker" "the worker binary (linux/amd64)" ;;
        hybridflow-store) want "operation/hybridflow-store/hybridflow-store" "the hybridflow-store binary (linux/amd64)" ;;
        kiao-mcp)      want "dist/kiao-mcp/dist/index.js" "the staged kiao-mcp bundle" ;;
        *) echo "require-build-all.sh: unknown artefact '$artefact'" >&2; exit 1 ;;
    esac
done

if [ -n "$missing" ]; then
    echo "ERROR: this build needs what ./bin/build-all.sh produces, and these are not there:" >&2
    printf '%s' "$missing" >&2
    echo "" >&2
    echo "       Run ./bin/build-all.sh first. It builds everything the kiao end scripts share," >&2
    echo "       once, so that running two of them in a row does not build it twice." >&2
    exit 1
fi
