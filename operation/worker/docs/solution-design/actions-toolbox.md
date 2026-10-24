# File actions and the toolbox

← [worker](/operation/worker/README.md) · assumes the index.

## File actions

Operations a client may run on a file, implemented by other services and declared in the manifest
named by `KIAO_WORKER_ACTIONS_PATH`. This service only reads the manifest, matches the rule and
forwards the run.

How the system fits together is [file-actions](/docs/solution-design/file-actions.md); how to add
one is the [file-actions](/.agents/skills/file-actions/SKILL.md) skill; the normative wire
contract is [PROTOCOL.md](/operation/worker/PROTOCOL/actions-media-toolbox.md) § File actions.

## The toolbox

A kiao installation is a store, an agent, and **a machine with things installed on it**. The third one used to be
whatever the deployment happened to have: a JDK if someone had put one there, a Node if the image
shipped one, and the MCP servers named in an env file and nowhere else. `internal/toolbox` makes it
a surface — a package manager in the configuration panel, with the same two questions on every row:
is it here, and is a turn given it.

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

**A runtime is not only what a turn runs.** `ffmpeg` is a catalogue runtime and the service is what
spawns it: it is what saves the segments of a video as files of their own
(`POST /media/saveSegments`), and no turn ever spawns it. There is no third kind for it, because
nothing would read one — the kind decides which section a row is in and whether its switch means
*handed to a turn*, and ffmpeg wants a section of neither and no switch. What it does want is what
the kind actually gates in the code: an `apt install ffmpeg` somebody did themselves reads as *on
this machine*, with no button to delete their binary. So the word widens, and `role` — a sentence,
not an enum — says what each one is for.

The service finds it through `RuntimeBinary` — the toolbox's copy first, the machine's after. The
build is BtbN/FFmpeg-Builds', the static builds FFmpeg's own download page sends Linux to: pinned
to a release branch rather than a tag, because every build is of a branch's newest commit, and two
files taken out of a `.tar.xz` that the machine's `xz` opens — which is why a machine without one
reads *blocked*, with the command to run, rather than failing after a 150 MB download. Alpine
installs the image's own package.

**An install is a job.** Fetching a Chromium is minutes; `POST /toolbox/install` answers 202 with a
job as soon as it starts, the job appends to a log, and the panel polls `GET /toolbox/jobs/{id}`.
One at a time.

**The ledger is the boundary of what the panel owns.** `<state>/toolbox.json` records what *this
service* installed; an uninstall removes what it names and nothing else, so a JDK the operator put
on the machine reads as *on this machine* with no button to remove it. It also records which MCP
servers are handed to a turn — seeded once from `KIAO_WORKER_MCP_SERVERS` and the authority
from then on, so switching a server off is a click rather than an env file and a restart.

**Four runtimes are agents, and their row carries that same switch.** `claude-cli`, `codex-cli`,
`muse-cli` and `opencode-cli` declare `agent` in the catalogue, and the hybridflow runner reads `AgentOffered` per request the
way it reads `MCPServers` per turn — so installing a CLI puts its agent in the tab on the next page
load, and switching the row off takes it out with no restart. It reads the other way round from a
server's: an agent nobody has said anything about is offered, because the CLI is on the machine and
silence is not a reason to hide it. That switch is the answer for a CLI the panel did not install —
one baked into an image, one that was there first — where an uninstall would be deleting somebody
else's file, and where, in a container, the next `docker run` would put it back anyway. The
`kiao` image ships neither CLI for exactly this reason: on the volume, both acts are real.

Codex installs the latest stable official release at each install, resolving GitHub's `/latest`
redirect and verifying the package against its `codex-package_SHA256SUMS`. The whole package stays
together, including the app server and Code Mode helper needed by current models. Build-time pins
such as `codex-cli@0.162.1` are also accepted; the installer translates them to release tags.

**An agent CLI arriving means the skills are written again.** They live in the store
(`.agents/skills`, `.claude/skills`), installed at startup from the bundle in the binary, and a CLI
that arrives later reads them on its next turn — but until now no CLI could arrive later at all. So
the install job calls back — `OnAgentInstalled`, set by the program, the one edge that runs from this
library towards the hybridflow runner — and it is a bare "a CLI arrived": what to do about it is
the other half's business and is not described here.

**And so does the plugin list being saved**, for the same reason and through the same shape: which
skills a store gets is which plugins it loads, so the document store calls back too —
`OnDashboardConfigSaved`, also set by the program, also a bare "it changed". Without it, switching a
plugin off would leave its skill in the store until somebody restarted the service.

**An installed MCP server is probed before it is trusted**, with a real `initialize` /`tools/list`
handshake. That is both the proof the install works — a package that resolved and wrote its files
can still fail to start, and the only other place that shows up is a turn with quietly missing
tools — and where the panel's tool count and per-request byte cost come from.

**The consequence to know about**: `--mcp-config` travels with `--strict-mcp-config`, so once
anything is registered here a turn is handed *exactly* these servers, and servers registered with
the `claude` command itself stop arriving. The panel says so above the list.
