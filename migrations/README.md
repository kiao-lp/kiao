# File-store migrations

The common worker runs independent, named sources before serving requests. The assembly selects
one base source and any additional sources. All pending base scripts run first; additional sources
run in manifest order, each in ascending numeric version. Versions in different sources may overlap.

The active base source is **`kiao`, baseline 18 (2026-10-20)**. V001–V018 are retired; no content
migration is currently active. The next base migration is **V019**, never V001 again.
See [the cutover](cutover-2026-10-20.md) for the inventory, supported starting point and older stores.
[Maintained examples](history.md) capture the retired base transformations.

## Configuration and identity

Use `KIAO_WORKER_MIGRATIONS_PATH=/absolute/source` for one base source, or
`KIAO_WORKER_MIGRATIONS_SOURCES=/absolute/sources.json` for an assembly. Setting both is an error.
Empty settings disable discovery. `KIAO_WORKER_MIGRATIONS_ENABLED=false` disables the whole runner.
A configured source that is missing or malformed aborts startup; it never silently becomes empty.

An assembly manifest contains:

```json
{"base":"./base","additional":["./extension"]}
```

Paths are relative to the manifest (absolute paths are also accepted). Each directory contains
`source.json`, for example:

```json
{"id":"extension","baseline":0}
```

An ID matches `[a-z][a-z0-9._-]*`. It names the history, independent of its checkout, install or
assembly path. Duplicate IDs or directories are errors. Keep the ID when relocating a source;
never reuse an ID for a different history. Removing a source from an assembly retains its ledger,
so adding it back resumes that same history. A new source starts at its declared baseline.
Additional sources do not inherit the base version, including when first added to an existing store.
Source declarations and their delivery belong to the assembly; the worker knows no extension names.

`baseline` is the highest retired version. Scripts at or below it are forbidden on disk. It is a
release boundary, not an author-controlled way to skip a failed migration. Changing a recorded
baseline requires a separate coordinated cutover; normal startup refuses a mismatch.
`legacyLastScript` is reserved for the base source's documented flat-ledger transition.

## Execution and ledger

Only regular files directly in a source named `V<positive integer>__<name>.js` are discovered.
Directories, examples, tests and the template are not migrations. Duplicate numeric versions within
a source are errors, including differently padded spellings of the same number.

```sh
node V019__example.js <absolute-data-root>
```

The working directory is the store root. Environment:

| Variable | Value |
| --- | --- |
| `KIAO_DATA_ROOT` | store root, also argv[2] |
| `KIAO_MIGRATION_SOURCE` | stable source ID |
| `KIAO_MIGRATION_VERSION` | version within that source |
| `KIAO_MIGRATION_LIB` | base source's `lib/`, including in installed deliveries |

Keep additional helpers in the source's own `lib/` and require them relative to the script.
Use `KIAO_MIGRATION_LIB` for shared helpers. A manual run must supply that variable when needed.
Shared helpers must remain compatible with all active scripts; do not change their meaning under an
already-applied migration. A changed script includes changed comments in its SHA-256.

`<state>/files-migrations.json` has format version 2, a store root and a `sources` map. Each source
records `baseline`, `schemaVersion` and its own `applied` entries (script, name, SHA-256, time,
duration). A missing ledger means the operator selected the supported baseline; it is **not** an
upgrade route for unknown old content. A ledger for another store is refused. To rehearse a copied
store, explicitly rebind **the copied ledger's** `dataRoot` to the copy; do not point a rehearsal at
the original state directory.

One `files-migrations.lock` covers discovery, loading/converting the ledger, validation, all sources
and persistence. The serving process also holds `state.lock` for its lifetime. Every configured
source is checked before any script runs. A successful script is recorded immediately by atomic
replacement of the ledger. Startup also persists new sources and compaction when no scripts run.

A nonzero exit or timeout stops the entire batch; later versions and sources stay pending. The
per-script timeout is `KIAO_WORKER_MIGRATIONS_TIMEOUT_SECONDS` (600 by default). With
`KIAO_WORKER_MIGRATIONS_FAIL_ON_ERROR=false`, script/runtime/checksum failures warn and permit
service startup, **without continuing the batch**. Invalid configuration, corrupt/unsupported
ledgers, stale retired scripts and ledger-write failures always abort. A failed script, or one
whose success was not durably recorded before a crash, runs again: scripts must tolerate partial
writes. This is not a transaction across content and ledger.

