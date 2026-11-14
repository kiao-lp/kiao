---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
status: "partially superseded by ADR-00068 (client authorization)"
date: 2026-08-31
tags: ["security", "premise", "runtime", "worker", "dashboard"]
triggers: ["sandbox", "isolation", "bypass permissions", "trusted folder", "confirmation", "reader role", "scope not sandbox", "KIAO_WORKER_CLAUDE_BYPASS_ENABLED", "core.ResolvePath", "resolveClaudeFolder", "--add-dir", "files_reader"]
supersedes: []
superseded_by: ["00068"]
---

# 00015 — One person owns system everywhere KIAO runs.

## Context and Problem Statement

KIAO's execution and filesystem features assume the prompting person owns the installation
and machine. Treating that owner as an untrusted second operator would contradict those features.

## Considered Options

* Apply the one-person ownership premise in every runtime.
* Treat the image as a partial exception to that premise.

## Decision Outcome

Chosen option: "Apply the one-person ownership premise in every runtime", because server
and container ownership do not create another operator to protect against.

Every installation, container started from `kiao`, and turn command serves one person who
owns both worker's root and the system. Do not add per-user isolation, root sandboxing or
confirmation justified only by access outside the store. `CLAUDE.md` records this premise.

It accounts for default bypass (`KIAO_WORKER_CLAUDE_BYPASS_ENABLED`), a turn folder being
a scope with the store supplied through `--add-dir`, absolute `Read` / `Bash` paths,
and removal of the trusted-folder registry. `core.ResolvePath` and `resolveClaudeFolder`
still follow symlinks and check the root: escaping paths are caller bugs and execution
must begin in the expected folder.

Read-only clients remain outside this premise: `files_reader` and
`KIAO_WORKER_READER_ROOTS` are real boundaries. Credentials, SSH remotes, `git push`
and deployment also reach systems whose ownership is separate.

## More Information

The client exception above is historical. [00068](00068-owner-access-from-every-application.md)
replaces it with full owner access from every application. The ownership, path checks and
outward-credential rules remain applicable.

The same-day amendment on 2026-08-31 removed the image exception. Published ports justify
its defaults—bypass off and closable sign-in endpoints—rather than restricting the owner's
features. Those defaults remain changeable. The software-installation configuration panel
is available in all three runtimes.
