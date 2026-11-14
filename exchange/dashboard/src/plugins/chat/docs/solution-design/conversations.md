---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Conversations panel

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

[ChatPrompt](../../ChatPrompt.tsx) hosts the switcher and pinned panes;
[ChatConversationPane](../../ChatConversationPane.tsx) owns one transcript
and composer. Contributions are gated by `chatEnabled`; the app-level providers survive
navigation. The panel reads socket, registry and options once and shares them across panes.

## Starting, pinning and forking

Each offered harness has a named starter with a plus icon. A conversation's engine is immutable,
so there is no engine selector in the composer. Model, effort and permission carry into a new
conversation only when its harness matches the current one.

Pinning stores `pinned` on the conversation record and opens it in its own column beside the
main switcher. The layout travels across browsers; it does not affect execution. Columns may
use the full available width, keeping the resize handle reachable.

Fork is offered on user messages. The service copies the conversation **before** that prompt,
returns its text to the main composer and selects the copy. The original remains unchanged.
`POST /hybridflow-runner/conversations/{id}/fork` with `fromMessageId` forks the transcript and
provider session. Claude sessions use `--fork-session` and `--resume-session-at` to keep remembered
context aligned with the visible copy.

## Transport and rendering

[ChatSocket](../../ChatSocket-ctx.tsx) connects to
`ws[s]://<host>/api/ws/hybridflow-runner` (worker `/ws/hybridflow-runner`) and handles turns,
attachments and controls using the `kiao-worker` wire unions.

[ChatMessageList](../../ChatMessageList.tsx) renders text, thinking and tool blocks in produced order. Indexed `output`/`tool_use` updates and full `sync` replay keep that order. Thinking collapses in place; tool chips expose full input. Transcripts without blocks render as flat text and chips.

Text uses `ConfiguredMarkdown`, including diagram fences and store links opened in place.
Worker's `harnesses/prompt/briefing.go` tells turns how these features work.

## Permissions, questions and steering

[ChatPermissionRequests](../../ChatPermissionRequests.tsx) shows pending calls:

| Mode | UI and service behavior |
| --- | --- |
| `manual` | Park the turn until each request is allowed or denied |
| `manualLive` | Show the service's `decideAt` deadline; allow on expiry unless answered first |
| `bypassPermissions` | No approval prompt; the selector uses warning colors |

The active turn's `start`/`sync` frame supplies its mode; composer settings describe the next
turn. A reload reattaches and receives pending requests in `sync`; they are not persisted
in browser state. At expiry a card says “Allowing…” until `permission_resolved` removes it.

During a running turn, Send emits text-only `between` rather than starting another prompt.
The service feeds the CLI's open stdin at its next tool boundary. Model, effort, permission
and attachment controls stay disabled while Send and Stop remain available. The transcript
records `role: user`, `between: true` and captions it “said mid-turn” above the affected reply.
If the turn ended before delivery, `no_running_turn` restores the text to the composer.

[ChatQuestions](../../ChatQuestions.tsx) renders harness questions separately
from permissions: radios, checkboxes and free text, returning one answer string per question.
Questions appear in every permission mode and have no automatic answer or countdown.
Dismissal sends an empty answer; leaving a card unanswered parks the turn.

## Usage and host login

[ChatUsageTab](../../ChatUsageTab.tsx) offers a refresh per harness over
[usage gauges](../../ChatUsagePanel.tsx). Data loads only on request and is
shared through [ChatUsageProvider](../../ChatUsage-ctx.tsx).

[ChatLoginPanel](../../ChatLoginPanel.tsx) handles the **server-side** CLI login
when [useChatAuth](../../useChatAuth.ts) reports signed out. The service provides
an authorization URL; the user approves it and pastes the code to the waiting CLI. Signed-in
or unreadable status renders no login panel. `loginEnabled` controls endpoint availability.
