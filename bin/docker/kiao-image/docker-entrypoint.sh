#!/bin/sh
# Starts the services of the kiao image: PostgreSQL and the hybridflow-store holding the
# boards, the PlantUML renderer, the Go worker, then nginx (Dashboard SPA + reverse
# proxies to the backends). Claude Code is not a service — the worker spawns the CLI
# per turn — but its home directory and its managed settings are prepared here, before anything
# can run it.
set -eu

log() { echo "[kiao] $*"; }

# --- Configuration -----------------------------------------------------------
# Every variable can be overridden at `docker run -e`, matching the worker
# env names used by the dev/e2e scripts (SERVER_PORT, KIAO_WORKER_*).
: "${KIAO_WORKER_ROOT_PATH:=/data}"
# The service's own state — migration ledger, conversations, the Dashboard config documents — is
# left to its default of <root>/.kiao-config, so a volume mounted over the content
# store keeps it across `docker run`s along with the content it describes. Without such a volume it
# is recreated, with defaults, on every start. It never shows up in the file browser.
: "${SERVER_PORT:=18080}"
: "${PLANTUML_PORT:=8080}"
: "${HYBRIDFLOW_PORT:=18081}"
: "${KIAO_WORKER_AUTH_MODE:=debug}"
# Migrations are off by default, exactly like e2e/bin/start-env.sh. To run them
# against a real store, set KIAO_WORKER_MIGRATIONS_PATH=/opt/kiao/migrations
# (node is bundled in the image for this).
: "${KIAO_WORKER_MIGRATIONS_PATH:=}"
# The kiao-mcp servers, on by default: the files and the boards, the two generic halves the
# base bundle stages. They talk to this container's own worker over the loopback address, so
# they act on the store that is mounted here and nowhere else. Set this to empty to withdraw
# them; KIAO_WORKER_MCP_SERVERS picks which ones (default "files,hybridflow").
: "${KIAO_WORKER_MCP_PATH:=/opt/kiao/kiao-mcp}"
# The toolbox catalogue the panel reads: pub.json, refreshed at every build. Empty is the
# binary's embedded pub.json alone, which is the same file — this default is what lets an
# assembly drop its own catalogues beside it.
: "${KIAO_WORKER_TOOLBOX_CATALOG_PATH:=/opt/kiao/catalog}"
# Where the configuration panel installs what a turn asks for — a JDK, npm, Python, an MCP server.
# The dev volume, which is the one directory here that survives the container being replaced and
# which the Dockerfile already points npm, pip, cargo and gradle at. On Alpine the panel installs
# system packages through `kiao-dev add`, so they land in the declaration this entrypoint replays.
# Set this to empty to make the panel read-only.
: "${KIAO_WORKER_TOOLBOX_PATH:=/opt/kiao/dev}"
# --- The boards: PostgreSQL and hybridflow-store, in this container ----------------
# The boards and the flow nodes live here — not on a server — so this image works
# with nothing behind it. PostgreSQL is initialised in PGDATA on the first start and the
# hybridflow-store keeps the boards in it, in debug auth mode like the worker beside it:
# there is no identity provider in front of this container. The database listens on the loopback
# address alone, with trust authentication the loopback alone can reach — nothing in this
# container holds a password for it, because there is no password.
#
# PGDATA on a named volume (-v kiao-postgres:/var/lib/postgresql/data) is what keeps the boards
# across `docker rm`; without one they die with the container, like a store with no volume over
# /data. A Windows bind mount is the wrong thing here — the server wants Unix ownership on its
# files — which is the same reason the development volume is a named one.
#
# KIAO_HYBRIDFLOW_STORE_DATABASE_URL points the service at another PostgreSQL instead — one on
# the host, or on the network — and the embedded one is then not started at all. The schema is the
# service's own business either way: it creates and migrates it at startup, so an empty database
# is enough.
: "${PGDATA:=/var/lib/postgresql/data}"
: "${KIAO_HYBRIDFLOW_STORE_DATABASE_URL:=}"
# Signing in from the Claude tab in Dashboard instead of needing a shell inside the container. On by
# default here, unlike a server deployment: this image has no identity provider in front of it, so gating the
# endpoint would leave no way in at all. Whoever reaches it binds this container's CLI to their own
# Anthropic account — which on a desktop publishing the ports to localhost is the person using it.
# Publish them to a network and set this to false.
#
# All three spellings are honoured: `…_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED` is the name the
# service reads now, `…_AGENT_CLAUDE_LOGIN_ENABLED` the one before it, and `…_CLAUDE_LOGIN_ENABLED`
# the one this image has always documented. Whichever is passed wins, and only the namespaced one is
# exported — defaulting the new name unconditionally would mask an old one a user did pass.
: "${KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED:=${KIAO_WORKER_AGENT_CLAUDE_LOGIN_ENABLED:-${KIAO_WORKER_CLAUDE_LOGIN_ENABLED:-true}}}"
# Storing an API key with the container's `muse` CLI from the Usage panel. On by default here, for
# the reason above: with no identity provider in front of this image, gating the endpoint would
# leave no way in at all. Publish the ports to a network and set this to false.
: "${KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED:=${KIAO_WORKER_AGENT_MUSE_LOGIN_ENABLED:-true}}"
# `bypassPermissions` — the mode that spawns the CLI with --dangerously-skip-permissions and runs
# every tool call unasked — is OFF here, and only here: a local worker or a server one defaults it on,
# because there the machine and the store belong to whoever is prompting. This image is the one that
# travels, so the turn it runs is one where every tool call is put to somebody first (Manual, or
# Manual Live's ten-second count). Set this to true to get the other behaviour back; nothing else in
# the panel changes either way. All three spellings are honoured, as above.
: "${KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED:=${KIAO_WORKER_AGENT_BYPASS_ENABLED:-${KIAO_WORKER_CLAUDE_BYPASS_ENABLED:-false}}}"
# Development tools: the packages and the setup script declared on the /opt/kiao/dev volume
# are reinstalled into this container before anything else starts. false skips the whole
# step — the e2e run declares nothing and pays nothing for it either way.
: "${KIAO_DEV_ENABLED:=true}"
# The two nudges towards the durable install: `apt`/`apt-get` stubs that name the Alpine
# equivalent, and an `apk` wrapper that follows a successful bare `apk add` with a note saying
# the package was not declared. false removes both — for a third-party installer that probes
# for apt-get to decide which distribution it is on, or for a quieter log.
: "${KIAO_DEV_INSTALL_HINTS:=true}"
# The container's own bearings, installed into the Claude home as user memory so a turn asked to
# install something knows it is on Alpine and that `kiao-dev add` is the form that lasts. This is
# the main way tools get installed here, so it is not left to be discovered.
: "${KIAO_CLAUDE_CONTAINER_MEMORY:=true}"

