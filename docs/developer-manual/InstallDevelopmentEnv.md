# Install development environment

This document will guide you through the process of setting up a development environment for KIAO.

## Prerequisites

- Linux or similar
- Docker (for the single-container image and the local PostgreSQL)
- NodeJS 20+
- Go 1.24+ (the backend services in `operation/`)

## Install the Go toolchain

The Go services in `operation/` require
Go 1.24+, which is newer than the `golang-go` package shipped by Debian/Mint apt.

On a Debian-based system (Debian, Ubuntu, Linux Mint), install the official toolchain with:

```bash
./bin/install-go-toolchain.sh
```

The script downloads the official binary tarball, verifies its checksum, installs it
to `/usr/local/go`, and adds it to the `PATH` for new shells (via `/etc/profile.d/go.sh`).
For the current shell, run `export PATH=$PATH:/usr/local/go/bin`, then verify with `go version`.

Override the version with `GO_VERSION=x.y.z ./bin/install-go-toolchain.sh` if needed.

## Build

```bash
./bin/build-all.sh                   # reference libraries, Go binaries, kiao-mcp, Dashboard tree
./bin/build-kiao-image.sh            # the kiao Docker image, or
./bin/install-kiao-executable.sh     # the kiao executable on this machine
```

See [`bin/README.md`](../bin/README.md) for what the shared stage builds and what each end
script adds.

## Run

```bash
./bin/local-start-kiao.sh            # kiao over a folder, on fixed local ports
./bin/test-e2e.sh                    # the Playwright suite (starts its own throwaway stacks)
```

`config/local/` holds the local ports and the PostgreSQL the boards develop against;
[`e2e/`](../e2e) documents the suite.
