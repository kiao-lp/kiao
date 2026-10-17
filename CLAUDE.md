# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working with code in this tree — and only what is
specific to it. Start with [AGENTS.md](AGENTS.md): everything common to all agents lives there.
What follows assumes it.

## The verdict hooks

Three hooks in `.claude/settings.json` — `SessionStart`, `UserPromptSubmit` and `Stop` — call
`e2e/bin/run-tests.sh --announce-hook`, which is the e2e verdict delivered rather than fetched: a
Claude turn is *told* that a run it started earlier has ended, once, and only if something changed.
It is as close to a callback as this environment permits. Dashboard runs `claude --print --resume`
afresh for every message, so the process that started a run is already gone when the run ends and
nothing can be delivered *to* it. What is left is to catch the next moment a turn is there to be
told, and the three events are three such moments: on the way into a session, on the way into a
turn, on the way out of one.

`SessionStart` alone only ever caught a run that outlived its whole session, leaving the ordinary
case — started and finished between two messages of one open session — announced to nobody.
`UserPromptSubmit` closes that, but only when the user says something: until then the verdict still
waits. `Stop` is what makes a turn pick a finished run up on its own, and it is the awkward one,
because injected context is no use at a Stop — the turn is over and there is nothing left to read
it. The turn has to be *made* to carry on, which means returning a block decision.

A hook that blocks every Stop is a session that never ends, so the block is fired only with a
verdict in hand — a run that has ended and has not been announced — under two guards. `announced=1`
is written before the decision is returned, so whatever the turn does next, the second Stop finds
the verdict spent. `stop_hook_active` says the turn is already continuing *because* a stop hook
told it to, and is never blocked again: belt to the other's braces. Everything else returns
silently without spawning anything — no run, a run in flight, a verdict already delivered — which
is almost every turn, at about ten milliseconds.

A run still in flight is reported by the two context hooks every turn, without being marked
announced, so nobody starts a second one over the top of it. `Stop` stays quiet about it: an
unfinished run is no reason to hold a turn open.

All three share one command, and what it answers with depends on which event fired — the context
JSON is only honoured when it names that event — so `--announce-hook` reads `hook_event_name` off
the payload on stdin rather than assuming one.

## A turn's scope

**Bypass permissions** is on by default where the machine, the store and the person prompting are
the same party: a turn's folder is a scope and not a sandbox, the whole store going to the CLI as
`--add-dir`; `Read` and `Bash` reach whatever the service user can. `core.ResolvePath` and
`resolveClaudeFolder` stay strict for a different reason: a path leaving the store is a bug in the
caller, and a store symlink pointing out of the tree would put a process somewhere nobody asked
for.

The `kiao` image shipping `KIAO_WORKER_CLAUDE_BYPASS_ENABLED=false` is a *default*, not
an exception to the premise: it is a good first answer to "who is likely at the other end of this
published port", and it is one click to change.

## The installed skills are not the source

A Claude turn asked to change a shipped skill lands on `<store>/.claude/skills/` — the generated
copy — and an edit there achieves nothing, silently: it is rewritten at every KIAO start. Edit
`reference/kiao-skills/<name>/SKILL.md` instead, as [AGENTS.md](AGENTS.md) says.