# Which java renders diagrams, decided before anything on the volume gets a say. /opt/java
# is the trimmed runtime built for plantuml.jar and verified at build time; a JDK installed
# into the container for development, and a JAVA_HOME its env.sh exports, must not silently
# become the one the renderer runs on.
RENDERER_JAVA="${JAVA_HOME:-/opt/java}/bin/java"

export KIAO_WORKER_HYBRIDFLOW_RUNNER_CLAUDE_LOGIN_ENABLED
export KIAO_WORKER_HYBRIDFLOW_RUNNER_MUSE_LOGIN_ENABLED
export KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED
export KIAO_WORKER_ROOT_PATH
export SERVER_PORT
export HYBRIDFLOW_PORT
export KIAO_WORKER_AUTH_MODE
export KIAO_WORKER_MIGRATIONS_PATH
export KIAO_WORKER_MCP_PATH
export KIAO_WORKER_TOOLBOX_CATALOG_PATH
export KIAO_WORKER_TOOLBOX_PATH
export PGDATA

# A boards service elsewhere is refused, loudly, before anything is started. This image serves
# its own boards, and the worker reads KIAO_WORKER_HYBRIDFLOW_URL itself — taking
# that variable at face value here would write a run's answer to the remote service while the
# SPA wrote the card to this container, two places for one board. To work on a remote service's
# boards, run kiao or bin/local-start-kiao.sh instead of this image; to keep this container's
# own service on another
# database, set KIAO_HYBRIDFLOW_STORE_DATABASE_URL.
if [ -n "${KIAO_WORKER_HYBRIDFLOW_URL:-}" ]; then
    log "ERROR: KIAO_WORKER_HYBRIDFLOW_URL is set, and this image serves its own boards."
    log "       Unset it for the embedded PostgreSQL, or set KIAO_HYBRIDFLOW_STORE_DATABASE_URL"
    log "       to a PostgreSQL for this container's own hybridflow-store to serve instead."
    log "       (docs/user-manual/deep-dive/kiao-docker.md, \"Boards\".)"
    exit 1
