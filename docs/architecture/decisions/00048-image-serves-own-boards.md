---
id: "00048"
title: "the image serves its own boards, and refuses a service elsewhere"
status: accepted
date: 2026-09-13
tags: ["image", "hybridflow-store", "deploy"]
components: ["hybridflow-store", "worker"]
paths: []
symbols: ["KIAO_WORKER_WORKFLOWS_URL", "KIAO_WORKFLOWS_SERVICE_DATABASE_URL", "anonymous"]
triggers: ["image boards", "VPS boards", "remote override", "named volume", "trust auth", "service token", "bind mount modes"]
supersedes: []
superseded_by: []
---

# 00048 — the image serves its own boards, and refuses a service elsewhere

**Decision:** the `kiao` image carries PostgreSQL and the workflows-service and starts both,
so its boards live in the container and it works with no VPS behind it. `kiao` the executable
and `bin/local-start-kiao.sh` stay clients of the VPS's service by default — that is the machine
they were configured on — while the image is the copy handed to somebody else, and one that wrote
into the live boards from another machine would be a stranger with a key.

**No remote override.** `KIAO_WORKER_WORKFLOWS_URL` is refused at startup rather than
honoured: the worker reads that variable itself, so honouring it would write a run's answer
to the named service while nginx still sent the SPA's cards to the container — two places for one
board, and each half working well enough that nobody would notice for a while. The one escape
hatch is `KIAO_WORKFLOWS_SERVICE_DATABASE_URL`, a PostgreSQL for this container's own service to
serve, which keeps the pair on one database however it is pointed.

**Trust on the loopback, a token per start, boards per volume.** The database listens on 127.0.0.1
alone with trust authentication, since nothing outside the container can reach it and there is no
password to keep; the service token the two Go halves share is minted per start and never written
down, like the launcher's; and the data lives or dies with the container unless a named volume is
put under it — a bind mount's modes defeat the server, which is the same reason the development
volume is a named one. What the browser writes with no login is recorded as `anonymous`, which is
the truth about it.

## Refactor notes

Entry text still says `workflows-service` / `KIAO_WORKER_WORKFLOWS_*`; read through the HybridFlow rename (00054).
