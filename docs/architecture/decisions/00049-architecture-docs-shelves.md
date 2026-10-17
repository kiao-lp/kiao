---
id: "00049"
title: "architecture is written in `docs/architecture`, and a document about one container lives in that container's folder"
status: accepted
date: 2026-09-14
tags: ["docs", "repo", "conventions"]
components: ["docs"]
paths: ["pub/docs/architecture"]
symbols: ["containers/<name>", "views/"]
triggers: ["where to write architecture", "new container doc", "shelf", "container folder", "store-root-absolute link", "file repeats folder"]
supersedes: []
superseded_by: []
---

# 00049 — architecture is written in `docs/architecture`, and a document about one container lives in that container's folder

**Decision:** [`docs/architecture`](/docs/architecture/README.md) is the one place the architecture
of KIAO is written down, and it has three shelves:

- **[`containers/<name>/`](/docs/architecture/containers/README.md)** — one folder per C4 container,
  an independently deployable or runnable unit (`dashboard`, `worker`, `hybridflow-store`,
  Keycloak). A document that concerns **one**
  container alone goes in that container's folder.
- **[`views/`](/docs/architecture/views/Functions.md)** — the baseline overview: which container
  plays which rôle, how they talk to each other, where each one is deployed.
- **the root of `docs/architecture`, and [`decisions/`](/docs/architecture/decisions)** — everything
  that spans two containers or more: the target architectures, and these logs.

Four rules follow from it, and they are the whole of the convention:

1. **Exclusivity decides the shelf.** "Related to a container" is not enough — a document moves into
   `containers/<name>/` only when that container is its whole subject. A document about DCMS is
   about the file/content feature of dashboard *and* the files service in worker, and one about
   hybridflow spans three parts — so both stay a level up, however much of either is one of the two.
2. **The folder names the container, so the file names the subject.**
   `containers/hybridflow-store/boards-in-a-database.md`, not
   `containers/hybridflow-store/hybridflow-store.md`. A file name that repeats its folder says
   nothing twice.
3. **A folder appears when a document does.** A container with nothing written about it yet has no
   folder, and that is the normal state — not a gap to fill with a placeholder.
4. **Link into these documents with a store-root-absolute path** — `/pub/docs/architecture/containers/…`
   while this tree lives inside the monorepo, `/docs/architecture/containers/…` once it stands
   alone — from code comments and from other documents alike. A relative `../..` is depth-dependent and
   silently wrong the next time something moves; the absolute form survives, and it is the store's
   own link convention (see AGENTS.md, *a link is a path with a leading slash*).

**Why:** the containers are the unit a person actually works in — a branch touches one service, a
deployment ships one binary, a question is about one process — and until this the architecture
folder was flat, so finding what was written about a container meant opening every file to see
whose it was. C4's container level is already the vocabulary
[`views/Functions.md`](/docs/architecture/views/Functions.md) uses, so the folders name things the
diagrams had named first; the shelf is not a new taxonomy, it is the one already in use given
somewhere to put files.

**What this buys an agent:** a reliable path. Asked to understand or change a container, read
`docs/architecture/README.md`, then `containers/README.md` — which lists every container whether or
not it has documents — then that container's folder if it has one. Asked to *write* architecture,
place the new document by rule 1 rather than by where the neighbouring files happen to sit, and say
so in `docs/architecture/README.md`, which is the index and is expected to stay complete.

**The cost accepted:** moving a document breaks every inbound link, and the inbound links are mostly
in code — a package comment pointing at the schema, a README pointing at the reasoning. Rule 4 is
what keeps the next move a rename plus a `grep`, and the move that established this convention was
exactly that: two documents, five referring files, one `git mv` each.