fi

# The worker refuses to start on a missing root; create it (also covers an
# empty bind-mount volume).
mkdir -p "$KIAO_WORKER_ROOT_PATH"

# --- Claude Code state -------------------------------------------------------
# Everything the CLI keeps — the sign-in token, the user settings, the session transcripts — hangs
# off one home directory, so it either all survives the container being replaced or none of it does.
# It defaults inside the service's own state directory, beside the conversations that describe the
# same store: a volume mounted over the store then carries the sign-in with it, and nothing extra
# has to be mounted for a login to outlive `docker rm`. That directory is hidden from the file API
# and carries a .gitignore of "*", so the token reaches neither the file browser nor a commit.
STATE_PATH="${KIAO_WORKER_STATE_PATH:-$KIAO_WORKER_ROOT_PATH/.kiao-config}"
: "${KIAO_CLAUDE_HOME:=$STATE_PATH/claude}"

# 0700 on both, the mode the service gives its own state directory: .credentials.json is an OAuth
# token and the transcripts are verbatim prompt text. The state directory is created here — the
# service would create it moments later anyway — so that it is not left at 0755 as a by-product of
# creating the home inside it. A bind mount from Windows ignores the mode entirely; that is the
# host's business and not something the container can fix, hence the `|| true`.
mkdir -p "$STATE_PATH" "$KIAO_CLAUDE_HOME/.claude"
chmod 700 "$STATE_PATH" "$KIAO_CLAUDE_HOME" 2>/dev/null || true

# The organisation's policy file. Claude Code reads it from /etc/claude-code/managed-settings.json,
# which lives in the container's writable layer and is therefore gone the moment the container is
# replaced — and replacing the container is how this image is upgraded. So the copy that persists
# is the one in the Claude home, installed from there at every start. Nothing is deleted when it is
# absent: that path can equally be bind-mounted from the host, and a start that cleared it would be
# deleting the operator's own file.
: "${KIAO_CLAUDE_POLICY_PATH:=$KIAO_CLAUDE_HOME/managed-settings.json}"
if [ -f "$KIAO_CLAUDE_POLICY_PATH" ]; then
    mkdir -p /etc/claude-code
    cp "$KIAO_CLAUDE_POLICY_PATH" /etc/claude-code/managed-settings.json
    chmod 644 /etc/claude-code/managed-settings.json
    log "Claude managed settings installed from $KIAO_CLAUDE_POLICY_PATH"
elif [ -f /etc/claude-code/managed-settings.json ]; then
    log "Claude managed settings: /etc/claude-code/managed-settings.json, as mounted"
else
    log "Claude managed settings: none" \
        "(drop a managed-settings.json into $KIAO_CLAUDE_HOME to install one)"
fi

# What the CLI is told about the box it is running on. Asking the Claude tab to install a JDK is
# the main way tools arrive here, and a CLI that knows nothing reaches for `apt` (absent) or for
# `apk add` (silently undone by the next container) — so the container's own instructions are
# installed as *user* memory, which is the scope the service loads (--setting-sources user; a
# CLAUDE.md arriving in the store through a git pull is deliberately not read).
#
# The generated file is separate from CLAUDE.md and merely imported by it: it is refreshed from
# the image at every start, so upgrading the image updates the guidance, while whatever the
# operator wrote in CLAUDE.md is never touched — the import line is added once and that is all.
if [ "$KIAO_CLAUDE_CONTAINER_MEMORY" = "true" ] && [ -f /opt/kiao/claude/kiao-container.md ]; then
    cp /opt/kiao/claude/kiao-container.md "$KIAO_CLAUDE_HOME/.claude/kiao-container.md"
    claude_memory="$KIAO_CLAUDE_HOME/.claude/CLAUDE.md"
    if [ ! -f "$claude_memory" ]; then
        printf '@kiao-container.md\n' > "$claude_memory"
        log "Claude memory: $claude_memory created, importing kiao-container.md"
    elif ! grep -q '^@kiao-container\.md[[:space:]]*$' "$claude_memory"; then
        { printf '@kiao-container.md\n\n'; cat "$claude_memory"; } > "$claude_memory.tmp"
        mv "$claude_memory.tmp" "$claude_memory"
        log "Claude memory: added the kiao-container.md import to $claude_memory"
    else
        log "Claude memory: kiao-container.md refreshed (imported by $claude_memory)"
    fi
