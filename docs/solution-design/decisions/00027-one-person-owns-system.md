---
id: "00027"
title: "the person prompting owns the system, everywhere KIAO runs"
status: accepted
date: 2026-08-31
tags: ["security", "premise", "runtime"]
components: ["worker", "dashboard"]
paths: []
symbols: ["KIAO_WORKER_CLAUDE_BYPASS_ENABLED", "core.ResolvePath", "resolveClaudeFolder", "--add-dir", "files_reader"]
triggers: ["sandbox", "isolation", "bypass permissions", "trusted folder", "confirmation", "reader role", "scope not sandbox"]
supersedes: []
superseded_by: []
---

# 00027 — the person prompting owns the system, everywhere KIAO runs

**Decision:** state as a premise that the KIAO VPS, the KIAO on it, every container started from
the `kiao` image and every command a turn executes are used by **one person, and that the
worker root and the system belong to that person**. Nothing in KIAO defends the store, the
filesystem or the machine against the person prompting: no per-user isolation, no sandboxing of the
store root, no confirmation whose only justification is that a command could reach outside the
store. Written up in `CLAUDE.md` ("One person, everywhere") because it shapes every future change.

**Why:** the choices already made only read as coherent under it. Bypass permissions is on by
default (`KIAO_WORKER_CLAUDE_BYPASS_ENABLED`), a turn's folder is documented as *a scope,
not a sandbox* with the whole store handed over as `--add-dir`, `Read` and `Bash` take absolute
paths and reach whatever the service user can, and the trusted-folder registry was removed rather
than maintained. Read without the premise, each looks like a gap somebody should close, and closing
any of them would cost the tool its point while protecting no one. The strictness that remains —
`core.ResolvePath`, `resolveClaudeFolder` following symlinks and re-checking against the root —
stays for coherence, not for defence: a path that leaves the store is a caller bug, and a process
started outside the tree is a surprise nobody asked for.

**What it does not cover, and the distinction is *user* versus *reach*.** The podcast player's
listeners are not that person: `files_reader` and `KIAO_WORKER_READER_ROOTS` face them and
remain a real boundary. Likewise, everything the machine can reach *outward* — a credential on the
dev volume, an ssh remote, a `git push`, a deploy — deserves the same care as before; owning the
machine says nothing about owning what it talks to.

**Amended 2026-08-31, same day: the premise holds in all three runtimes, without qualification.**
This record first said the image was a partial exception, on the grounds that a published port can
be reached by someone who is not its user. That is a reason for the *defaults* the image ships —
bypass off, the sign-in endpoints closable — and it was wrongly written as a limit on the premise
itself. It is not one. The VPS is owned and used by one person; the image is meant to be started on
a system that person owns, in a container that person owns. So a feature is not withheld from a
runtime on the grounds that the runtime might have another user, and the configuration panel below
— which installs software on the machine — is offered on all three. The image's defaults stay as
they are: a default is a good first answer to "who is likely at the other end of this port", and it
is one click to change.
