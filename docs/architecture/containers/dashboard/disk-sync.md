# Following the file on disk (`src/cms-core/files/disk-sync/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

The other half of saving as you type: **an open file is watched, not read once.** A change made to
it elsewhere — an agent editing the store, a `git pull`, an editor outside the app — is read back
into the open document as it happens, so what a document becomes under an agent is something to
watch rather than something to discover on the next open.

`useDocumentFileSync(path, {parse, serialize})` is the whole mechanism: the guarded read (one
that lands after the reader has moved to another file is dropped, not applied to it), the
debounced writer that carries its path and flushes on the way out, and the poll below. The codec
is a plugin's two arrows between the file's text and the structure it edits — `doc`/`onDocChange`
carry the structured side, `text`/`onTextChange` a source view, and the text is delivered as it
came, never re-serialized. A text that holds no document is `doc: null` — the plugin's "invalid
file" state — at open and at reload alike; only mid-edit does a text that stops parsing keep the
last document it held, so the structured side is not blanked at each keystroke of a source view.
A file the store does not hold yet — `/info` answers it with null — is opened as empty text rather
than as a failed read, and the first write creates it: a sidecar nothing has been written into is a
document like any other, and a codec that reads the empty text as an empty document never has to
know the difference.

`useTextFileSync(path)` is the same hook under the identity codec, and it is what the three
plugins that open a file *as text* — `markdown-edit`, `text-edit`, `code-edit` — use in place of
a load effect and a debounced writer of their own; `graph-edit`, `featmat-view`, `mindmap-edit`,
`hybridflow-ui` and the script half of `ttst-edit` sit on the document form.

`mindmap-edit` is the one that keeps an **editing state of its own** beside the hook's document: a
map is mutated far more often than it is saved — a drag moves it on every mouse event and writes
once, at the end — so `setMindmap` moves what is drawn and `saveMindmap` is what reaches
`onDocChange`. What arrives from the file is adopted into that state, our own writes coming back
being told apart by identity: `onDocChange` is handed the very object the editor built.

**Modification time is the trigger; the text is the truth.** Polling `/info` every two seconds says
*something* happened, and only reading the file says whether it is a change at all — a write of the
editor's own moves the modification time exactly like an outside one. So a moved time costs one
read, and the three texts decide ([`diskSync.ts`](../../../../exchange/dashboard/src/cms-core/files/disk-sync/diskSync.ts)):

| The file holds | The editor shows | |
| --- | --- | --- |
| the editor's text | — | in sync: the editor's own write landing, or one still in flight |
| something else | what was last read or written | reload: the file wins, and the editor follows |
| something else | an edit not written yet | conflict: the editor keeps it, and a notification says so |

**The file wins only where there is nothing to lose.** An edit made here and not yet written is
never overwritten by one that arrived from outside; that case is announced, once per disk state,
and left alone. It is a narrow window — the write is a second behind the last keystroke — but not
an empty one: a trailing debounce is pushed back by every keystroke, so typing without a pause
holds a document off the disk for as long as it lasts.

**A codec may answer the conflict instead of losing to it.** A document with a *second writer of
its own* has a better answer than dropping one of the two: `merge(base, ours, theirs)` puts them
together, and what comes back is shown **and written**, so the two ends converge instead of
overwriting each other in turn. No editor offers one today: the one merge in the tree is the
board's ([boardMerge.ts](../../../../exchange/dashboard/src/plugins/hybridflow-ui/boardMerge.ts)), which merges board state from
the service rather than file revisions from the disk.

Such a document also **looks before it writes**: a whole-document save going out over a file that
moved since it was last read is the other end's work quietly removed, and the poll may not have
come round yet. So the write is preceded by the same check the poll runs — one extra `/info` per
save, paid only by a codec that declared a merge. What that leaves is the millisecond between the
check and the write landing; closing that would take a conditional write, which the files API has
no shape for.

Three details are load-bearing. The initial read takes the modification time **before** the text:
the other way round, a write landing between the two calls leaves a stale text stamped with the
time that replaced it, and the file is never looked at again. The debounced writer records its
text as the file's *before* the write lands, not after, so a poll firing while it is in flight
recognises what it reads. And what it sends is what the editor **holds now**, not the text the
write was scheduled with: the poll's check and the writer's own race for the same arrival, whoever
gets there first merges it and moves the modification time, and the other then finds nothing to do
— so a write still going out on its scheduled text would put the *un*merged document on the file
and take the other writer's fields off it. A hidden tab is not polled.

**No writer stays hand-rolled.** Saving entangled with semantics the shared hook does not
carry used to be the reason: editors holding a `sessionStorage` snapshot with an awaitable flush
before an export, or re-reading a content pool and merging before every write, all kept their
own — and all have left the lot since.

`hybridflow-ui` was the fourth before it left the lot with the rest of them: it wrote the board
whole over whatever the file had, which is the one thing a board a run writes cannot do
(`docs/architecture/decisions/00029-board-merge-on-run.md`). A board is a row in a database now rather than
a file, so it sits on no hook at all — and the run still says when it has written the board
(`documentAt`), which takes the watch's round trip off that one case.
