# Document indexes and search

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index and [file endpoints](/operation/worker/PROTOCOL/files.md).

## Document indexes

A document whose text a plain grep cannot reach is **converted** into a sibling file next to it,
and that file is what search scans, what the editor offers as a companion tab, and what an agent
reads. The conversion is not a text dump: each type goes into the format that preserves what it
is.

| Source | Index | What the conversion keeps |
|---|---|---|
| `.pdf` | `<name>.index.md` | one `## Page n` section per page |
| `.docx` | `<name>.index.md` | headings, list items with their nesting, tables as pipe tables; headers, footers and notes under a heading of their own |
| `.pptx` | `<name>.index.md` | one `## Slide n` section per slide, the title placeholder as a heading, the rest as bullets at their outline level; speaker notes after the slides |
| `.odt` | `<name>.index.md` | headings at their outline level, list items, tables |
| `.eml`, `.msg` | `<name>.index.md` | the subject as the title, then `From` / `To` / `Cc` / `Date` as fields, the body (the text alternative, or the HTML one reduced to text), then the attachments **named** — never opened |
| `.xlsx`, `.xlsm`, `.ods` | `<name>.index.csv` | one CSV record per row, one `# sheet name` record per sheet |

`.index.txt` is still recognised as an index — it is what older versions of this service wrote,
and it is a perfectly good thing to write by hand. A document carrying more than one index is read
through one of them, in the order `.index.md`, `.index.csv`, `.index.txt`, so it is never reported
twice by a search.

Every index is a **subsidiary**: hidden from `/list` while its main file is there, carried along by
a rename, a copy and a delete, and offered in the companion family from `/info`.

### When an index is written

A generated index is stamped with **its source's modification time**. Everything follows from that
one convention:

| The index is… | What happens |
|---|---|
| absent | written, by the next `/search` or by `/reindex` |
| older than its source | rewritten: the document changed |
| the same age as its source, in the format written today | left alone — it is current |
| the same age as its source, in a format a previous version wrote | rewritten by `/reindex` **only**; `/search` leaves it, so deploying a new version does not silently rewrite a whole store |
| **newer** than its source | **never touched.** A generated index cannot be newer than its source, so this one was written or edited by a person. Delete it to have the document converted again. |

A rewrite leaves exactly one index: the superseded file under another suffix is removed.

### `POST /reindex`

```json
{ "paths": ["docs/runbook.docx", "mail"] }
```

Each path is a file or a folder; a folder is walked, staying out of what the store declares under
`[search]` in its `.kiao-files` and out of dot-directories and `node_modules`. The answer:

```json
{ "indexed": ["docs/runbook.docx.index.md"], "upToDate": 12, "failed": [], "truncated": false }
```

- `indexed` names the index **files** written, not the documents they came from — that is the path
  a client refreshes and a user opens.
- `upToDate` counts the documents that needed nothing, including the ones whose index a person
  wrote.
- `failed` is `[{ "path", "error" }]`. A document that cannot be converted is reported there and
  does **not** fail the request: pointing at a folder of a hundred files and losing the
  ninety-nine that converted because one is corrupt is not a useful answer. Only a path outside
  the store is an error (`400`), and it stops the whole request.
- `truncated` says the run stopped at the server's cap on how many indexes one request **writes**.
  The cap counts writes and not files looked at, so asking again continues where it stopped.

A file whose type has no converter is not an error and not counted: a folder of images and
Markdown is a perfectly good thing to point at.

## Search query language

`query` is a list of **terms** separated by whitespace. Every term must be satisfied by the same
file — but they may match on **different lines**, and each is tried against the file's **base name**
as well as its content. Implementation: `files/searchquery.go`.

| Form | Meaning |
|---|---|
| `mot` | substring, case-insensitive |
| `"Mon Expression"` | substring, exact case; `\"` is a quote and `\\` a backslash |
| `/regexp/` | RE2, case-sensitive |
| `/regexp/i` | RE2, case-insensitive |
| `-terme` | the file must **not** contain it (works with all three forms) |

Only one thing is a syntax error — a regex that does not compile, which returns `400` with the
compiler's complaint. Everything else degrades to a literal:

- A `"` opens a phrase only as a token's first character, so `a"b` is the word `a"b`. An
  unterminated quote swallows the rest of the input rather than failing.
- A `/…/` token is a regex only when it holds no whitespace, has a non-empty body, and ends with an
  optional `i` followed by whitespace or end of input. So `units/foo`, `/units/foo`, `//` and
  `/foo/bar` are all plain words — but `/units/i` *is* read as a regex; quote it to force a literal.
- `-` negates only as a token's first character with something after it, so a lone `-` is a word.
  A query holding only negations is refused with `400`.
- An empty query returns no results, without walking the tree.

Two consequences worth knowing. A file the service cannot read — a binary, or one past the 1 MiB
content cap — still matches on its name, and comes back with an empty `matches` array. And a phrase
containing a space cannot match across a line break, since matching is per line.

Each `SearchMatch` carries `ranges`: the `[start, end)` bounds of the hits inside `content`, counted
in **UTF-16 code units**, so a browser can `content.slice(...)` them directly. `truncated` reports
that the walk stopped at the server's result cap.

**What a search does not reach.** Directories named `node_modules` or starting with `.` are never
searched, whatever the store says — in production the storage root is the git work tree, and the
service's own state directory holds verbatim transcripts. Beyond that floor, both passes (the index
refresh and the scan) honour the store's own `.kiao-files` declarations under the `[search]`
concern, so a search of a folder holding a build tree or a network mount does not walk it. A rule
naming files rather than folders is honoured the same way — with the seeded defaults, that means a
dot-file is no more searched than a dot-directory was. The folder named in the request is always
searched, whatever the declaration says about it: an exclusion keeps the walk out of the folders
nobody pointed it at, not out of the one that was pointed at.
