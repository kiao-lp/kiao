---
id: "00028"
title: "the machine's outfitting is a library, and the panel names a catalogue"
status: accepted
date: 2026-08-31
tags: ["toolbox", "worker", "mcp", "installs"]
components: ["worker", "dashboard"]
paths: ["operation/worker/internal/toolbox"]
symbols: ["internal/toolbox", "catalog.json", "toolbox.json", "MCPRegistry", "core.MCPServer", "KIAO_WORKER_TOOLBOX_PATH", "KIAO_WORKER_MCP_SERVERS", "POST /toolbox/install"]
triggers: ["install JDK", "install node", "install python", "new MCP server", "tool byte cost", "ledger", "handshake probe", "202 install job"]
supersedes: []
superseded_by: []
---

# 00028 — the machine's outfitting is a library, and the panel names a catalogue

**Decision:** worker grows a third library beside the document store and the conduite des agents:
`internal/toolbox`, **what is installed on the machine so that a turn can use it** — a JDK, the Node
LTS, Python, and the MCP servers that give a turn a web fetcher, a search engine, a PDF converter or
a paper index. It is driven from a configuration panel in Dashboard, a tool bar tab reached from the
tools menu, which reads as a package manager: two sections of rows, one button each, and a
dependency prompt before an install that would drag another component in.

**Why a library and not a corner of `agents`.** Installing a JDK has nothing to do with a
conversation. The rule that has held since the split — each library on the socle, never on another —
holds here too: `agents` declares an `MCPRegistry` port and `main.go` fills it with the toolbox,
exactly as it already fills `DocumentStore` with the file service. The one thing that had to cross
is `core.MCPServer`, which sits in the socle for the reason `core.Route` does: two libraries speak
it and neither owns it.

**A shipped catalogue, not a command field.** Everything installable is written in
`internal/toolbox/catalog.json`, embedded in the binary the way the skills are, with a recipe **per
platform**. A request names an id from it and carries no command, no package name and no version.
That is the whole security model of a surface that runs installers, and it is the bargain
`actions.json` already strikes for file actions: the deployment owns the declaration, the client can
only point at an entry of it. The three runtimes get the same component by three different routes,
which is why the recipe rather than the component is per-platform.

**No root anywhere, and the one exception proves it.** On a machine somebody owns and on the VPS the
service user is not root and never will be, so installing "the distribution JDK" would mean a
sudoers rule — and that is the honest cost, stated: what gets installed is a checksum-verified
Temurin tarball, the official Node LTS tarball, and `uv python install`, all under one prefix named
by `KIAO_WORKER_TOOLBOX_PATH`. Empty is the default and makes the panel read-only: a
deployment that has not said where software may be installed has not agreed to software being
installed. The exception is the `kiao` image, where the process already *is* root, there is no
sudo to ask, and an install that skips `kiao-dev` does not survive the container being replaced — so
there the recipe is the image's own mechanism, and the durability stays where it already lived.

**The ledger is the boundary of what the panel owns.** `<state>/toolbox.json` records what *this
service* installed, and an uninstall removes what it names and nothing else. A `uv` that was on the
machine before the panel existed reads as *on this machine* with no button to remove it — the same
discipline as the `.kiao-skill` marker, and for the same reason: a button labelled "uninstall" that
deletes somebody else's tool is a bug you only find once.

**Registration moved out of the env file.** `KIAO_WORKER_MCP_SERVERS` now **seeds** that
ledger on a store that has never had one and stops being the authority the moment it exists. Without
the seed this build would have silently taken `units` and `cv` away from every turn on the VPS and
in the image; with it, switching a server off is a click rather than an env file and a restart.
Registration is also a question separate from being installed, in both directions, because every
tool a server declares is sent with **every single request** a turn makes — `units,cv` alone are
tens of thousands of characters, on a VPS with one vCPU — and a panel offering eight more servers
without saying what they weigh is offering a bill nobody can read. Hence the handshake probe after
an install, which does double duty: it is the proof the server actually starts, and it is where the
tool count and the per-request byte cost come from.

**The MCP document is written per turn.** It used to be written once at startup, because it names an
absolute script path, a port and a node binary, all three of which move with a deployment. The set
itself now moves too, the moment somebody installs a server — so the document is named after the
digest of its own contents and written on the spawn path: an identical set costs a stat, and a
changed set reaches the next prompt instead of the next restart.

**The consequence worth stating out loud.** `--mcp-config` travels with `--strict-mcp-config`, so
once anything is registered in the panel a turn is handed *exactly* those servers, and servers
registered with the `claude` command itself stop arriving. Previously that only happened where a
kiao-mcp bundle was staged, which is to say never on a developer's own machine. The panel says so in
a line above the list rather than leaving it to be discovered.

**An install is a job.** Fetching a Chromium is minutes. `POST /toolbox/install` answers `202` with
a job, the job appends to a log, and the panel polls it — the idiom the Git monitor and the sign-in
probe already use, and the only one available: KIAO has no streaming transport but the Claude
socket, and that is a turn's channel, not a place to put a package manager. One job at a time.

**A cost accepted.** The catalogue's Python servers pull heavy dependency trees, and on musl some
may have no wheel and no compiler to build one. The design reports that per row, with the installer's
own log, rather than promising every entry installs everywhere — which is what a package manager
does, and why a row can read *not here*.
