#!/bin/bash
set -euo pipefail

# Installs the Go toolchain on a Debian-based system (Debian, Ubuntu, Linux Mint).
#
# The apt "golang-go" package lags well behind upstream, so this fetches the
# official binary tarball from Google's download server and installs it under
# /usr/local/go. The version matches the one required by the Go services in
# operation/ (see their go.mod). Override with GO_VERSION=x.y.z if needed.

GO_VERSION="${GO_VERSION:-1.27.3}"
INSTALL_DIR="/usr/local"
GO_ROOT="$INSTALL_DIR/go"

# Let the selected Go locate its own SDK, regardless of an old shell setup.
unset GOROOT
export GOTOOLCHAIN=local

# Map the machine architecture to Go's release naming.
case "$(uname -m)" in
    x86_64|amd64)   GO_ARCH="amd64" ;;
    aarch64|arm64)  GO_ARCH="arm64" ;;
    armv6l|armv7l)  GO_ARCH="armv6l" ;;
    i386|i686)      GO_ARCH="386" ;;
    *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

TARBALL="go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
URL="https://dl.google.com/go/${TARBALL}"

# Use sudo only when not already root.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

# Keep configuring PATH on reruns, even when Go itself needs no update.
if [ -x "$GO_ROOT/bin/go" ] && "$GO_ROOT/bin/go" version | grep -q "go${GO_VERSION} "; then
    echo "Go ${GO_VERSION} is already installed."
else
    # Make sure we have a downloader.
    if ! command -v curl >/dev/null 2>&1; then
        echo "Installing curl..."
        $SUDO apt-get update && $SUDO apt-get install -y curl
    fi

    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    echo "Downloading ${URL} ..."
    curl -fSL "$URL" -o "$TMP_DIR/$TARBALL"

    echo "Verifying checksum ..."
    EXPECTED_SHA="$(curl -fsSL "${URL}.sha256")"
    echo "${EXPECTED_SHA}  $TMP_DIR/$TARBALL" | sha256sum -c -

    echo "Installing to ${GO_ROOT} (removing any previous install) ..."
    $SUDO rm -rf "$GO_ROOT"
    $SUDO tar -C "$INSTALL_DIR" -xzf "$TMP_DIR/$TARBALL"
fi

# Check outside echo: a failed substitution inside echo would still report success.
INSTALLED_VERSION="$("$GO_ROOT/bin/go" version)"
case "$INSTALLED_VERSION" in
    "go version go${GO_VERSION} "*) ;;
    *) echo "ERROR: expected Go ${GO_VERSION}, got: ${INSTALLED_VERSION}" >&2; exit 1 ;;
esac

# Prefer this Go to distro packages in future login shells.
PROFILE_FILE="/etc/profile.d/go.sh"
PROFILE_CONTENT='unset GOROOT
export PATH="/usr/local/go/bin:$PATH"'
if [ ! -f "$PROFILE_FILE" ] || [ "$(cat "$PROFILE_FILE")" != "$PROFILE_CONTENT" ]; then
    printf '%s\n' "$PROFILE_CONTENT" | $SUDO tee "$PROFILE_FILE" >/dev/null
    $SUDO chmod 644 "$PROFILE_FILE"
fi

echo
echo "Done: $INSTALLED_VERSION"
echo "Configured ${PROFILE_FILE} for new shells. Kiao scripts use this Go immediately."
echo "For other commands in the current shell, run:"
echo "    unset GOROOT"
echo "    export PATH=/usr/local/go/bin:\$PATH"
