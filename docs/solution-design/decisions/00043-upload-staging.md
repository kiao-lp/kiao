---
id: "00043"
title: "an upload is staged and read before any of it is in the store"
status: accepted
date: 2026-09-08
tags: ["upload", "staging", "review"]
components: ["worker", "dashboard"]
paths: [".kiao-uploads"]
symbols: ["POST /staging", "DELETE /staging", "/moveBatch", "/reindex", "/listRecursive"]
triggers: ["upload folder", "review upload", "safe import", "unsafe import", "sweep", "git-ignored upload", "subsidiary"]
supersedes: []
superseded_by: []
---

# 00043 — an upload is staged and read before any of it is in the store

**Decision:** the file browser's upload zone no longer writes into the folder being browsed. It asks
worker for a **staging area** (`POST /staging` → `.kiao-uploads/u-<clock>-<rand>`), uploads
into that, has the documents converted there with `/reindex`, and then opens a dialog showing the
tree of what arrived beside the text of what each document says. Every file that was converted takes
a decision — *Delete* or *Import*, neither chosen by default — reported next to it in the tree. Three
ways out: **Cancel**, which throws the whole upload away; **Safe import**, offered only once every
converted document has been decided; and **Unsafe import**, red, which is offered from the start and
asks nothing. Importing moves the file to the browsed folder — with its index, subsidiaries
travelling with their main file — and deleting is that file still being there when the staging area
is discarded.

**Why the detour.** The reason to upload a folder is usually that nobody knows what is in it: a
scanner's output, a mailbox export, a directory somebody handed over on a key. Finding out meant
putting all of it in the store first and sorting it out afterwards — against a link fixer, a git
status and a navigation tree that had all already taken it as content. Now the reading happens
before the store has anything to undo, and the conversion this repository already writes for search
is exactly what makes it possible: an `.eml`, a `.docx` or a spreadsheet is unreadable until it has
been converted, and it already is, one step before the question is asked.

**A staging area is an ordinary directory, deliberately.** Everything it needs — write a file, walk
it, convert it, move things out of it, delete it — is an endpoint that exists, so it uses them:
importing *is* a `/moveBatch`, deleting *is* the area going away, and an index follows its document
because a subsidiary always has. What is not ordinary about it is three things, and each is there
for one reason. **No listing shows the `.kiao-uploads` folder** — files nobody has accepted must not
read as content — while a listing *of* one works normally, because that is what the review asks for.
**It is git-ignored**, by a `.gitignore` of `*` seeded in it, since in production the store root is a
work tree. And **it is swept** at the next upload, of anything older than a day, because a browser
that was closed on a review would otherwise leave files in a folder nobody can see. The automatic
passes stay out of it for free: its name begins with a dot, which the seeded `.kiao-files` excludes
from all three, and a reindex *aimed at* it still works because an exclusion never applies to the
folder that was named.

**The two import buttons run the same import.** They differ in what they demand before they are
offered, never in what they do — an undecided file is imported by both. That is what makes the safe
one mean something precise ("everything readable here has been looked at") rather than being a
second, gentler import; and it is why the red one needs no confirmation dialog, which would only ask
"are you sure" about an operation whose entire subject is already on the screen. A file with **no**
index is never waited on: nothing was shown of it that anyone could have formed an opinion from, so
requiring a click would be requiring a click and not a decision.

**The client builds the review from what it already knows.** The uploader holds every path it sent,
and `/reindex` answers with the index *files* it wrote — so which document has something to read is a
set membership, not a round trip. Asking the server would have been worse than redundant:
`/listRecursive` caps at 500 entries and hides subsidiaries, which is to say it hides exactly the
thing being asked about.

**The discard is bounded by the service, not by the caller.** `DELETE /staging` is a recursive delete
with no confirmation in front of it, so it refuses any path that is not one of the directories
`POST /staging` minted — not the staging folder itself, which holds every other upload, and nothing
deeper than one area. No link fixer runs on it either: nothing in the store can refer to a path no
client was ever shown.