fi

# Whether this container can talk to Anthropic at all is the first question asked of a Claude tab
# that has gone quiet, and it is answered here rather than left to be discovered one failing turn
# at a time. `claude auth status` reads local state only; the timeout is there so a CLI that hangs
# delays a log line rather than the whole startup.
# Resolved on PATH rather than at a fixed path: the image's own CLIs are in the toolbox prefix at
# /opt/kiao/cli/bin, and a `kiao-dev`-installed one on the volume shadows them — which is how either
# CLI moves without a rebuild, and would be invisible to a test on a hard-coded path.
if command -v claude > /dev/null 2>&1; then
    claude_version=$(HOME="$KIAO_CLAUDE_HOME" claude --version 2>/dev/null | cut -d' ' -f1)
    if HOME="$KIAO_CLAUDE_HOME" timeout 20 claude auth status --json 2>/dev/null \
            | grep -q '"loggedIn"[[:space:]]*:[[:space:]]*true'; then
        log "Claude Code ${claude_version:-?} is signed in (home=$KIAO_CLAUDE_HOME)"
    else
        log "Claude Code ${claude_version:-?} is NOT signed in;" \
            "use Sign in on the agent tab in Dashboard (home=$KIAO_CLAUDE_HOME)"
    fi
else
    log "no Claude Code CLI on this container yet; install it from the Configuration panel" \
        "in Dashboard (Runtimes -> Claude Code CLI) and the agent tab offers it from the next" \
        "page load. It lands on the /opt/kiao/dev volume and outlives this container"
fi

# Codex is the second agent, and the worker decides whether to offer it from exactly this:
# whether the binary is on PATH — asked afresh at every page rather than once here, so a CLI
# installed from the Configuration panel is offered without a restart. There is no sign-in state to
# read — `codex` keeps its own, and has no equivalent of `claude auth status` — so this says what is
# there and no more.
if command -v codex > /dev/null 2>&1; then
    log "Codex $(codex --version 2>/dev/null | awk '{print $NF}') is available"
else
    log "no Codex CLI on this container yet; Configuration -> Runtimes -> Codex CLI installs it"
fi

# --- Development tools -------------------------------------------------------
# The nudges: apt/apt-get answer an `apt install` with the Alpine command that does the same
# job, and the apk wrapper tells a bare `apk add` that what it installed was not declared.
# Removed on request — for an installer that reads `command -v apt-get` as "this is Debian",
# the one case where standing in for a missing command is worse than not.
if [ "$KIAO_DEV_INSTALL_HINTS" != "true" ]; then
    rm -f /usr/local/bin/apt /usr/local/bin/apt-get /usr/local/bin/apk
fi

# This image is also used as a local development box, where a JDK and a handful of other
# tools are wanted. They are not in it: everyone else it is handed to would carry them, and
# the needs change faster than an image is rebuilt. So they are installed into a running
# container and declared on the /opt/kiao/dev volume, which is replayed here — from the apk
# cache on that same volume, so a container recreated on a disconnected machine still comes
# back with its toolchain. kiao-dev.sh explains the arrangement; `kiao-dev status` reports
# on it from inside.
#
# It runs before the services rather than beside them: a turn that starts the moment
# Dashboard answers must find `javac` there, not five minutes later. Nothing here can stop
# the container — a mistyped package name leaves Dashboard running and says so.
if [ ! -x /usr/local/bin/kiao-dev ]; then
    log "no kiao-dev in this image; nothing manages /opt/kiao/dev"
