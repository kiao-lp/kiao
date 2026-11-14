---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# The toolbox

← [worker](../../README.md).

The [toolbox wire contract](../../PROTOCOL/toolbox.md) owns inventory states, registration rules
and the asynchronous job lifecycle. Dashboard's
[configuration-panel design](/exchange/dashboard/src/core/toolbox/docs/solution-design/configuration-panel.md)
owns the UI. This page describes worker's catalogue, installation ownership and runtime equipment.

`internal/toolbox` manages machine equipment through the configuration panel. Each row reports
whether a component is installed and, for harnesses and MCP servers, whether it is enabled for turns.

## Catalogue and installation prefix

**What it may install is a shipped catalogue** (`internal/toolbox/catalog/pub.json`, embedded, and every
`*.json` the deployment staged beside it in `KIAO_WORKER_TOOLBOX_CATALOG_PATH` — a deployment
with components of its own drops them there under another name). A request names an id from it; there is no free-form command anywhere on the
wire, which is what makes an authenticated caller unable to ask for anything the deployment did not
ship. Each entry carries a recipe **per platform**, because the three places kiao runs get the same
component by three different routes.

**Nothing asks for root.** On a machine somebody owns and on a server the service user is not root
and never will be, so a JDK is a checksum-verified Temurin tarball, Node is the official LTS
tarball, Python is `uv python install`, and everything lands under one prefix,
`KIAO_WORKER_TOOLBOX_PATH`. Empty — the default — makes the panel read-only: a deployment
that has not said where software may be installed has not agreed to software being installed. The
one exception is the `kiao` image, where the process already *is* root, there is no sudo to ask,
and an install that skips `kiao-dev` does not survive the container being replaced.

## Runtime resolution

**Runtimes serve both turns and worker operations.** The worker uses `ffmpeg` for
`POST /media/saveSegments`. Its catalogue kind is `runtime`, and its `role` explains that use.
A binary installed outside the toolbox reads as *on this machine* and cannot be uninstalled
through the panel.

The service finds it through `RuntimeBinary` — the toolbox's copy first, the machine's after. The
build is BtbN/FFmpeg-Builds', the static builds FFmpeg's own download page sends Linux to: pinned
to a release branch rather than a tag, because every build is of a branch's newest commit, and two
files taken out of a `.tar.xz` that the machine's `xz` opens — which is why a machine without one
reads *blocked*, with the command to run, rather than failing after a 150 MB download. Alpine
installs the image's own package.

## Inventory and turn equipment

`<state>/toolbox.json` records installations and turn equipment. Its MCP selection is seeded once
from `KIAO_WORKER_MCP_SERVERS`; the ledger is the authority from then on, so changing equipment
requires no environment edit or restart. The [wire contract](../../PROTOCOL/toolbox.md) defines
ownership checks for uninstalling, inventory states and registration defaults.

Harness runtimes — `claude-cli`, `codex-cli`, `muse-cli`, `opencode-cli` and Pi installations —
declare `harness` in the catalogue. The runner reads `HarnessOffered` per request and `MCPServers`
per turn. Installing or disabling a CLI therefore changes the next page's harness list without
a restart. The availability switch also handles binaries the panel cannot uninstall, including
those baked into an image that the next `docker run` would restore.

## Harness installation and skills

Codex installs the latest stable official release at each install, resolving GitHub's `/latest`
redirect and verifying the package against its `codex-package_SHA256SUMS`. The whole package stays
together, including the app server and Code Mode helper needed by current models. Build-time pins
such as `codex-cli@0.162.1` are also accepted; the installer translates them to release tags.

**Installing a harness CLI synchronizes the store's skills.** Skills live in `.agents/skills`
and `.claude/skills`, composed from the embedded catalogue and any assembly-provided source.
Application assembly wires `OnHarnessInstalled` to the runner's equipment synchronization.
The [config-document save effects](../../PROTOCOL/config-documents.md#save-effects) describe
the same synchronization after plugin-list changes. MCP handshake probes, tool costs and
Claude's strict server selection belong to the [toolbox contract](../../PROTOCOL/toolbox.md).
