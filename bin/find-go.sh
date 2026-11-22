#!/bin/sh
# Prints the Go executable used by Kiao's build and local-run scripts.
# Prefer the toolchain installed by bin/install-go-toolchain.sh, even when PATH
# contains an older Go. Other installations remain usable when it is absent.

if [ -x /usr/local/go/bin/go ]; then
    echo /usr/local/go/bin/go
    exit 0
fi

if command -v go >/dev/null 2>&1; then
    command -v go
    exit 0
fi

for candidate in "$HOME/go-sdk/go/bin/go" "$HOME/sdk/go/bin/go"; do
    if [ -x "$candidate" ]; then
        echo "$candidate"
        exit 0
    fi
done

echo "ERROR: Go toolchain not found. Run bin/install-go-toolchain.sh to install Go 1.27.3+." >&2
exit 1
