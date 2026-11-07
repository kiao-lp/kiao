---
status: DRAFT
role: PRIMARY_SOURCE
---

# Panel suites

Part of the [Dashboard solution design](README.md).

Panels are [toolbar tabs](tool-bars.md), declared with ID, title, icon, placement and rendering
options. Load panel data on first reveal rather than on mount: document layouts remount bars,
and a never-opened tab should not cause requests.

## Git

Git is a cms-core integration gated by `gitEnabled`, because it owns application diff mode.

| Source under `src/cms-core/git/` | Responsibility |
| --- | --- |
| [GitPanel.tsx](../../src/cms-core/git/GitPanel.tsx) | Status, staging and commit UI |
| [useGitStatus.ts](../../src/cms-core/git/useGitStatus.ts) | Last-request-wins polling |
| [useGitActions.ts](../../src/cms-core/git/useGitActions.ts) | Stage, revert, commit, consolidate and remote operations; local result reporting |
| [GitConsolidateModal.tsx](../../src/cms-core/git/GitConsolidateModal.tsx) | Confirm history consolidation and show its report |
| [GitDiff-ctx.tsx](../../src/cms-core/git/GitDiff-ctx.tsx), [GitDiffView.tsx](../../src/cms-core/git/GitDiffView.tsx) | Diff target, draft and Document stack view |
| [GitSyncMonitor.tsx](../../src/cms-core/git/GitSyncMonitor.tsx) | Fetch on mount, pull prompts and ahead/uncommitted counts |

Changes → More actions offers consolidation into one commit to reclaim history space.
For a tracking branch it also force-pushes the rewrite; confirmation describes this irreversible
operation. Its result needs a modal report rather than a transient toast.

## Conversations

[ChatPrompt](../../src/plugins/chat/ChatPrompt.tsx) hosts the switcher and pinned panes;
[ChatConversationPane](../../src/plugins/chat/ChatConversationPane.tsx) owns one transcript
and composer. Contributions are gated by `chatEnabled`; the app-level providers survive
navigation. The panel reads socket, registry and options once and shares them across panes.

### Starting, pinning and forking

Each offered agent has a named starter with a plus icon. A conversation's engine is immutable,
so there is no engine selector in the composer. Model, effort and permission carry into a new
conversation only when its platform matches the current one.

Pinning stores `pinned` on the conversation record and opens it in its own column beside the
main switcher. The layout travels across browsers; it does not affect execution. Columns may
use the full available width, keeping the resize handle reachable.

Fork is offered on user messages. The service copies the conversation **before** that prompt,
returns its text to the main composer and selects the copy. The original remains unchanged.
`POST /hybridflow-runner/conversations/{id}/fork` with `fromMessageId` forks the transcript and
provider session. Claude sessions use `--fork-session` and `--resume-session-at` to keep remembered
context aligned with the visible copy.

### Transport and rendering

[ChatSocket](../../src/plugins/chat/ChatSocket-ctx.tsx) connects to
`ws[s]://<host>/api/ws/hybridflow-runner` (worker `/ws/hybridflow-runner`) and handles turns,
attachments and controls using the `kiao-worker` wire unions.

[ChatMessageList](../../src/plugins/chat/ChatMessageList.tsx) renders text, thinking and tool blocks in produced order. Indexed `output`/`tool_use` updates and full `sync` replay keep that order. Thinking collapses in place; tool chips expose full input. Transcripts without blocks render as flat text and chips.

Text uses `ConfiguredMarkdown`, including diagram fences and store links opened in place.
Worker's `agents/prompt/briefing.go` tells turns how these features work.

### Permissions, questions and steering

[ChatPermissionRequests](../../src/plugins/chat/ChatPermissionRequests.tsx) shows pending calls:

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

[ChatQuestions](../../src/plugins/chat/ChatQuestions.tsx) renders agent questions separately
from permissions: radios, checkboxes and free text, returning one answer string per question.
Questions appear in every permission mode and have no automatic answer or countdown.
Dismissal sends an empty answer; leaving a card unanswered parks the turn.

### Usage and host login

[ChatUsageTab](../../src/plugins/chat/ChatUsageTab.tsx) offers a refresh per agent over
[usage gauges](../../src/plugins/chat/ChatUsagePanel.tsx). Data loads only on request and is
shared through [ChatUsageProvider](../../src/plugins/chat/ChatUsage-ctx.tsx).

[ChatLoginPanel](../../src/plugins/chat/ChatLoginPanel.tsx) handles the **server-side** CLI login
when [useChatAuth](../../src/plugins/chat/useChatAuth.ts) reports signed out. The service provides
an authorization URL; the user approves it and pastes the code to the waiting CLI. Signed-in
or unreadable status renders no login panel. `loginEnabled` controls endpoint availability.
