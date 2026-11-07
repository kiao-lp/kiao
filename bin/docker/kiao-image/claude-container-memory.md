<!-- Installed by docker-entrypoint.sh at every container start, from the image. Edits here are
     overwritten; write your own guidance in CLAUDE.md, beside the @kiao-container.md import. -->

# This container

You are running inside the `kiao` container: **Alpine Linux**, as root — no sudo, and
no apt. It runs KIAO — DCMS and hybridflow — over the store mounted
at `/data`, and it doubles as a development box.

## Installing a tool

**`kiao-dev add <alpine-package>`** installs it now *and* declares it, so the container that
replaces this one — which is how the image is upgraded — has it too. It is the only durable way,
and it is what to use unless the user asks otherwise.

- Names are Alpine's, not Debian's: `openjdk17-jdk`, not `openjdk-17-jdk`; `build-base`, not
  `build-essential`. Check with `kiao-dev search <term>` before installing.
- `apk add` on its own installs into the container's writable layer, which is discarded when the
  container is replaced — the tool then disappears with no warning. Use it only for something
  deliberately throwaway, and say that is what you did.
- Nothing needs restarting: the tool is on `PATH` for the next command.

What no package provides — an SDK tarball, `npm i -g`, a language toolchain — install under
`/opt/kiao/dev`, then make it repeatable by appending to `/opt/kiao/dev/setup.sh`, which runs at
every start and so must check before it installs. Environment variables belong in
`/opt/kiao/dev/env.sh`. Global installs of npm, Go, Cargo and pip already land on that volume.

`kiao-dev status` says what is declared and whether `/opt/kiao/dev` is genuinely a mounted volume —
worth a look before telling anyone that an install will survive. `kiao-dev help` has the rest.

## SSH keys and registry credentials

They do **not** go under `~`: your `HOME` is not the one a `docker exec` shell gets, and neither
survives the container being replaced. There is one copy of each on the dev volume, already wired
up, and writing anywhere else quietly breaks one of the two callers.

| What | Where | How it is found |
|---|---|---|
| SSH keys, `known_hosts`, extra `Host` blocks | `/opt/kiao/dev/ssh/` | `/etc/ssh/ssh_config`, so every process here |
| Maven repositories and their credentials | `/opt/kiao/dev/m2/settings.xml` | `MAVEN_ARGS` passes `-s` on it |
| npm registry and its token | `/opt/kiao/dev/npmrc` | `npm_config_userconfig`, so `npm config set` writes here |

So: `ssh-keygen -t ed25519 -f /opt/kiao/dev/ssh/id_ed25519`, and a key under any other name needs a
`Host` block naming it in `/opt/kiao/dev/ssh/config`. `ssh-keyscan <host> >> /opt/kiao/dev/ssh/known_hosts`
before the first push, or it hangs on a prompt nobody can answer. Never print or commit any of
these files — they hold private keys and tokens, and the store is a git work tree.
