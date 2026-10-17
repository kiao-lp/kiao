# Chains — What Happens After a Card

`onSuccess`, the three types the board plays to itself, and what a play does to a card.
Transport-agnostic like [cards.md](cards.md): the same over MCP or over HTTP.

## On Success

A flow node says what is to be done **after** it: the flow node played next, and — on an AI card —
what becomes of the conversation it ran in, which is two answers.

```json
"onSuccess": { "flowNode": "…the next card's id…", "mode": "continue", "compact": true }
```

| Key | Meaning |
|-----|---------|
| `flowNode` | The id of the flow node played next. **Any flow node of the same board.** Empty when nothing follows, never written on a Shutdown, and never on a Gateway either — a Gateway names its branches the list way. |
| `flowNodes` | The ids of the flow nodes a Gateway starts when it fires, in the order the card lists them. **A Gateway's alone**, and never written on any other type. |
| `mode` | Who gets the conversation once the flow node is done. **Write it on every `onSuccess` you write.** Only an AI card is asked. |
| `compact` | Whether the flow node's chat is shortened when it ends well — `/compact`, sent into it as a turn of its own. Absent is false. Only an AI card is asked. |

| Value of `mode` | What happens |
|-------|--------------|
| `end` | Nothing is handed on. Whatever comes next is played in a chat of its own: the one it already had — unless that is the conversation just finished, which a fresh one replaces — or one made for it. **The default.** |
| `continue` | This flow node's conversation is **forked**, and the next flow node is played in the copy — which carries the transcript and the agent's session, so it remembers what the chain has done, while this card keeps a chat of its own. |

Where both are said the order is the one they read in: the chat is shortened first, and the fork is
taken from the shortened one.

**Naming the next flow node is the only way flow nodes are chained.** There is no other order on a
board: a play runs the card it was started on, then whatever that card names, and stops when nothing
is named.

The chat is what makes a chain worth more than two cards played apart: the second flow node starts
knowing what the first found out. Two unchained cards give the second a chat of its own; one card is
one turn, and a turn is the unit the board files an answer under and retries.

- **Both stand on their own.** `{"onSuccess": {"mode": "end", "compact": true}}` is a whole
  statement with no flow node named after it: a card at the end of a board still says what becomes
  of the chat it leaves.
- **They are the flow node's, not the chain's.** They say how *this* flow node ends, so taking the
  chain off or pointing it at another card leaves them alone.
- **`compact` is a box and not a third mode.** The mode says who gets the conversation; the box says
  what state this card leaves it in. `"mode": "compact"` was one word for both, is still read as
  both, and is written by nothing.
- **Either says the flow node is AI's** — a conversation to hand on, or one to shorten. On any other
  type neither is asked, and one written anyway is read as nothing. On an AI flow node whose other
  settings are incomplete, saying either is **invalid**: the board marks it, and the flow node is
  not played.
- **It names a flow node.** A chain survives every drag: the card it points at is the
  card it points at wherever that card ends up.
- **On success only.** A turn that came back an error is not a flow node that was done, so neither
  the chain nor the mode is reached — the flow node is marked `error` and the play retries or stops.
- **One chat, one folder.** A conversation keeps the folder it was made in, so a flow node being
  handed one must name the **same `folder`** as the flow node handing it over. It does not, and the
  play stops rather than running somewhere nobody asked for. `"mode": "end"` is the way round it.
- **The chat is handed on only to a card that has one.** A Scheduler, a Shutdown and a Gateway speak
  to nobody, so a `continue` in front of one is honoured as far as it can be: the chain carries on,
  and the conversation stops there.
- **A chain ends** where the flow node names none, where the one it names is gone or is not a card a
  run can take — an AI one missing part of its settings, a Scheduler with neither `at` nor `duration`, a Human one — and
  where it comes back round to a flow node the chain has already played.
- **A chain onto a card of another board is refused.** A run would walk off the end of the board it
  is playing.

There is a call for the link alone, which is what a chain drawn on the board sends — over HTTP only;
with the MCP tools, patch `onSuccess` instead:

```bash
curl -sS -X POST "$HYBRIDFLOW/boards/major/flow-nodes/$first/chain" \
     -H "$AUTH" -H "$ACTOR" -H 'Content-Type: application/json' -d '{"flowNode":"'"$second"'"}'
```

An empty `flowNode` takes the link off. It leaves the mode alone; patch `onSuccess` to say both at once.

On a Gateway the call adds a branch: the target joins its branches — naming one it already holds
changes nothing — and an empty `flowNode` takes them all off. To say the branches whole, patch
`onSuccess` with the list the card is to hold.

