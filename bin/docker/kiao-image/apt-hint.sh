#!/bin/sh
# `apt install …`, typed by a person or by an assistant, on an image that is Alpine.
#
# Standing in for the missing command is worth more than "not found": it names the one that
# does the same job here, and the wrapper that makes the install survive the container
# being replaced. Installed as both `apt` and `apt-get`.
#
# It never installs anything itself — Debian and Alpine package names do not match
# (openjdk-17-jdk / openjdk17-jdk, build-essential / build-base), so translating would
# guess. Set KIAO_DEV_INSTALL_HINTS=false on the container to have the entrypoint remove both
# names: a third-party installer that probes `command -v apt-get` to decide it is on Debian
# is the case that wants them gone.
self=$(basename "$0")

# Everything that is not a flag and not the subcommand, which is as close to "the packages
# they meant" as is honest here.
subcommand=""
packages=""
for arg in "$@"; do
    case "$arg" in
        -*) continue ;;
    esac
    if [ -z "$subcommand" ]; then
        subcommand="$arg"
    else
        packages="$packages $arg"
    fi
done
[ -n "$packages" ] || packages=" <package>"

cat >&2 <<EOF
$self: this image is Alpine Linux — there is no apt here, and package names differ.

  Durable — installed now and in every container made from this image afterwards,
  kept on the /opt/kiao/dev volume:

      kiao-dev add$packages

  This container only — gone when it is replaced:

      apk add$packages

  Not sure of the Alpine name?   kiao-dev search <term>
  See also: docs/user-manual/deep-dive/kiao-docker.md, "Development tools".
EOF
exit 1
