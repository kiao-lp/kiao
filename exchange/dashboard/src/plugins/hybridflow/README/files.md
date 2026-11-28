---
document:
  status: DRAFT
  role: PRIMARY_SOURCE
---

# Files

[Board guide](../README.md)

Paths are relative to `src/plugins/hybridflow/`. Pure models and operations stay outside
React; contexts coordinate drafts, services and rendering.

| Files | Responsibility |
| --- | --- |
| `index.tsx`, `constants.ts`, `boardRoute.ts` | Manifest, seven toolbar tab IDs, routes and board folders |
| `boardContent.ts` | Read/write shape, normalization and prompt construction |
| `flowNodeType.ts`, `flowNodeSettings.ts` | Node kinds, type conversion, explicit play settings and runner pins |
| `flowNodeSchedule.ts`, `flowNodeStatus.ts`, `flowNodeSuccess.ts` | Timing, lifecycle gates and successor/chat rules |
| `flowNodeStatusGlyph.tsx`, `components/FlowNodeStatusMenu.tsx` | Shared status symbols and the editor's status dropdown |
| `flowNodeSpot.ts`, `flowNodeSize.ts`, `boardSpots.ts`, `workflowBounds.ts` | Node positions and dimensions, chain layout, arrows and group bounds |
| `flowNodeMove.ts` | Transfers to another board |
| `boardOps.ts`, `boardWrites.ts` | ID-keyed pure edits and their narrow service calls; archival is a boolean update |
| `boardClip.ts`, `boardMerge.ts` | Clipboard conversion and three-way board merging |
| `boardDom.ts`, `boardScroll.ts`, `boardFilter.ts` | Pointer-time geometry, drag scrolling and tag filters |
| `flowNodeTemplates.ts`, `runnerSeen.ts` | Template defaults and runner last-seen display |
| `Hybridflow-ctx.tsx`, `FlowNodeEditing-ctx.tsx` | Open board/node/workflow, title/body drafts and writes |
| `Agents-ctx.tsx`, `Runners-ctx.tsx` | Shared managed-agent and runner lists |
| `useBoardSync.ts` | Held-request watch and ordered writes |
| `conversations/`, `usePlayFlowNode.ts` | Conversations, socket, chain runs and board playback |
| `agentic-resources/`, `useHarnessOptions.ts` | Shared agent catalogue, editor and harness options |
| `useBoardClipboard.ts`, `useFlowNodeMove.ts` | Clipboard and transfer orchestration |
| `useInstantiateClipboard.tsx`, `useLinkDrag.ts`, `useSpotDrag.ts` | Template instantiation, successor dragging and movement |
| `useBoxSelect.ts`, `useCardHeights.ts`, `useCardResize.ts` | Live rectangle selection, measured card heights and edge resizing |
| `useFlowNodeRemoval.ts`, `useFlowNodeDelete.ts`, `useFlowNodeArchive.ts` | Removal, batch confirmation and chat cleanup choices |
| `service/` | HTTP client and test `fakeClient.ts` |
| `components/Board.tsx`, `BoardCanvas.tsx`, `BoardFilter.tsx` | Board orchestration, chain run naming, canvas layers and tag chips |
| `components/BoardsPanel.tsx`, `BoardsPage.tsx` | Boards tab and `/boards` list |
| `components/FlowNodeCard.tsx` | Card presentation, menus and gestures |
| `components/FlowNodePanel.tsx` | Flow node panel with Spec, Options and Result task views |
| `components/FlowNodeCosts.tsx`, `FlowNodeOutput.tsx` | Task consumption totals, output schema and stored output |
| `components/FlowNodeControls.tsx`, `FlowNodeStateEditor.tsx`, `FlowNodeMetaEditor.tsx`, `FlowNodeSuccessEditor.tsx` | Shared controls for state, type/settings and successors |
| `components/WorkflowPanel.tsx` | Workflow name, shared values and file settings |
| `components/FlowNodeTemplateMenu.tsx`, `TemplateInstantiationPanel.tsx` | Template menu, answers and preview |
| `components/HybridflowPanel.tsx` | Chain runs tree |
| `agentic-resources/` | Agent source management, its HTTP client and catalogue state |
| `components/RunnersPanel.tsx` | Runner status |

## Format and write rules

- **Forgiving reads:** accept hand-written or pasted data, discard unreadable entries and
  supply missing IDs. `writeBoardContent` emits one normalized shape and omits empty values.
- **Stable identity:** operations find nodes by ID regardless of layout or stale snapshots.
- **Narrow writes:** each gesture supplies its specific service call; never replace a board
  to update one field. `useBoardSync` orders writes and merges incoming revisions.
- **Shared meaning:** worker's hybridflow-runner reads the same shape in `board_content.go`.
  Changes must keep both readers consistent.
