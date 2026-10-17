[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know the editors, tasks and template-lang basics.

# Flow node templates

A flow node's description is written **from a template**: one of the `.temp.md` files a store keeps
in **`kiao-user-config/flow-node-templates`**. They are template-lang templates like any other — written
and edited with `template-edit`, with the same variables, the same optional sections and the same
value providers — kept in a folder of their own so that the board offers the ones meant for flow
nodes rather than every template in the store. The folder is flat: a template is named for the flow
node it writes, "Bug report", "Refactoring", which is a list and not a tree.

Both faces of the editor carry the same control, on the line above the description: a **select** of
the folder and, beside it, the button that **instantiates** what it names. The pick is held once, in
the draft above both faces, so the panel and the large editor always agree about it.

**Two templates have names the board knows**: `AI` and `Human`. Typing a card picks the one that
goes with it, so the standing instructions an agent is always given are one click away instead of
arriving in the body unasked. A *Shutdown* and a *Scheduler* are offered neither — neither is a text
anybody writes — and what was picked by hand is left alone. Where the store has not got them they
are **written on the first board that opens**. `AI` is the store's own file as this release ships
it: a Root that is the running order and nothing else —

```
${noCode}
${colleague}
${flowNodeDescription}
${commit}
```

— and the three of them as **optional sub-templates**, each with an empty `defaultText`. That is
what makes them clauses rather than prose: a checkbox in the panel, and nothing at all in the
description when it is unticked, a standing instruction being standing and not compulsory.

| Clause | What it says |
| --- | --- |
| *No code* | Answer at the level of the architecture and the approach rather than the code, and explain in plain terms whatever code has to be named. |
| *Colleague* | Write in the words a colleague sending a teams message would use. |
| *Commit* | Commit the work once it is done, and do not push it. |

The last is the one every played turn wants said: a played turn is one nobody is sitting at, and
what it leaves behind is a work tree somebody still has to look at — committed, so the work is not
lost between one flow node and the next, and unpushed, so nothing reaches a remote before the user
has read it.

`Human` says `${flowNodeDescription}` and nothing around it, so there is nothing on it to switch
off. Only what is missing is written, and only ever once: from that moment the two are the store's
own, edited like any other template, and a template deleted stays deleted.

**The flow node answers two variables itself.** `${flowNodeDescription}` is what the card says now
and `${flowNodeTitle}` is its title, so a template is a thing written *around* a description rather
than one replacing it. Neither is compulsory, and neither is asked for in the panel — a box holding
the description that is on screen behind it is a question nobody was asked.

**Instantiating pushes a panel onto the central area's stack**: what the template asks on the left,
what it makes on the right — rendered as the markdown it is, templates being always markdown —
and **Instantiate** replaces the description with it. Copy is off: the text has somewhere to go
that is not the clipboard. Cancelling — the stack's floating cross — is back where the flow node
was, the large editor's panel or the board.
There is no file written and nothing to apply — the instantiation goes onto the board through the
editor's own call, like every other edit made here — and what is replaced is text the user can read
and correct before the flow node is ever played. That is the whole point of doing it here rather
than on the way out: a standing instruction nobody sees before it goes is one nobody can correct.
The play sends what the card says, and the card says everything the play sends.

**The answers are the application's**, held in `@cms-kit/template-fields`' one store: a value typed
to instantiate a flow node template is the value the next instantiation opens with, wherever it is
asked for — the template editor included. It survives a reload and goes with the tab. The flow
node's own two are merged in on the way to the preview and never into that store, a card's words
being no more an answer than the card is.

**The panel never blocks the chrome around it.** There is no mask and no focus trap, so the file
tree stays usable while it is open and a file dragged out of it still lands where it is dropped. The
flow node's own two answers are read live from the draft, at every keystroke of the editor behind
the panel. Pushing twice is pushing once: the button that opened the panel stays on screen behind
it.

**The runner knows nothing about any of this.** A template is instantiated here, in the editor,
and what a run sends is the flow node's title and body as they stand (`board_content.go` reads no
template of any kind). A class version in template mode is the same panel with a different end:
its text becomes the instance's description — see [Node classes](/exchange/dashboard/src/plugins/hybridflow-ui/README/classes-and-workflows.md#node-classes).

