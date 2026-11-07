---
status: DRAFT
role: PRIMARY_SOURCE
---

# Following the file on disk (`src/cms-core/files/disk-sync/`)

Part of the [Dashboard solution design](README.md).

An open file follows external edits, including agent writes and `git pull`. The shared
[`useDocumentFileSync`](../../src/cms-core/files/disk-sync/useDocumentFileSync.ts) hook
combines guarded reads, autosave and disk checks. See [saving](saving.md) for writer rules.

## Document and text interfaces

`useDocumentFileSync(path, { parse, serialize })` exposes:

| Value | Purpose |
| --- | --- |
| `doc`, `onDocChange` | Parsed document and structural edits |
| `text`, `onTextChange` | Source text preserved as typed, without reserialization |
| `loading` | Initial read state |
| `checkNow()` | Request a disk check before the next polling interval |

The codec throws for invalid documents. Invalid text gives `doc: null` on load or reload;
while typing, a parse failure retains the last valid document and still saves the source.
A missing file starts as empty text and is created by the first write, allowing codecs to
support optional sidecars. Late reads for a file already left are discarded.

`useTextFileSync(path)` uses the identity codec for `markdown-edit`, `text-edit` and
`code-edit`. Structured editors supply their own codecs. Mindmap also keeps transient drag
state: `setMindmap` redraws during a gesture; `saveMindmap` calls `onDocChange` at its end.
Incoming documents are adopted, with object identity distinguishing the editor's own writes.

## Disk checks and conflicts

Visible tabs poll file metadata every **two seconds**. A changed modification time triggers
one text read; comparison with local text and the last synchronized text decides the result
([diskSync.ts](../../src/cms-core/files/disk-sync/diskSync.ts)):

| Disk text | Local editor | Result |
| --- | --- | --- |
| Equals local text | Any | In sync; recognizes an editor write, including one in flight |
| Differs | Equals the last synchronized text | Reload from disk |
| Differs | Has unsaved edits | Keep local edits and warn once per disk state |

Continuous typing can keep a trailing debounce pending indefinitely, so the conflict window
can exceed one second. Hidden tabs are not polled.

## Optional merge codec

A codec may implement `merge(base, ours, theirs)` for cooperating writers. If all three
texts parse and merging succeeds, the result is displayed and saved. Otherwise local edits
remain and the conflict is reported. Merge serialization may reformat source text.

A merge codec also checks metadata before saving, so an external write since the last poll
can be merged first. This adds one metadata request per save. The files API has no conditional
write, so a race remains between the check and the write.

No current file editor supplies a merge codec. Hybridflow uses
[boardMerge.ts](../../src/plugins/hybridflow-ui/boardMerge.ts) against the boards service;
boards are database records and do not use disk-sync hooks.

## Ordering constraints

- Read modification time **before** text. Reversing them can label stale text with a newer
  timestamp and hide the external write.
- Record outgoing text as synchronized **before** sending it, so a concurrent poll recognizes it.
- After asynchronous checks, write the editor's **current** text, which may already include a
  poll's merge. A delayed write of the scheduled text would undo that merge.
- On navigation, flush to the original path, wait for pending writes before reading, and check
  the active path after asynchronous work. A failed load must not expose the previous document
  for editing at the new path.

Panel-owned files such as bookmarks and tags retain their own app-lifetime persistence; see
[their local guides](../../src/plugins/README.md).
