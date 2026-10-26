# What a kiao build delivers — proposed solution design for one catalogue

A kiao build hands over four kinds of thing: **plugins** (what Dashboard opens a file with),
**MCP servers** (what an agent's turn is handed), **skills** (what teaches a turn the store's
formats) and **runtimes** (what the other three need to be on the machine at all). Each is
declared in a different place, carried by a different mechanism, and switched off — or not — at a
different scope. Only one of the four models dependencies, and it models them only within itself.

This is the state that produces the report, and the target that would end it.

## 1. What each kind is today

| | Declared in | Carried by | Switched off | Dependencies | Health |
|---|---|---|---|---|---|
| **Plugin** (17 shipped, plus dropped-in ones) | `src/plugins/catalogue.json`, one line; a dropped-in one by its `package.json` in its own project directory | compiled into the SPA; `VITE_PLUGIN_PATHS` decides which dropped-in ones | per **store** (`dashboard.json`), needs a reload | — | — |
| **MCP server** (10) | `internal/toolbox/catalog/pub.json`, `kind: mcp` (+ deployment-staged `*.json` beside it) | `pub.json` embedded, the rest staged per deployment; installed on demand through five channels | per **machine** (the toolbox ledger's `enabled`) | `requires` → runtimes, `requiresEnv` → tokens | handshake probe: tools, bytes, error |
| **Skill** (9 embedded, plus assembly additions) | a directory holding a `SKILL.md`; embedded mappings in `pluginOf`, additional mappings and master provenance in `skills.json` | `//go:embed` plus optional `KIAO_WORKER_SKILLS_PATH`; one composed catalogue written into `<store>/.agents/skills` and `<store>/.claude/skills` at every start and plugin-list save | per **store**, by the plugin it is the half of (`dashboard.json`) | skill → plugin, one edge, one direction | source errors preserve the previous installation |
| **Runtime** (6) | `internal/toolbox/catalog/pub.json`, `kind: runtime` | installed on demand: `uv-bootstrap`, `node-tarball`, `temurin`, `uv-python`, `system`, `claude-release`, `codex-release` | install / uninstall only | `requires` (python → uv) | version probe |

Four columns of that table are empty, and the three empty ones in the plugin and skill rows are
the subject.

**Since this was written**, two of the runtimes are the agent CLIs: `claude-cli` and `codex-cli`
are catalogue rows with checksummed recipes of their own, which is steps 1 and 4 taken for the
third dashed node below. What that changed, and what it left, is recorded where it belongs — §2.1,
§4 and §5 — rather than as an amendment here.

**And the skill row has lost two of its three blanks.** A skill is the agent half of a Dashboard
plugin and now says which one, so it is switched off per store by that plugin's own switch, and
that naming is one edge of the cross-kind `requires` §3 asks for — taken on its own, without the
manifest. §2.3 and §4, step 2a.

Assemblies can now add runtime skill sources without changing the common binary. This is a
limited extension of the skill catalogue, separate from the unified resource manifest proposed
below; see [00071](decisions/00071-runtime-skill-sources.md).

## 2. Three things that are wrong

### 2.1 The dependency graph stops at the MCP corner

`requires` exists in exactly one file and points in exactly one direction: from an MCP server to a
runtime. Three real dependencies of the *other* kinds live outside that closure, and each is
provisioned by hand, differently, in every build:

**PlantUML** is needed by `archdia-edit` and by every markdown render that carries a diagram
fence. It arrives four ways — a `plantuml/plantuml-server:jetty` container in a server deployment, a server
inside the `kiao` image behind nginx, and a pinned, SHA-256-verified jar fetched by
`bin/install-kiao-executable.sh` into `dist/cache/plantuml` with its own `--skip-plantuml` and
`--plantuml-jar` flags. The fourth way is *not at all*: neither `bin/local-start-kiao.sh` nor the
e2e stack sets `VITE_PLANTUML_SERVER_URL`, so on a developer's own machine a diagram renders as
nothing and no part of the system says why.

**git** is what `internal/files/git/git.go` shells out to, and the Git tool bar tab and the
side-by-side diff are built on it. It has nowhere at all to be declared, because it is not a
plugin's dependency but *cms-core's own*: the Git tab is one of the two tabs cms-core contributes
itself (`App.tsx`), present in every assembly, switchable off nowhere. Worse: `git` in the
catalogue is the *MCP server* `mcp-server-git`, so the one row wearing that name is the one thing
that is not the dependency — switching it off implies "no git", which is false, and switching it
on does nothing for the tab.

**The agent CLIs** are needed by the `agent` plugin and by `hybridflow-ui` playback; the skills
themselves are store content since they moved out of the agent homes, written at every start
whether or not a CLI is there to read them. `claude` used to arrive three ways — `npm install -g
@anthropic-ai/claude-code` on a server, a checksummed musl binary staged into the image with
`--claude-version` and `--skip-claude`, and "assumed present" everywhere else — and `codex`, the
second agent, would have doubled every one of them.

**This part is done.** `claude-cli`, `codex-cli` and `muse-cli` are catalogue runtimes on three
channels of their own, `claude-release`, `codex-release` and `muse-release`, which do for a release
binary what `temurin` does for a JDK: resolve the current version, read the publisher's checksum,
verify, unpack. The build script holds a list of ids — `--preinstall
claude-cli,codex-cli,muse-cli` — and `worker toolbox preinstall` does the fetching, into a
prefix the image copies whole. `--skip-claude`, `--claude-version`, the `dist/cache/claude`
directory and the sixty lines that used them are gone, and the Codex and Muse twins they would have
spawned were never written.

So the catalogue that already knows how to fetch a checksummed Temurin JDK still does not know that
a jar it could fetch by the same means is fetched instead by a block of bash with its own pin, its
own digest, its own cache directory and its own skip flag — `bin/install-kiao-executable.sh`, for
PlantUML. That is the same shape, one node further along, and the mechanism it needs now exists.

### 2.2 Nothing can say why a resource does not work

The toolbox ledger already keeps the fact that matters, and keeps it for MCP servers alone: not
*is it installed* — a package manager reporting success proves files were written, not that
anything runs — but *did it answer*. A plugin switched on with its dependency missing is drawn
exactly like one that works. A store where the CLI is absent gets no skills and no agent tab, and
the panel shows nothing about either.

### 2.3 Audience is a property of three different mechanisms, and only one has it

"Delivered to everybody" against "this person's own" is a genuine product decision, and it is
expressed once — for plugins — as *which directory a project sits in*, plus *which of the four
build scripts calls `bin/dashboard-plugin-projects.sh`*. Skills had no equivalent: `actlog` and
`hybridflow` landed in everybody's `~/.claude/skills` whether or not the plugins that write those
files were in the build. MCP has none either, which is how a site-specific pair — say an
`inventory-edit` plugin no shared build carries and a `kiao-inventory` MCP server in everybody's
catalogue — came to be the two halves of one feature shipped with opposite defaults.

**The skill half of this is done, and not by an `audience` field.** A skill is the agent half of a
plugin and now says which one, so the question "who gets `archdia`" is answered by the question
already being asked — *does this store load the Archdia plugin* — rather than by a second one. The
installer reads the store's `plugins` list at every pass and installs the skills it calls for;
switching a plugin off prunes its skill, through the same marker rule that removes a skill the
build has dropped. Every way of failing to answer means every skill, which is the direction that
costs a directory nobody reads rather than a turn that no longer knows the store's formats.

That is not `audience` and does not replace it: audience is about *which build carries a thing*,
and this is about *which store switched it on*. What it shows is that for a resource which is the
half of another, the switch already exists — the other half's. A site-specific server and its
plugin were that same pair, shipped with opposite defaults.

**Since this was written**, the pair ships aligned — but by a split, not by an `audience` field.
The site-specific server moved to its own package, built self-contained and overlaid into the
bundle's `dist/` only by the deployments that carry its plugin; the base bundle stages its own
servers and names the overlaid one only where it was overlaid. See step 3 below.

**And the catalogue half followed.** The toolbox no longer reads one embedded document: it merges
`pub.json` with every `*.json` the deployment staged beside it, and the site-specific components
moved to such a file, which only those assemblies stage. The shared panel lists no such row;
the site's lists them.

## 3. The target: one manifest, four kinds, one graph

Promote the toolbox catalogue from *what the MCP panel installs* to **the manifest of everything a
build delivers**. The entry shape is the one already there — `id`, `kind`, `title`, `role`,
`requires`, and a `recipes` map keyed by platform — with three changes:

- **`kind` gains `skill` and `plugin`.** A skill's recipe is `channel: "bundled"`, which the
  catalogue already has. A plugin's is `channel: "assembly"`: nothing to install, compiled in.
- **`requires` crosses kinds.** This is the whole of it. `archdia-edit` requires `plantuml`;
  `plantuml` requires `jdk`; `mcp-git` requires `git`; the `agent` plugin, `hybridflow-ui` and
  every skill require `claude-cli`; and each skill requires the plugin it is the half of —
  `archdia` requires `archdia-edit`. A fifth entry, `kind: core`, carries the handful cms-core
  needs whatever the assembly — `git` today — so that a dependency belonging to no plugin still
  has somewhere to be said. **That last edge exists already**, as `pluginOf` in
  `reference/kiao-skills/skills.go`, and the installer acts on it (step 2a); folding it into the
  manifest is a move rather than an invention.
- **`audience: "everyone" | "owner"`** replaces the directory-scan-plus-which-script-calls-it
  rule, for all four kinds at once.

<!-- kiao:diagram
```mermaid
graph RL
  subgraph runtimes[Runtimes]
    uv[uv]; node[Node]; jdk[JDK]; python[Python]
    git[(git)]; plantuml[(PlantUML)]; cli[(Claude CLI)]
  end
  subgraph mcp[MCP servers]
    fetch; duckduckgo; markitdown; papers; mcpgit[mcp-git]; playwright
    sitemcp[a site server]; kfiles[kiao-files]
  end
  subgraph plugins[Plugins]
    archdia[archdia-edit]; claudep[claude]; board[hybridflow-ui]; sitep[its plugin]
  end
  subgraph corefeat[cms-core itself]
    scm["Git tab and diff"]
  end
  subgraph skills[Skills]
    sk["archdia, graph, mindmap,<br/>hybridflow, actlog, …"]
  end

  python --&gt; uv
  fetch --&gt; uv; duckduckgo --&gt; uv; markitdown --&gt; uv; papers --&gt; uv; mcpgit --&gt; uv
  playwright --&gt; node; cli --&gt; node
  plantuml --&gt; jdk
  archdia --&gt; plantuml
  scm --&gt; git
  mcpgit -.-> git
  claudep --&gt; cli; board --&gt; cli; sk --&gt; cli
  sitep -. "same feature" .-> sitemcp

  classDef missing fill:#fde,stroke:#c66,stroke-dasharray:4 3
  class git,plantuml missing
```
-->
![Mermaid diagram 1](kiao-delivered-resources.assets/01-mermaid.svg)

The dashed nodes are the ones that do not exist in any catalogue. `cli` was the third and is now
two rows — `claude-cli` and `codex-cli` — so the edges into it are edges the system can draw;
`git` and `plantuml` are still edges nothing can. `mcp-git` is the renamed MCP
entry: its `id` is prefixed so that `git` can name the binary, while `server: "git"` — what the
CLI sees — stays untouched.

### What falls out of it

1. **Two bash fetches become two recipes.** The PlantUML jar and the Claude CLI binary are
   checksummed downloads of a pinned version, which is precisely what the `temurin` and
   `node-tarball` channels are. `install-kiao-executable.sh` and `build-kiao-image.sh` stop
   holding a pin, a digest, a cache path and a skip flag each, and hold instead a list of ids to
   preinstall. `--skip-plantuml` and `--skip-claude` become the same gesture: leave it off the
   list.
2. **The panel gains a reason, not just a fourth section.** The closure already computed to turn
   *install fetch* into *install uv and fetch, is that alright?* is the same closure that answers
   "archdia-edit is on, but PlantUML is not reachable" and "no skills: there is no Claude CLI on
   PATH". The ledger's third fact generalises from the MCP handshake to a probe per kind — a
   binary on PATH answering `--version`, an HTTP endpoint answering a render.
3. **A site-specific server stops being everybody's.** One `audience` field, read by every build site, settles
   what three mechanisms currently disagree about. **Done, without the field:** the server moved
   to its own package and is overlaid into the staged bundle by the site's own deploys; the base bundle
   and the shared image no longer carry it, and the seed default no longer names it. The toolbox
   catalogue keeps its row, which reads unavailable without the overlay.
4. **No build site holds a list.** A script deriving the dropped-in projects from the directory
   already exists because the list was written by hand once and every build site added afterwards
   was born without it — the server deploy and the installed executable each shipped an assembly
   missing the dropped-in projects, and their files simply opened as code. That fix is right and
   it should cover four kinds, not one.

### Where the manifest lives, and why it has to move

The one genuinely hard constraint: the four kinds are consumed at **three different times**.
Plugins at *bundle build* time, because Vite must know what to compile. Runtimes and MCP servers
at *service run* time, on demand. Skills at *service start* time, written into the Claude home.
A manifest embedded in the Go binary alone therefore cannot serve the plugins.

So the file moves to a neutral module — `reference/kiao-catalog/catalog.json` — with **one source
and three readers**: `//go:embed` into the worker exactly as today, `jq` from the build
scripts, and a Vite plugin at bundle time. This is a move rather than an invention: plugins
already work this way. `src/plugins/catalogue.json` is *already* a build input read by both the
build and the loader; it simply has a file of its own.

### What deliberately does not change

The recipe / channel / platform mechanism is right — it needs more kinds, not a redesign. The
ledger's ownership rule (never remove what this service did not install) and the skills'
`.kiao-skill` marker are the same rule written twice, and become one implementation over four
kinds. Plugin on/off stays store-scoped and needs a reload; runtime install stays machine-scoped.
Plugins stay compiled into the SPA — nothing here makes them load at run time.

**Nor does the bundle grow a second copy of anything.** A skill is installed into two store
directories — `.agents/skills` and `.claude/skills` — by one pass over a list of *targets*. The
dialect turned out to be almost the same one — every CLI reads a front matter of `name` and
`description` — so the difference is rendered on install rather than written twice in
`reference/kiao-skills`: the installed copy gains `metadata.short-description`, the line Codex's
skills catalogue shows, taken from the subtitle of the document's own title, which the other two
read past. The `.kiao-skill` marker rule is unchanged and now per directory, which is what it has
to be: adopting one copy of a skill says nothing about the other.

## 4. Migration, in the order that pays

| Step | Change | Risk | What it buys immediately |
|---|---|---|---|
| 1 | Rename `git` → `mcp-git`; add `git`, `plantuml`, `claude-cli` as runtimes with a **detect-only** recipe (present on PATH / reachable, never installed) | none — additive | three honest rows; the panel can finally answer "why is my diagram blank" |
| 1a | **Done.** `claude-cli` and `codex-cli` are runtimes — with real recipes rather than detect-only, because step 4 came with them | none — additive | two honest rows, and the panel can install either CLI |
| 2 | Add `skill` and `plugin` entries to the manifest and the cross-kind `requires` edges. Files stay where they are; `src/plugins/catalogue.json` becomes a generated view | low | the graph above becomes real; unmet dependencies become reportable |
| 2a | **Done, for one edge.** Every skill names the plugin it is the half of (`pluginOf` in `reference/kiao-skills/skills.go`), and the installer gives a store the skills its `plugins` list calls for — with the tests that keep the ids matching `src/plugins/catalogue.json` | none — the reading fails open in every direction | a store stops carrying nine skills for formats it cannot open; §2.3's skill half, without the manifest |
| 3 | Move the manifest to `reference/kiao-catalog/`; Vite and the build scripts read it. `dashboard-plugin-projects.sh` becomes a filter on `audience` | medium — touches four build sites | one list; a new build site cannot be born incomplete |
| 4 | Fold the PlantUML jar and Claude CLI fetches into checksummed recipes | medium | ~150 lines of bash and two ad-hoc caches deleted |
| 4a | **Done, for the CLIs.** `claude-release` and `codex-release` channels; `bin/build-kiao-image.sh` holds `--preinstall claude-cli[,codex-cli]` and calls `worker toolbox preinstall`. PlantUML is untouched | low, as it turned out — the prefix is the cache and the image copies it whole | ~60 lines of bash, one ad-hoc cache and two flags deleted; the second CLI cost a word rather than a block |
| 5 | Probe per kind; the panel shows the unmet-dependency reason on every row | low | the ledger's third fact, for all four kinds |

**Done, for one row of step 1.** `graphviz` is a catalogue runtime on a `detect` channel: the panel
reports whether `dot` is on the machine and names the system's own install command when it is not,
and never installs anything. It is the row that answers "why is my diagram blank". The `plantuml`
jar as a recipe, and the `git` rename, are still to come.

Steps 1 and 2 are additive and reversible and can be taken in any order against any other work.
Step 3 is the one that touches the build scripts and is the point of no return. Steps 4 and 5 are
what make the first three worth having, and neither is urgent.

What taking 1a and 4a first actually showed: **step 3 was not the prerequisite it looks like.** The
build script reads the manifest through `worker toolbox preinstall` rather than through `jq`,
so the one source stayed embedded in the Go binary and the build site still holds no pin. Moving the
file to `reference/kiao-catalog/` remains the right step for the *plugins*, which Vite has to read
at bundle time and a subcommand cannot serve — but nothing about a runtime or an MCP server needs
it. Step 3 is one reader's problem, not three.

## 5. What this does not solve

**An agent CLI installed by the panel is not on the agent half's PATH — except in the image.** The
two halves reach a binary by different routes: the toolbox looks in its prefix first and PATH after,
while the hybridflow-runner half spawns a bare `claude` or `codex` and lets the process PATH resolve it. In the
image those agree, because the prefix's `bin` is on `PATH` in the Dockerfile; on a machine whose
prefix is `~/.local/share/kiao/toolbox` they do not, so a CLI installed from the panel is a row
that reads `installed` and an agent tab that still has nothing to spawn. The fix is the one step 5
is already about — a lookup the hybridflow-runner half asks the toolbox rather than PATH — and it is
deliberately not a PATH the service rewrites for itself at startup, which would change what every
tool a turn runs resolves to.

**Resolved for the native shapes, the image's way rather than step 5's.** The launcher hands its
worker child a PATH with the prefix's `bin` ahead of it (`pathWithToolbox`,
`bin/kiao-launcher/service.go`), and `bin/local-start-kiao.sh` exports the same — which is what the
Dockerfile does one level down, now done by whatever starts the service rather than only by the
image. The service still does not rewrite its own PATH: it is given one, by the half that knows
where the panel was pointed, which is the same half that sets `KIAO_WORKER_TOOLBOX_PATH` two
lines above. **The consequence the paragraph above names is accepted, not avoided:** a runtime the
panel installed now shadows the machine's own for every tool a turn runs under `kiao`, exactly
as it has always done in the image. Step 5's lookup remains the finer answer — it would offer the
agent without touching what a turn resolves — and is still worth doing; this is what makes an agent
installed from the panel work on a laptop today. A server unit is not covered: it has no `PATH=` line
and its systemd default does not even carry `~/.local/bin`, so an agent installed from the panel
there still needs one written into `kiao-worker.service`.

