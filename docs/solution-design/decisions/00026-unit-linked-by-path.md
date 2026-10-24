---
id: "00026"
title: "a unit is linked by path, the root sommaire is the catalogue, and the catalog is gone"
status: accepted
date: 2026-08-30
tags: ["units", "links", "sommaire", "catalog"]
components: ["worker", "dashboard"]
paths: []
symbols: ["///deleted///", "files_reader", "KIAO_WORKER_READER_ROOTS", "V003__unit-links-by-path.js", "catalog-decommission.md", "unit::"]
triggers: ["unit link", "docId", "publish", "unpublish", "members", "remarks", "catalog search", "progress store"]
supersedes: []
superseded_by: []
---

# 00026 — a unit is linked by path, the root sommaire is the catalogue, and the catalog is gone

**Decision:** a reference to a unit is the store-root-relative path of its `.mlunit.json` with a
leading slash — `/units/abc/abc.mlunit.json` — both in a sommaire's `members` and after the
markdown `unit::` prefix. A unit folder may sit anywhere in the store, nothing derives a location
from a docId any more, and the document keeps its `<docId>.mlunit.json` name only because that is
what the existing units are called. What a reader is offered is what a **root sommaire**'s members
name: "published" means reachable from it, "unpublish" means removing an entry from that list, and
display order is the members order. Publishing a unit prepares its files and stamps
`lastPublishedAt`, and does nothing else. `operation/catalog` is deleted — service, database, role
and systemd unit — the player reads the store directly over Keycloak through a new read-only
`files_reader` realm role scoped to a prefix of the store, and remarks are removed entirely, to be
reimplemented later.

**Why: the catalog was a second copy of the store, kept in step by hand.** It held a projection of
every published unit in Postgres, so a unit existed twice and the two could disagree; a rename in
the store was invisible to it, an unpublish was a route rather than an edit, and its ordering rules
lived nowhere the author could see. Linking by path removes the copy: the link fixer already
maintains a root-relative path token on rename and writes `///deleted///` on delete, so the
references repair themselves and a broken one is visible rather than silently unresolvable. Every
consumer of `members` therefore has to tolerate `///deleted///` — skip it, show it as broken, never
fetch it.

**And the docId stayed exactly where it was.** It is still the unit's identity in the envelope and
still what the player keys an installed library and a listener's progress on. Linking is what
changed; identity is not, because `SqfliteProgressStore` is schema version 1 with no `onUpgrade`
and a changed key would quietly lose somebody's history.

**What it cost.** The store needs a migration (`V003__unit-links-by-path.js`) that indexes every
`.mlunit.json` once to resolve the old bare docIds, and an id resolving to nothing is left alone and
reported rather than guessed at. The catalog's search, its quality-then-collated-title ordering and
its remarks are not reproduced anywhere — the first two were features of a projection nobody is
rebuilding, and remarks come back later on their own terms. The production teardown that no script
performs is written down in `../catalog-decommission.md` instead: the dump, the live realm export,
the retired `publication-service` client and `catalog_writer` role, and the dropped database.

## Refactor notes

TODO: confirm whether remarks were reimplemented; if so, link the entry.