Classes link the same way — a class names the class after it, never a version or a card — see
[classes.md](classes.md#chaining-classes).

## Shutting the Machine Down

A **Shutdown card** turns the machine off when it is played:

```json
{ "title": "Good night", "type": "shutdown" }
```

It is the one thing a board does that reaches past the store, and it is for the chain nobody sits
through: work started in the evening should not leave a machine running all night.

- **It has no options.** No `settings`, no `folder`, and **no flow node named after it**: the play
  ends there, so a chain drawn out of it is a chain nothing could follow. A `body` is a note to
  whoever reads the board and is never sent anywhere.
- **Put it last.** It is a card of the chain like any other — give the card before it an `onSuccess`
  naming its id.
- **A chain that failed never reaches it.** A card is played when the card before it was done, so a
  turn that came back an error, or one somebody stopped, leaves the machine on. That is the point.
- **Not every deployment can act on it.** The machine goes off where KIAO was started from the
  command line; on a server the card is played and marked `error`, having asked for something that
  did not happen.

## Waiting for an Hour

A **Scheduler card** waits, then plays the flow node after it. Choose one mode:

```json
{ "title": "Pause", "type": "scheduler", "duration": "15m",
  "onSuccess": { "flowNode": "…the next card…", "mode": "end" } }
```

```json
{ "title": "Tonight", "type": "scheduler", "at": "2026-10-16T22:00",
  "onSuccess": { "flowNode": "…the next card…", "mode": "end" } }
```

- **Fixed duration** counts from each play. `duration` uses positive `h`, `m`, `s` or `ms`
  components, including combinations such as `1h30m`. Zero, negative and malformed waits are refused.
- **Date time** uses `at`: `YYYY-MM-DDTHH:mm`, no zone or seconds, on the runner's local clock.
  A datetime already past continues immediately.
- **One mode at a time.** Setting a nonempty field clears the other; sending both nonempty is
  refused. Clearing both leaves the Scheduler incomplete. The same rules apply to class presets.
- **Play starts the wait**, either from the small Play beside its clock or through a chain.
  Only a configured, `ready` Scheduler offers Play. Its name is edited in the panel and hidden
  on the board, which shows the duration or date time beneath the clock.
- **No task settings or conversation.** What follows it runs in its own chat.
- **The card is `running` while waiting and `done` when the wait ends.** Stop cancels the wait
  immediately and leaves the successor unplayed.

## Joining and Forking

A **Gateway card** is the board's parallel gateway, as in BPMN: it waits for every branch feeding
into it, then starts every branch leaving it:

```json
{ "title": "Both done?", "type": "gateway",
  "onSuccess": { "flowNodes": ["…first branch…", "…second branch…"] } }
```

- **The join is what names it.** Every card naming the Gateway as what follows it is a branch feeding
  into it, and the Gateway fires once all of them are `done` — no earlier. A branch arriving to find
  the others not yet done leaves the Gateway untouched and ends there; the branch finding them all
  done fires it.
- **The fork is the branches it lists.** Firing it starts every one, in parallel, each as a run of
  its own — and the run that fired it ends there. Each branch is played in a chat of its own: the
  Gateway speaks to nobody, so there is no conversation to hand on.
- **What it waits for is written on the board, not on the card.** The branches feeding in are the
  cards pointing at it; the branches leaving are the `flowNodes` list. A Gateway with no branches
  still joins — it fires with nothing after it, and the play is done.
- **It needs nothing.** No `settings`, no `folder`, no `mode`: firing it *is* what it does. A direct
  Play on a Gateway still waiting is refused, naming what it waits for.
- **A branch that failed never arrives.** A card is played when the card before it was done, so a
  turn that came back an error holds the Gateway until the branch is played again and done. That is
  the point.
- **No Gateway is a class.** A class is reusable words — a description and what done means — and a
  Gateway holds none, so the service refuses one.

## Playing Flow nodes

Worth knowing when writing or reading a board, because it shapes what ends up on the card:

- **What playing means is the card's [type](cards.md#flow-node-type).** An AI card is a turn; a Shutdown
  sends the command that takes the machine down; a Scheduler holds for its `at` and then plays the
  flow node after it; a Gateway waits for every branch feeding into it and then starts every branch
  leaving it. The last three are the run's own, with nothing said to an agent at all — and all are
  marked like any other card, so a board read the next morning says what happened.
- **The prompt is the AI card's description — or, where there is none, its title — and its
  success criteria, always, where there are any**, and nothing is added to it. The title is sent
  only in place of a missing description, never beside one. The settings are not part of it either:
  they say how the flow node is to be run, not what it is about.
- **An AI card with no title, no description and no success criterion is not played.** There is
  nothing to send.
- **When a play takes a flow node its `status` becomes `running`**, before the prompt is even sent,
  and the run's id is written onto the card. A second run asking for the same card is refused.
- **When the turn ends, the `status` becomes `done`.** The description stays where it is,
  and the card stays where it was put.
- **A flow node is played in the chat it names**, or in one made for it, whose id is written onto
  the flow node before the turn even starts.
- A turn that came back an API error marks the flow node `error` instead, which keeps
  its description so it can be played again as it stands.
- A turn somebody **stopped** marks the flow node `interrupted`. A run that ends while
  holding a flow node — replaced, stopped mid-wait — leaves it the same way.
