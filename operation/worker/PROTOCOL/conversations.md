---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Harness attachments and conversations

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index and [harnesses](/operation/worker/PROTOCOL/harnesses.md).

## Harness attachments

A file the user hands a turn: a screenshot pasted into the message box, a PDF dropped on it, a file
picked from disk.

| Method | Path | Query / body | Response |
|---|---|---|---|
| POST | `/hybridflow-runner/attachments` | multipart `file`, optional `name` | `201` + `HarnessAttachmentDto` |
| GET | `/hybridflow-runner/attachments/{id}` | — | the bytes, `Content-Type` from the extension |

**The CLI takes text on a pipe and nothing else, so an attachment is a file on this host and the
prompt is told where it is.** A turn reads it with the Read tool, which is why the mechanism carries
a `.docx` as readily as a PNG and needs no per-format handling anywhere. `promptWithContext` appends
the note that names them:

```
---
The user attached these files to the message above. Read them with the Read tool — the paths are
absolute, so use them as written:
- /srv/store/.kiao-config/claude-attachments/att-1756100000000-a1b2-shot.png (image/png, 84213 bytes)
---
```

They live in `KIAO_WORKER_STATE_PATH/claude-attachments`, beside the conversations and **not**
in the store. An attachment is not content: nobody browsed to it and nobody named it, and a store
that filled with pasted screenshots would put every one of them in `git status` and in a published
site. The state directory is refused by the file API, left out of every listing and carries a
`.gitignore` of `*`, which is the treatment a transient upload wants.

The **id is the file name**, and the whole of what stands between a client-supplied path segment and
`filepath.Join`: `att-`, the creation millis, four random hex, and the uploaded name reduced to
`[A-Za-z0-9._-]`. Validated by shape rather than sanitised on the way in, exactly as a conversation
id is. Carrying the name in the id is what keeps one artefact per attachment — no metadata sidecar —
and is also what the model sees, so a path ending in `shot.png` is identifiable in the prompt.

`name` on the wire is therefore the name **as stored**, not as uploaded. A client should render that
one: it is what the model was told the file is called, so the two never differ.

Four rules complete the contract:

- **One upload per request**, capped at 25 MB. The cap is enforced on the bytes as they are written
  rather than from the `Content-Length`, and a body that exceeds it leaves nothing behind — a
  half-written image is worse than none, because a turn would report on it without knowing.
- **A prompt may name at most ten**, in the order the user attached them, which is the order the
  model is given them in.
- **A prompt naming one that is not there is refused** with `bad_attachment` rather than run without
  it. A model answering about a screenshot it never saw is the one failure neither side can detect.
- **They are swept after 30 days, at startup only.** There is no second timer: at startup nothing can
  be reading them, which is what makes a sweep that cannot race a turn possible. The transcript is
  unaffected — a message records what was attached, so a conversation still says a screenshot was
  attached here long after the bytes have gone, and a `GET` for one of those is a `404`.

A malformed id is `400` and a swept or unknown one is `404`: the remedies differ, one being a bug in
the client and the other an attachment that has aged out and must be uploaded again.

## Harness conversations