elif [ "$KIAO_DEV_ENABLED" = "true" ]; then
    # Sourced before the packages are installed, not after: it is where a proxy, a private
    # registry token or a JAVA_HOME belongs, and the install and the setup script are the
    # first things that need them. Exported variables reach every process started below,
    # the worker among them, hence the `claude` it spawns and that turn's Bash tool.
    if [ -f /opt/kiao/dev/env.sh ]; then
        log "sourcing /opt/kiao/dev/env.sh"
        # errexit off around it: it is a file on a volume, and a line that fails in it must
        # cost the variables it did not set, not the container. It is sourced, so an `exit`
        # written in it does stop the startup — assignments only, there.
        set +e
        set -a
        . /opt/kiao/dev/env.sh
        env_rc=$?
        set +a
        set -e
        [ "$env_rc" -eq 0 ] || log "WARNING: /opt/kiao/dev/env.sh exited $env_rc"
    fi
    kiao-dev sync || log "WARNING: development tools are incomplete (see above)"
    # A `docker exec` gets the image's environment, so PATH and HOME are already right
    # there; what it cannot get is the volume's own env.sh. A login shell can:
    # `docker exec -it <container> bash -l`.
    mkdir -p /etc/profile.d
    cat > /etc/profile.d/kiao-dev.sh <<'PROFILE'
# Written at container start by docker-entrypoint.sh — edit /opt/kiao/dev/env.sh instead.
if [ -f /opt/kiao/dev/env.sh ]; then . /opt/kiao/dev/env.sh; fi
PROFILE
else
    log "development tools skipped (KIAO_DEV_ENABLED=$KIAO_DEV_ENABLED)"
fi

# --- Per-user configuration: SSH keys, Maven, npm ----------------------------
# An SSH key and a private registry's credentials are per-user files, and this container has no
# single user: a `docker exec` shell has HOME=/opt/kiao/dev/home, the worker — and so the
# `claude` it spawns, and that turn's Bash tool — has the Claude home under the store, and a
# process started some other way has root's. Left at `~`, a key added from a shell is not the key a
# turn pushes with, and a settings.xml written in one of them is in the container's writable layer
# and gone the moment the container is replaced.
#
# So there is one copy of each, on the dev volume, and every tool is pointed at it from the image
# environment rather than at `~`: MAVEN_ARGS carries `-s`, npm_config_userconfig names the npmrc,
# and ssh is told here, system-wide, where the keys are. The files are created empty on the first
# start and never rewritten afterwards — they hold credentials, and nothing here overwrites those.
#
# It runs after the packages, so that a declared openssh replaces the image's own /etc/ssh before
# this rewrites the config, and it is skipped with the rest when KIAO_DEV_ENABLED is false.
if [ "$KIAO_DEV_ENABLED" = "true" ]; then
    DEV_SSH=/opt/kiao/dev/ssh
    mkdir -p "$DEV_SSH" /opt/kiao/dev/m2 /opt/kiao/dev/home

    if [ ! -f "$DEV_SSH/config" ]; then
        cat > "$DEV_SSH/config" <<'SSHCONFIG'
# Your own ssh options. Included by /etc/ssh/ssh_config, so they apply to every process in this
# container — a docker exec shell, and the Claude turn the worker spawns — and they live on
# the /opt/kiao/dev volume, so they outlive it. Created empty at the first start; never rewritten.
#
# Host github.com
#     IdentityFile /opt/kiao/dev/ssh/id_ed25519_github
SSHCONFIG
    fi
    [ -f "$DEV_SSH/known_hosts" ] || : > "$DEV_SSH/known_hosts"

    if [ ! -f /opt/kiao/dev/npmrc ]; then
        cat > /opt/kiao/dev/npmrc <<'NPMRC'
; npm user config for this container (npm_config_userconfig points here), on the /opt/kiao/dev
; volume so it outlives it. `npm config set …` writes here whichever HOME npm was run with.
; Created empty at the first start; never rewritten.
;
; registry=https://nexus.example.com/repository/npm-group/
; //nexus.example.com/repository/npm-group/:_authToken=…
NPMRC
    fi

    if [ ! -f /opt/kiao/dev/m2/settings.xml ]; then
        cat > /opt/kiao/dev/m2/settings.xml <<'SETTINGS'
<?xml version="1.0" encoding="UTF-8"?>
<!--
  Maven user settings for this container. MAVEN_ARGS passes `-s` on this file, so it is read
  whichever HOME the process got, and it is on the /opt/kiao/dev volume, so it outlives the
  container. Created empty at the first start; never rewritten.

  Repositories and their credentials go here:

  <servers>
    <server><id>nexus</id><username>…</username><password>…</password></server>
  </servers>
  <mirrors>
    <mirror><id>nexus</id><mirrorOf>*</mirrorOf><url>https://…/repository/maven-public/</url></mirror>
  </mirrors>