Applied scripts must remain present and byte-identical; inserted versions below the current version
are errors. Fix an applied migration in a new version. **The sole exception is an explicit history
retirement delivered with a checked baseline transition:** replace all active script directories,
rehearse on copies, compact the corresponding history, verify restarts and preserve the knowledge.
Never delete/reset a live ledger while the retired scripts are discoverable. Git history and
hybridflow-store's independent PostgreSQL migrations are unaffected.

For a stopped store, `worker migrate-files` uses the same configuration and locks, runs only the
file migrations, and exits. It requires enabled, configured sources; it starts no service or skill
synchronization. Use the same default fatal policy for rehearsals and cutovers.

## Authoring

1. Select the source and use its next unused number **above its baseline** (base: V019).
2. Copy [the template](migration-template.js). Select by document shape, not filename alone.
3. Use `loadIgnore(root)`/`scan(...)` for `[migration]` exclusions. Never rewrite arbitrary reachable
   files or blindly replace substrings. Ask with the path list if content identity is uncertain.
4. Leave unrelated, invalid and already-current documents unchanged. A second run must preserve
   their bytes. Report changed paths/counts, unresolved references, collisions and skipped shapes.
5. For renames use [the shared link fixer](lib/link-fix.js): only leading-slash tokens, raw and
   percent-encoded spellings, token boundaries and child suffixes. Relative Markdown destinations
   stay relative. Newly introduced spaces in inline destinations are escaped; JSON paths stay raw.
   Decide collisions **before** rewriting links, then rewrite links before moves so retries can
   reconstruct unfinished moves. Never overwrite an occupied destination.
6. Add focused fixtures/tests under `test/` and pin the script in `test/active-checksums.json` before
   delivery. Applied scripts and their meaning are immutable outside the coordinated exception above.
7. Rehearse on a copy of a real store, read the content diff, exercise a failed run and restart.

```sh
node --test migrations/test/*.test.js
cd operation/worker && go test ./internal/files/
```

`bin/stage-file-migrations.js <sources.json> <destination>` stages only source declarations, active
scripts and `lib/` dependencies, with a relocatable assembly manifest. It replaces the destination
in full after validation. Tests, documentation and examples never enter deployed discovery.
The executable installer accepts `KIAO_MIGRATIONS_ASSEMBLY`; otherwise it stages the base assembly.
Local startup enables the configured assembly as before. The executable requires `--migrations`;
the Docker image requires an explicit path/manifest setting. Neither target opts in during install.

## `.kiao-files`

A folder's declaration of what, in it and below, is not KIAO content. It is the answer to the
section above from the *deployment* side: the person who chose the store root is the one who knows
which parts of it are content and which are a source tree that happens to live there, and no amount
of care inside a script can know that.

It can sit in **any directory**, and covers that directory and everything below it — so a repository
living inside a store carries its own next to its `.gitignore`, and a store that is several
unrelated repositories, or no repository at all, is still declared correctly. A nested file adds to
what its ancestors said; nothing can re-include what an ancestor excluded.

worker seeds one at the store root on first start, with the common machinery names **already
in force** — unlike the `migration-ignore` it replaces, which was seeded fully commented out. The
asymmetry is deliberate: a migration that rewrites too much costs a restore from git, while an
exclusion that is too broad costs some links not being updated. Only the first is worth making an
operator opt in to. Once the file exists it is the operator's, and the service never rewrites it.

The runner cannot enforce any of it — a migration is a Node script with full filesystem access.
Normal startup logs the declarations; scripts must report their own scope, and the helpers honour it:
`scan()` skips declared files and does not descend into declared directories, and `loadIgnore()`
gives a hand-rolled walk the same matcher. Nothing names the file to a script any more: it has a
fixed name at a known place, so `KIAO_DATA_ROOT` is all a script needs to find the whole set.

### Three concerns, declared separately

Three things walk a store on their own, and a folder can be out of bounds for one and not the
others:

