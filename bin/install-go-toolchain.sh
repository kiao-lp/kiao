#!/bin/bash
set -euo pipefail

# Installs the Go toolchain on a Debian-based system (Debian, Ubuntu, Linux Mint).
#
# The apt "golang-go" package lags well behind upstream, so this fetches the
# official binary tarball from Google's download server and installs it under
# /usr/local/go. The version matches the one required by the Go services in
# operation/*-go (see their go.mod). Override with GO_VERSION=x.y.z if needed.

GO_VERSION="${GO_VERSION:-1.27.2}"
INSTALL_DIR="/usr/local"
GO_ROOT="$INSTALL_DIR/go"

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

# Nothing to do if the wanted version is already installed.
if [ -x "$GO_ROOT/bin/go" ] && "$GO_ROOT/bin/go" version | grep -q "go${GO_VERSION} "; then
    echo "Go ${GO_VERSION} is already installed:"
    "$GO_ROOT/bin/go" version
    exit 0
fi

# Use sudo only when not already root.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
fi

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

# Put go on PATH for future login shells.
PROFILE_FILE="/etc/profile.d/go.sh"
echo 'export PATH=$PATH:/usr/local/go/bin' | $SUDO tee "$PROFILE_FILE" >/dev/null
$SUDO chmod 644 "$PROFILE_FILE"

echo
echo "Done: $("$GO_ROOT/bin/go" version)"
echo "Added ${PROFILE_FILE} for new shells. For the current shell, run:"
echo "    export PATH=\$PATH:/usr/local/go/bin"