-->
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">
</settings>
SETTINGS
    fi

    # All three hold credentials, and ssh refuses a private key that anyone but its owner can
    # read — which a file copied in from elsewhere usually is. A bind mount from Windows reports
    # a mode it does not keep; that is the host's business, hence the `|| true`.
    chmod -R go-rwx "$DEV_SSH" 2>/dev/null || true
    chmod 600 /opt/kiao/dev/npmrc /opt/kiao/dev/m2/settings.xml 2>/dev/null || true

    # ssh reads no environment variable naming its key directory, so the system-wide config is
    # where a process that never saw `~` is told. Rewritten at every start: it is in the writable
    # layer, and Alpine's own copy of this file is comments only. A `~/.ssh/config` still wins,
    # being read first — including the volume's own, through the symlink below.
    mkdir -p /etc/ssh
    cat > /etc/ssh/ssh_config <<'ETCSSH'
# Written at container start by docker-entrypoint.sh — put your own options in
# /opt/kiao/dev/ssh/config, which is included first and overrides everything here.
Include /opt/kiao/dev/ssh/config

Host *
    IdentityFile /opt/kiao/dev/ssh/id_ed25519
    IdentityFile /opt/kiao/dev/ssh/id_ecdsa
    IdentityFile /opt/kiao/dev/ssh/id_rsa
    UserKnownHostsFile /opt/kiao/dev/ssh/known_hosts
ETCSSH

    # And the familiar paths, for the shell where they are what gets typed: `ssh-keygen` with its
    # default answers, or an installer writing ~/.npmrc, then lands in the shared copy rather than
    # beside it. Only ever created, never replaced — a real directory somebody put there wins.
    for pair in ".ssh:$DEV_SSH" ".m2:/opt/kiao/dev/m2" ".npmrc:/opt/kiao/dev/npmrc"; do
        link="/opt/kiao/dev/home/${pair%%:*}"
        if [ ! -e "$link" ] && [ ! -L "$link" ]; then
            ln -s "${pair#*:}" "$link"
        fi
    done

    log "per-user config on the dev volume: ssh=$DEV_SSH" \
        "maven=/opt/kiao/dev/m2/settings.xml npm=/opt/kiao/dev/npmrc"
fi

# --- nginx config ------------------------------------------------------------
# The drop-in directory differs by distribution — Debian includes conf.d/ from
# inside `http {}`, Alpine includes http.d/ there and conf.d/ at the main context,
# where a `server` block is a syntax error. The Dockerfile picks the right one.
: "${NGINX_CONF_DIR:=/etc/nginx/conf.d}"
sed -e "s|__WORKER_PORT__|$SERVER_PORT|g" \
    -e "s|__HYBRIDFLOW_PORT__|$HYBRIDFLOW_PORT|g" \
    -e "s|__PLANTUML_PORT__|$PLANTUML_PORT|g" \
    /etc/nginx/kiao.conf.template > "$NGINX_CONF_DIR/kiao.conf"

