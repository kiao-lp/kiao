[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know what a card shows and how the canvas reads.

# Tags

A card carries the **words it is filed under**:

```json
{ "id": "…", "title": "Write the plan", "tags": ["bug", "ui"] }
```

**A tag says what a card is *about*.** That is also why a tag is not a status and not a setting — it
says nothing about what runs the flow node, how hard it thinks or what happens after it. It is asked
of every card, an agent's or not.

**The document holds the words, not ids.** `kiao-user-config/tags.json` says what colour each word
is worn in, and that is the whole of what it says; a word it has never named is worn all the same,
in a neutral grey. So a board is still hand-writable, a turn holding the `hybridflow` skill can tag a
card without reading a second file, and a **card copied into another instance** arrives meaning what
it meant — `bug` is bug there too, where the colour is that store's own business. It is the exact
opposite of the [`chat`](/exchange/dashboard/src/plugins/hybridflow-ui/README/status-and-chat.md#status-and-chat), which never travels: one is a word, the other is an id
naming a conversation of this instance.

The card wears them **directly under its title**: what a card is filed under is read with its name,
and on a card that no longer carries a description they are the whole of what it is about. They wrap,
so a card with six tags is six tags high — a tag half shown is a tag nobody can read.

Both faces of the editor offer the **picker** — under the title in the panel, on the status row in
the large editor — through the tags capability, so **a word typed onto a
card joins the store's list on the spot**, with the first colour no tag holds. A tag that had to be
declared before it could be used is a tag nobody declares. The Tags panel is then where they are
coloured, renamed, reordered and thrown away.

## The filter above the board

The board's tags are a row of chips over the canvas, and pressing one leaves the cards wearing it:

```
  [bug] [ops] [ui]        2 of 11 shown   ⌫
```

**A filter is a question, not an edit.** It writes nothing — not the document, not the view state —
and it is gone when the board is left: "show me the bugs" is a thing somebody asks for a minute.
That is also why the tag is the one thing filtered on: a status is where a play left a card and is
read at a glance already; what a card is *about* is the thing scattered across a board too big to
read at once.

**The words offered are the board's own**, not the store's: `tags.json` may name thirty where this
board uses three, and a row of words that all hide every card is not a filter. They are in
alphabetical order — the row is a thing the hand comes back to, and a card added to the board
would otherwise move the chip somebody was about to click. Several are read as **or**: `bug` and
`ui` asks for the cards about either, which is what a row of chips looks like it means. The row is
not drawn at all on a board wearing no tag, nor in an assembly without the tags capability, where a
bar of invisible chips would be a strip of empty buttons.

**The cards hidden are still there**, which is the whole of what the rest of the board has to
respect: a mark on a card the filter is holding back is left out of every gesture, so a delete
never takes a card nobody could see.

**The runner reads none of it.** The words are carried through the rewrites a run makes — a field
it did not know about would be a field the play quietly deleted — and mean nothing there
(`board_content.go`). They are the board's, and the merge treats them as such: like the title, they
are only ever written here, so the side that changed them is the side that meant to.

