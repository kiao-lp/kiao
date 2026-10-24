[← hybridflow-ui index](/exchange/dashboard/src/plugins/hybridflow-ui/README.md)

Assumes: you read the index and know what a board, a flow node and a chain are.

# Files

| File | Role |
| --- | --- |
| `index.tsx` | Manifest: the URL prefix, the main view, the toolbar tabs, the providers. |
| `constants.ts` | The six toolbar tab ids. |
| `boardRoute.ts` | The `/boards` URLs, and the store folder belonging to a board. |
| `boardContent.ts` | The format: cards, classes and workflows, what is written back, and what a prompt reads out of a flow node. |
| `flowNodeType.ts` | **What kind of card a flow node is** — AI, Human, Shutdown or Scheduler — and what each of the four is asked. |
| `flowNodeSettings.ts` | What a turn is run with: which agent, at what effort, how its tool calls are answered, where — and which runner it is pinned to. |
| `flowNodeSchedule.ts` | A Scheduler's datetime: the wall clock it waits for, as the card holds it and reads it out. |
| `flowNodeStatus.ts` | Where a flow node stands, in eight words from `draft` to `error`, and which of them is played. |
| `flowNodeSuccess.ts` | What a flow node says is to be done after it: the flow node played next, the transition mode, and whether its chat is shortened. |
| `flowNodeSpot.ts` | Where a card sits on the board: a point on the canvas, on the card, and absent for a card nobody has placed. |
| `flowNodeClass.ts` | The reusable card: node classes, their versions, and the chains an instantiation makes flow nodes from. |
| `flowNodeMove.ts` | Taking cards to another board of this store: what travels and what is left behind. |
| `flowNodeClassMove.ts` | Taking classes to another board: the class whole, versions and all. |
| `boardSpots.ts` | The geometry of the board: the chains a board reads as, where an unplaced card goes, and where an arrow between two cards runs. |
| `workflowBounds.ts` | The geometry of the workflows: the rectangle drawn round each group of cards. |
| `boardDom.ts` | Where the cards are, asked of the document at pointer time. |
| `boardScroll.ts` | Bringing the board to the pointer while something is dragged across it. |
| `boardFilter.ts` | The filter above the board: the words its cards wear, and what a word leaves on screen. |
| `boardOps.ts` | Every edit the board makes, as pure functions from one board content to the next — all keyed on ids. |
| `boardWrites.ts` | The call that makes each gesture true, given with the operation: no diffing. |
| `boardClip.ts` | Flow nodes as clipboard JSON, and back, with fresh ids. |
| `boardMerge.ts` | The board on screen and the board the service holds put together, against the one both started from. |
| `flowNodeTemplates.ts` | The templates a flow node's description is written from: the `.temp.md` files of `kiao-user-config/flow-node-templates`, the two named ones among them, and what they say when the store has none. |
| `boardOps.archiveFlowNodes` | Archiving as a boolean flip: the card stays stored with `archived` set, hidden everywhere with its links. |
| `runnerSeen.ts` | When a runner was last heard from, as the panel reads it out. |
| `Hybridflow-ctx.tsx` | The open board, the open card, the open rectangle, whether the card is open large, and the reading and writing — watched, so the service is followed while a board is open. |
| `FlowNodeEditing-ctx.tsx` | The open card as it is being typed: one draft of its title and description, and every write made to it — shared by both faces of the editor. |
| `Agents-ctx.tsx` | The managed agents, wherever they are read: the panel that keeps them, the editor that picks one, the chips a card wears. |
| `Runners-ctx.tsx` | The runners, wherever they are read: the panel, the task editor, the paste deciding whether a pin names one of this store's. |
| `useBoardSync.ts` | Watching the board: the held request, the ordered writes, the merge of every re-read. |
| `usePlayDefaults.ts` | What the store answers about a card nobody has been asked about yet: its first agent, and the permission mode a card made on the board opens with. |
| `useChatAvailable.ts` | Whether this board can be played at all: the deployment's switch and the capability that plays. |
| `useOpenFlowNodeChat.ts` | The way into the chat a flow node was played in — from either face of the editor, and from the card. |
| `useBoardClipboard.ts` | The copy, cut and paste commands, and what they say when the clipboard refuses. |
| `useFlowNodeMove.ts` | Moving cards to another board: created there first, taken off here after. |
| `useFlowNodeClassMove.ts` | Moving classes to another board, versions and all. |
| `useInstantiateClass.tsx` | Instantiating a class or a workflow class: its templates first, its flow nodes after. |
| `useLinkDrag.ts` | Drawing a chain from one card's knob to another card. |
| `useSpotDrag.ts` | The board's drag: a card carried across the canvas, following the pointer, and put down where it is let go. |
| `useBoxSelect.ts` | The box pulled on the empty canvas to pick cards out — cards and classes alike — reported live as it moves. |
| `useCardHeights.ts` | How tall the cards on the canvas actually are, read back out of the document, so the arrows meet real edges. |
| `useFlowNodeRemoval.ts` | Cards deleted or cut off the board: the question they ask about their chats when nothing left names them. |
| `useFlowNodeDelete.ts` | Deleting a card, or the several marked with it — the way off the board that keeps nothing. |
| `useFlowNodeArchive.ts` | Archiving a card: the boolean flip hiding it everywhere without deleting it. |
| `usePlayFlowNode.ts` | The board's view of the service's runs: which run holds which card, and the two buttons. |
| `service/` | The hybridflow-store over HTTP, and the fake the tests hold (`fakeClient.ts`). |
| `components/Board.tsx` | The board view: the canvas, the filter, the menus, the run names. |
| `components/BoardCanvas.tsx` | The canvas itself: rectangles at the back, one relation layer above them, cards where somebody put them on top. |
| `components/BoardFilter.tsx` | The row of tag chips above the canvas. |
| `components/BoardsPanel.tsx` | The Boards toolbar tab: the way in to each board. |
| `components/BoardsPage.tsx` | The same list as a page, at the bare `/boards` URL. |
| `components/FlowNodeCard.tsx` | One card: what it shows, its menu, its Play, its knob. |
| `components/NodeClassCard.tsx` | One class card: the same, for a reusable card. |
| `components/FlowNodePanel.tsx` | The Node tab: the open card in a panel's width. |
| `components/ExpandedFlowNode.tsx` | The large editor over the board, pushed onto the central area's stack. |
| `components/FlowNodeEditorPanel.tsx` | The large editor's faces: the rows of settings above the markdown panes. |
| `components/FlowNodeControls.tsx` | Every control both faces share, written once and arranged twice. |
| `components/FlowNodeStateEditor.tsx` | Where the card stands and which chat it was played in. |
| `components/FlowNodeMetaEditor.tsx` | The type and the settings. |
| `components/FlowNodeSuccessEditor.tsx` | What comes after the card and what becomes of its chat. |
| `components/FlowNodeClassPanel.tsx` | The reusable card's editor: the class, its versions, its note. |
| `components/ClassVersionTemplatePanel.tsx` | A version in template mode, written as the template it is instantiated as. |
| `components/FlowNodeCosts.tsx` | What an AI card spent, on its own row of the large editor. |
| `components/WorkflowPanel.tsx` | The Workflow tab: the open rectangle's name, which is all it has. |
| `components/FlowNodeTemplateSelect.tsx` | The template the description is written from, and the button instantiating it. |
| `components/TemplateInstantiationPanel.tsx` | Instantiating a template: what it asks on the left, what it makes on the right. |
| `components/HybridflowPanel.tsx` | The chain runs panel: every run as a tree, its chain under it, and Stop, Resume, Restart and Forget. |
| `components/StartChainRunModal.tsx` | What a run is called, asked for at the click, prefilled with the moment it starts. |
| `components/AgentsPanel.tsx` | The Node agents tab: the named definitions of what plays a flow node. |
| `components/RunnersPanel.tsx` | The Runners tab: the machines that play cards, and when each was last heard from. |

**Reading is forgiving, writing is narrow.** A card may have been hand-written, produced by a
turn or pasted in from another instance, so `readBoardContent` drops what it cannot read and gives an id to
anything written without one.
`writeBoardContent` writes one shape and leaves out everything that says nothing — no
`"settings": {}` — so a paste stays a thing a person can read.

**Everything is keyed on ids.** `boardOps` finds a flow node by id wherever it has been dragged to,
which is what lets a run, the panel and a paste all name the same flow node without agreeing on when
they last looked at the board.

**The other reader of this format is the hybridflow-runner inside worker**, which plays the board:
`board_content.go` is the same two rules in Go, reading the same shape the same forgiving way, so a
card the runner holds and one this editor holds read the same.

