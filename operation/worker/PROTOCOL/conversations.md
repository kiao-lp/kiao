# Agent attachments and conversations

← [worker wire protocol](/operation/worker/PROTOCOL.md) · assumes the index and [agents](/operation/worker/PROTOCOL/agents.md).

## Agent attachments

A file the user hands a turn: a screenshot pasted into the message box, a PDF dropped on it, a file
picked from disk.

| Method | Path | Query / body | Response |
|---|---|---|---|
| POST | `/hybridflow-runner/attachments` | multipart `file`, optional `name` | `201` + `AgentAttachmentDto` |
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

## Agent conversations

A **conversation** is a durable, server-owned thread: an id, a title, the folder it runs in, the CLI
session it resumes, the settings its next turn defaults to, and a transcript. It is what `/ws/hybridflow-runner`
multiplexes and what a turn belongs to. It lives under `KIAO_WORKER_STATE_PATH`, never in the
browser — a conversation a user left open in one tab is there in the next one, and on the next
machine.

| Method | Path | Query / body | Response |
|---|---|---|---|
| GET | `/hybridflow-runner/conversations` | `archived=true` to include archived ones | `AgentConversationDto[]`, newest `updatedAt` first |
| POST | `/hybridflow-runner/conversations` | `CreateConversationRequestDto` | `201` + `AgentConversationDto` |
| GET | `/hybridflow-runner/conversations/{id}` | — | `AgentConversationDetailDto` — the summary plus the whole transcript |
| PATCH | `/hybridflow-runner/conversations/{id}` | `PatchConversationRequestDto` | `AgentConversationDto` |
| DELETE | `/hybridflow-runner/conversations/{id}` | — | `204`; the running turn is stopped first |
| POST | `/hybridflow-runner/conversations/{id}/fork` | `AgentForkRequestDto` (`fromMessageId?`, `agent?`) | `201` + `AgentConversationDto` — a copy carrying on from a point in this one |

**`folder` is fixed at creation and is absent from the patch payload on purpose.** It is two things
at once — the CLI's working directory and the folder whose slug owns the CLI's own transcript — and
they have to agree, so a prompt for a different folder is a different conversation. `""` is the store
root.

**`agent` is fixed at creation too, and for a stronger reason.** A session id belongs to one engine:
nothing resumes a Claude session with `codex exec` or the reverse. A conversation that changed agent
would be holding a session that no longer means anything, under a transcript claiming it had been
continued. So it is set at creation, omitted from the patch payload, and reported resolved — a
conversation stored without one reads as the default rather than as an empty string, which is what
every conversation written before agents were a choice actually ran on.

Changing agent is a **fork**, below. An `agent` this deployment does not offer is a `400` at
creation, and a `permissionMode` that agent does not have is a `400` at creation and at patch. A
conversation bound to an agent the deployment has *since* withdrawn is refused at its next prompt
with `unknown_agent`, which names the fork as the way on.

A conversation's folder is a **scope, not a sandbox**: it is where the CLI process starts, and the
whole store is handed to it as `--add-dir`, so a turn started in one unit reads and writes another
without asking. Beyond the store, `Read` and `Bash` take absolute paths and reach whatever the
service user can. What bounds a turn is the permission mode and the human answering it.

Every other field is a default the next `prompt` may override for one turn, and every patch field is
optional: an omitted one is left alone rather than reset. Emptying `title` *is* a reset — the
conversation goes back to being named after its first prompt, which is what emptying a rename box
looks like it should do. A title nobody set is derived from the first non-empty line of the first
prompt, whitespace-collapsed and cut at 60 runes; deriving it is deliberately not a model call,
because a title has to exist the moment the first message is sent.

`running` is the turn registry's answer, not the disk's. The stored metadata records that a turn was
*started*, so a restart can settle it; whether one is live right now is only ever known in memory.

**Forking** is a copy that carries on from a point in the source: the same folder, the same settings,
the transcript down to that point, and the same CLI session picked up in the same place. The session
is what makes it a fork rather than a new chat with someone else's history pasted above it — Claude
remembers the copy. The transcript is closed with a `notice` naming what it was forked from, which is
where the two conversations stop being one. The notice carries the source's title for a reader and
its id (`forkFrom`, `forkFromMessage`) for anything that has to follow the link after the source has
been renamed; the copy's own record carries the same pair (`forkedFrom`, `forkedFromMessage`), which
is what survives the notice being compacted away.

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

**Forking onto another agent is how a conversation changes engine**, and `agent` on the body is what
asks for it. The copy runs on the named agent, and it never carries the session — a session id is one
engine's own, so there is nothing to hand over. What it does carry is the transcript, as a preamble:
the same records, read the same way, closed with the same fork notice, which names the new agent and
says in as many words that it was not given that history. Its `model`, `effort` and `permissionMode`
become the *new* agent's own rather than the source's, because all three are vocabulary of the engine
that ran them — a Codex conversation inheriting `sonnet` names nothing it can run, and one
inheriting `manual` would be refused at its first prompt.

Reusing the fork machinery is the honest way to say this. The alternative — letting a conversation
switch agent in place — would leave a transcript claiming a continuity that does not exist.

A fork onto the **same** agent is the fork it always was, except where that agent cannot branch a
session at all. Codex can continue a thread and not branch one, so a fork of a Codex conversation
takes the transcript and no session: two conversations resuming one thread would be two writers on
it. The notice says so, as it does for any other fork that carries no session.

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
the agent wrote to stderr — and this adds the raw protocol to it, in both directions, for the turns
that follow. It is off by default because it is the whole exchange rather than the reply: unbounded,
and uninteresting until something is wrong. See
[what a conversation folder holds](/docs/architecture/containers/worker/conversation-folder.md).

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
