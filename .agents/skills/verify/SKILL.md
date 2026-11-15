---
name: verify
description: How to launch and drive the KIAO dev stack to verify changes end-to-end (Dashboard + worker, no boards backend).
---

# Verifying KIAO changes at runtime

## Launch the full stack (recommended handle)

The e2e harness starts everything with throwaway data — no config and no
Docker needed:

```bash
cd e2e && bash bin/start-env.sh   # run in background; ~60s to ready
```

Services: worker (:48310, auth debug) and Dashboard (:48332, no
security) — the two containers, and nothing else: no hybridflow-store, so no boards.
Data root is a temp copy of `e2e/data/files-template` at `/tmp/kiao-e2e-<ts>`
— inspect it directly to verify writes. The script's EXIT trap tears
everything down, so kill the background flow node to clean up.

Ready check: `curl -s --noproxy '*' http://localhost:48332/dashboard/`.

## Boards need a service the harness does not start

A board is a row in PostgreSQL behind **hybridflow-store**, and `start-env.sh`
starts no such service. So the boards page of that stack answers nothing: the
dev proxy sends `/api/hybridflow` to `KIAO_WORKER_HYBRIDFLOW_URL`, which
defaults to `http://localhost:18081` with nothing listening on it.

To check anything about a board at runtime, give the stack a backend before
launching it:

```bash
KIAO_WORKER_HYBRIDFLOW_URL=… KIAO_WORKER_HYBRIDFLOW_TOKEN=… \
  bash bin/start-env.sh
```

Run one of your own for that — `operation/hybridflow-store/README.md` has the
two commands, a throwaway postgres container and `go run .`. **Do not point it
at the production service**: the boards there are the real ones, one list for
every environment, and a verification run would be writing to them.

## Gotchas

- **Corporate proxy**: when `http_proxy` is set, always use
  `curl --noproxy '*'` for localhost or you get a bogus 403.
- Go toolchain: the scripts look on `PATH`, then in `~/go-sdk/go/bin/go` and
  `~/sdk/go/bin/go` — one of those must hold Go 1.24+.
- Expected console noise in the browser: 404 for `/config/dashboard.json` on a
  first run (the config document is seeded on that 404).

## Driving Dashboard (Playwright MCP)

- Open a file directly: `http://localhost:48332/dashboard/<path>` (e.g.
  `welcome.md`, `works/beta/article.md`).
- Markdown editor source pane is `.cm-content` (CodeMirror 6).
- Unit editor: bottom-toolbar buttons switch views (setting=config,
  file-text=article, edit=exercises); the article view needs the Article
  switch enabled in the config view's Translations table first.
- Synthetic image paste (clipboard APIs unavailable headless): build a
  `File` from a canvas blob, put it in a `DataTransfer`, dispatch
  `new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })`
  on `.cm-content`.
- Worker API for asserting writes: `GET :48310/list?path=` /
  `getFile?path=` (debug auth mode accepts unauthenticated requests).