# --- PostgreSQL ----------------------------------------------------------------
# The boards' database. Initialised once — PG_VERSION says it has been — and started on every
# run. pg_ctl start waits for the server to accept connections, so whatever follows it can use
# the database; a server that never comes up fails the start here rather than ten lines later in
# the hybridflow-store. Skipped whole when KIAO_HYBRIDFLOW_STORE_DATABASE_URL names another
# PostgreSQL: the embedded one is then not initialised either, and PGDATA stays untouched.
POSTGRES_STARTED=""
HYBRIDFLOW_DATABASE_URL="$KIAO_HYBRIDFLOW_STORE_DATABASE_URL"
if [ -z "$HYBRIDFLOW_DATABASE_URL" ]; then
    mkdir -p "$PGDATA" /var/run/postgresql
    # A fresh named volume belongs to root; the server refuses to run on files it does not own.
    chown postgres:postgres "$PGDATA" /var/run/postgresql
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
        log "initialising PostgreSQL in $PGDATA"
        su-exec postgres initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 \
            --locale=C.UTF-8 > /var/log/postgres-init.log 2>&1
    fi
    log "starting PostgreSQL (data in $PGDATA)"
    # The server log is opened by the postgres user, which cannot create a file in root-owned
    # /var/log — so it is created here, beside the services' own logs, and handed over.
    touch /var/log/postgres.log
    chown postgres:postgres /var/log/postgres.log
    # Loopback only, UTC everywhere: nothing outside this container can reach it, and every
    # timestamp it writes and logs is in the same zone whatever the host keeps.
    su-exec postgres pg_ctl -D "$PGDATA" -l /var/log/postgres.log \
        -o "-c listen_addresses=127.0.0.1 -c timezone=UTC -c log_timezone=UTC" -w start
    # The role and the database the service keeps the boards in. CREATE DATABASE cannot run in a
    # DO block, so the idempotent form is a SELECT returning the statement only while nothing by
    # that name exists yet, executed by \gexec — a second start prints DO and nothing else. A volume
    # that served the old names keeps its boards by renaming them: nothing is connected yet at this
    # point of the start, so the rename cannot meet a session.
    su-exec postgres psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'workflows')
       AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hybridflow') THEN
        ALTER ROLE workflows RENAME TO hybridflow;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hybridflow') THEN
        CREATE ROLE hybridflow LOGIN;
    END IF;
END
$$;
SELECT 'ALTER DATABASE workflows RENAME TO hybridflow'
WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'workflows')
  AND NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hybridflow')\gexec
SELECT 'CREATE DATABASE hybridflow OWNER hybridflow'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hybridflow')\gexec
SQL
    HYBRIDFLOW_DATABASE_URL="postgres://hybridflow@127.0.0.1:5432/hybridflow?sslmode=disable"
    POSTGRES_STARTED=1
fi

# --- hybridflow-store ---------------------------------------------------------
# The boards over HTTP, on the database above — this container's own, or the one
# KIAO_HYBRIDFLOW_STORE_DATABASE_URL names. Debug auth, like the worker beside it: there
# is no Keycloak here, the SPA is built with VITE_NO_SECURITY, and every call the browser makes
# arrives through nginx on this same origin, so no CORS list is needed.
#
# The service token is minted per start and never written down: the pair that has to agree on
# it — this service and the worker child below — are both started here, and a token that
# lives in memory for one run cannot be leaked by a file nobody remembered to delete. The
# worker presents it when a run claims a card and files an answer, naming the run's owner
# beside it; the browser presents nothing, and what it writes is recorded as anonymous.
HYBRIDFLOW_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=')"
export KIAO_WORKER_HYBRIDFLOW_URL="http://127.0.0.1:$HYBRIDFLOW_PORT"
export KIAO_WORKER_HYBRIDFLOW_TOKEN="$HYBRIDFLOW_TOKEN"
# The connection string with its password taken out, for the log line — the embedded one has none,
# but one given through KIAO_HYBRIDFLOW_STORE_DATABASE_URL may.
db_shown="$(printf '%s' "$HYBRIDFLOW_DATABASE_URL" | sed -e 's|\(://[^:/@]*\):[^@]*@|\1:***@|' -e 's|?.*||')"
log "starting hybridflow-store on 0.0.0.0:$HYBRIDFLOW_PORT (database $db_shown)"
KIAO_HYBRIDFLOW_STORE_PORT="$HYBRIDFLOW_PORT" \
KIAO_HYBRIDFLOW_STORE_DATABASE_URL="$HYBRIDFLOW_DATABASE_URL" \
KIAO_HYBRIDFLOW_STORE_AUTH_MODE=debug \
KIAO_HYBRIDFLOW_STORE_SERVICE_TOKEN="$HYBRIDFLOW_TOKEN" \
KIAO_HYBRIDFLOW_STORE_CORS_ORIGINS="" \
    /usr/local/bin/hybridflow-store > /var/log/hybridflow-store.log 2>&1 &
HYBRIDFLOW_PID=$!

# --- PlantUML renderer -------------------------------------------------------
# plantuml.jar's own -picoweb server, on the trimmed runtime at /opt/java. It
# answers both /plantuml/<format>/<encoded> and /<format>/<encoded>, so it fits the
# nginx `location /plantuml/` proxy, which strips the prefix.
log "starting the PlantUML renderer on 0.0.0.0:$PLANTUML_PORT"
"$RENDERER_JAVA" -Djava.awt.headless=true -jar "$PLANTUML_JAR" \
    "-picoweb:$PLANTUML_PORT" > /var/log/plantuml.log 2>&1 &
