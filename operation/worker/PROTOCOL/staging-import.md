# Staging and the import gate

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index and [file endpoints](/operation/worker/PROTOCOL/files.md).

## The staging area

An upload does not have to land where it will live. `POST /staging` answers with a directory of the
store to write into first:

```json
{ "path": ".kiao-uploads/u-1772280000000-9f3c1a20b7e4d556" }
```

It is an ordinary directory in every respect the rest of this document describes — `/upload`,
`/reindex`, `/list`, `/moveBatch` and `/delete` all work on it and on what is in it — with three
differences, which are the only reasons this endpoint exists rather than a convention:

- **No listing shows the `.kiao-uploads` folder itself.** Files nobody has accepted yet must not
  read as content. A listing *of* a staging area works normally: that is what the client reviewing
  one asks for.
- **It is kept out of git**, by a `.gitignore` of `*` seeded in it — in production the store root is
  a work tree, and an upload waiting to be answered for would otherwise fill Source Control.
- **It is swept.** Opening one removes the areas older than 24 hours, so an upload whose browser was
  closed does not sit in a folder nobody can see forever.

The automatic passes stay out of it because its name begins with a dot, which the seeded
`.kiao-files` excludes from all three; a `/reindex` **aimed at** it still converts everything in it,
which is the rule that an exclusion never applies to the folder that was named.

`DELETE /staging?path=…` throws one away with everything still in it. That is a recursive delete
with no confirmation in front of it, so the service decides what it may reach: a path that is not
one of the directories `POST /staging` minted is a `400`, and neither the staging folder itself nor
anything deeper than one area is one. No link fixer runs — nothing in the store can refer to a path
no client was ever shown.

Dashboard's upload zone is the caller. It stages the upload, converts it, shows what arrived beside
what each document says, and takes a decision per file: importing is a `/moveBatch` out of the area
(which brings each index along, indexes being subsidiaries), importing *as text* is a `/moveBatch`
of the index alone under the document's own name, and deleting is that file being left where it is
when the area is discarded. A passage obfuscated in the review is a `/update` of the staged text
before any of that runs, so what moves is what the reviewer was last looking at.

## The import gate

The store says what, in the text of a document, is worth a reviewer's attention. It says it in
`kiao-user-config/import-gate/` — one JSON file per category of sensitive information, each holding
a list of named regular expressions and a criticality — and nothing in this service ever runs one.
The gate is Dashboard's: it fetches the folder with `/list` and `/getFile` like any other content,
and runs the rules in the browser over the index a document was converted into.

The gate runs over **every text being imported**, not only the indexes: a `.md`, a `.csv` or a
`.json` is read as itself, since it needs no conversion to be readable and would otherwise be the
one kind of file nobody looked at.

What the service does is **seed** it. A store with no `kiao-user-config/import-gate` gets the
catalogue this build carries — credentials and keys, classification markings, special-category data
under GDPR article 9, direct personal identifiers, bank and payment data, HR records, network
topology, contracts and IP — written out as ordinary store files at startup, beside its README.

The folder is then the store's, entirely: it is edited by hand, committed with the rest, and never
written to again. A category deleted on purpose stays deleted, which is the behaviour somebody
tuning the gate must be able to rely on; the price is that a later build's new category has to be
copied in, or the whole folder removed to be seeded afresh.
