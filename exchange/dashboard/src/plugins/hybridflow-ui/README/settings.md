[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and the flow node types, and know what makes a card playable.

# Settings

An AI flow node says what is to run it, or it is not run. What it can carry is a `settings`
object on the flow node, and the panel edits it as selects and a box — all but the folder drawn
only on an [AI card](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types), and the folder on every [task](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types),
which is to say on an AI card and a Human one alike.
Nothing here says what *kind* of card it is, which is the [type](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-types.md#flow-node-types) beside them, nor
what happens *after* the flow node, which is [what it says about its chat](/exchange/dashboard/src/plugins/hybridflow-ui/README/on-success.md#on-success).

| Field | What it says |
| --- | --- |
| `"agent": "…its agent id…"` | **Which agent plays it** — one of the managed agents the store keeps, picked by name. The engine and the model a turn runs on are the agent's to say. No default in the document; the editor writes the store's first agent the moment a card is typed AI. |
| `"effort": "high"` | How hard it thinks. No default either, and required with the agent. |
| `"permission": "bypassPermissions"` | How its tool calls are answered. No default in the document, and required with the rest — see [Playing flow nodes](/exchange/dashboard/src/plugins/hybridflow-ui/README/playing-flow-nodes.md#playing-flow-nodes); the board writes this mode into a card it **makes**, where the agent's platform offers it. |
| `"folder": "exchange/dashboard"` | Where it runs. No default either, and required with the rest — though the box is offered on every task, an agent's or not. A lone `/` is the store root. A flow node played in a chat it already has runs in **that conversation's** folder: a chat keeps the one it was made in. |
| `"runner": "…its runner id…"` | **Which runner plays it** — one of the runners the store keeps, picked by name. A pin rather than a setting a turn is run with: empty is played wherever a Play is pressed, and naming one is played there and refused everywhere else. No part of what makes a card playable. |
| no `settings` at all | What every card but an AI one says. On a card with no `type` either it is also what makes it **Human**, which is how every board written before the type field is read. |

**A flow node is nobody's but the user's until it names an agent, an effort, a permission mode and a
folder.** None of the four falls back to whatever the deployment happens to run. A played turn is one
nobody is sitting at, so which agent runs it, what it costs, what it may do on its own and where it
writes are things somebody chose rather than things that happened to be configured; and part of the
set is no more a choice than none of it, so a flow node naming an agent and missing any of the other
three is not played either.

**The agent is one of the managed agents the store keeps** — a name for a platform, a model and
standing instructions, filed in the Node agents panel. The effort and the permission mode
beside it are its platform's vocabulary: the three permission modes a Claude turn offers are one on
a Codex turn. Changing it in the panel clears the two where the new agent runs on another platform,
and the legacy model whatever the platform. A card written before managed agents names the engine
itself, with the model beside it; those cards are read forgivingly and played as they always were,
and nothing writes an engine any more.

Each agent also has a **description** explaining when to choose it for a task. Edit it in the
Node agents panel and read it beneath the agent's name in the task editor's choices. It is
selection guidance, separate from standing instructions, and is never sent to the agent's turns.

Where a played turn writes is a thing the user picked — a board
is a list of work, not the folder that work belongs to, and the boards worth keeping sit nowhere
near what they are about. A `/` is how the store root is asked for out loud, `''` being the one
folder that cannot be typed.

**The card does not say it.** A path is the longest thing the settings hold and the least worth
reading forty times: on a board whose flow nodes all run in one tree it says the same thing on every
card, and where it differs it is a nested path no bubble could hold. The card wears the agent
([What a card shows](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#what-a-card-shows)); the folder is
read in the panel, which is where it is set. What the card keeps is a folder that is **missing** —
`no folder` beside `no effort` and `no permission` — because that is not a path, it is the reason a
card meant for an agent carries no Play.

It is also the one setting **asked of both the types that name work**: where the work is is worth
writing down on a card somebody is going to do by hand, and a flow node typed AI later arrives with
the one line nothing else could have supplied. Only of an AI card is it *required*, so the box on a
Human one is asked but not marked — the warning is the mark of a card that cannot be played until
this is filled in. The effort and the permission mode are the other half of that rule and are not
drawn on a Human card at all: they say how a played turn runs, and there is no turn. A Shutdown and
a Scheduler are asked for none of the four: they run nothing, and run it nowhere.

Having asked for it, the box takes it **dragged in**: a folder of the file tree or the file browser
dropped on it fills it with that folder, and a *file* dropped on it fills it with the folder holding
the file — a file dropped on a box asking where to run says here, not me (`droppedFolder`). A path
typed by hand is a path that can be misspelled, and the tree is on screen already. See
[Dragging a file out of the store](/docs/architecture/containers/dashboard/file-drag-drop.md)
for what a drag carries.

The permission mode is answered in **one place**, and it is `bypassPermissions`: the card the board
*makes* from its canvas menu ([Editing](/exchange/dashboard/src/plugins/hybridflow-ui/README/editing-cards.md#editing)). That is not a default coming back. A default is
what a card falls back on when nobody answered — and this is an answer, written into the document at
the moment the card is made, on the card, in the select, where the next person to look at it reads
it and changes it. A card typed AI in the large editor is given no mode at all, because a card
being retyped by hand is one somebody is sitting at. The mode is still asked of a document that says
none, so no board anywhere is played on a mode it never wrote down.

**Typing a card writes nothing into its description.** It picks the [template](/exchange/dashboard/src/plugins/hybridflow-ui/README/flow-node-templates.md#flow-node-templates)
that goes with the type — `AI` or `Human` — in the select above the box, and that is all: what the
template says reaches the description when somebody instantiates it, having read it.

**An empty value says what no field says.** A `settings` object whose keys are all empty is written
back as no object at all — and, on a card that names no type either, is read as a Human flow node.

