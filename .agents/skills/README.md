# Skills for developing this tree

`verify`, `hexarch`, `markdown-anchors`, `dashboard-plugin` and `file-actions` are about
working on *this tree* — launching the stack to check a change, the layering rules the
services follow, the anchor-link syntax markdown documents here are written
with, how to write a Dashboard plugin, and how to add a worker file action. They are read by an
agent session opened in this checkout, whichever agent it runs, and they ship nowhere.

All but `verify` have a second entry under `.claude/skills/`, because Claude reads only
that directory. Same front matter, body points back here. `verify` needs none: AGENTS.md
tells the session to read it by path.

## The format skills live beside these

`actlog`, `archdia`, `template-lang`, `featmat`, `graph`, `mindmap`, `passage-link`,
`strategy` and `hybridflow` are installed here at every KIAO start from
**[reference/kiao-skills/](../../reference/kiao-skills/README.md)**, which is also where they are edited. They are the counterpart of
the Dashboard plugins that edit those formats: the plugin is how a human writes one of these
files, the skill is how an agent tab does.

An assembly can add its own skills through `KIAO_WORKER_SKILLS_PATH`; their masters live with
that assembly. The installed marker and footer name the right source for each skill.

Which of them a store gets is that store's plugin list: switch a plugin off in the Configuration
panel and its skill is removed, because a store that cannot open the format has no use for a
description read at the start of every turn.

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
