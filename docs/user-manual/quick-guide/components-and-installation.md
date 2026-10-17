# Components and installation

[User manual](../README.md)

## What to install

Choose one of the two forms of Kiao:

| Form | What it runs | What you provide |
|---|---|---|
| **`kiao` executable** | Dashboard, worker and a local diagram renderer; it can also start hybridflow-store when configured with a database | A Debian-based Linux machine (Debian, Ubuntu or Mint). For boards, a boards service or PostgreSQL database |
| **`kiao` Docker image** | Dashboard, worker, hybridflow-store, PostgreSQL and a diagram renderer in one container | Docker, or Docker Desktop on Windows; a folder for your files and volumes to retain the container's data |

**Dashboard** is the browser interface. **worker** serves your files and runs agent work.
**hybridflow-store** stores boards in **PostgreSQL**. The installer and the image assemble
these parts for you.

The following examples install Kiao and open a folder. Building from source requires Git,
Go 1.24+, Node.js 20+ with npm, and network access to download dependencies. Run build
commands from the Kiao source checkout, in the directory containing `bin/`.

## Install the executable

On a Debian-based Linux machine, build and install:

```bash
./bin/build-all.sh
./bin/install-kiao-executable.sh
export PATH="$HOME/.local/bin:$PATH"
```

The default installation puts the command in `~/.local/bin` and its files in
`~/.local/share/kiao`. Keep `~/.local/bin` on your shell's `PATH` for later sessions.

Open an example folder:

```bash
mkdir -p "$HOME/kiao-example"
kiao "$HOME/kiao-example"
```

Kiao opens Dashboard in your browser and prints its address. It chooses free ports starting
at 48400. Stop this instance with Ctrl+C in the terminal.

This example works with files immediately. To use boards, configure a boards service or
database as described in [Executable: Boards](../deep-dive/kiao-executable.md#boards).
For diagram dependencies, installation flags and other command options, see the
[executable reference](../deep-dive/kiao-executable.md#install).

## Install the Docker image

Start Docker on the machine that will run Kiao. To build the image from source on Linux
or WSL, using the build prerequisites above:

```bash
./bin/build-all.sh
./bin/build-kiao-image.sh
```

This creates `kiao:latest` locally and saves `dist/kiao-image.tar.gz`. If you received that
archive instead, load it on the target machine:

```bash
docker load -i dist/kiao-image.tar.gz
```

Start Kiao with an example folder (Bash syntax):

```bash
mkdir -p "$HOME/kiao-example"
docker run -d --name kiao \
  -p 127.0.0.1:48302:80 \
  -v "$HOME/kiao-example:/data" \
  -v kiao-dev:/opt/kiao/dev \
  -v kiao-postgres:/var/lib/postgresql/data \
  kiao:latest
```

Open <http://localhost:48302/dashboard/>. The folder holds your files, `kiao-postgres`
keeps boards when the container is replaced, and `kiao-dev` keeps installed tools.
No separate boards service or database installation is needed. Stop the container with
`docker stop kiao`; start it again with `docker start kiao`.

For the PowerShell example, volume details and configuration options, see the
[Docker image reference](../deep-dive/kiao-docker.md#run-it).
