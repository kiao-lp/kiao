---
id: "00008"
title: "publishing a unit is resolved server-side"
status: accepted
date: 2026-08-10
tags: ["units", "publishing", "file-actions"]
components: ["worker", "dashboard"]
paths: []
symbols: ["unit-loader.ts", "FileStore", "resolveUnitContents", "expml"]
triggers: ["publish", "unit export", ".mlunit.json", "payload assembly", "Export button"]
supersedes: []
superseded_by: []
---

# 00008 — publishing a unit is resolved server-side

**Decision:** the publish action takes the path of a `.mlunit.json` and the publication service
follows the content chain itself (`unit-loader.ts`, reading through a new `FileStore` port); the
unit-edit Export button now runs that action, so the button and the file browser's contextual menu
share one implementation. The browser no longer assembles a publish payload. **Why:** an action is
reachable from a context menu, where there is nothing but a path — so "publish" only becomes an
action once the server can publish from a path alone, and having Dashboard download every article and
podcast just to re-upload them was always the odd part. The consequence to accept: `go-unit-builder`
has no action endpoint yet, so its `expml` build path still resolves the chain in the browser and
`resolveUnitContents` lives in both places until it gets one.
