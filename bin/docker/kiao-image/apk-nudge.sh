#!/bin/sh
# `apk add` on this image, wrapped so that it says what it did not do.
#
# The one silent failure of the whole arrangement: `apk add git-lfs` works, prints OK, and the
# package is gone the next time the container is replaced — because it went into the writable
# layer and nothing recorded that it was wanted. `kiao-dev add` is the durable form. A person
# reading the docs knows that; an assistant reaching for the command it knows from every other
# Alpine box does not, and neither is told by apk itself.
#
# So: the real apk runs, its output and its exit status are untouched, and one note follows a
# successful `add`. Nothing is blocked or rewritten — an intentionally throwaway install is a
# legitimate thing to want. KIAO_DEV_INSTALL_HINTS=false removes this wrapper altogether, and
# kiao-dev calls /sbin/apk directly so its own installs never trigger it.
APK=/sbin/apk

# The subcommand is the first argument that is not a flag.
subcommand=""
for arg in "$@"; do
    case "$arg" in
        -*) continue ;;
    esac
    subcommand="$arg"
    break
done

"$APK" "$@"
rc=$?

if [ "$rc" -eq 0 ] && [ "$subcommand" = "add" ] && [ "${KIAO_DEV_APK_QUIET:-0}" != "1" ]; then
    cat >&2 <<'EOF'

NOTE: that installed into this container only, and it is gone once the container is replaced.
      `kiao-dev add <pkg>` installs the same thing and declares it on the /opt/kiao/dev volume,
      so every later container has it too. `kiao-dev status` says where things stand.
EOF
fi

exit $rc
