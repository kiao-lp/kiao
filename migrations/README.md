# File-store migrations

Versioned scripts that rewrite the content of a Dashboard store in place, run once each, in order, by
worker at startup ([`files/migrations.go`](../operation/worker/internal/files/migrations.go)):

```
node V<NNN>__<name>.js <data-root-abs-path>     # cwd = data root
```

with `KIAO_DATA_ROOT` and `KIAO_MIGRATION_VERSION` in the environment.
Exit 0 records the script in the ledger at `<state-path>/files-migrations.json`; a non-zero exit
aborts startup by default. The same script can be run by hand, exactly as the runner runs it.

**The tree ships seventeen scripts.**
[`V001__rename-root-folders.js`](V001__rename-root-folders.js) renames `qd-notes` to `docs` and
`config` to `kiao-user-config` at the store root, and rewrites the links into them.
[`V002__tasks-boards-to-workflow.js`](V002__tasks-boards-to-workflow.js) turns a task board that was
a folder of `.tasks.md` column files into the single `.workflow.json` document that replaced it,
minting a UUID for every column and every task; the reading of the old format is
[`lib/tasks-to-workflow.js`](lib/tasks-to-workflow.js), kept identical to what Dashboard used to do.
[`V003__unit-links-by-path.js`](V003__unit-links-by-path.js) turns a unit's references to other
units — the `members` of a sommaire, and the `unit::` scheme in text — from docIds into the path of
the referenced document, resolved through an index of the store built in one walk; an id the index
cannot resolve is left alone and reported, because guessing a path from a docId is the derivation
this migration exists to remove.
[`V004__mindmap-binary-relations.js`](V004__mindmap-binary-relations.js) makes every mindmap
relation join exactly two notes: a relation of more ends becomes one relation per pair, hung off
the end nearest where the lines used to meet; a relation of fewer is dropped, having never been
drawable; and an `attachPointNumber` outside the twelve places around a note — the `99` an old
command wrote — is taken off, the field having no value meaning "none" any more.
[`V005__mindmap-straight-relations.js`](V005__mindmap-straight-relations.js) finishes the same job:
every mindmap relation is drawn as a straight line now, and none of them carries text, so the
`shape` that chose between nine routings and the `textOver` / `textUnder` of each end are taken off.
The texts have nowhere to go — an end has no other text, and a note in its place is one the author
did not draw — so each is printed with the file it came from, which is what an operator would write
the labels back from. A note's own `shape` is a different field and is left alone.
[`V006__workflow-task-agent.js`](V006__workflow-task-agent.js) names the agent on every AI card of
every task board: a card's settings gained a fifth field, `agent`, and it is part of what makes the
card playable, because the other four are written in that agent's vocabulary and no one else's —
`opus` is a model on Claude and no model at all on Codex. Every board written before this build meant
Claude, so this says so out loud once, and a board keeps its Play buttons instead of losing them to a
field nobody could have written. A card that already names an agent is left alone, including one
naming an agent this host does not offer: that is a board that has travelled, not a board to correct.
[`V007__unit-folders-by-title.js`](V007__unit-folders-by-title.js) files a unit's folder under the
unit's own title and an episode inside its series: `units/<docId>/` becomes `units/<the title>/`,
and a terminal member of a sommaire becomes `<that sommaire's folder>/episodes/<its title>/`. The
document keeps the docId for its name, so every reference still carries the id and searching the
store for one still finds everything that points at it. A member sommaire is only renamed, never
moved into the sommaire that lists it — nesting tables of contents would bury every unit in the
store under the root one. It claims a folder only when the folder is named after the docId of the
one unit inside it, which is exactly "created by the default rule and never moved since"; anything
filed by hand, or shared by two unit documents, is reported and left alone. The links are rewritten
**before** the folders move, so an interrupted run is finished by running it again.
[`V008__drop-dangling-members.js`](V008__drop-dangling-members.js) drops the `members` entries that
are a bare docId no unit answers to — what V003 left where it found it, because guessing a path from
a docId is the derivation V003 existed to remove, and the unit had already been deleted. The entry
addresses nothing and readers skip it; until it goes, the sommaire announces more members than it
has. Three things are deliberately kept: the `///deleted///`
sentinel, which the link fixer wrote when an author deleted a member and is a message to a person
who has not read it yet; a bare docId that still resolves, which is V003's work and is reported; and
an entry that is a path, because a file that is not there right now — a folder not pulled —
is not a file that never will be.
[`V009__absolute-internal-links.js`](V009__absolute-internal-links.js) gives the leading slash to the
two stored fields that were still written without one: a unit's `contents[].path` (stamped
`docTypeVersion` 21) and a task's `settings.folder`. The slash is what makes a path a **link** — see
below — and the link fixer now follows nothing else, so a field written without it would stop being
repaired the first time its folder moved. Prose is not touched and neither is a relative markdown
link: `[le cadre](cadre.md)` is read against the document that holds it, so a slash would break it,
and only the fields whose name says they hold a store path are converted. It carries one repair for
what `V007` can no longer do on its own — a slashless content path whose file is gone, with a file of
that name beside the unit's own document, is re-pointed at the document's folder and reported. V007
itself is untouchable: the runner compares an applied script's checksum and refuses to start on a
mismatch.
[`V010__workflow-tasks-out-of-columns.js`](V010__workflow-tasks-out-of-columns.js) takes a task
board's cards out of its columns: a column held its own `tasks` list, and a board is now its columns
and one list of cards beside them, each naming the column it is filed in with `column` — or naming
none, which files it in the backlog, a place the nested shape had no way of saying. The cards come out
in the order the board was read in, after any the document already listed beside the columns;
`column` goes straight after each card's `id`, where the editor writes it; a column written without an
id is given one, its cards now having to name it; and an enveloped board says `docTypeVersion` 2.
Both services still read the nested shape and write the flat one at a board's first save, so this is
what makes a board nobody opens read the way the `taskboard` skill describes it — not a precondition
for opening one.
[`V011__workflow-boards-to-seed-sql.js`](V011__workflow-boards-to-seed-sql.js) exports every task
board to one `boards-seed.sql` at the store root — the script `tools/seedgen` wrote, one
transaction, the same deterministic ids — and deletes the `.workflow.json` files it came from, which
nothing reads any more. A board is exported whole or left whole: one whose cards cannot be carried,
or whose name a board already exported answers to, stays a file and is reported, and only the files
that went into the script are deleted, after it is written. The board template in
`kiao-user-config/file-templates/` is skipped, and no link is rewritten for the deleted files —
nothing a store holds names a board by its path. After this, an instance whose worker names no
workflows-service has no boards until the script is imported somewhere and the instance pointed at
it.
[`V012__boards-seed-compact-box.js`](V012__boards-seed-compact-box.js) brings a script V011 left at
the store root to workflows-service's schema V005, which split `on_success_mode = 'compact'` into the
mode `continue` and the box `on_success_compact` and narrowed the mode's check to the two words left:
a V011 script still saying `compact` would be refused whole. Each task statement gains the column, a
`compact` card becomes `'continue', true` and every other card `false`. Only a `boards-seed.sql` or
`boards-seed-<n>.sql` whose header says V011 wrote it is touched, and one whose statements are not the
shape V011 writes is left as it is and named. V011 could not be taught the column itself: it had been
applied, and editing it is exactly what stopped a server on a checksum mismatch.
[`V013__workflow-tasks-are-flow-nodes.js`](V013__workflow-tasks-are-flow-nodes.js) renames the last
places a store's own files call a board's cards tasks: `tasks` becomes `flowNodes` in every
`.workflow.json` left in the tree — beside the columns, and inside each column on a board nobody has
opened since V010 — a card's `onSuccess.task` becomes `onSuccess.flowNode`, and
`kiao-user-config/task-templates` becomes `kiao-user-config/flow-node-templates`, with the
`${taskDescription}` and `${taskTitle}` the editor binds renamed inside every template under it. Each
key is renamed in the place it held, so a rewritten board differs from the one before it in the
spelling and in nothing else, and a board already renamed is left byte-identical. The database half
of the same rename is hybridflow-store's schema `V009`, and the two are independent.
[`V014__mlex-flatten-titles.js`](V014__mlex-flatten-titles.js) turns an exercise set's inner titles
into plain text lines: a set is one list of paragraphs now, and `##` opens nothing, so `## La pluie`
becomes `La pluie` on each side that holds it. The `#` title stays, as does any other prefix on the
line (`^## Foo` becomes `^ Foo`), and a set with no inner title is left byte-identical. No schema
changes, so `docTypeVersion` is untouched.
[`V015__bookmarks-to-json.js`](V015__bookmarks-to-json.js) moves the bookmarks from the markdown
file of `### [title](link)` sections they were to the JSON array of `{ title, link, note }`
entries they are — `kiao-user-config/bookmarks.md` becomes `kiao-user-config/bookmarks.json`,
written byte-identical to what the panel writes itself, and the markdown file is removed. The
sections are read the way Dashboard read them, fences included; the preamble above the first
bookmark has nowhere to go and is dropped; a file holding no bookmark leaves no JSON behind; and
a store already holding the JSON is left alone, markdown file included, which is what makes a
second run a no-op.
[`V016__dashboard-rename.js`](V016__dashboard-rename.js) applies the Dashboard rename to the
store: the three state files at `.kiao-config/` are renamed from their `quickcms*` names to
their `dashboard*` ones, contents untouched, and the `/quickcms` mount prefix pasted into
markdown link destinations becomes `/dashboard`. Only destinations that render as links are
rewritten — inline links and images, reference definitions, `<autolinks>` and bare absolute
URLs — and only the prefix; fenced code, inline code spans, bare prose mentions, lookalikes
(`/quickcmsx`), templates and raw HTML attributes are left alone, and the markdown half honours
`.kiao-files` while the state half does not, state not being content. A document already under
its new name wins over the old one beside it.
[`V017__values-object-field.js`](V017__values-object-field.js) groups a value provider's custom
fields under `object`: `{ type, value, folderName, objective }` becomes
`{ type, value, object: { folderName, objective } }` in every `*.json` file directly inside
`kiao-user-config/values/`, which is exactly what Dashboard loads. The placeholders say the
same as before — `${topic:TopicToLearn.objective}` — the field resolving at the root or under
`object` indifferently. An entry already grouped, or holding no custom field, is left
byte-identical; a file that is not an array, an entry without a string `type` and `value`, and
an entry whose `object` is not a plain object are left alone and named.

