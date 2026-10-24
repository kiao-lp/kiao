---
id: "00006"
title: "file actions are declared, not implemented, in worker"
status: accepted
date: 2026-08-10
tags: ["worker", "file-actions", "dcms"]
components: ["worker", "dashboard"]
paths: ["operation/worker"]
symbols: ["KIAO_WORKER_ACTIONS_PATH", "GET /actions", "POST /actions/run", "files/actions.go"]
triggers: ["new action", "operation on a file", "provider URL", "manifest entry", "tts.speech", "unit.publish"]
supersedes: []
superseded_by: []
---

# 00006 — file actions are declared, not implemented, in worker

**Decision:** an operation a client can run on a file is a **manifest entry**
(`KIAO_WORKER_ACTIONS_PATH`) naming an id, a label, an applicability rule and the URL of the
service that implements it; worker serves the descriptors (`GET /actions`) and proxies the
run (`POST /actions/run`), forwarding the caller's bearer token, and knows nothing else.
`files/actions.go` mentions no TTS and no units. **Why:** the alternative — an in-process Go
registry — would have meant reimplementing Google/Azure synthesis inside a
service whose whole job is files, and every new action would have been a new deployment of it. With
the manifest, `tts.speech` and `unit.publish` are ordinary endpoints on the publication
service, and a third action is a JSON entry plus an endpoint wherever it belongs — no Go, no
Dashboard code. The provider URL is never disclosed to a client: a client names an action by id, and
routing stays deployment configuration.
