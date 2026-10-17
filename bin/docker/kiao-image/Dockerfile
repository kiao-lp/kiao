# Self-contained Dashboard, worker, PlantUML, hybridflow-store and PostgreSQL;
# Windows hosts need only Docker. bin/build-kiao-image.sh stages dist/kiao-image/.
# Alpine requires CGO-free Go binaries and musl-compatible native tools.

# Extract the official renderer without Jetty or the web editor; -picoweb serves
# the SPA's /plantuml/svg/<encoded> requests directly.
FROM plantuml/plantuml-server:jetty AS plantuml-war

# jdeps identifies java.{base,desktop,logging,prefs,scripting} and jdk.unsupported.
# java.naming and jdk.crypto.ec also support !includeurl over HTTPS.
# picoweb uses ServerSocket, so jdk.httpserver is unnecessary.
# Build the trimmed runtime on the final stage's Alpine version to match its libc.
FROM alpine:3.23 AS java-runtime
ENV JDK_HOME=/usr/lib/jvm/java-17-openjdk
# jlink --strip-debug needs binutils' objcopy for native libraries (builder only).
RUN apk add --no-cache openjdk17-jdk binutils
COPY --from=plantuml-war /plantuml.war /tmp/plantuml.war
RUN cd /tmp \
    && "$JDK_HOME/bin/jar" xf plantuml.war WEB-INF/lib \
    && mkdir -p /opt/plantuml \
    && cp /tmp/WEB-INF/lib/plantuml-*.jar /opt/plantuml/plantuml.jar \
    && test -s /opt/plantuml/plantuml.jar
RUN "$JDK_HOME/bin/jlink" \
        --add-modules java.base,java.desktop,java.logging,java.prefs,java.scripting,java.naming,jdk.unsupported,jdk.crypto.ec \
        --strip-debug --no-man-pages --no-header-files --compress=2 \
        --output /opt/java

FROM alpine:3.23

# Runtime requirements: git backs /git/*; without it, git stores report repo:false.
# Claude Code's Bash tool requires /bin/bash; SSH remotes require openssh-client.
# Node runs migrations and MCP servers; graphviz and fonts enable PlantUML rendering.
# The trimmed JVM links against libstdc++/zlib and uses fontconfig/DejaVu for text metrics.
# PostgreSQL and psql host/initialize boards; su-exec runs them as postgres (root is
# refused), and tzdata supplies log time zones.
RUN apk add --no-cache \
        bash \
        ca-certificates \
        curl \
        font-dejavu \
        fontconfig \
        git \
        graphviz \
        libstdc++ \
        nginx \
        nodejs \
        openssh-client \
        postgresql16 \
        postgresql16-client \
        su-exec \
        tzdata \
        zlib \
    && mkdir -p /var/log/nginx /run/nginx \
    && rm -f /etc/nginx/http.d/default.conf

# Alpine includes http.d/ inside http {}, but conf.d/ at main scope, where server
# blocks are invalid. The entrypoint writes its server config to this directory.
ENV NGINX_CONF_DIR=/etc/nginx/http.d

# Pin dot's package path; PlantUML probes /opt/local/bin and /usr/local/bin first.
COPY --from=java-runtime /opt/java /opt/java
COPY --from=java-runtime /opt/plantuml/plantuml.jar /opt/plantuml/plantuml.jar
ENV JAVA_HOME=/opt/java \
    PLANTUML_JAR=/opt/plantuml/plantuml.jar \
    GRAPHVIZ_DOT=/usr/bin/dot

# Verify the trimmed JVM, fonts and dot at build time; -testdot exits 16 on failure.
RUN "$JAVA_HOME/bin/java" -Djava.awt.headless=true -jar "$PLANTUML_JAR" -testdot \
    && printf '@startuml\nAlice -> Bob: ok\n@enduml\n' \
        | "$JAVA_HOME/bin/java" -Djava.awt.headless=true -jar "$PLANTUML_JAR" -tsvg -pipe > /tmp/smoke.svg \
    && grep -q '</svg>' /tmp/smoke.svg \
    && rm -f /tmp/smoke.svg

# CGO-free linux/amd64 binaries and scripts are staged with final modes to avoid
# duplicating binaries in a chmod layer.
COPY worker /usr/local/bin/worker
COPY migrations /opt/kiao/migrations

COPY hybridflow-store /usr/local/bin/hybridflow-store

# Host-staged MCP dependencies need Node, not npm. Servers call the loopback worker
# with per-turn tokens; no credential is baked into the image.
COPY kiao-mcp /opt/kiao/kiao-mcp

# pub.json is refreshed each build; assemblies may add catalogues beside it.
COPY catalog /opt/kiao/catalog

# Empty by default: the panel installs removable CLIs on /opt/kiao/dev.
# --preinstall stages a musl-compatible prefix. Preserve its layout: codex resolves
# ripgrep/sandbox helpers relative to itself; muse manages a sibling versioned binary.
COPY toolbox/ /opt/kiao/cli/