Every migration written before V001 had been applied on every environment, so they were removed and
every ledger reset to version 0 — see
[Resetting an environment to 0](#resetting-an-environment-to-0), which stopped being optional the
day V001 was written. The machinery around them: [`lib/kiao-fs.js`](lib/kiao-fs.js) (the data
root, and the `.kiao-files` matcher), [`lib/link-fix.js`](lib/link-fix.js) (the link rewriting, kept
identical to worker's own — see below), [`migration-template.js`](migration-template.js)
(copy it to start), and [`test/`](test).

**Running one deliberately, on a store that declares itself out of bounds.** This checkout's own
`.kiao-files` says `[migration] /` — nothing in this checkout is migrated automatically — so a
board kept under it would be converted by pointing the script at that subtree as its data root,
which is the "do it deliberately" the [`.kiao-files`](../.kiao-files) file asks for:

```bash
node migrations/V002__tasks-boards-to-workflow.js "$PWD/backlog"       # then read git diff
node migrations/V010__workflow-tasks-out-of-columns.js "$PWD/backlog"  # the same, for the cards leaving their columns
```

Do it with kiao **stopped**: a board open on the old folder holds the column texts it read and
writes them back on its own debounce, so it would recreate the files the conversion just removed.

### Renaming something a store links to

A rename performed through Dashboard is followed by worker's link fixer
([`files/linkfix.go`](../operation/worker/internal/files/linkfix.go)), which is out of reach of a migration: a
migration runs before the service answers anything. [`lib/link-fix.js`](lib/link-fix.js) is the same
pass in JS, down to the details that decide whether a link is recognised at all — a path token
opening with the leading `/` that makes it a link, delimited by whitespace or ``"'()[]{}<>,;:|@` ``,
matched both verbatim and percent-encoded, written back in the form it was found in, keeping its
`/child…` suffix. Use it rather than a substring replace.

**The leading slash is required, and that is the whole of what tells a link from prose.** A store's
root folders are called `docs`, `config`, `units` — ordinary words — so a bare `config/values` is a
shell snippet or a pasted stack trace as often as it is a reference. It used to be the caller's
choice (`absoluteOnly`, which V001 asked for by name, for exactly that folder); it is now the rule
for every path, and the option is gone. A path written without the slash is left alone: in markdown
that is a document-relative link, read against the document holding it, and it points somewhere else
entirely.

**One context is written differently: a markdown link destination whose new path carries a space.**
A destination ends at its first space, so `[x](/units/Ma série/x.mlunit.json)` is not a link at all,
and "the form it was found in" cannot answer for it — that form was decided by the *old* path, and a
docId never needed escaping. Both fixers therefore percent-encode a `](…)` destination when, and
only when, the new path holds a space. Everywhere else the path goes back as it reads, which is what
a unit's `members` needs: every reader of one hands what it finds straight to `getFile`, which takes
the path undecoded, so an escaped entry would break the fetch. The two forms land in the same file,
sometimes on the same line.

## The store is not necessarily a document store

DCMS serves **any folder**. Nothing about either half — the file views in Dashboard, the
files service in worker — is specific to KIAO content:
`KIAO_WORKER_ROOT_PATH` is a directory and a git work tree, and that is the whole
contract. It is routinely pointed at folders that hold no KIAO document at all —
[`bin/local-start-kiao.sh`](../bin/local-start-kiao.sh) may be pointed at the *source checkout
itself* as a store root, and the standalone builds exist to browse and edit ordinary work
folders. A store may equally be a mix: a few units next to a checkout of something
else entirely.

A migration is a Node script with unrestricted filesystem access to that folder, run automatically,
without a prompt, before the service accepts a single request. It is the one part of the system that
writes to files nobody asked it to touch. So:

> **A migration must never assume that everything it can reach is KIAO content.**

Concretely, when writing one:

- **Select on shape, not on reachability.** Load the document, check it is what you think it is —
  the field you are about to rename is present, the record is not already in the target shape — and
  skip anything else. An extension is a weak signal: `.json` is everyone's, and even a KIAO-looking
  name can be a fixture, a sample in someone's notes, or an export.
- **Never do a blind substring replace across the tree.** A string that identifies a link inside a
  KIAO document identifies something else entirely inside a source file, a stack trace pasted into a
  note, or a URL of a local dev instance. Match on a boundary, and check the surroundings.
- **Be idempotent.** Re-running must be a no-op, so that a half-applied migration can be re-run and
  a document already in the target shape is left byte-identical.
- **Honour what the store declares.** `.kiao-files` — see below — is where a folder says what in it
  is not content, and it is the answer to everything above from the *deployment* side. A migration
  reads the `[migration]` concern; the other sections answer for passes inside worker.
  [`scan`](lib/kiao-fs.js) does it for you; a hand-rolled walk must call `loadIgnore()` itself.
  `.git` and `.kiao-config` are excluded whatever a declaration says, and need no rule.
- **Say what you did.** Print the count of files changed, and ideally their paths — it is the only
  record an operator has, after the fact, of what a startup did to their files.
- **When in doubt, ask before writing.** If it is not certain that every file a migration would
  touch is genuinely KIAO content, the migration is not ready. Ask for confirmation — with the list
  of paths it would rewrite — rather than guessing. A migration that skips too much costs one more
  run; a migration that rewrites too much costs a restore from git, and only if the store was clean.

Rehearse against a copy of a real store, not a fixture, and read `git diff` before letting the
service run it for real.

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

The runner cannot enforce any of it — a migration is a Node script with full filesystem access — so
it logs the rules in force before the first script runs, and the shared helpers honour them:
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

## Resetting an environment to 0

Needed once, now that the pre-`V001` scripts have been deleted: a ledger still claiming version 17
skips every script this tree ships. Resetting is removing the ledger — the runner reads a missing
one as version 0.

### The gate is one comparison

A script is pending only when `s.version > ledger.schemaVersion`
([`files/migrations.go`](../operation/worker/internal/files/migrations.go)), and the scripts this tree ships are
versions 1, 2 and 3. **Against a ledger that still claims 17, not one of them is pending**, and the
store is left exactly as it was found.

That costs most with [`V003`](V003__unit-links-by-path.js), because nothing else ever applies it: a
sommaire's `members` keep the bare docIds that no reader resolves any more, so a client fetching
the root sommaire 404s on every member path it is handed, and offers an empty library. The store
is wrong and the app is where it shows.

A stale ledger announces itself in one of two ways, and the deploy treats neither as a failure of
its own. If it records entries for versions 1 to 3 — the deleted scripts had those numbers too —
`validateAlreadyApplied` compares checksums, finds three mismatches, and with
`KIAO_WORKER_MIGRATIONS_FAIL_ON_ERROR` at its default of `true` **refuses to start**. If it
records only the version, the same function logs `migration is below current version but not
recorded in the ledger; skipping` once per script and startup carries on as though the store were up
to date. The first is loud, the second is silent, and the remedy is the same reset.

### Deploy first. Always.

**Reset only an environment whose migrations directory no longer holds the deleted pre-`V001`
scripts.** The order is not a nicety:

- **Reset while the deleted scripts are still on disk** and the runner reads the missing ledger as
  version 0, finds all seventeen pending, and **replays every one of them** against a live store.
  A directory that somehow holds both sets refuses instead: two files claiming version 1 is a
  duplicate `discoverMigrations` rejects, and startup stops at
  `duplicate migration version 1`.
- **Reset once they are gone** and the eleven scripts this tree ships are the only pending ones,
  which is the whole point of resetting. Replaying V001 and V002 on a store they have already run
  against costs nothing: each skips a rename or a conversion whose target already exists, V003
  leaves a members entry that already starts with `/` byte-identical, and V004 leaves a mindmap
  whose relations are already pairs untouched. A ledger that is "ahead" was inert for as long as no
  script was on disk, which is why the reset could be left alone while the tree shipped nothing.
  **Eleven scripts are on disk now**, so an environment whose ledger still claims version 17 skips
  all eleven.

**Do not take "I deployed" as proof of the first condition. Read the log.** The gate is the count of
scripts on disk, and only that: it must read **exactly the number this tree ships, `11`**. Anything
larger means the deleted scripts are still in the migrations directory beside them — stop, and leave
the ledger alone. This exact mistake happened on 2026-08-16: prod was deployed and
the reset run straight after, and the seventeen migrations replayed anyway — the deploy ships
through a staging directory on the server that `rsync` was never told to prune, so
`install.sh` kept faithfully reinstalling scripts this repo no longer
contains. (Fixed since, in the deploy script, which
now removes the remote staging copy before shipping. The replay itself was harmless — every one of
the seventeen was idempotent, and the store's `git status` came back clean.)

Where the scripts live decides how exposed an environment is:

- **a server deployment** ships them into a directory *shared across versions*, so a stale script survives a new
  binary. Deploy, check the log, then reset.
- **the Docker image** carries them *inside the image*, rebuilt from a wiped context every time
  ([`build-kiao-image.sh`](../bin/build-kiao-image.sh) does `rm -rf "$STAGE_DIR"`).
  Stopping the old container removes the scripts along with it, so resetting the ledger on the host
  and starting the new image is safe in that order — provided the old image is never started again
  afterwards.
- **dev and local** point `KIAO_WORKER_MIGRATIONS_PATH` straight at the working tree, so the
  scripts are gone the moment this commit is checked out and the order takes care of itself.

### The procedure

Stop the service first, so the running process does not rewrite the file on its way out. Prefer
`mv` to `rm`: re-deploying an older build reinstalls its seventeen scripts, and with no ledger they
would all replay — a backup makes that rollback a one-line restore. The `.pre-reset` file is inert
where it lies (nothing reads that name, and the state directory is git-ignored); delete it once the
new version has proved itself.

```bash
mv <state-path>/files-migrations.json <state-path>/files-migrations.json.pre-reset
```

`<state-path>` is `KIAO_WORKER_STATE_PATH`, and `<store-root>/.kiao-config` when that is
unset — which it is everywhere here. `files-migrations.lock` beside it can stay; it is recreated on
demand and holds no version.

| Environment | Command |
| --- | --- |
| **local** ([`bin/local-start-kiao.sh`](../bin/local-start-kiao.sh)) | one per store root served: `mv <root>/.kiao-config/files-migrations.json{,.pre-reset}` for each |
| **prod** (server, systemd) | **after deploying** — see below |
| **kiao Docker image** ([`docs/user-manual/deep-dive/kiao-docker.md`](../docs/user-manual/deep-dive/kiao-docker.md)) | **after rebuilding the image**: on the host, in the folder bind-mounted at `/data`, `mv .kiao-config/files-migrations.json{,.pre-reset}`. Moot unless `KIAO_WORKER_MIGRATIONS_PATH` is set — migrations are off by default there |
| **e2e** ([`e2e/bin/start-env.sh`](../e2e/bin/start-env.sh)) | nothing to do — migrations are not enabled there, and the store is a fresh temp directory per run |

A store written before the `.kiao-config` layout may still carry `<store-root>/.kiao/migrations.json`.
It needs no attention: startup deletes it along with the rest of the old directory
([`state_legacy.go`](../operation/worker/state_legacy.go)) instead of adopting it, which is
what keeps a reset from being undone on the next boot.

Prod in full, the two steps kept apart so the deployment can be judged before the ledger moves:

```bash
# 1. deploy the new build, then check the migration lines in its log:
ssh <host> "journalctl -u kiao-worker -n 80 | grep migrate"
#   scripts_on_disk=11 → the deployment landed and nothing stale is beside the eleven
#   version=0 … 10     → the pending scripts ran; there is nothing to reset
#   version=17         → every script this tree ships was skipped; reset below, then restart

# 2. reset the ledger and restart:
ssh <host> '
  sudo systemctl stop kiao-worker &&
  sudo -u <user> mv <store>/.kiao-config/files-migrations.json \
                    <store>/.kiao-config/files-migrations.json.pre-reset &&
  sudo systemctl start kiao-worker'
ssh <host> "journalctl -u kiao-worker -n 80 | grep migrate"   # expect file store migrated version=11
```

A store with nothing left to do logs one line, and it carries both halves of the check:

```
INFO file store up to date; nothing to apply version=11 scripts_on_disk=11
```

`scripts_on_disk=11` is the half that says the deployment landed — a larger count means the old
migrations directory is still there, and the ledger must not be touched. `version=11` is the half
that says the eleven scripts have been applied to this store; `version=17` on that same line means
they never were.

A startup that has work to do logs `applying pending migrations version=0 pending=11` instead, one
`applied migration` line per script, and `file store migrated version=11` at the end. That sequence,
with `V003__unit-links-by-path.js` among the scripts named, is the proof the unit links were
rewritten.

## Writing the next one

1. Copy [`migration-template.js`](migration-template.js) to `V<NNN>__<short-description>.js`
   (next free number — V018 today; unique; applied in ascending order).
2. Re-read [The store is not necessarily a document store](#the-store-is-not-necessarily-a-document-store).
3. Add a test in [`test/`](test) — it must live in that subdirectory, or the runner discovers it as a
   migration and runs it against the real store. Run one with
   `node --test migrations/test/<name>.test.js`, or all of them with
   `node --test "migrations/test/*.test.js"` (quote the glob; passing the directory itself
   is not supported).
4. Register the new script's sha256 in
   [`test/applied-migrations-immutable.test.js`](test/applied-migrations-immutable.test.js).
   That test pins every applied script byte-for-byte: once a script has been applied anywhere,
   it is never edited — not even a comment — and never renamed or deleted, because the worker
   checksums the whole file at startup and refuses to boot on a mismatch. A fix to an applied
   migration is a new script with the next free number.
5. Rehearse on a copy of a real store; read the diff.

A server deploy copies this whole directory to `/opt/kiao-worker/migrations`, and the
standalone image bundles it by [`bin/build-kiao-image.sh`](../bin/build-kiao-image.sh) at
`/opt/kiao/migrations`.