| Section | Bounds |
| --- | --- |
| *(before any section)* | all of them |
| `[migration]` | file-store migrations |
| `[refactor]` | link updates after a rename or a delete (worker's link fixer) |
| `[search]` | search, and the scope a delete reports before it asks for confirmation |

The first two rewrite files nobody asked them to touch. `[search]` does not: it bounds the walks
that answer a question about one folder by reading everything under it, where an undeclared build
tree or network mount costs time and a useless answer rather than a restore from git. It is named
for search because that is what an operator whose store has become slow goes looking for; the delete
scope rides with it because it is the same walk into the same folder nobody meant to include. Only
worker consumes it — a migration is not a search — but a rule written before any section
bounds it, which is why a store that already declared its `node_modules` gets a faster search
without editing anything.

**A folder that is excluded is still walked when it is the folder that was named.** A search of a
declared `vendor/` searches it, a delete of it describes it in full, and a migration pointed at it
by hand is the operator's business; the exclusion keeps a pass out of the folders nobody pointed it
at, not out of the one that was pointed at. That is what keeps an exclusion from becoming a folder
nobody can ever look inside — the rest of the declaration still applies within it.

An unknown section is parsed and never consulted, so a later consumer can be added without breaking
a service that predates it.

### Syntax

A deliberately small subset of `.gitignore`:

| | |
| --- | --- |
| `# comment`, blank line | not a pattern |
| `node_modules` | no `/` in the pattern: matches at **any depth** |
| `build/generated` | contains a `/`: **anchored** at the declaring folder |
| `vendor/` | a trailing slash is decoration — the same rule as `vendor` |
| `/vendor` | a leading slash is what anchors |
| `*.generated.json` | `*` matches within **one** path segment — there is no `**` |
| `.*` | how a declaration excludes dot-directories |
| any directory match | covers everything under it |
| `/` alone | covers the whole folder: nothing in it is content |

There is **no negation** (`!`) and no character class. Matching is case-sensitive, and paths are
compared relative to the declaring folder, with forward slashes.

The grammar is read by two implementations — [`lib/kiao-fs.js`](lib/kiao-fs.js) here, and
`files/kiaofiles.go` in worker, which bounds the link fixer, search and the delete scope with
it. They are pinned to each other by a shared table of cases,
[`test/kiao-files-corpus.json`](test/kiao-files-corpus.json), that both test suites read. **A change
to the grammar goes there first.**

### The worked example: this repository

**This checkout is itself a supported store root** — [`bin/local-start-kiao.sh`](../bin/local-start-kiao.sh)
may serve it with the migration runner enabled. So the checkout
carries its own declaration, committed, at [`.kiao-files`](../.kiao-files):

- the seeded machinery defaults, which is what keeps a rename here from reading 13,000 files;
- a `[migration]` section holding a single `/` — nothing here is migrated. The files in the tree
  that carry an extension the store owns are not store content: the e2e fixtures the suite
  asserts against, and the architecture documents authored here. The file explains what that rule
  costs and how to run a migration over `docs/` deliberately when one is ever needed;
- a `[refactor]` section naming the fixture and example trees alone. Link updates *do* run here:
  renaming a document under `docs/` should fix the references to it, which is a large part of what
  this checkout is used to author;
- no `[search]` section: the fixtures and examples are worth finding, and the machinery defaults
  above already keep a search out of `node_modules`, `target` and the rest.

That split is the point of having sections at all. The single-concern `migration-ignore` this
replaces could not express it — a `/` that switched migrations off switched everything off.

Reuse the shape for any store that is not purely content:

```
# A mixed store: units and notes are content, the rest is a source tree.
node_modules
vendor/
exchange/

[refactor]
samples

[search]
# A network mount: searching it from the root would go out over the wire. Searched directly,
# it still answers.
archive
```

### Migrating from `migration-ignore`

The declaration used to be `<state-path>/migration-ignore`, inside the service's own state
directory, and answered for migrations alone. worker converts a store on first start: it
writes `.kiao-files` with the defaults, appends the legacy patterns verbatim under `[migration]`,
and removes the old file — a declaration nothing reads any more is a file someone will keep editing.
Both steps are logged, with both paths. A store that has not been converted yet is still honoured as
it stands, so a migration run by hand on one behaves the same.
