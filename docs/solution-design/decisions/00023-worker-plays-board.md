---
id: "00023"
title: "a board is played by worker, and the Manual Live countdown with it"
status: accepted
date: 2026-08-27
tags: ["hybridflow", "runs", "worker"]
components: ["worker", "dashboard"]
paths: ["operation/worker"]
symbols: ["agents/workflow_run.go", "POST /agents/workflow/play", "manualLive", "decideAt", "turnFault.ts", "ClaudeShow-ctx"]
triggers: ["run ends on tab close", "countdown parked", "stop run", "notice wording", "suspend on interrupt"]
supersedes: []
superseded_by: []
---

# 00023 — a board is played by worker, and the Manual Live countdown with it

**Decision:** the play loop moves out of the browser. worker owns **one run at a time**
(`agents/workflow_run.go`): it reads the `.workflow.json`, sends each task's prompt, files what came back
under the task, marks it, waits out the errors worth waiting out and follows the chain. Dashboard
starts a run (`POST /agents/workflow/play`), is told what it is doing (a service-scoped `workflow`
frame, plus the run on `hello`), and can stop it. `manualLive`'s ten-second countdown moves with it:
the service allows a card nobody answered, and the request carries `decideAt` so a connected panel
can show the count and refuse before it. Protocol version 8.

**Why: a play that needs a browser is a play that ends when the laptop shuts.** A turn has always
been the service's — it keeps running, keeps parking on a permission request, keeps writing its
transcript with nobody connected — but everything *around* the turn was the page's: what the answer
was filed under, whether the error was worth waiting twenty minutes for, which task came next. So
leaving the board ended the run, and a chain of eight tasks was eight tasks somebody had to sit
through. The unit of work here is hours; the unit of attention is minutes.

**The countdown had the same shape of bug, and it is the same fix.** `manualLive` promised that every
tool call is *shown*, with ten seconds to refuse — and delivered a turn parked for ever when the chat
was not on screen, because the thing counting was a React component. Selecting another conversation
in the panel was enough. A mode about what happens when nobody answers cannot be implemented by the
one thing that is not there when nobody is. The client is now told the deadline instead of owning it,
which is strictly more than it could say before: two tabs count down to the same instant.

**One run, and it is service-wide.** The service writes the document, so two runs would be two
writers of it; starting a play stops whatever was playing, and every socket is told, so two boards in
two tabs never disagree about what is under way. That is also why the frame carries no
`conversationId`: a run belongs to the service, not to a chat.

**The words belong to the run.** A chain that ended, a task tried again at twenty past, a folder that
does not match — the run decides all of it, so it sends the sentence with the state (`notice`) rather
than leaving each client to reconstruct one. A client that composed its own would be describing a
play it is not running.

**Stopping the chat suspends the run rather than ending it.** Interrupting a turn is the plainest way
of saying the run is going wrong, and carrying on to the next task would argue with that — but
throwing the run away loses the chain. It is kept, holding its task and its chat, and the next
message said in that chat is where the user is asked: carry on with the board, or not. Yes attaches
the run to the turn that message starts; no drops it. The question is asked once, at the moment it is
a decision.

**What it cost.** The document has two writers now — a person typing in the panel, and a run filing
answers — so the board re-reads on `documentAt` and the last write wins; the alternative was locking
a file somebody is editing. `usePlayTask` went from a 486-line loop to a reading of the run's state,
`turnFault.ts` moved into Go as `agents/workflow_fault.go`, and `ClaudeRunner-ctx` — which existed to drive
a conversation from outside the panel — is down to the one thing that is still a client's business,
putting a chat on screen (`ClaudeShow-ctx`).

## Refactor notes

Entry text still says `.ClaudeRunner-ctx` / `turnFault.ts`; read through the agent rename (00036). Runs later became named and plural (00038), then chain runs (00066).
