# Deviations from the Java version

← [worker](/operation/worker/README.md) · assumes the index and [Endpoints](/operation/worker/docs/solution-design/endpoints.md).

- The `indexed` flag in `/list` is computed from each file's actual on-disk index path, so it is
  reported correctly inside subdirectories (the Java version only detected it at the data root).
- **Indexing is a conversion, not a text dump.** The Java service wrote one `<name>.index.txt` per
  document whatever the document was; this one writes the format the source deserves — Markdown
  for a document, CSV for a workbook — and covers `.eml` and `.msg` on top of the Java set. A
  `.index.txt` an older service left is still read; `POST /reindex` is how a store converts them.
- The link-fixer's path rewrite handles a leading-slash on the matched token without the
  off-by-one present in the Java implementation; relative (no-slash) references — the common
  case — rewrite identically.
- **`/search` is a deliberate break with the Java wire shape** — the only one. The
  `caseSensitive`, `wholeWord` and `regex` flags are gone, replaced by a query language in the
  `query` parameter alone (see [PROTOCOL.md](/operation/worker/PROTOCOL/search-indexes.md)), and the response is a `{ results, truncated }`
  envelope rather than a bare array. Three things follow from it: the AND between conditions is
  satisfied at *document* level rather than per line, every condition is tried against the file's
  name as well as its content, and the walk stops at `maxSearchResults`. This is not a parity gap
  to close; `ADDING-AN-ENDPOINT.md`'s "wire compatibility is sacred" rule still governs everything
  else.
- User-supplied regex terms use Go's RE2 engine instead of `java.util.regex`; literal searches
  behave the same, exotic back-tracking regexes may not. `\b` is available, and is what replaced
  the old whole-word flag.

Two more deviations are from **this service's own earlier behaviour** rather than from the Java one,
which had no Claude feature at all. One an operator meets on the first prompt after the upgrade, and
the other is a wire that was broken on purpose:

- **A turn's working directory moved from the store root to the conversation's folder.** It used to
  run at `KIAO_WORKER_ROOT_PATH` whatever the user had selected, with the intended folder
  described to the model in a line of prose; now it is the process's actual working directory,
  absolute and symlink-resolved. Any prompt that relied on relative paths from the store root
  resolves differently — which is the point of the change. `--setting-sources` also defaults to
  `user` now, so a `.claude/settings.json` that arrives in the store through `git pull` is no longer
  loaded.
- **The `/ws/hybridflow-runner` protocol broke compatibility**, deliberately: `flowNodeId`, `attach`,
  `prompt.path` and `prompt.sessionId` are gone, and a turn is keyed by a server-owned
  `conversationId`. The "wire compatibility is sacred" rule is about the **HTTP** surface, where
  this change is purely additive — the socket has one consumer, versioned in lockstep by
  `hello.protocolVersion`, and a stale bundle is told to reload rather than left half-working. The
  full argument is in [PROTOCOL.md](/operation/worker/PROTOCOL/socket-frames.md) § WebSocket.

