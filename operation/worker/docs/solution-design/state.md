---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Operational state

← [worker](../../README.md).

[Filesystem state primitives](../../internal/core/filesystem/state.go) and
[application startup](../../internal/app/main.go) own the directory lifecycle.
Each service family owns its persisted documents; see [Components](./components.md#state-and-access).

## Service state

Operational state includes the migration ledger (`files-migrations.json` and its
`files-migrations.lock`), conversation registry, process lock and Dashboard config documents.
It lives under `KIAO_WORKER_STATE_PATH`, which defaults to `<root>/.kiao-config`.
The default associates state with its store: two stores on one machine have separate ledgers
and registries, and moving or copying a store takes its state with it. Wiping and re-cloning
also removes that state; a deployment that needs it to survive sets the variable outside the root.

Inside the root, the service seeds a `.gitignore` containing `*`, keeping transcripts and prompt
text out of Source Control and published stores. It writes this file only when absent, preserving
the operator's edits on restart. Independently, `Storage` refuses paths into the state directory
(`filesystem.ErrStatePath` → `400`), so no file-API client can read, rename or delete its registries.
Listings, search, link repair and delete-scope walks omit it. Automatic-pass exclusions for the
rest of the store belong to [`.kiao-files`](/migrations/README.md#kiao-files).

## Persistence and locking

Registries use temp-file + fsync + rename replacement, so readers see one whole document or the
other. The shared writer does not fsync the directory; a power loss may lose the last write.
The process holds an exclusive `flock` on `state.lock` for its lifetime. Atomic replacement alone
would let two processes discard each other's registry updates; the second instance instead fails
startup with a message naming the path. The kernel releases the lock on process death, so a
refusal indicates a live second instance rather than a lock left by a crash.

## Legacy state adoption

Startup moves `<root>/.kiao/conversations`
into the state directory and adopts `<root>/config/quickcms.json` and
`quickcms-view-state.json` as `dashboard.json` and `dashboard-view-state.json`.
Within the state directory it also renames `quickcms.json`, `quickcms-view-state.json` and
`quickcms-view-state-small.json` to their Dashboard equivalents. These operations run under the
state lock, before file-store migrations. Existing destinations win; conflicts and move failures
are logged for the operator and do not fail startup. Cross-filesystem moves fall back to copying
with the source permissions retained.

`claude-trust.json` is retired generated state and is removed with a log entry. The `.kiao`
directory is pruned only when every remaining entry is a known generated leftover; unknown files,
including a `migrations.json` ledger, keep it intact. File-store ledgers follow the separate
[migration baseline and upgrade contract](/migrations/cutover-2026-10-20.md).

The adoption implementation is [state_legacy.go](../../internal/app/state_legacy.go).
The [config-document contract](../../PROTOCOL/config-documents.md) owns allowed names and save effects;
[deployment configuration](./configuration.md) owns environment defaults and validation.

## Harness vocabulary adoption

Before runner initialization, `assembly.AdoptHarnessState` upgrades the runner's owned
conversation metadata, common turn traces and chain logs to the `harness` field. A captured
workflow agent publication retains its `agentId` and version and uses `harness` for its
execution tooling. Transcript text and native session files keep their contents.

The same pass moves `agent-profiles.json` to `harness-profiles.json` and `agent-secrets/` to
`harness-secrets/`. An occupied destination stops startup before either move. Atomic writes
preserve file permissions. `harness-state.json` records successful version 1 adoption, so
subsequent starts do not rescan history. A failed pass can be retried.
