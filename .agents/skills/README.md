---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Skills for developing this tree

`verify`, `hexarch`, `dashboard-plugin` and `file-actions` are about
working on *this tree* — launching the stack to check a change, the layering rules the
services follow, how to write a Dashboard plugin, and how to add a worker file action. They are
read by an agent session opened in this checkout, whichever agent it runs, and they ship nowhere.

All but `verify` have a second entry under `.claude/skills/`, because Claude reads only
that directory. Same front matter, body points back here. `verify` needs none: AGENTS.md
tells the session to read it by path.

## The format skills live beside these

`actlog`, `archdia`, `template-lang`, `featmat`, `graph`, `mindmap`, `markdown-anchors`,
`markdown-metadata`, `markdown-passage-link`, `kiao-adr`, `strategy` and `hybridflow` are installed here at
every KIAO start from **[reference/kiao-skills/](../../reference/kiao-skills/README.md)**, which
is also where they are edited. Most correspond to a Dashboard plugin; `kiao-adr` describes
decision records independently of plugins.

An assembly can add its own skills through `KIAO_WORKER_SKILLS_PATH`; their masters live with
that assembly. The installed marker and footer name the right source for each skill.

See the catalogue for installation policies: independent skills are always delivered;
plugin-specific skills follow the store's plugin list.

They are kept there rather than here because anyone running KIAO over any folder should get
them, not just someone working inside this checkout. What the installer wrote is generated —
an edit to it is lost at the next start — and carries a `.kiao-skill` marker saying so, with
its `SKILL.md` ending in a comment naming the source. The installer leaves these three alone:
a directory with no marker is nobody's business but its owner's.

Which leaves two copies that are not the source, and neither is the one to edit:

| Where | What it is |
|---|---|
| `reference/kiao-skills/<name>/` | **the source — edit this** |
| `<store>/.agents/skills/<name>/` | installed from the binary, rewritten at every KIAO start |
| `<store>/.claude/skills/<name>/` | the same, second copy — Claude reads only that directory |
