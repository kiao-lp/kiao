[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index plus status, on-success, settings and types.

# Playing flow nodes

Playing a flow node hands it to an agent as a prompt, in the chat it names or in one made for it,
which opens in the lateral toolbar; when the turn ends the flow node is marked
[done](/exchange/dashboard/src/plugins/hybridflow-ui/README/status-and-chat.md#status-and-chat). Then whatever the flow node [names after it](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md#on-success) is played, and
so on until the chain runs out.

**None of that happens in this page.** The loop is **the runner's** — `chain_run.go` reads the
board, sends the prompts, marks the flow nodes, waits out the errors worth waiting out and follows
the chain — and this plugin starts it, is told what it is doing, and can stop it.

**Several runs play at once.** Two boards side by side, or two chains of one board started from two
cards — the service keeps a list, every tab reads the same one, and starting a play stops nothing.
What is refused is a second run on the *same card*: two turns on one flow node, and a chain walking
into a card another run holds ends there and says whose it is.

So an AI card's or Scheduler's Play is offered whenever the card can take one, and only the card a run is on
shows a **Stop** instead. The Stop names its chain run, because three cards of one board may be
playing at once and "stop the play" would name none of them. A Shutdown and a Gateway
carry neither: they are never played directly, so they are elements a click opens, and a run
holding one is stopped from the chain runs panel.

**A run is named when it is started.** Pressing Play opens a box asking what to call it, prefilled
with `Started 4 Sep 13:22` — a name, for the run somebody starts without thinking about what to call
it — and typing over it costs one keystroke. That name is the whole of what tells two runs apart
afterwards: in the [chain runs panel](#the-chain-runs-panel), in the notices they raise, in the tooltip
of the card they are on. It is asked for once and never derived from anything.

## The chain runs panel

A second tool bar tab, beside the flow node panel and registered for every document rather than for
a board. It lists every run the service knows — live, and lately ended — as a tree of the same rows
the store's own navigation uses: one row per run, and under it the cards of its chain with where
each of them stands.

**It holds no board.** The chain it draws — the cards played, the card the run is on, the cards
ahead of it along the `onSuccess` links, each with its title and its status — travels with the run
itself, worked out by the service from the board it has just read anyway. So the panel shows a
chain run whose board this tab has never opened, and the tail of the chain is a forecast
read afresh at every step rather than a plan fixed when the run started.

**A run stays in the list once it has ended**, saying so and saying why — the last sentence it said.
That is what the panel offers a **Restart** on: the run is played again from the card it was started
on, keeping its name and its place in the list — the card still asks what it was asking, so a
restart plays it as it stands. **Forget** takes an ended run off the
list, and is refused while it is playing.

The four actions are the panel's whole vocabulary: **Stop** on a live run, **Resume** on one whose
turn was stopped from its chat, **Restart** and **Forget** on one that has ended. The name opens the
board the run plays, and the speech bubble opens the conversation it is playing in.

These are the things worth knowing, because none of them is guessable from a button:

**The prompt is the flow node's description** — sub-headings and code blocks included — or, where
there is none, its title, and its success criteria, always, where there are any, and nothing added
to it. The title is the card's name, read on the board and named by a chain, and it is sent only in
place of a missing description, never beside one. Whatever standing instructions the flow
node carries are already *in* the description, instantiated there from a [flow node
template](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-templates.md#flow-node-templates); what the card says is what is sent. The settings are not part of it
either: they say how the flow node is to be run rather than anything about the flow node. **A card
with no title, no description and no success criterion is not played** — there is nothing to send —
so it carries no Play, and a chain reaching one ends there.

**The images the body links go with it.** The CLI takes text on a pipe, so a picture reaches a turn
as a path it goes and reads: the run resolves what the body names and appends a note giving each
file's absolute path, exactly as it does for a screenshot attached to a message by hand
(`flow_node_images.go`). The links are read against the **board's** folder — that is the document the
markdown is written in, and it is not the folder the turn runs in — and nothing is copied anywhere,
so the model is told where the file really is and can change the picture as well as look at it. Every
markdown image counts, and a link counts when its extension says it is one: a file dropped in from
the tree arrives as a link and is still a screenshot. A link that resolves to nothing does not stop
the play — a dead link is a mistake in a document somebody is still writing — and the run says which
image the turn was never given.

**A play sends the description and marks the card where it stands.** The description stays where
it is: what the turn said is in the conversation the card names, and the card still asks what it was
asking — so a played card is played again as it stands, into the same chat.

**Nothing moves.** The card stays where it was put, and the status is what says it has been played.

**The flow node is found by its id.** A turn lasts minutes and the board is live throughout, so the
run reads the document again at every step and finds its flow node by id; and because it reads and
writes the document rather than a copy of it, a card dragged while its turn ran keeps the drag *and*
gets its mark.

**The board reads the document again when the run writes it.** The run says when it last wrote
(`documentAt`), and the board re-reads on it: that is how a card fills in with its mark and its chat
while somebody is watching. The open flow node stays open — a panel that shut itself every time a
run marked a card would be unusable during a run. A person and a run editing the same document at
the same moment are still two writers of it, and the last write wins.

**Not every card is played, and what playing means is the card's [type](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types).** An AI
card is played only where its [settings](/exchange/dashboard/src/plugins/hybridflow-ui/README/settings.md#settings) name an agent, an effort, a permission mode
*and* a folder, and nothing on the board writes any of them for it; a Scheduler only where it names
a positive duration or a datetime; a Shutdown always, playing it being the whole of what it does; a Gateway always, firing
it being the whole of what it does; and a Human card never.
The rest have no Play on their cards, and a chain that names one ends there. The service asks the
same questions again when it is asked to play one, since a request is not a button.

**Three of the five types the run plays to itself**, with no turn in them at all: a Shutdown sends
the command that takes the machine down, a Scheduler waits for its duration or datetime and lets the chain
carry on, and a Gateway waits for every branch feeding into it and then starts every branch leaving
it. All are marked like any other card — taken while the run holds them, then done — because
that is what the board is for: read the next morning, a card that ran says so, and one that could not
says why. Whatever is written on such a card is a note to a person rather than a prompt.

**A flow node played again goes back into its own chat.** Its mark becomes `running` as the round
starts, so the card is not showing yesterday's error under a spinner.

**The board's Stop stops the play, not the chat.** The turn under way is the user's to interrupt,
from the chat where the Stop button has always been; ending it from the board would kill a turn that
has already done its work. So the button stops the *chain*: the flow node under way finishes and is
marked like any other, and nothing after it is started. A run that is not running a turn but
waiting has nothing to let finish, and Stop is the end of it there and then rather than twenty
minutes later — or, on a Scheduler, rather than at three in the morning.

**The chat's Stop stops the play too — and keeps it.** Interrupting the turn is the plainest way of
saying the run is not going as it should, and going straight on to the next flow node would be the
board arguing with that. The stopped flow node is marked `interrupted`, which is neither of the two
lies to hand: `done` would claim the flow node was finished, and `error` would call somebody
pressing Stop a failure. It is the last one played.

What happens next is what is new. The run is not thrown away: it is **suspended**, holding the flow
node and its chat, and the plainest way of carrying on is the one the user is already taking —
saying something in that chat. So the next message sent there asks the question: *carry on with the
board?* **Yes** picks the chain back up, with that message as the flow node's turn — the flow node
is marked and the chain follows — and **No** drops the run, leaving an ordinary conversation. It is
asked once, at the moment it is a decision, because a board that asked it on every message would be
asking to be ignored.

The two buttons are therefore not opposites: the board's ends the play *after* the turn, the chat's
ends the turn *and* the play, and only the second leaves something to resume. Nothing else is treated
this way — a turn that merely went badly is an answer like any other, and the play carries on.

**A turn that came back an error did not do the flow node.** The CLI does not fail a turn for an API
error: it writes the error where the answer would have gone and ends the turn normally, exit code
and all. Read as an answer, that sentence would mark a flow node done by the one thing saying it
was not. So the reply is read before the card is marked (`chain_run_fault.go`), and a flow node
whose turn came back an error is marked `error`.

What separates the errors is time. **An overloaded API, a connection that dropped — the run waits
twenty minutes and sends the same flow node again**, into the same chat, up to three times, rather
than giving up on something that will have righted itself by then. The wait is long on purpose: the
CLI has already spent its own retries on the request before it writes the notice, so what is being
waited on is minutes deep. The card keeps its place and its mark, with a clock instead of a spinner
and the time it will be tried again, because twenty minutes of a spinner says the board is working
when nothing is running at all. After the fourth failure the run stops, says so, and marks the flow
node: an outage that long is somebody's business rather than the board's.

**A usage limit is waited out differently** — on its own clock, and with something else sent at the
end of it. See [Waiting for a usage limit](#waiting-for-a-usage-limit).

The rest — no login, no credit, a prompt too long, a model this deployment will not run — stop the
play there and then, with the flow node marked: nothing but the user clears them. An error the list
has no word for is treated the same way, since a wait is a claim about what went wrong. So is a turn
that said **nothing at all** and whose process ended badly: there is no notice to read, and the one
thing known about the flow node is that nobody did it. (A turn that says little and exits cleanly is
a quiet turn, and is left alone.)

**A notice is read at the foot of the reply as well as at its head**, and the foot is where a long
run meets one. A subscription limit is worded by the CLI itself and mentions no error at all —
`You've hit your session limit · resets 7:10pm (Europe/Paris)`, and the same for the weekly and
model windows — and it is written as one more block *after* everything the turn had
already said. Read only at the head, that reply is an answer, and the flow node is marked done by
the very sentence saying it was not finished. A reply is one record whose text blocks are joined, so
the last block is the stretch to read: these texts are prose, and an answer *about* API errors is a
thing a flow node asks for, so a stretch is taken for a notice only where it *begins* with one and
is short enough to be nothing else. What the hour said is not lost — it is in the conversation the
card names, and it stays out of the flow node's body because a body is also a prompt if the flow
node is ever played again.

`API Error: Request was aborted.` is the exception, and not because of its words: it is how a turn
stopped from the chat comes back, and a turn somebody stopped keeps the ending Stop has always
given it.

**Leaving the board changes nothing.** The run is the service's: it goes on marking cards and
playing what comes next with the tab closed, the browser shut or the machine asleep, and
a board opened again — here or on another machine — shows exactly where it has got to, because that
is what the document says and what the run reports.

**Everything the board says about a run is what the run said.** A chain that ended, a flow node
tried again at twenty past, a folder that does not match, a flow node that has left the board:
The runner decides all of it and sends the words with the state, so nothing here composes a
sentence of its own about a play it is not running.

The chat itself is an ordinary conversation, made with what the flow node's [settings](/exchange/dashboard/src/plugins/hybridflow-ui/README/settings.md#settings)
state — the four of them, those being what made it playable at all. **Nothing is defaulted, the
permission mode least of all**: it is the line that says what the agent may do to the store while
nobody is looking, so a board that picked one for a flow node would be deciding that on the user's
behalf, and every flow node on it would have been decided for the same way.

What the modes mean is the platform's to say. On Claude's three, `manual` waits for an answer to
every tool call, so a flow node set to it waits at its first one until somebody comes back, and the
chain stops there with it — which is what a flow node worth sitting through is asking for.
`bypassPermissions` asks nothing and shows nothing, and runs every call unwatched — which is what a
long refactor the user means to walk away from is asking for, and why the select marks it the way
the chat's own toolbar marks it. `manualLive` is the middle one: every call is still put on screen,
and one nobody answers within ten seconds is allowed, so a play carries on by itself and a call
worth refusing can still be refused.

**That ten-second countdown is the service's**, and it runs whether or not anybody is connected: the
card is put up, the clock starts in the runner, and the call is allowed there when it runs out.
A connected panel is told when the count ends and shows it running down, which is what Deny is for;
what it no longer does is *make* the decision.

The agent, the mode, the effort and the working directory are what the flow node's settings say, and
they always say something: a flow node that leaves any of them out is not one of the ones played.
The Play button is absent where `chatEnabled` is off,
and so is the panel's settings editor — the status stays, a board kept by hand still having work
that is done.

**What this costs the plugin.** Nothing that names another plugin. The board asks
[`@cms-kit/capabilities`](/exchange/dashboard/src/kit/capabilities/index.ts) for what it needs — `chat.run` to play a
flow node and read the run (`useChatRun`), `chat.show` to open the conversation one was played in
(`useShowChat`), `chat.options` for the agents its settings are chosen from and what each of them
accepts (`useChatOptions`), and the tags capability for the picker's words (`useTagsUi`) — and the
`chat` plugin is what publishes them. A store assembled with the board and no chat gets the working
no-ops the kit defines: no Play, no chain knob, empty selects.

The lists come **per platform** and not as one flat set: the effort and the permission mode are
the vocabulary of the card's agent, and a deployment that has withdrawn
`bypassPermissions` does not offer it here either.

The run's state sits in the chat plugin rather than here. It arrives on the chat
socket, and the board has no business knowing the frame protocol; and the chat panel needs it too —
stopping a turn stops the run it belonged to, and the question about picking it back up is asked
where the next message is typed.

## What an AI card spent

The large editor gives an AI card a row of its own: the sums of the usage reports its turns filed
— the cost, and the tokens in and out. It is read when the editor opens, and again when another
card is opened in it; the breakdown — cache, reasoning, how many reports — rides in the tooltip.
The cost is unknown where no report priced itself, and that is said out loud: an absent price is
not a free turn. A card whose turns filed nothing says it spent nothing yet, which is a different
thing from a read that failed.

## Waiting for a usage limit

**A usage limit is not a failure, it is a clock** — and it is the one notice that says when it stops
being true. `Claude AI usage limit reached|1750000000` names the instant outright;
`You've hit your session limit · resets 7:10pm (Europe/Paris)` names a wall clock, with a weekday in
front of it for the weekly window; a `429` quotes the API's own `retry-after`. The run reads whichever
of the three is there and **waits until that moment, plus a minute** — the minute because the first
second of a window is contended and because the clock on the notice is not necessarily this machine's.

That matters because the twenty-minute wait is no answer to it at all: a five-hour window is hours
deep, four tries twenty minutes apart all land inside the first hour of it, and the run would then
mark as an error a flow node nothing was ever wrong with. A notice that names no moment — a bare
`429` — falls back to the twenty minutes, which is the best guess left.

**The card says `waiting-refresh` meanwhile**, in the document rather than only in this page: the
run may be holding it for four hours, and `running` would draw a spinner over a card nothing is
happening to for anyone reading the board in another tab or in the morning. Its line reads *Waiting
refresh · back at 19:11*, and the run reports itself as `refreshing` — a state of its own beside
`waiting`, because it is a different wait and ends in a different thing being sent. Stop cuts it
short like any other wait, and the flow node is then marked `interrupted`: the run was holding it
and did not finish it.

**What goes in when the limit lifts is not the flow node.** The turn that met the limit had usually
been working — it read the folder, wrote half the change — and its conversation still holds every
word of that. Sending the description again would ask for all of it a second time in a chat that
already contains it, the model reading its own half-done work as somebody else's, and an hour paid
for twice. So the run says the one thing that is true:

> You have been interrupted, please resume cleanly

and the answer to *that* is the flow node's answer. The pictures the body links are not
sent again either, for the same reason — the conversation was given them the first time.

A limit that will not lift is still bounded: the four tries are the four tries, and a run that meets
a closed window every time marks the flow node and stops.