# The entrypoint restores /etc/claude-code/managed-settings.json from the persistent
# Claude home; this policy overrides user/project settings and must survive upgrades.
# Disable CLI self-updates so installed versions match the panel/preinstall records.
ENV DISABLE_AUTOUPDATER=1
# Check preinstalled CLIs for libc compatibility using a throwaway HOME to avoid
# seeding state; absent CLIs are skipped.
RUN mkdir -p /etc/claude-code /tmp/cli-smoke \
    && { [ ! -e /opt/kiao/cli/bin/claude ] || HOME=/tmp/cli-smoke /opt/kiao/cli/bin/claude --version; } \
    && { [ ! -e /opt/kiao/cli/bin/codex ] || HOME=/tmp/cli-smoke /opt/kiao/cli/bin/codex --version; } \
    && { [ ! -e /opt/kiao/cli/bin/muse ] || HOME=/tmp/cli-smoke /opt/kiao/cli/bin/muse --version; } \
    && { [ ! -e /opt/kiao/cli/bin/opencode ] || HOME=/tmp/cli-smoke /opt/kiao/cli/bin/opencode --version; } \
    && rm -rf /tmp/cli-smoke

# kiao-dev replays declared tools/setup from /opt/kiao/dev after container replacement.
# Mount that directory as a volume; see kiao-dev.sh and `kiao-dev add <pkg>`.
COPY kiao-dev.sh /usr/local/bin/kiao-dev
# apt wrappers point to Alpine equivalents; apk still runs /sbin/apk but reminds
# callers to declare installs for replay.
COPY apt-hint.sh /usr/local/bin/apt
COPY apk-nudge.sh /usr/local/bin/apk
# The entrypoint installs this guidance as Claude user memory.
COPY claude-container-memory.md /opt/kiao/claude/kiao-container.md
# Persist apk's cache for offline replay, including direct shell installs.
# The link stays dangling until the entrypoint creates the target, before apk runs.
RUN ln -sf /usr/local/bin/apt /usr/local/bin/apt-get \
    && ln -s /opt/kiao/dev/apk-cache /etc/apk/cache \
    && mkdir -p /opt/kiao/dev/home
# Image ENV also reaches docker exec, which does not inherit entrypoint exports.
# Volume tools precede image CLIs, allowing upgrades without rebuilding the image.
# Package installs and build caches persist on the dev volume. Shell HOME lives there;
# worker/Claude HOME lives in the store's state directory, with git identity and transcripts.
# Explicit Maven/npm config paths and system-wide SSH config share dev-volume credentials
# across these homes. The entrypoint configures /opt/kiao/dev/ssh and creates
# /opt/kiao/dev/m2/settings.xml, which MAVEN_ARGS requires to exist.
ENV KIAO_DEV_HOME=/opt/kiao/dev \
    HOME=/opt/kiao/dev/home \
    PATH=/opt/kiao/dev/bin:/opt/kiao/dev/npm/bin:/opt/kiao/dev/cargo/bin:/opt/kiao/cli/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    npm_config_prefix=/opt/kiao/dev/npm \
    npm_config_cache=/opt/kiao/dev/cache/npm \
    PYTHONUSERBASE=/opt/kiao/dev \
    PIP_CACHE_DIR=/opt/kiao/dev/cache/pip \
    CARGO_HOME=/opt/kiao/dev/cargo \
    GOPATH=/opt/kiao/dev/go \
    GOBIN=/opt/kiao/dev/bin \
    GOMODCACHE=/opt/kiao/dev/go/pkg/mod \
    GOCACHE=/opt/kiao/dev/cache/go-build \
    GRADLE_USER_HOME=/opt/kiao/dev/cache/gradle \
    MAVEN_ARGS="-Dmaven.repo.local=/opt/kiao/dev/cache/m2 -s /opt/kiao/dev/m2/settings.xml" \
    npm_config_userconfig=/opt/kiao/dev/npmrc

# SPA base is /dashboard/. Mount /data (or set KIAO_WORKER_ROOT_PATH) for your store;
# its .kiao-config holds service state and the default Claude home across replacements.
# Persist boards separately at /var/lib/postgresql/data on a named volume: PostgreSQL
# needs Unix ownership, which Windows bind mounts cannot supply.
COPY dashboard /usr/share/dashboard
COPY data /data

# The entrypoint interpolates nginx ports at startup.
COPY kiao.conf.template /etc/nginx/kiao.conf.template
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 80 18080 18081 8080

# nginx starts after backend readiness; serving the SPA marks startup complete.
# Allow for PlantUML's 60s first render and dev-package replay. Large first installs
# can exceed the grace period; later successful probes restore healthy status.
HEALTHCHECK --interval=10s --timeout=5s --start-period=180s --retries=6 \
    CMD curl -fsS -o /dev/null http://127.0.0.1/dashboard/ || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
