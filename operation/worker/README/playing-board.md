# Playing a board

← [worker](/operation/worker/README.md) · assumes [Conversations and turns](/operation/worker/README/conversations.md).

**Playing a board** (`hybridflow-runner/chain_run.go`, `hybridflow-runner/board_content.go`,
`hybridflow-runner/chain_run_fault.go`, `hybridflow-runner/flow_node_images.go`, `hybridflow-runner/chain_run_log.go`,
`hybridflow-runner/shutdown.go`,
`hybridflow-runner/handlers_chain_run.go`). A board is rows in the hybridflow-store, reached over
HTTP; a **chain run** plays one of its flow nodes and then whatever that flow node names after
it, filing what Claude said under each flow node and marking it. The loop lives here rather than in
Dashboard,
and that is the whole of the feature: a board left, a tab closed or a laptop shut used to end a play
— the turn under way kept running, but nothing filed its answer and nothing played what came next.

A card is **typed**, and its type is what playing it means: an *AI* card is a turn, a *Human* one is
nobody's to play, and the two remaining are the run's own to play with no turn in them at all — a
*Shutdown* turns the machine off, and a *Scheduler* holds until the datetime written on it and then
lets the chain carry on. Both are marked like any other card, taken and then done, because the board
is the record of where the work stands whoever did it.

**Several runs play at once**, and each is **named** by whoever started it — two boards side by side,
or two chains of one board started from two cards. One rule keeps them apart: a card is played by one
run (a second play on it is refused, and a chain walking into one ends there). The marks themselves
never collide — each is a named operation on one card and one field of it — so two runs marking two
cards of one board never queue behind each other. A run **stays in the
list once it has ended**, saying so and saying why, until it is restarted or forgotten — that is what
the chain runs panel offers a Restart on. The list reaches every open socket as a `chainRun` frame, and
`hello` carries it, so a tab that connects mid-run draws the board correctly without polling. Six
endpoints (`GET /hybridflow-runner/chain-runs`, `play`, `stop`, `resume`, `restart`, `forget`); every one but the
first names its run by id.

The run reads the board afresh at every step and finds its flow node by id: a turn lasts minutes
and the board is live throughout, so nothing is carried across a wait but ids. A reply is read
*before* it is filed (`hybridflow-runner/chain_run_fault.go`), because the CLI writes an API error where the
answer would go and ends the turn normally — filed as an answer, that sentence would mark a flow
node done by the one thing saying it was not. An error that passes (overloaded, a connection that
dropped) is waited out for 20 minutes and sent again, up to three times; the rest mark the flow node
and stop the run.

**A usage limit is a clock rather than a failure**, and is the one error waited out on its own
terms.
Its notice says when it lifts — `Claude AI usage limit reached|1750000000`, `resets 7:10pm
(Europe/Paris)`, a `429`'s `retry-after` — so the run reads that moment and holds the flow node
until it, plus a minute; the twenty-minute wait would spend all four tries inside the first hour of
a five-hour window. The flow node is marked `waiting-refresh` in the document and the run reports
itself `refreshing`, because hours of `running` is a spinner over a card nothing is happening to.
What goes in when the limit lifts is **not the flow node again** but `You have been interrupted,
please resume cleanly`: the turn that met the limit had usually been working, its conversation still
holds all of it, and the answer to that word is filed under the flow node as the play's one answer.

**A flow node's images travel with it** (`hybridflow-runner/flow_node_images.go`). A body is markdown, so a
picture in one is a file of the store it links — a screenshot pasted into the flow node, an image
dragged in from the tree — and the prompt is text on a pipe, so the run appends a note giving each
file's absolute path, the way an attachment is named. The links are read from the store root rather
than against the one the turn runs in, and nothing is copied: the file is named where the
store really keeps it, because the turn is working in that store. A link that resolves to nothing is
said out loud and does not stop the play — unlike a missing attachment, which refuses the turn.

Stopping the *turn* from its chat stops the run and **keeps** it: interrupting a turn is the plainest
way of saying the run is not going as it should, and the next message said in that chat is offered as
the way to pick the whole chain back up (`resume`, which attaches to the turn that message starts).
The board's own Stop is the other one: the turn under way finishes and is filed like any other, and
nothing after it is started.

A **Shutdown card** turns the machine off — `"type": "shutdown"`, and nothing else on the card: the
one thing a board does that reaches past the store (`hybridflow-runner/shutdown.go`). It **ends the board**, and
that is why it names nothing after it: playing anything into a machine on its way down would be
starting work to abandon it. A chain that failed never reaches it, a card being played only when the
card before it was done, which is the point of putting one at the end of one.

It happens only where `KIAO_WORKER_SHUTDOWN_COMMAND` names a command — which `kiao` sets
and no other start does. Everywhere else the card is read, written, copied and *played*, and marked
`error`: it asked for something that did not happen, and `done` over a machine still running would be
the play claiming otherwise. A board travels between deployments, and a card dropped where it cannot
be honoured would be taken out of the document by the first save made there.

A **Scheduler card** holds until its `at` — a local `YYYY-MM-DDTHH:mm`, read in this process's own
location, because the machine that will be woken is the one whose clock decides — and then plays the
flow node it names. It reports itself as a run state of its own (`scheduled`), so a board says which
of its waits it is in; a datetime already past does not wait; and the board's Stop ends the wait
there and then, as it ends the twenty minutes between two tries.
