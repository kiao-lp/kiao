# kiao-skills — the skills an agent tab is given

Agent skills that teach an assistant the document formats the store holds — the DCMS formats
below, the hybridflow boards, and the one convention that is not a format — how a link names
a passage of a document. Each directory is one skill: a
`SKILL.md` with the front matter the CLIs read, plus whatever else it needs beside it.

| Skill | Teaches | Edited in Dashboard by |
|---|---|---|
| `actlog` | `.actlog.jsonl` and its `config.json` — daily activity logs | `activity-log` |
| `archdia` | `.arch.md` — architecture diagrams, PlantUML source with free positioning | `archdia-edit` |
| `template-lang` | `.temp.md` — the template engine and Kiao Expression Language | `template-edit` |
| `featmat` | `.fmat.json` — MoSCoW-weighted feature matrices | `featmat-view` |
| `graph` | `.graph.json` — directed node-and-edge diagrams | `graph-edit` |
| `mindmap` | `.mmap.json` — free-positioned notes and the relations between them | `mindmap-edit` |
| `mlunit` | `.mlunit.json` — how a unit is titled, and the folder that title names | `unit-edit` |
| `passage-link` | `#text=…` links that name a passage of a markdown document by quoting it | `markdown-edit` (the preview's right-click) |
| `strategy` | lever-to-objective modelling, a layer over `graph` | `graph-edit` |
| `hybridflow` | the boards, their columns and their cards — read and written over the hybridflow-store API | `hybridflow-ui` |

They are the counterpart of those plugins: the plugin is how a human writes one of these files — or,
for `passage-link`, copies one out of a preview — and the skill is how an agent tab does.

## A store gets the skills its plugins call for, and no others

That last column is not a cross-reference: it is the switch. A store that has switched a plugin
off has nothing that opens the format its skill is about, so the skill is not installed there —
and one already installed is removed at the next pass. Switch the Units plugin off and `mlunit`
goes; switch Graphs off and both `graph` and `strategy` go, since a plugin may be the other half
of more than one.

What that saves is not disk. A skill's `description` is read at the start of every turn, and the
dozen phrases `.mlunit.json` triggers on are a dozen phrases of a turn's attention spent on a
document kind that store cannot open.

The list is `plugins` in the store's `dashboard.json`, the same one the Configuration panel writes,
and saving it reinstalls the skills — so switching a plugin takes effect on the next turn rather
than at the next restart. Every way of *not* answering means every skill: a store with no
configuration document, one written before the plugin list was a store's to choose, and one whose
document cannot be read all get the whole bundle. An **empty** list is an answer, and it is
honoured.

The mapping is `pluginOf` in `skills.go`, because it is the pair's fact rather than either half's —
a skill says what it teaches, and which plugin writes that format is not something the `SKILL.md`
a CLI reads should have to carry. `go test ./reference/kiao-skills` checks both ends of it: every
skill here names a plugin, and every plugin named is one `exchange/dashboard/src/plugins/catalogue.json`
still carries.

## Why they are here and not in this checkout's `.agents/skills/`

Because of where they have to end up. Anyone running KIAO over any folder should get these skills,
not just someone working inside a checkout of this repository.

So the service installs them into the store being edited at every start — `<store>/.agents/skills`
for Codex and Muse, `<store>/.claude/skills` for Claude, which reads only that directory — as many
of them as that store's plugins call for, and this directory is the one place they are kept.
`.agents/skills/` still holds the skills that are about *developing this repository* (`verify`,
`hexarch`, `markdown-anchors`) — those are not part of what KIAO ships, and the installer leaves
them alone.

## How they get there

The directory is a Go module whose only job is to carry the tree into the binary that installs it:

```go
//go:embed all:*
```

`operation/worker/internal/hybridflow-runner/skills.go` writes them out at every start. Embedded rather
than staged beside the binary because kiao starts four ways — a server unit, `bin/local-start-kiao.sh`,
the `kiao` executable and the Docker image — and each would otherwise need its own copy step and
its own path to point at. In the binary, they travel wherever it does.

Nothing else in the repository builds this module. `bin/build-reference.sh` does not touch it: it is
compiled as a dependency of the worker, like any other Go package.

## Adding or changing a skill

Create a directory here with a `SKILL.md` in it, and name its plugin in `pluginOf` — the embed
pattern needs no editing, and the service installs whatever is bundled the next time it starts.
Four things are checked by `go test ./reference/kiao-skills`:

- a directory is only treated as a skill if it holds a `SKILL.md`;
- the `name:` in that front matter matches the directory name, because a skill is *installed* under
  its directory name and *invoked* by its front-matter name;
- every skill names a plugin — one that does not is installed in every store, which is the right
  way round for an oversight and the wrong one for a rule;
- every plugin named is still in the Dashboard catalogue, since a skill naming a plugin that has
  been renamed away is never installed again, in any store, and nothing at run time would say so.

An edit here reaches a running instance once the worker is rebuilt and restarted. A change
to which *plugins* a store loads reaches it at the save, without a restart.

## Edit here, not in the store's `.agents/skills`

That one is the copy KIAO installs, and it is generated — as is the second copy in
`.claude/skills`. An edit made there is undone at the next start and reported in the log with the
source path: the marker (`.kiao-skill`) records both the version the copy came from *and* the
tree as it was written, so a hand edit is told apart from a new release rather than surviving
quietly until one happens. The installed `SKILL.md` ends with a comment saying the same, because
a turn running over an unrelated store cannot reach this repository at all and is better off
knowing that before it starts.

A directory carrying no marker is nobody's business but its owner's — it is reported and left alone
— so deleting the marker is how someone keeps their own edits to an installed skill.

Before this the skills were installed into the agent homes (`~/.claude/skills`,
`~/.codex/skills`, `$XDG_CONFIG_HOME/muse/skills`). The first start after the move removes
whatever the service wrote there, so no stale copy shadows the store one.