PLANTUML_PID=$!

# --- worker -----------------------------------------------------------
log "starting worker on 0.0.0.0:$SERVER_PORT" \
    "(root=$KIAO_WORKER_ROOT_PATH, auth=$KIAO_WORKER_AUTH_MODE," \
    "claude-home=$KIAO_CLAUDE_HOME," \
    "agent-bypass=$KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED)"
# Both variables are set on this one process rather than exported: the `claude` the service spawns
# inherits them, which is the point, while nginx and the JVM keep their own environment.
#
# HOME is what puts every piece of Claude state in one directory — the service derives its default
# for the credentials file from it, and the CLI writes everything else there.
#
# IS_SANDBOX=1 is what would let a bypass turn run at all. Everything in this container runs as root
# (nginx binds :80, and the store is a bind mount whose ownership the container does not get to
# choose), and the CLI refuses `--dangerously-skip-permissions` under root unless this says the
# process is already confined. Here it is: a container is the boundary. It stays set even though the
# flag is not passed by default, so that flipping KIAO_WORKER_HYBRIDFLOW_RUNNER_BYPASS_ENABLED back on is
# the only thing that has to be done — otherwise every such turn would die on "cannot be used with
# root/sudo privileges" before doing anything.
HOME="$KIAO_CLAUDE_HOME" IS_SANDBOX=1 \
    /usr/local/bin/worker > /var/log/worker.log 2>&1 &
WORKER_PID=$!

# --- readiness ---------------------------------------------------------------
wait_for() {
    name=$1
    url=$2
    pid=$3
    timeout=$4
    i=0
    while [ "$i" -lt "$timeout" ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            log "ERROR: $name exited during startup; tail /var/log/$name.log"
            return 1
        fi
        # -f so an error status counts as not-ready; --max-time 5 leaves room for a
        # cold first render (JVM class loading, font cache) on a slow host.
        if curl -fs -o /dev/null --max-time 5 "$url"; then
            log "$name is up ($url)"
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    log "ERROR: $name not up after ${timeout}s; tail /var/log/$name.log"
    return 1
}

# The PlantUML probe renders a diagram rather than just touching the port: the
# encoded payload is `Bob -> Alice: hello`, so a 200 means the JVM and the fonts
# are actually working, not merely that the socket is open.
wait_for plantuml \
    "http://127.0.0.1:$PLANTUML_PORT/plantuml/svg/SyfFKj2rKt3CoKnELR1Io4ZDoSa70000" \
    "$PLANTUML_PID" 60
# Generous on the first start, which is where the schema is created and migrated.
wait_for hybridflow-store "http://127.0.0.1:$HYBRIDFLOW_PORT/healthz" "$HYBRIDFLOW_PID" 60
wait_for worker "http://127.0.0.1:$SERVER_PORT/healthz" "$WORKER_PID" 30

# --- nginx -------------------------------------------------------------------
log "starting nginx (Dashboard SPA + proxies)"
nginx -g 'daemon off;' > /var/log/nginx/error.log 2>&1 &
NGINX_PID=$!

cleanup() {
    log "stopping services..."
    kill "$NGINX_PID" "$WORKER_PID" "$HYBRIDFLOW_PID" "$PLANTUML_PID" 2>/dev/null || true
    # The database is stopped through pg_ctl rather than killed: it was started that way, and a
    # fast stop checkpoints what is held while a kill leaves recovery to the next start. Only when
    # this container started one — an external database is not ours to stop.
    if [ -n "$POSTGRES_STARTED" ]; then
        su-exec postgres pg_ctl -D "$PGDATA" -m fast stop > /dev/null 2>&1 || true
    fi
    wait 2>/dev/null || true
    log "stopped."
    exit 0
}
trap cleanup TERM INT

log "ready: Dashboard at http://localhost/dashboard/ (publish e.g. -p 59532:80)," \
    "worker on :$SERVER_PORT (publish e.g. -p 59510:$SERVER_PORT)," \
    "hybridflow-store on :$HYBRIDFLOW_PORT," \
    "PlantUML on :$PLANTUML_PORT"
wait
