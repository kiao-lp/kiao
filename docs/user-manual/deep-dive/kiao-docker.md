# Docker image

[User manual](../README.md) · [Quick guide: components and installation](../quick-guide/components-and-installation.md) · [Executable](kiao-executable.md)

The `kiao` Docker image runs Dashboard, worker, hybridflow-store, PostgreSQL and the
PlantUML renderer in one container. It includes DCMS for files and content, hybridflow
for boards and agents, the `kiao-mcp` servers, skills and the toolbox. Its boards database
is included, so no separate boards service or database is needed.

Agent CLIs are installed on demand from the configuration panel and can be removed there;
see [The agent CLIs](#the-agent-clis). This page details installation, persistent data and
configuration, including [development tools](#development-tools) installed in a running
container.

## Build or load the image

Building from the Kiao source checkout requires Linux or WSL, Git, Go 1.24+, Node.js 20+
with npm, Docker and network access for dependencies. From the directory containing `bin/`:

```bash
./bin/build-all.sh
./bin/build-kiao-image.sh
```

[`bin/build-all.sh`](../../../bin/build-all.sh) builds the shared prerequisites;
[`bin/build-kiao-image.sh`](../../../bin/build-kiao-image.sh) then builds `kiao:latest`
and saves `dist/kiao-image.tar.gz`. See the script's header for build flags and
[`bin/README.md`](../../../bin/README.md) for the build stages.

The image supplies its own Alpine Node.js. Every build checks its version and Zstandard
support with the same check Pi runs at launch, including images where Pi will be installed later.
With `--preinstall pi-cli`, the build host's npm stages the portable package; the image's Node
checks the staged Pi executable.

On the target machine, Docker is the runtime prerequisite; Windows uses Docker Desktop.
If you received the archive, load it with `docker load -i dist/kiao-image.tar.gz` before
running it. An image built locally is already loaded.

An existing container keeps its original image after a build or load. Recreate the container
with the new image, keeping the same data binds and named volumes.

## Run it

The [quick guide](../quick-guide/components-and-installation.md#install-the-docker-image) has a minimal Bash
example. The following PowerShell example also enables the optional direct worker port,
file-store migrations and permission bypass. Adjust the host paths to existing folders;
omit optional lines you do not need. Load the archive only if the image is not already loaded:

```powershell
docker load -i dist\kiao-image.tar.gz

docker run -d --name kiao `
  -p 127.0.0.1:48302:80 `
  -p 127.0.0.1:48303:18080 `
  -v C:\Users\you\qroot:/data `
  -v kiao-dev:/opt/kiao/dev `
  -v kiao-postgres:/var/lib/postgresql/data `
  -e KIAO_WORKER_MIGRATIONS_PATH=/opt/kiao/migrations `
  -e KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=true `
  kiao:latest
```

Dashboard is then at <http://localhost:48302/dashboard/>. Line by line:

| Line | Drop it and |
|---|---|
| `-p 127.0.0.1:48302:80` | there is no Dashboard. The host port can be changed; `:80` is nginx, serving the SPA and proxying the API |
| `-p 127.0.0.1:48303:18080` | the API is only reachable through nginx. Publish it to call the worker directly |
| `-v …:/data` | the store is a throwaway copy baked into the image, and dies with the container |
| `-v kiao-dev:/opt/kiao/dev` | a JDK or any other tool installed into the container has to be installed again in the next one — see [Development tools](#development-tools) |
| `-v kiao-postgres:/var/lib/postgresql/data` | the boards die with the container — see [Boards](#boards) |
| `-e …MIGRATIONS_PATH` | no migration runs at startup |
| `-e …HYBRIDFLOW_RUNNER_BYPASS_ENABLED` | **Bypass permissions** is not offered and every tool call is put to you |

## What goes on the host

```
C:\Users\you\qroot\                  the store, mounted at /data
└── .kiao-config\claude\             KIAO_CLAUDE_HOME — kept by the volume
    ├── managed-settings.json        policy → /etc/claude-code/managed-settings.json
    ├── .claude\settings.json        user settings (~/.claude/settings.json to the CLI)
    └── .claude\CLAUDE.md            user memory, importing the container's own instructions
```

The development volume is deliberately *not* on this list: `kiao-dev` is a named volume, which
Docker keeps on its own Linux side. It holds a Unix toolchain — symlinks, executable bits, a JDK's
own layout — none of which a Windows folder reproduces. See
[Development tools](#development-tools).

**Migrations.** The image bundles base source `kiao` and its helpers at `/opt/kiao/migrations`.
Use that bundled set for normal starts. Remove an old host bind over this directory when switching
to the 2026-10-20 baseline; it would hide the new source metadata and restore retired scripts.
A custom assembly must mount a complete current package, including `source.json`, `sources.json`
and helper dependencies, produced by the common staging script.

Migrations remain **off by default**. Opt in with
`KIAO_WORKER_MIGRATIONS_PATH=/opt/kiao/migrations`, or use
`KIAO_WORKER_MIGRATIONS_SOURCES=/opt/kiao/migrations/sources.json` instead. Set only one.
The ledger stays at `/data/.kiao-config/files-migrations.json` with the persistent store; keep it
when recreating the container. A supported version-18 ledger is compacted automatically on the
first enabled start, and later starts resume its independent source histories. No manual reset is
needed. This baseline ships zero active content scripts; the retired V001–V018 must not be replayed.

Read the [migration contract](../../../migrations/README.md) before opting in. Older/incomplete
ledgers need the [documented upgrade route](../../../migrations/cutover-2026-10-20.md).

**Claude settings.** Allow the harmless tool calls once and the panel stops asking —
`…\qroot\.kiao-config\claude\.claude\settings.json`:

```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)"],
    "deny": ["Bash(rm:*)", "Bash(git push:*)"]
  },
  "includeCoAuthoredBy": false
}
```

Reading and searching are granted outright; `Edit` and `Write` are left to be asked, one card at a
time. Beside it, `managed-settings.json` is the same shape but outranks the user file and is not
something a turn can override:

```json
{
  "permissions": { "deny": ["Bash(curl:*)", "Bash(docker:*)", "WebFetch"] },
  "disableBypassPermissionsMode": "disable"
}
```

Settings take effect on the next turn; the policy is copied at startup, so it needs a restart.
`docker logs kiao` reports what took effect:

```
[kiao] Claude managed settings installed from /data/.kiao-config/claude/managed-settings.json
[kiao] Claude memory: kiao-container.md refreshed (imported by /data/.kiao-config/claude/.claude/CLAUDE.md)
[kiao] Claude Code 2.1.234 is signed in (home=/data/.kiao-config/claude)
[kiao-dev] installing declared packages: openjdk17-jdk maven
[kiao-dev] packages ready
[kiao] starting worker on 0.0.0.0:18080 (root=/data, auth=debug, claude-bypass=true)
```

## Boards

The boards and their flow nodes are **rows in the PostgreSQL in this container**,
served by the hybridflow-store beside it, against a database that
is this container's own. Nothing behind the image needs to be running: **Boards…** in the menu
opens the list, empty on a first start, and creating one there is the first thing to do with it.

The [executable](kiao-executable.md#boards) can connect to a shared boards service or use
a PostgreSQL database you provide. The image serves its own boards; they start empty
and belong to this container's database.

`-v kiao-postgres:/var/lib/postgresql/data` is what keeps them across `docker rm` — a named
volume, on Docker's own Linux side. Without it they survive `docker restart` and die with the
container, like a store with no volume over `/data`. A Windows folder is the wrong thing here: the
server wants Unix ownership on its files, and a bind mount reports modes it does not keep — the
same reason the development volume is a named one.

Two things about the deployment, and one refusal:

- **There is no login.** The service runs in debug auth mode, like the worker beside it,
  and the database listens on the loopback address alone with no password — nothing outside this
  container can reach either. What is written from the boards UI is recorded as `anonymous`, and
  what a run files is recorded under its run id. Publish the ports to `localhost` and that is the
  person using it; publish them to a network and think about it first, as with the sign-in
  endpoints below.
- **Another database instead.** `-e KIAO_HYBRIDFLOW_STORE_DATABASE_URL=postgres://…` points this
  container's own service at another PostgreSQL, and the embedded one is then not started at all.
  The schema is the service's own business either way: it creates and migrates it at startup, so
  an empty database is enough and the boards in it are made from the page.
- **No service elsewhere.** `-e KIAO_WORKER_HYBRIDFLOW_URL=…` is refused at startup: the
  worker reads that variable itself, and honouring it here would write a run's answer to
  that service while the SPA wrote the card to this container — two places for one board. To work
  on a remote service's boards, run `kiao` or `bin/local-start-kiao.sh` instead of this image.

## Claude Code

### The agent CLIs

**Neither is in the image.** A fresh container has no `claude` and no `codex` on it, and the agent
tab says so and points here. Open the **Configuration** panel, find *Claude Code CLI* or *Codex CLI*
under **Runtimes**, and install the one you want; it lands in `/opt/kiao/dev`, which is the volume
that survives the container being replaced, and the agent tab offers it from the next page load —
no restart. The same row removes it again.

Three reasons it is not baked in. It is a hundred-odd megabytes per CLI on an archive that gets
carried to a Windows machine by hand. Whoever runs the image usually wants one agent and not both,
and had no way of saying so: a CLI in an image layer is not the panel's to delete, and a
`docker run` would put it back anyway. And a CLI in a layer is pinned to the day the image was
built, where one on the volume is a click away from the current release.

If you would rather have one in the image — an offline machine, an image somebody else has to
reproduce — build it with `./bin/build-kiao-image.sh --preinstall claude-cli`, or
`--preinstall claude-cli@2.1.259` to pin the version. Its row then reads *on this machine*: no
uninstall, because that binary is not the panel's to delete, but the **switch** on the row still
withdraws the agent from the tab. That switch is on every agent row, whoever installed the CLI, and
it is the answer to "offer Claude but not Codex" — or the reverse — without touching a file.

`KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_ENABLED=false` and `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_ENABLED=false`
are the same decision taken by the deployment rather than by whoever is at the panel: a veto, and
nothing in the panel overrides it.

### Signing in

Sign in from the browser — **Claude** tab → **Sign in**. The container runs `claude auth login`,
hands you the authorisation link and takes back the code that page shows. Nothing is installed on
the host and no shell inside the container is needed. Every start reports where things stand,
naming the home it used.

For **Codex**, open **Usage → Codex → Login**. Open the sign-in page in your browser,
enter the displayed device code and approve the request. This also works when the container is
on a remote server. You can use an API key instead. A signed-out Codex conversation opens Usage
before it is created, so you can sign in before sending your first message.

**Bypass permissions** is off unless `KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED=true` says
otherwise, leaving **Manual** and **Manual Live** — the latter allowing a card you leave alone past
its delay (`manualLiveCountdownSeconds` in `.kiao-config/conversations.json`, 10 seconds when missing).
That is the one behavioural difference from a worker started by
`bin/local-start-kiao.sh` or running on a server, where the machine, the store and the person
prompting are the same party. A container is that person's too, but its port is published: whoever
reaches it can prompt it, and this is the image that travels.

The sign-in endpoints are on by default here (`KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED=true`,
`KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_LOGIN_ENABLED=true` and
`KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED=true`), as in the executable and a standalone worker.
Anyone who reaches the published port can bind this container's CLIs to their own
accounts — unremarkable on `localhost`, worth thinking about otherwise. `false` withdraws them
entirely.

### What persists, and where

Everything the CLI keeps hangs off one directory, so it all survives together or not at all:

```
<store>/.kiao-config/claude/          KIAO_CLAUDE_HOME
├── .claude/.credentials.json         the OAuth token the sign-in writes
├── .claude/settings.json             user settings
├── .claude/CLAUDE.md                 user memory — yours, plus one import line
├── .claude/kiao-container.md         what this container tells the CLI about itself,
│                                     rewritten from the image at every start
├── .claude/skills/…                  the format and boards skills, reinstalled at every start
├── .claude/projects/…                session transcripts
├── .claude.json                      the CLI's own per-directory state
└── managed-settings.json             policy → /etc/claude-code/managed-settings.json
```

**With no volume over `/data`, none of it outlives `docker rm`** — it survives `docker restart` and
`stop`/`start`, which keep the container's writable layer, and dies with the container itself.

A persisted token is not a live session: the access token lasts 8 hours and is renewed as a side
effect of the panel being used, but a container left untouched for long enough can find its refresh
token lapsed. A server deployment keeps one alive with a timer for that; this image
has no such timer, so sign in again from the tab.

To share one sign-in across several stores, or to keep it off a Windows bind mount, point the home
at a named volume: `-v kiao-claude:/var/lib/kiao/claude -e KIAO_CLAUDE_HOME=/var/lib/kiao/claude`.

The service passes `--setting-sources user`, so `.claude/settings.json` in the Claude home is
loaded and one arriving in the store through a `git pull` is not. Adding `project` to
`KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES` means pulled content can install hooks that run inside
the container. The model and effort come from the panel, not from settings.

**Skills.** The store's `.agents/skills/` and `.claude/skills/` are filled at every start with
the skills that teach a turn the store's formats and its boards — `.arch.md`, `.temp.md`, `.graph.json`,
`.fmat.json`, the strategy layer and the boards. They come out of the worker binary, so upgrading the
image upgrades them, the same way `kiao-container.md` works. Which ones you get is which plugins
the store loads: a skill is the agent half of a plugin, so a plugin switched off in Configuration
takes its skill with it, at the save rather than at the next start. Your own skills can sit beside them:
only directories carrying a `.kiao-skill` marker are ever rewritten, and one of yours with the
same name is reported in the log and left alone.

## Development tools

The image carries no toolchain — no JDK, no compiler, no extra CLI. Everyone handed the image
carries whatever is in it, only some people develop inside it, and what they need changes far
faster than an image is rebuilt. So development tools are installed into a *running* container and
declared on a volume, which is replayed into the next container. Nothing of that is in the
delivered archive, and nothing of it needs a new image.

```powershell
docker run -d --name kiao -p 127.0.0.1:48302:80 -v C:\Users\you\qroot:/data `
  -v kiao-dev:/opt/kiao/dev kiao:latest

docker exec -it kiao kiao-dev add openjdk17-jdk maven
```

`javac` works from that moment on — in a `docker exec` shell, and in a turn run from the **Claude**
tab, which inherits the same environment. It also still works in the container that replaces this
one tomorrow: `openjdk17-jdk maven` is now written in `/opt/kiao/dev/packages`, and the startup
reinstalls it from the volume's own package cache in about fifteen seconds, with or without a
network.

Package names are Alpine's, not Debian's — `openjdk17-jdk`, not `openjdk-17-jdk`; `build-base`,
not `build-essential`. `kiao-dev search jdk` finds them, and `apt install …` answers with the
command that does the same job here rather than "not found".

### From the configuration panel

The same thing without a shell: **Configuration** in the tools menu of the top bar lists a JDK, the
Node LTS, Python and the MCP servers a turn can be given, each with an Install button. In this image
it installs through `kiao-dev`, so what it puts on the box is declared on the volume and replayed
like anything else added by hand — the two are the same mechanism, and the panel is the way in that
does not need `docker exec`. It is also the only way to add an MCP server: a turn is handed exactly
the servers registered there, so `claude mcp add` from inside the container changes nothing.

### Asking Claude to install it

Which is how most of it actually happens: "install a JDK and Maven" in the **Claude** tab, rather
than a `docker exec`. That turn runs inside this container, so it can install — but left to its own
devices it reaches for `apt` (which no Alpine box has) or for `apk add` (which works, and is undone
by the next container without saying so). Three things keep it on the durable path.

**It is told.** The entrypoint installs the container's own instructions as Claude's *user* memory,
copied from the image at every start:

```
<store>\.kiao-config\claude\.claude\
├── kiao-container.md     the instructions, refreshed from the image at every start
└── CLAUDE.md             yours — it gains one line, `@kiao-container.md`, and nothing else
```

They say what the box is (Alpine, root, no apt), that `kiao-dev add` is the form that lasts, that
`apk add` alone is not, where a non-package install goes, and to check `kiao-dev status` before
promising anything will persist. User memory is the scope the CLI is started with
(`--setting-sources user`), which is also why a `CLAUDE.md` arriving in the store through a `git
pull` is not read. Write your own guidance in `CLAUDE.md` beside the import — that file is never
rewritten; `kiao-container.md` is, so image upgrades update the instructions.

**It is corrected.** `apt`/`apt-get` are stubs that print the Alpine equivalent. `apk` is wrapped:
it runs normally, output and exit status untouched, and one note follows a successful `apk add`
saying the package was not declared and how to declare it. `kiao-dev` and `setup.sh` are exempt —
what they install *is* declared.

**It can check.** `kiao-dev status` and `kiao-dev list` report whether the volume is really mounted
and what is declared, so the answer "it will still be there tomorrow" is one a turn can verify
rather than assume.

`KIAO_CLAUDE_CONTAINER_MEMORY=false` stops installing the memory; `KIAO_DEV_INSTALL_HINTS=false`
removes the stubs. Both leave `kiao-dev` itself untouched.

### What the volume holds

| Path under `/opt/kiao/dev` | |
|---|---|
| `packages` | **the declaration.** Alpine package names, one per line, `#` comments. Hand-editable; `kiao-dev add`/`del` write here |
| `setup.sh` | **the rest of the declaration** — anything a package cannot express. Run at every start, so keep it idempotent |
| `env.sh` | variables for everything the container starts, the worker and hence a Claude turn included |
| `apk-cache/` | the downloaded packages and the repository index. What makes the replay a local unpack, and what makes it work offline |
| `bin/ lib/ opt/` | tools installed by hand. `bin/` is first on `PATH` |
| `npm/ go/ cargo/ cache/` | where the global installs of npm, Go, Cargo and pip go, and where npm, pip, Go, Gradle and Maven keep their caches |
| `ssh/ m2/settings.xml npmrc` | **the credentials** — SSH keys, and the private registries of Maven and npm. See [SSH keys and private registries](#ssh-keys-and-private-registries) |
| `home/` | `HOME` for a `docker exec` shell — `.gitconfig`, shell history, and `.ssh`, `.m2`, `.npmrc` as symlinks to the three above |

The split that matters is between the **declaration** (`packages`, `setup.sh`, `env.sh`) — small,
worth backing up, the thing to edit when the needs change — and the **bytes**, which only make
replaying it fast. An Alpine package installs into `/usr`, i.e. into the container's writable
layer, which is why it is reinstalled at every start rather than merely found. Everything else on
that list is used in place.

### Commands

`kiao-dev` runs from a `docker exec` shell, or from a Claude turn's Bash tool.

| | |
|---|---|
| `kiao-dev add <pkg>…` | install now, and at every future start. A name that does not exist is not recorded |
| `kiao-dev del <pkg>…` | stop declaring, and uninstall here |
| `kiao-dev list` | what is declared, and whether this container has it |
| `kiao-dev search <term>` | find the Alpine name of something |
| `kiao-dev sync` | replay the declaration — what the entrypoint runs at startup |
| `kiao-dev status` | where everything lives, its size, and whether it is actually persisted |

`kiao-dev status` is the one to run first when something is missing: it says in its first line
whether `/opt/kiao/dev` is a mount at all. Without the `-v`, everything below still works and
nothing of it survives `docker rm` — the startup log warns about exactly that.

### Anything that is not an Alpine package

`setup.sh` is run at every start, after the packages. It is a plain script, so it covers an SDK
tarball, a private CLI, a `pip install`, a language toolchain — and because what it installs is on
the volume, the idempotent version of it is also the fast one:

```bash
#!/bin/bash
set -e
JDK=/opt/kiao/dev/opt/jdk-21
if [ ! -x "$JDK/bin/javac" ]; then
    mkdir -p "$JDK"
    curl -fsSL https://example.invalid/jdk-21.tar.gz | tar xz -C "$JDK" --strip-components=1
fi
ln -sf "$JDK/bin/javac" "$JDK/bin/java" /opt/kiao/dev/bin/
npm ls -g --depth 0 typescript > /dev/null 2>&1 || npm i -g typescript
```

Next to it, `env.sh` is sourced before the packages are installed — it is where a proxy, a registry
token or a `JAVA_HOME` belongs. It is *sourced*, so it holds assignments and no `exit`:

```bash
JAVA_HOME=/opt/kiao/dev/opt/jdk-21
SDKMAN_DIR=/opt/kiao/dev/opt/sdkman
```

Everything it exports reaches the worker, so a Claude turn sees it too. A `docker exec`
shell gets `PATH` and `HOME` from the image but not `env.sh`; `docker exec -it kiao
bash -l` reads it.

### SSH keys and private registries

An SSH key and a registry password are per-user files, and this container has no single `HOME`: a
`docker exec` shell gets `HOME=/opt/kiao/dev/home`, a Claude turn gets the Claude home under the
store. A key written to `~/.ssh` from a shell is therefore not the key a turn pushes with, and one
written anywhere outside the two volumes is gone when the container is replaced. So each of them
has **one** copy, on the dev volume, and every process is pointed at it:

| | Where it goes | What reads it |
|---|---|---|
| SSH keys, `known_hosts`, `Host` blocks | `/opt/kiao/dev/ssh/` | `/etc/ssh/ssh_config`, rewritten at every start — so `ssh`, and `git` through it, whatever `HOME` |
| Maven repositories and credentials | `/opt/kiao/dev/m2/settings.xml` | `MAVEN_ARGS`, which carries `-s` on that path |
| npm registry and token | `/opt/kiao/dev/npmrc` | `npm_config_userconfig` — so `npm config set …` writes here by itself |
| Gradle credentials | `/opt/kiao/dev/cache/gradle/gradle.properties` | `GRADLE_USER_HOME` |

Each file is created empty at the first start, with a commented example inside, and never rewritten
afterwards. In a `docker exec` shell the familiar paths work too: `~/.ssh`, `~/.m2` and `~/.npmrc`
are symlinks to them, so `ssh-keygen` and `npm login` with their default answers land in the shared
copy rather than beside it.

```powershell
docker exec -it kiao ssh-keygen -t ed25519 -f /opt/kiao/dev/ssh/id_ed25519
docker exec kiao sh -c "ssh-keyscan github.com >> /opt/kiao/dev/ssh/known_hosts"
docker exec kiao cat /opt/kiao/dev/ssh/id_ed25519.pub
```

Register that public key with the forge, and `git push` over an ssh remote works — from a shell,
from the version-control panel, and from a Claude turn. The `ssh-keyscan` is not optional: without
a known host key, the first connection stops on a prompt that a turn and the panel have no way of
answering. `id_ed25519`, `id_ecdsa` and `id_rsa` are tried by name; a key called anything else
needs a `Host` block naming it in `/opt/kiao/dev/ssh/config`, which is included ahead of the rest.

Maven and npm are configured the way they are anywhere else, only in those files:

```powershell
docker exec kiao npm config set registry https://nexus.example.com/repository/npm-group/
docker exec kiao npm config set //nexus.example.com/repository/npm-group/:_authToken <token>
```

and `<servers>` / `<mirrors>` in `settings.xml`, which the commented header of the generated file
shows the shape of. All of it survives `docker rm` — it is on the `kiao-dev` volume, which is also
to say **it is only as durable as that volume**: without `-v kiao-dev:/opt/kiao/dev` these files
are in the container and die with it, and `docker volume rm kiao-dev` takes the keys with the rest.
Back up `ssh/`, `m2/settings.xml` and `npmrc` along with `packages`, `setup.sh` and `env.sh` — they
are the declaration, not the bytes.

The image ships `openssh-client` for this; nothing else about ssh has to be installed. Keys are
kept `0600` and the directory `0700` at every start, which is what stops ssh from refusing a key
copied in from the host — on a named volume, which is where this belongs. A Windows bind mount at
`/opt/kiao/dev` reports modes it does not keep, and ssh will reject the key.

### Worth knowing

- **`/opt/kiao/dev/bin` comes first on `PATH`**, so a tool on the volume shadows the image's own —
  including `claude`, which is how the CLI is moved to another version without rebuilding.
- **PlantUML keeps its own Java.** The renderer runs on the trimmed runtime at `/opt/java`, verified
  at build time, whatever JDK gets installed and whatever `JAVA_HOME` `env.sh` sets.
- **`HOME` differs by who is asking.** A `docker exec` shell gets `/opt/kiao/dev/home`, on the
  volume. A Claude turn gets the Claude home under the store — its git identity and its transcripts
  belong with the content they describe, not with the toolchain.
- **`kiao-dev del` obeys.** Naming something the image itself installed (`git`, `bash`, `nginx`)
  uninstalls it and breaks this container until it is replaced.
- **The volume only grows.** A JDK, Maven and their caches are a few hundred megabytes.
  `docker volume rm kiao-dev` throws the lot away, declaration included, and the next start is a
  clean one.
- **Nothing here changes the delivered image.** `dist/kiao-image.tar.gz` is the same size
  whether the box it lands on installs a JDK or not.

## Configuration

Everything is set with `docker run -e`, using the worker variable names.

| Variable | Default | Purpose |
|---|---|---|
| `KIAO_WORKER_ROOT_PATH` | `/data` | the store; created on startup. Mount a volume here |
| `SERVER_PORT` | `18080` | worker internal port |
| `KIAO_WORKER_AUTH_MODE` | `debug` | no login, matching the SPA's `VITE_NO_SECURITY=true` |
| `PLANTUML_PORT` | `8080` | PlantUML renderer internal port |
| `HYBRIDFLOW_PORT` | `18081` | hybridflow-store internal port — the boards over HTTP, through nginx at `/api/hybridflow/` |
| `PGDATA` | `/var/lib/postgresql/data` | the embedded PostgreSQL's data. Put a named volume here to keep the boards across `docker rm`; untouched when `KIAO_HYBRIDFLOW_STORE_DATABASE_URL` names another database |
| `KIAO_HYBRIDFLOW_STORE_DATABASE_URL` | *(empty)* | another PostgreSQL for this container's own hybridflow-store to serve, instead of the embedded one. Empty serves the embedded one; the schema is created and migrated at startup either way |
| `KIAO_WORKER_MIGRATIONS_PATH` | *(empty)* | one named base source; `/opt/kiao/migrations` is the in-image one (node is bundled) |
| `KIAO_WORKER_MIGRATIONS_SOURCES` | *(empty)* | assembly manifest, e.g. `/opt/kiao/migrations/sources.json`; use instead of `MIGRATIONS_PATH` |
| `KIAO_WORKER_MIGRATIONS_ENABLED` | `true` | master switch for the migration runner |
| `KIAO_WORKER_LINK_FIX_WORKERS` | `16` | how many files the link fixer reads at once after a rename or a delete. `1` makes the pass serial |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED` | `true` | the sign-in endpoints the **Sign in** button uses. `false` withdraws them |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED` | `true` | the endpoints the Usage tab's **Login** button uses. `false` withdraws them |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_LOGIN_ENABLED` | `true` | Codex device-code and API-key login from Usage. `false` withdraws the login endpoints |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_ENABLED` | `true` | whether this deployment offers Claude at all. `false` keeps it out of the agent tab whatever is installed and whatever the panel says |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CODEX_ENABLED` | `true` | the same for Codex. None of the four says an agent *is* offered: that also needs its CLI on the machine, and the panel's switch left on |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_ENABLED` | `true` | the same for Muse |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_OPENCODE_ENABLED` | `true` | the same for OpenCode |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED` | `false` | **off in this image only.** Allows **Bypass permissions**, which runs the CLI with `--dangerously-skip-permissions` and asks nothing. Off, the mode is not offered and is refused if asked for; the manual modes are unaffected |
| `KIAO_CLAUDE_HOME` | `<state>/claude` | the CLI's sign-in, settings and transcripts. Inside the store's `.kiao-config`, so a volume over `/data` keeps them |
| `KIAO_CLAUDE_POLICY_PATH` | `<claude home>/managed-settings.json` | policy installed to `/etc/claude-code/managed-settings.json` at every start. Absent installs none, and removes none |
| `KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_SETTING_SOURCES` | `user` | which settings the CLI loads |
| `KIAO_WORKER_MCP_PATH` | `/opt/kiao/kiao-mcp` | the bundled [kiao-mcp](../../../reference/kiao-mcp/README.md) servers a turn is given — the files and the boards. They reach *this container's* worker on the loopback address, so they act on the mounted store and nothing else. Empty withdraws them, and the turn is spawned with no MCP servers at all |
| `KIAO_WORKER_MCP_SERVERS` | `files,hybridflow` | which of them. Naming a server the staged bundle does not carry fails the start |
| `KIAO_WORKER_TOOLBOX_PATH` | `/opt/kiao/dev` | where the **Configuration** panel installs what a turn asks for — a JDK, npm, Python, an MCP server. The dev volume, so an install survives the container being replaced. Empty makes the panel read-only |
| `KIAO_DEV_ENABLED` | `true` | replay the declared [development tools](#development-tools) at startup. `false` starts the services and touches nothing under `/opt/kiao/dev` |
| `KIAO_DEV_PACKAGES` | *(empty)* | Alpine packages to install on top of `/opt/kiao/dev/packages`, for declaring a box from a compose file rather than from inside it |
| `KIAO_DEV_INSTALL_HINTS` | `true` | the `apt`/`apt-get` stubs that name the Alpine equivalent, and the `apk` wrapper that follows a bare `apk add` with a note saying the package was not declared. `false` removes all three, for a third-party installer that probes `command -v apt-get` to decide which distribution it is on |
| `KIAO_CLAUDE_CONTAINER_MEMORY` | `true` | install this container's instructions as Claude's user memory, so a turn asked to install something knows where it is and which command lasts. `false` installs nothing and removes nothing |

## Troubleshooting

- **`ERR_CONNECTION_REFUSED`** — the container is not running, or the ports are mapped differently.
  Check `docker ps`.
- **`docker load` says "no space"** — Docker Desktop needs more disk.
- **`docker ps` says `unhealthy`** — nginx is not serving `/dashboard/`. `docker logs` names the
  service that failed; per-service logs are at `/var/log/{postgres,hybridflow-store,plantuml,
  worker}.log` and `/var/log/nginx/error.log`.
- **The boards page is empty, or says the service is not answering** — an empty list on a first
  start is correct: this container's boards start with none, and creating one is the first thing
  to do. Anything else is the hybridflow-store or the database:
  `docker exec kiao curl -fsS http://127.0.0.1:18081/healthz` says whether the first is up,
  and `/var/log/hybridflow-store.log` and `/var/log/postgres.log` say why not.
- **The container exits at once with `KIAO_WORKER_HYBRIDFLOW_URL is set`** — that variable
  names a boards service elsewhere, and this image serves its own; honouring it would write a
  run's answer there while the SPA wrote the card here. Unset it for the embedded boards, or set
  `KIAO_HYBRIDFLOW_STORE_DATABASE_URL` to a PostgreSQL for this container's own service to serve
  instead — see [Boards](#boards).
- **A fix is committed but the container still misbehaves** — a container is bound to the image *id*
  it was created from, not to the `:latest` tag, so `docker restart` re-runs the old image however
  many times the image was rebuilt or re-`docker load`ed. Nothing in `docker ps` says so; replacing
  the container is the only way:

  ```powershell
  docker rm -f kiao
  docker load -i dist\kiao-image.tar.gz
  docker run -d --name kiao -p 127.0.0.1:48302:80 -p 127.0.0.1:48303:18080 `
    -v C:\your\store:/data -v kiao-dev:/opt/kiao/dev `
    -v kiao-postgres:/var/lib/postgresql/data kiao:latest
  ```

  To prove which code is running, ask the container — a `0` or no output means it predates the fix:

  ```powershell
  docker exec kiao grep -c "proxy_read_timeout 660s" /etc/nginx/http.d/kiao.conf
  docker exec kiao grep -o "link_fix_workers=[0-9]*" /var/log/worker.log
  ```

  The entrypoint re-renders the nginx config at every start, so editing it in a running container
  does not survive a restart. The SPA is a separate question: a production build ships a service
  worker, so the browser can keep running the previous bundle — hard-reload (Ctrl+Shift+R) or clear
  site data.
- **The Claude tab says the host is not signed in, again** — the sign-in went into a container that
  has since been replaced. `docker logs` names the home it used; if that is under `/data` with no
  volume there, nothing under it outlives `docker rm`.
- **The Claude tab cannot read the auth status** — the image was built without the CLI, or it
  cannot run: `docker exec kiao claude --version`.
- **The policy is not applied** — the entrypoint logs at every start whether it installed one and
  from where. It reads `KIAO_CLAUDE_POLICY_PATH` only, at startup:
  `docker exec kiao cat /etc/claude-code/managed-settings.json`.
- **A Claude turn reaches for `apt`, or installs with `apk add` and it does not last** — it was
  not told where it is. `docker logs` has one `Claude memory:` line per start; if it is missing,
  `KIAO_CLAUDE_CONTAINER_MEMORY` is `false` or the image predates the mechanism. If it is there,
  check that `<store>/.kiao-config/claude/.claude/CLAUDE.md` still holds the `@kiao-container.md`
  line — the import is added once, and a file replaced wholesale afterwards loses it.
- **A tool installed yesterday is gone** — `docker exec kiao kiao-dev status`. Either
  `/opt/kiao/dev` is not a mount, and the install went into a container that has since been
  replaced (add `-v kiao-dev:/opt/kiao/dev`), or it was installed with `apk add` rather than
  `kiao-dev add` and was never declared. `kiao-dev add` on the same package fixes both, and
  `docker logs` shows the replay at every start.
- **`git push` over ssh fails** — `Host key verification failed` is the missing `ssh-keyscan`;
  `Permission denied (publickey)` is a key the forge does not know, or one whose name is not among
  the three tried by default. `docker exec kiao ssh -G github.com` prints the identities and
  the `known_hosts` actually in force, and `docker exec kiao ssh -T git@github.com` says who
  the forge thinks is calling. `Bad owner or permissions` means the modes were not kept — the
  volume is a Windows bind mount rather than a named one. See
  [SSH keys and private registries](#ssh-keys-and-private-registries).
- **`WARNING: updating https://dl-cdn.alpinelinux.org/… DNS: transient error`** — expected on a
  machine with no network. apk says it cannot refresh the index and then installs from the
  volume's cache; the line that matters is the `[kiao-dev] packages ready` after it. The one case
  it is fatal is a package that has never been installed here before, which is not in that cache.
- **`docker ps` says `unhealthy` on the first start after declaring a JDK** — the packages are
  installed before the services, and a few hundred megabytes over a slow link outrun the health
  check's grace period. The next probe after nginx starts flips it back to `healthy`;
  `docker logs` shows where it is.
- **A delete or a paste is slow rather than broken** — raise
  `KIAO_WORKER_LINK_FIX_WORKERS`; a bind mount from the host is where that pass costs the
  most. `/var/log/worker.log` times every request (`elapsed=`), which says whether the time
  goes there at all.