**Since this was written**, the image is the runtime that depends on it: it now ships *no* agent CLI
and expects both to be installed from the panel, which works there and only there. Three things came
with that. Whether an agent is offered is read per request rather than fixed at startup — the
deployment's veto, the CLI on PATH, and the row's switch — so an install shows up on the next page
load. The row's `registered` field gained a second meaning, *offered in the agent tab*, which is the
control for a CLI the panel did not install and therefore cannot remove. And the toolbox calls back
into the hybridflow-runner half after installing one (`OnAgentInstalled`), because the pass that fills the
store's skills directories used to run only at startup — the first thing this document says a skill
depends on is a CLI that until now could not arrive while the service was up.

**The document store calls back for the same reason**, through the same shape
(`OnDashboardConfigSaved`): a skill's other dependency is the plugin it is the half of, and that one
is switched in the panel, on a store that is up. So the two edges into the skills pass are the two
things a skill depends on, each announced by the half that owns it.

Audience is binary here (`everyone` / `owner`) because that is the only distinction the builds
actually make today. If a third party ever gets a build, it becomes a set rather than a flag, and
the manifest is the right place for that to happen — but declaring it now would be inventing a
requirement.

Nor does this unify *the installers*. A plugin is compiled in, a skill is copied out of a binary,
an MCP server is fetched from a package index. Those stay three mechanisms, correctly. What
becomes one is the **declaration** of what exists, what it needs, who gets it, and whether it
works.
