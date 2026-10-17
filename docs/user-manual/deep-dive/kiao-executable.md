# Executable

[User manual](../README.md) · [Quick guide: components and installation](../quick-guide/components-and-installation.md) · [Docker image](kiao-docker.md)

The `kiao` executable runs Kiao on a Debian-based Linux machine without Docker. Point it
at a folder and it serves that folder through Dashboard, on free ports, in a browser tab
it opens for you. Each folder has its own instance. It runs as you, with your files and
your machine's agent CLIs and credentials.

The installation includes Dashboard, worker, hybridflow-store, the PlantUML renderer,
the `kiao-mcp` servers, skills and the toolbox. Unlike the [Docker image](kiao-docker.md),
it does not include PostgreSQL: [boards](#boards) require a boards service or a database
you provide. This page details installation, command options and configuration.

Run the build commands from the Kiao source checkout, in the directory containing `bin/`:

```bash
./bin/build-all.sh                   # the shared build stage — once, before any kiao end script
./bin/install-kiao-executable.sh     # build and install (a few minutes, mostly the SPA)

kiao ~/some/project             # serve it, open a browser
kiao -d ~/some/project          # …in the background
kiao --list                     # what is running
kiao --stop all                 # stop it
```

## Install

[`bin/install-kiao-executable.sh`](../../../bin/install-kiao-executable.sh) builds the Dashboard SPA,
worker, hybridflow-store and the launcher in [`bin/kiao-launcher/`](../../../bin/kiao-launcher/),
fetches the PlantUML jar and installs the staged `kiao-mcp` bundle. It places these parts
in one directory and links the command into `~/.local/bin` by default. Make sure that
directory is on your shell's `PATH`.
It takes the reference libraries and the Dashboard dependency tree from
[`bin/build-all.sh`](../../../bin/build-all.sh) — the stage the two kiao end scripts share — and stops
with a pointer to it if that has not been run (see [`bin/README.md`](../../../bin/README.md)):

```
~/.local/share/kiao/
├── bin/kiao               the launcher — the only thing that gets run
├── bin/worker             the Go service, built for this machine
├── bin/hybridflow-store   the boards service, started when a database is configured
├── web/                   the built SPA (VITE_NO_SECURITY, no service worker, /plantuml)
├── lib/plantuml.jar       the diagram renderer, pinned and checksummed
├── kiao-mcp/              the bundled MCP servers and their dependencies
├── catalog/               the toolbox catalogue
├── migrations/            the file-store migration machinery — no script, by design
└── VERSION

~/.local/bin/kiao -> ~/.local/share/kiao/bin/kiao
```

| Flag | |
|---|---|
| `--skip-spa` | reuse whatever is in `exchange/dashboard/build` — the usual flag when only the Go or the launcher code changed |
| `--plantuml-jar PATH` | ship this jar instead of downloading the pinned one — an offline install, or a jar you keep yourself |
| `--skip-plantuml` | install without fetching it; whatever jar is already installed stays |
| `--system` | install into `/usr/local` for everyone on the machine (needs `sudo`) |
| `--prefix DIR` / `--bindir DIR` | install somewhere else entirely |
| `--uninstall` | stop the instances, remove the parts and the executable |

Reinstalling over a running instance is safe: the binaries are unlinked and replaced rather than
written over, so what is running keeps the files it opened and the next start gets the new ones.

**Upgrading from `kiao-dcms`** is a reinstall: the old executable is removed, the installed
tools move from `~/.local/share/kiao-dcms/toolbox` to `~/.local/share/kiao/toolbox`, and
`~/.config/kiao-dcms/config.env` moves to `~/.config/kiao/config.env`. Until that move, the
new executable reads the old config and the old instance registry, so `--list` and `--stop`
still see instances it did not start. `KIAO_HOME` replaces `KIAO_DCMS_HOME`; the old name
is still honoured.

To build with: Git, a run of `./bin/build-all.sh`, Go 1.24+ (`./bin/install-go-toolchain.sh`), Node 20+ with npm,
and a reachable github.com for the jar (cached in `dist/cache/plantuml` after the first time). To run with: `git`, the `claude` CLI
if the Claude tab is wanted, and — for diagrams — a JRE and `graphviz`, the two parts of PlantUML
that come from the machine rather than from here: `sudo apt install default-jre-headless graphviz`.
The install names whichever of those is missing and installs anyway — none of them is needed to
edit markdown.

## Running an instance

`kiao [folder]` — the folder defaults to the current directory, and must exist.

| Option | |
|---|---|
| `-d`, `--detach` | run in the background, in its own session; the URL and the log path are printed before it returns |
| `--port N` | serve Dashboard on this port instead of the next free one |
| `--no-browser` | do not open a browser |
| `--migrations` | run the file-store migrations on this folder at startup (see below) |
| `--plantuml PATH` | a `plantuml.jar`, or a command taking `-tsvg -pipe`, instead of the one that ships with the executable |
| `--plantuml-server URL` | send diagrams to a PlantUML server instead of rendering them here |
| `--list`, `--stop [folder\|all]` | the running instances; stopping one, or every one |

**Ports** are taken in order from 48400 upwards — Dashboard, then the worker, then the
hybridflow-store on an instance that has boards — skipping whatever is already listening. That keeps them below 49152, which on WSL2 is the difference between
a port you keep and one Windows takes back, and above the fixed `bin/local-start-*.sh` ports
(482xx–483xx), so an instance and a local-start never collide. Only Dashboard is meant to be
visited; it is bound to `127.0.0.1` and proxies the API to the worker beside it, the way
nginx does in the image.

**Starting a folder that already has an instance opens its browser tab**, rather than failing or
starting a second one. Two of them could not run anyway — the worker locks the store's state
directory — and what was wanted was the folder, open.

**Stopping** is Ctrl+C in the terminal that started it, or `kiao --stop <folder>` for a
detached one. Either way the worker goes with it, and so does anything it started: a Claude
turn, a `git push`, a migration.

## Configuring it once

```
~/.config/kiao/config.env    # $XDG_CONFIG_HOME/kiao/config.env, if that is set
```

Read at every start, so that starting an instance is `kiao .` and not four exports. The
install script writes a commented template the first time and never touches it again.

`KEY=value` a line, `#` comments, a leading `export` tolerated so the same file can be sourced by a
shell, quotes optional. **What is already exported wins**, so trying something out for one run is
still one export and the file stays put.

Every variable in it reaches the worker and the hybridflow-store too — they are children of
this command and inherit its environment — so it is the one place to answer for all three. That
includes `KIAO_WORKER_SHUTDOWN_COMMAND` and `KIAO_WORKER_TOOLBOX_PATH`, which the
template lists.

A file holding a credential — a key with `TOKEN`, `PASSWORD`, `SECRET` or `DATABASE_URL` in its
name — that anybody but its owner can read is **refused**, with the `chmod 600` to type. `ssh`
does the same for a private key, for the same reason. `bin/local-start-kiao.sh` reads the same file,
so a machine is configured once and both entry points agree.

The start says which file it read:

```
  config         /home/me/.config/kiao/config.env
```

## Boards

The boards and their flow nodes are **rows in PostgreSQL on a shared service**, not files in
the folder. Every instance is a client of that one service — the online Dashboard, and `kiao` on
every machine — so a board made here is the same board as the one made there. Two lines in
`config.env`:

```sh
KIAO_WORKER_HYBRIDFLOW_URL=https://boards.example.com/api/hybridflow
KIAO_WORKER_HYBRIDFLOW_TOKEN=<the service token>
```

There is no database credential on this machine and nothing to tunnel: the instance talks to the
service over HTTPS, the way a browser does.

**Who the work is recorded as** is `KIAO_HYBRIDFLOW_ACTOR`, your login name by default. It matters
because a machine running one folder for one person has no Keycloak session to borrow: the launcher
presents the deployment's service token and names you beside it, and that name is what the change
log records. Without it every card you moved would be attributed to the service.

The startup lines say where the boards are and who you are to them:

```
kiao on /home/me/folder
  Dashboard       http://127.0.0.1:48400/dashboard/
  worker         http://127.0.0.1:48401  (auth: debug)
  boards         https://boards.example.com/api/hybridflow (as alex)
  diagrams       /opt/plantuml/plantuml.jar
  config         /home/me/.config/kiao/config.env
```

With neither variable set, `/boards` says so in a sentence and everything else works as before —
which is the ordinary case, since this command is pointed at whatever folder somebody is working in
and most of them are not stores with boards.

### One list, every environment

**The boards of every environment are in one list, and nothing on a board says which store or which
machine it was made for.** A board made from a laptop on one folder sits beside the ones the shared
service's own store uses, under the same names. That is accepted for now; it is the price of having one place
where the boards are, and the alternative — a board that belongs to a store — is a design decision
that has not been made yet.

### A database of your own instead

For developing against something that is not production, point the command at a database rather
than at a service, and it starts a `hybridflow-store` of its own beside the worker:

```sh
KIAO_HYBRIDFLOW_STORE_DATABASE_URL=postgres://hybridflow:glg203@localhost:48233/hybridflow?sslmode=disable
```

`config/local/docker-compose-local.yml` runs such a database and
`config/local/init-postgresql-local.sql` creates the role in it. **The schema is the service's own
business**: it creates and migrates it at startup against whatever database it is pointed at, so an
empty one is enough. The *boards* in it are not — make them from the Boards tab once the stack
is up.

Setting both variables is refused at startup rather than resolved by guessing: they are two
different places to write a card to, and they look identical from the screen.

## What it leaves in the folder

The same two entries kiao writes anywhere it is pointed:

- **`.kiao-files`** — what in the folder is not KIAO content. Seeded with the machinery names
  (`node_modules`, `build`, `dist`, `.*`…) on a folder that has none; it bounds the passes that walk
  the folder on their own — migrations, link updates, and search with the scope a delete reports.
  See [`.kiao-files`](../../../.kiao-files), which is this repository's own.
- **`.kiao-config/`** — the service's state: the migration ledger, the Claude conversations, the
  Dashboard config documents. It carries a `.gitignore` of `*`, so it stays out of commits, and the
  file browser never shows it.

Nothing else is touched unless you touch it — with one exception, which is why it is off by
default:

**Migrations.** `--migrations` runs the pass that rewrites files nobody asked it to touch, before
the service answers a request. This command is pointed at whatever folder someone is working in — a
source repository as often as a document store — so it does not run one unless asked. The one
script the tree ships renames two folders at the store root; read
[`migrations/README.md`](../../../migrations/README.md) before turning the flag on.

## Claude, diagrams, and what is not there

**Claude Code** is your own: the worker spawns the `claude` on your PATH, with your `HOME`,
so the Claude tab is signed in exactly as your terminal is, reads your `~/.claude/settings.json`,
and — unlike the image, which travels — offers **Bypass permissions**. It is your machine and your
files either way.

The skills that teach a turn the store's formats and its boards are installed into the folder you open at every
start — its `.agents/skills/` and `.claude/skills/` — and reinstalling the executable upgrades them.
You get the ones your plugins call for: a skill is the agent half of a plugin, so switching
**Graphs** off in Configuration takes the graph skills away with the editor, and switching it back
on brings them back at the save. They are the folder's from then on, opened like any other file. Skills of your own are safe beside
them: only directories carrying a `.kiao-skill` marker are ever rewritten, and deleting that marker
from one of theirs is how you take it over. The first start after the move also removes what the
previous install wrote into `~/.claude/skills`, so no stale copy shadows the new one.

**Installing what a turn needs.** **Configuration** in the tools menu lists a JDK, the latest Node
LTS, Python and the MCP servers a turn can be given — a web fetcher, a search engine, a PDF
converter, a paper index — with an Install button on each and a prompt when one drags in another.
The kiao servers need no install — but only the ones the staged bundle carries are offered
here: files and boards, the halves that make sense over any folder. A server the bundle does
not carry reads unavailable. `KIAO_WORKER_MCP_SERVERS` in your environment names another
set, and an empty value withdraws them all.
Nothing here asks for `sudo`, so what it installs is not the distribution's: the JDK is a
checksum-verified Temurin tarball, Node the official LTS one, Python `uv`'s. It all goes under
`~/.local/share/kiao/toolbox`, one directory for the machine rather than one per folder, so a
tool installed from one instance is there in the next. `KIAO_WORKER_TOOLBOX_PATH` in your
environment moves it, and an empty value makes the panel read-only.

The panel is also the only way to give a turn an MCP server here: once anything is registered
there, a turn is handed exactly those servers and the ones you registered with `claude mcp add`
stop arriving. Register nothing and nothing changes — your own servers reach the Claude tab as
before.

**Turning the machine off.** A hybridflow-ui flow node can ask for it — a **Shutdown** card, one of the four
kinds a card is typed — and this is the start that honours it: the machine is the one you are sitting
at, and the service runs as you. It goes off once that card is marked **done**, and the play ends
there, a Shutdown naming nothing after it; a card that came back an error leaves the machine on. The
command is `systemctl poweroff`, which a Debian machine grants a logged-in user over polkit;
`KIAO_WORKER_SHUTDOWN_COMMAND` in your environment replaces it, and an empty value turns the
card into the no-op it is everywhere else. The image and a server deployment set nothing, so a board carrying one
travels to them and the play simply ends there.

**Diagrams** are a core feature, so the renderer ships with the executable: the install puts a pinned
`plantuml.jar` in `lib/`, and that is the one used — nothing to find, nothing to install. It is run
on the spot in `-pipe` mode rather than as a PlantUML server, so there is no third port and nothing
to keep alive; a JVM start is ~1s and every render is cached under the URL that encodes its source.
What still comes from the machine is Java, and `graphviz` for everything laid out by `dot` —
without a JRE, a diagram renders as a note saying which apt line is missing. A machine with its own
jar can still be preferred, in this order: `--plantuml PATH`, `$PLANTUML_JAR`, the shipped jar,
`/usr/share/plantuml`, `/usr/share/java`, `/opt/plantuml`, a `plantuml` command. Nothing is sent
anywhere: `--plantuml-server https://www.plantuml.com/plantuml` is how you decide otherwise.

**No service worker.** The SPA is built with `VITE_NO_SERVICE_WORKER`, so this bundle precaches
nothing — it is on the same disk as the files it edits, and there is nothing to be offline from.
Precaching it was worse than useless: every reinstall rebuilds the bundle under new hashes, and a
worker still answering with the previous `index.html` would boot a bundle whose lazily imported
chunks are gone, so the next mermaid diagram opened would fail to load its renderer. `sw.js` is
therefore served by the launcher rather than from `web/`, and what it serves is a worker that
unregisters itself and drops its caches — that is what clears out a worker registered by an earlier
install, or by the kiao image, which serves the same app under the same scope and may have had the
same port. A missing file under the SPA is a 404 too, and only a navigation falls back to
`index.html`; a chunk that is not there should say so rather than arrive as HTML.

**No identity provider.** The SPA is built with `VITE_NO_SECURITY` and the service runs in `debug`
auth mode — there is no Keycloak in front of a folder on your own machine, which is also why the
web port is bound to the loopback interface. Do not put it on a network: with Bypass permissions
available, whoever reaches that port has a shell.

**No action providers.** This executable registers no file-action providers behind worker;
a menu entry that needs one says so and does nothing.

## Where things are

| | |
|---|---|
| the parts | `~/.local/share/kiao/` (or `/usr/local/lib/kiao` with `--system`) |
| the command | `~/.local/bin/kiao` — a symlink; `KIAO_HOME` overrides where it looks for the parts |
| its configuration | `~/.config/kiao/config.env`, written once by the install script and yours thereafter |
| what is running | `~/.local/state/kiao/instances/*.json`, one per folder, confirmed against the port it names before it is believed |
| the boards | the hybridflow-store named by `KIAO_WORKER_HYBRIDFLOW_URL` — a remote service's — and nothing in the folder |
| logs of detached instances | `~/.local/state/kiao/logs/<folder>-<id>.log` — the launcher's own lines and the service's |

A launcher that is killed outright (`kill -9`, a reboot) leaves a stale entry and possibly a
worker holding the store lock; the next `kiao` on that folder finds both, clears them
and starts.