A **conversation** is a durable, server-owned thread: an id, a title, the folder it runs in, the CLI
session it resumes, the settings its next turn defaults to, and a transcript. It is what `/ws/hybridflow-runner`
multiplexes and what a turn belongs to. It lives under `KIAO_WORKER_STATE_PATH`, never in the
browser — a conversation a user left open in one tab is there in the next one, and on the next
machine.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/hybridflow-runner/conversations` | `archived=true` to include archived ones | `HarnessConversationDto[]`, newest `updatedAt` first |
| POST | `/hybridflow-runner/conversations` | `CreateConversationRequestDto` | `201` + `HarnessConversationDto` |
| GET | `/hybridflow-runner/conversations/{id}` | — | `HarnessConversationDetailDto` — the summary plus the whole transcript |
| PATCH | `/hybridflow-runner/conversations/{id}` | `PatchConversationRequestDto` | `HarnessConversationDto` |
| DELETE | `/hybridflow-runner/conversations/{id}` | — | `204`; the running turn is stopped first |
| POST | `/hybridflow-runner/conversations/{id}/fork` | `HarnessForkRequestDto` (`fromMessageId?`, `agentId?`, `harness?`, `profileId?`, `model?`) | `201` + `HarnessConversationDto` — a copy carrying on from a point in this one |

`POST /hybridflow-runner/conversations` requires `agentId` and accepts `harness`, `profileId`, `model`,
`folder`, `title`, `effort`, `permissionMode` and `thinking`. The worker checks the harness
against the latest publication and the local runtime. An explicit `model` selects a catalogue
model for this conversation. With the field omitted, the worker uses the publication's model
or resolves the harness default. `profileId` selects a Pi profile on that worker. `folder` is the CLI’s working directory
relative to the store root. `""` selects the root.

The response includes `agentVersion`, which captures the selected publication and its effective
harness, model, effort and profile. Its `version` is the APM release string, such as `"1.2.3"`.
The folder, model and profile are fixed for the conversation’s lifetime.
Every turn loads the publication’s standing instructions, skills and MCP tools and records
`agentRef` and the release string as `agentVersion` on its prompt and reply. A prompt can set reasoning effort,
permissions and extended thinking for that turn. An unsupported permission mode returns `400`
at creation or patch and `mode_unsupported` on the socket.

`PATCH` accepts `title`, `archived`, `pinned`, `effort`, `permissionMode`, `thinking`
and `traceStream`. Omitted fields keep their values. Clearing `title` lets the next prompt
name the conversation. Worker derives the title from the first nonempty prompt line, with
whitespace collapsed and a 60-rune limit.

Archived and older transcripts can be read through the same read endpoints. A conversation with
no packaged agent publication can fork onto one. The socket reports `agent_package_required`
when such a conversation is asked to start a turn.

`running` is the turn registry's answer, not the disk's. The stored metadata records that a turn was
*started*, so a restart can settle it; whether one is live right now is only ever known in memory.

A fork uses the source folder and copies the transcript up to the fork point. The fork notice
records the source title and identifiers (`forkFrom` and `forkFromMessage`). The new
conversation also stores `forkedFrom` and `forkedFromMessage`.

**`fromMessageId` is that point, and the copy stops _short_ of it.** Forking is asked of a *prompt* —
"branch here" means "everything before this is history, and this is the message I am going to ask
again, differently" — so the message named is the first thing the copy does *not* have. Omitting it
forks the conversation whole, which is the same request said of its end. A message id this
conversation's transcript does not hold is a `404` rather than a fork of everything: it is the client
pointing at a record that was compacted away or belongs elsewhere, and widening the request would
hand back a copy remembering more than was asked for.

**Cutting the transcript is not cutting the session**, and the second is what the model actually has.
Each assistant record therefore carries a `sessionAnchor`: the uuid the CLI gave the last message of
that turn. A fork branching at a point resumes with `--resume-session-at=<anchor of the last reply it
kept>`, so the session stops exactly where the copied transcript does — the CLI keeps those uuids
across `--fork-session`, so an anchor written before a fork is still good inside it. A fork from a
point with no reply behind it — the very first prompt, or a transcript written before anchors
existed — has nothing to anchor to, so it takes **no session at all** and starts one of its own; its
notice says as much, because history the model was never given must not look like history it has.

`agentId` selects the agent for the fork. It defaults to the source agent’s ID and is required
when the source has no agent. The fork takes the chosen agent’s latest publication. Compatible
harnesses and profiles may branch the native session. A change of harness or Pi profile starts a
separate session. Pi supplies the copied transcript as context when it starts a separate session.
For other harnesses, the fork notice describes the available context.

**The source is not touched, at all**, which is the whole point: a fork is how a second direction is
tried without spending the first one. It is the *fork* that gives way, because two conversations may
not write one CLI session — it is marked server-side, and its first turn is spawned with
`--fork-session`, so the CLI replays the session it was handed and carries on under an id of its own.
Until that turn runs, the fork's `sessionId` names what it will branch from rather than what it will
write; the marker is cleared the moment the CLI announces the new id, and cleared just as surely when
the resume is refused, since there is then nothing left to branch from. The new conversation is
broadcast as a `conversation` frame like any other, so every tab's switcher shows it at once.

A turn running in the source is a `409` rather than something to wait for or stop: the fork copies
the transcript and the session as they are *now*, and a reply still being written would land in one
and not the other. Stopping it — which is what `DELETE` does — is only defensible when there is no
conversation left to damage. A full registry is a `409` too, and a folder gone since the source was
made is a `404`: the fork's folder is fixed for its life like any other conversation's; so is a
`fromMessageId` naming no message of this transcript.

`archived` and `pinned` are the two things a client is told about *where* a conversation belongs in a
switcher, and neither changes what a turn does. Archiving takes it out of the list without losing it,
which is why an archived one is left out of `GET /hybridflow-runner/conversations` unless asked for. Pinning
leaves it in the list and asks for it to be shown alongside the others rather than among them — a
column of its own in Dashboard. Both are stored here rather than in the browser, for the reason the
rest of the record is: a conversation the user arranged in one tab is arranged the same way in the
next one, and on the next machine.

`traceStream` is the one switch that changes what is *written down* about a turn rather than how it
is shown. Every turn leaves a trace beside the transcript — how its process was run and everything
the harness wrote to stderr — and this adds the raw protocol to it, in both directions, for the turns
that follow. It is off by default because it is the whole exchange rather than the reply: unbounded,
and uninteresting until something is wrong. See
[what a conversation folder holds](/operation/worker/docs/solution-design/conversation-folder.md).

Status mapping, all through `core.WriteError`: a malformed id → `400` (it is a path segment, so its shape
is the traversal boundary and it never reaches `filepath.Join`), an unknown one → `404`; a folder
outside the store root → `400`, one that is gone → `404`, one that is a file → `400`; a malformed
body, an unknown `permissionMode`, or a `permissionMode` of `bypassPermissions` on a service that has
withdrawn it → `400`; the 500-conversation cap → `409`; a fork asked for while a turn is running in
the conversation → `409`; a fork's `fromMessageId` naming no message of that transcript → `404`. **The creation-time folder check is a
convenience, not a gate** — it refuses a dead end at the point the user picked the folder — and the
socket handler re-resolves the folder before every turn, which is what catches one renamed or deleted
since.

Two caps bound a transcript, and both cost display history rather than the model's memory, whose
copy is the CLI's own session file: one record is cut at 256 K characters and 500 tool calls, and a
transcript over 8 MiB is compacted to 4 MiB by dropping its oldest records. Either leaves a marker —
`truncated` on the record, a `notice` line in place of what was dropped — so a gap is visible instead
of reading as an answer that simply stopped. Both of the record's caps are spent from the **end** of
the turn, since what a reader wants from one that ran away is what it was doing when it finished.

Deleting removes this service's directory only. The CLI's own
`~/.claude/projects/<slug>/<sessionId>.jsonl` stays: `claude project purge` takes a directory rather
than a session, so purging one conversation there would take the folder's other sessions with it.

Creating, patching and deleting each broadcast a registry frame to every open socket, so a switcher
left open in another tab updates without polling.
