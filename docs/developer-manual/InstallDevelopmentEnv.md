# Install development environment

This document will guide you through the process of setting up a development environment for KIAO.

## Prerequisites

- Linux or similar
- Docker (for the single-container image and the local PostgreSQL)
- NodeJS 20+
- Go 1.27.3+ (the backend services in `operation/`)

## Install the Go toolchain

The Go services in `operation/` require
Go 1.27.3+, which is newer than the `golang-go` package shipped by Debian/Mint apt.

On a Debian-based system (Debian, Ubuntu, Linux Mint), install the official toolchain with:

```bash
./bin/install-go-toolchain.sh
```

The script downloads the official binary tarball, verifies its checksum, installs it
to `/usr/local/go`, and puts it first on `PATH` for new shells (via `/etc/profile.d/go.sh`).
That profile also clears `GOROOT`, so Go locates its own SDK.
Rerunning the installer repairs that configuration even if the requested Go version is already
installed. Kiao's build, local-run and e2e scripts use this toolchain immediately, regardless of
the current shell's `PATH` and `GOROOT`. For other commands in the current shell, run:

```bash
unset GOROOT
export PATH=/usr/local/go/bin:$PATH
go version
```

Override the version with `GO_VERSION=x.y.z ./bin/install-go-toolchain.sh` if needed.

## Build

```bash
./bin/build-all.sh                   # reference libraries, Go binaries, kiao-mcp, Dashboard tree
./bin/build-kiao-image.sh            # the kiao Docker image, or
./bin/install-kiao-executable.sh     # the kiao executable on this machine
```

See [`bin/README.md`](../../bin/README.md) for what the shared stage builds and what each end
script adds.

## Run

```bash
./bin/local-start-kiao.sh            # kiao over a folder, on fixed local ports
./bin/test-e2e.sh                    # the Playwright suite (starts its own throwaway stacks)
```

`config/local/` holds the local ports and the PostgreSQL the boards develop against;
[`e2e/`](../../e2e) documents the suite.
