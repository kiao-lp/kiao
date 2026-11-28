---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Conversations panel

Part of the [Dashboard solution design](../../../../../docs/solution-design/README.md).

[ChatPrompt](../../conversations/ChatPrompt.tsx) hosts the switcher and pinned panes;
[ChatConversationPane](../../conversations/ChatConversationPane.tsx) owns one transcript
and composer. Contributions are gated by `chatEnabled`; the app-level providers survive
navigation. The panel reads socket, registry and options once and shares them across panes.

## Starting, pinning and forking

**New conversation** opens the shared agent catalogue. Choosing an agent and model there creates
the conversation at once, with no confirmation step. Sending a draft from the empty composer
opens the same picker. Dashboard creates the conversation in the current folder and worker
captures the selected agent’s latest publication. Each turn loads its instructions, skills and
MCP tools through the same runner as board tasks. Model and profile come from the publication.
The composer offers reasoning effort, permissions and extended thinking for the next turn; a
microphone beside them dictates into the message box.

The response token limit button displays the selected value and opens a 4 × 4 grid with **None**
and the first 15 distinct positive Fibonacci values multiplied by eight. The panel remembers the
choice per conversation while it is open.
A numeric choice asks the agent to keep all visible replies for the turn within the selected
budget. The worker adds that instruction to the model prompt and records the user’s original text.

Every cell of that catalogue reads **Select**: the column header carries the harness, the model
or the Pi profile, and the row heading the agent.

**Use local draft** includes unpublished agents and uses the selected agent’s working tree.
Worker saves its current instructions, skills and MCP tools when creating the conversation.
The composer uses this snapshot for subsequent turns.

Pinning stores `pinned` on the conversation record and opens it in its own column beside the
main switcher. The layout travels across browsers; it does not affect execution. Columns may
use the full available width, keeping the resize handle reachable.

Forking from a user message opens the agent picker with the source agent preselected. The new
conversation copies the transcript up to the selected message and restores that message to the
composer. Native session continuity depends on the selected agent’s harness and profile.
**Fork with an agent** also continues from the end of a transcript created before agent selection
was introduced, or when the source harness is unavailable.

## Transport and rendering

[ChatSocket](../../conversations/ChatSocket-ctx.tsx) connects to
`ws[s]://<host>/api/ws/hybridflow-runner` (worker `/ws/hybridflow-runner`) and handles turns,
attachments and controls using the `kiao-worker` wire unions.

[ChatMessageList](../../conversations/ChatMessageList.tsx) renders text, thinking and tool blocks in produced order. Indexed `output`/`tool_use` updates and full `sync` replay keep that order. Thinking collapses in place; tool chips expose full input. Transcripts without blocks render as flat text and chips.

[Conversation details](../../conversations/ChatConversationDetails.tsx) sits at the start of the
scrollable transcript. Every harness uses this view for the captured agent, execution defaults, IDs
and the worker paths supplied with the transcript.

Text uses `ConfiguredMarkdown` to render diagram fences and open DCMS links in place.
Worker's `harnesses/prompt/briefing.go` tells turns how these features work.

Every message carries a copy control that puts its markdown source on the clipboard: a prompt as
it was typed, a reply as its runs of prose in order. Reasoning and tool calls stay out, so what
lands in a markdown file is the text the reader would have selected, with its fences and links
intact. Notices are the service speaking and carry none.

## Permissions, questions and steering

[ChatPermissionRequests](../../conversations/ChatPermissionRequests.tsx) shows pending calls:

| Mode | UI and service behavior |
| --- | --- |
| `manual` | Park the turn until each request is allowed or denied |
| `manualLive` | Show the service's `decideAt` deadline; allow on expiry unless answered first |
| `bypassPermissions` | No approval prompt; the selector uses warning colors |

The active turn's `start`/`sync` frame supplies its mode; composer settings describe the next
turn. A reload reattaches and receives pending requests in `sync`; they are not persisted
in browser state. At expiry a card says “Allowing…” until `permission_resolved` removes it.

During a running turn, Send emits text-only `between` rather than starting another prompt.
The service feeds the CLI's open stdin at its next tool boundary. Effort, permission
and attachment controls stay disabled while Send and Stop remain available. The transcript
records `role: user`, `between: true` and captions it “said mid-turn” above the affected reply.
If the turn ended before delivery, `no_running_turn` restores the text to the composer.

[ChatQuestions](../../conversations/ChatQuestions.tsx) renders harness questions separately
from permissions: radios, checkboxes and free text, returning one answer string per question.
Questions appear in every permission mode and have no automatic answer or countdown.
Dismissal sends an empty answer; leaving a card unanswered parks the turn.

## Usage and host login

[ChatUsageTab](../../conversations/ChatUsageTab.tsx) offers a refresh per harness over
[usage gauges](../../conversations/ChatUsagePanel.tsx). Data loads only on request and is
shared through [ChatUsageProvider](../../conversations/ChatUsage-ctx.tsx).

[ChatLoginPanel](../../conversations/ChatLoginPanel.tsx) handles the **server-side** CLI login
when [useChatAuth](../../conversations/useChatAuth.ts) reports signed out. The service provides
an authorization URL; the user approves it and pastes the code to the waiting CLI. Signed-in
or unreadable status renders no login panel. `loginEnabled` controls endpoint availability.
