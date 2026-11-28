import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { NameDialog, useConfirmation, useDashboardConfig, useToolBars } from '@kiao-dashboard-core';
import { useHybridflow } from '../Hybridflow-ctx';
import { useBoardClipboard } from '../useBoardClipboard';
import { useLinkDrag } from '../useLinkDrag';
import { useSpotDrag } from '../useSpotDrag';
import { defaultChainRunName, usePlayFlowNode } from '../usePlayFlowNode';
import { useFlowNodeArchive } from '../useFlowNodeArchive';
import { useFlowNodeDelete } from '../useFlowNodeDelete';
import { useFlowNodeMove } from '../useFlowNodeMove';
import { BoardSummary, useHybridflowClient } from '../service';
import { BOARD_ATTRIBUTE } from '../boardDom';
import { revealTaskEditor } from '../boardRoute';
import { type FlowNodeSpot } from '../flowNodeSpot';
import type { FlowNodeSize } from '../flowNodeSize';
import { filterFlowNodes } from '../boardFilter';
import { useBoardControls } from '../BoardControls-ctx';
import { canPlay, canWorkOn } from '../flowNodeStatus';
import { chains, isTask, isWaitingEvent, splits, typeChanges, type FlowNodeType } from '../flowNodeType';
import { withSettings } from '../flowNodeSettings';
import { successFor } from '../flowNodeSuccess';
import { canAppendSuccessor } from '../flowConnections';
import { hasWork, isRunnable, FlowNode } from '../boardContent';
import { FLOW_NODE_TAB_ID, WORKFLOW_TAB_ID } from '../constants';
import { workflowDeletion } from './workflowDeletion';
import { BoardCanvas } from './BoardCanvas';
import { FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps, FlowNodeWorkProps } from './FlowNodeCard';
import styles from '../Hybridflow.module.css';
import { useShowChat } from '../conversations/ChatShow-ctx';

interface BoardProps {

    handle: string;
}

/** Whether the press carries the harness's modifier: Ctrl — and Cmd beside it, which is the same. */
const withMod = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
    event.ctrlKey || event.metaKey;

/** One board, whole: every card where somebody put it, and an arrow from each card to the one it hands. */
export const Board: React.FC<BoardProps> = ({ handle }) => {
    const {
        content, error, loading, selected, select, openTask, reloadBoard,
        marked, toggleMark, clearMarks, setMarked,
        selectedWorkflow, selectWorkflow,
        chainFlowNode, placeFlowNodes, moveSpots,
        addFlowNode, cloneFlowNode, editFlowNode,
        createWorkflow, removeWorkflows, setWorking,
    } = useHybridflow();
    const confirm = useConfirmation();
    const clipboard = useBoardClipboard();
    const toolBars = useToolBars();
    const { chatEnabled: harnessAvailable } = useDashboardConfig();
    const play = usePlayFlowNode();
    const deleteFlowNodes = useFlowNodeDelete();
    const archiveFlowNodes = useFlowNodeArchive();
    const moveFlowNodes = useFlowNodeMove();
    const store = useHybridflowClient();
    const showChat = useShowChat();

    // Read once per board shown rather than per card opened — the menu only lists them.
    const [boards, setBoards] = useState<BoardSummary[]>([]);
    useEffect(() => {
        if (!store) {
            setBoards([]);
            return;
        }
        let stopped = false;
        void store.boards().then(
            list => { if (!stopped) setBoards(list); },
            () => { if (!stopped) setBoards([]); },
        );
        return () => { stopped = true; };
    }, [store]);
    const moveTargets = useMemo(() => boards
        .filter(board => board.slug !== handle && !board.archived)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(board => ({ slug: board.slug, name: board.name })), [boards, handle]);

    const createFlowNode = (type: FlowNodeType, spot: FlowNodeSpot, workflow = '') =>
        workflow ? addFlowNode(type, spot, workflow) : addFlowNode(type, spot);

    useEffect(() => {
        if (play.documentAt) reloadBoard();
    }, [play.documentAt, reloadBoard]);

    const everyFlowNode = useMemo(
        () => (content?.flowNodes ?? []).filter(flowNode => !flowNode.archived),
        [content]);

    const { zoom, filter } = useBoardControls();

    const shown = useMemo(() => filterFlowNodes(everyFlowNode, filter), [everyFlowNode, filter]);

    const markedShown = useMemo(() => {
        if (marked.length === 0) return [];
        const held = new Set(marked);
        return shown.filter(flowNode => held.has(flowNode.id)).map(flowNode => flowNode.id);
    }, [marked, shown]);

    const isMarked = useMemo(() => new Set(markedShown), [markedShown]);

    const workflowMembers = useMemo(() => {
        const members = new Map<string, string[]>();
        const file = (workflowId: string, flowNodeId: string) => {
            members.set(workflowId, [...(members.get(workflowId) ?? []), flowNodeId]);
        };
        for (const flowNode of everyFlowNode) {
            if (flowNode.workflow) file(flowNode.workflow, flowNode.id);
        }
        return members;
    }, [everyFlowNode]);

    const aimedAt = useCallback(
        (id: string): string[] => {
            const members = workflowMembers.get(id);
            if (members) return members;
            return isMarked.has(id) ? markedShown : [id];
        },
        [workflowMembers, isMarked, markedShown],
    );

    const [naming, setNaming] = useState<FlowNode | null>(null);

    const placed = useMemo(() => {
        const map = new Map<string, FlowNode>();
        everyFlowNode.forEach(flowNode => map.set(flowNode.id, flowNode));
        return map;
    }, [everyFlowNode]);

    const canLink = useCallback((from: string, to: string) =>
        canAppendSuccessor(content?.flowNodes ?? [], from, to), [content]);
    const link = useLinkDrag({ onLink: chainFlowNode, canLink });

    const onSpotMove = useCallback((flowNodeIds: string[], dx: number, dy: number) => {
        if (flowNodeIds.length === 1) clearMarks();
        moveSpots(flowNodeIds, dx, dy);
    }, [clearMarks, moveSpots]);

    const spotDrag = useSpotDrag({ onMove: onSpotMove, aimedAt, zoom });

    const onResize = useCallback((id: string, size: FlowNodeSize, spot: FlowNodeSpot) => {
        editFlowNode(id, { size, spot });
    }, [editFlowNode]);

    const openFlowNode = useCallback((flowNodeId: string) => {
        if (spotDrag.justDragged()) return;
        const node = placed.get(flowNodeId);
        if (node && isTask(node.type)) {
            openTask(flowNodeId);
            revealTaskEditor(toolBars);
        } else {
            select(flowNodeId);
            toolBars.showTab(FLOW_NODE_TAB_ID);
        }
    }, [spotDrag, placed, openTask, select, toolBars]);

    const openWorkflow = useCallback((workflowId: string) => {
        if (spotDrag.justDragged()) return;
        selectWorkflow(workflowId);
        toolBars.showTab(WORKFLOW_TAB_ID);
    }, [spotDrag, selectWorkflow, toolBars]);

    const deleteWorkflow = useCallback((id: string) => {
        const workflow = content?.workflows.find(group => group.id === id);
        if (!workflow) return;
        confirm({
            ...workflowDeletion(workflow.name),
            onConfirm: () => removeWorkflows([id]),
        });
    }, [confirm, content, removeWorkflows]);

    const onFlowNodeKeyDown = useCallback((flowNode: FlowNode, event: React.KeyboardEvent<HTMLElement>): boolean => {
        if (withMod(event) && !event.shiftKey && !event.altKey && !event.repeat) {
            const key = event.key.toLowerCase();
            if (key === 'c' || key === 'x') {
                const selection = window.getSelection?.();
                if (selection && !selection.isCollapsed) return false;
                event.preventDefault();
                if (key === 'c') clipboard.copyFlowNodes(aimedAt(flowNode.id));
                else clipboard.cutFlowNodes(aimedAt(flowNode.id));
                return true;
            }
        }
        if (event.key === 'Delete') {
            event.preventDefault();
            deleteFlowNodes(aimedAt(flowNode.id));
            return true;
        }
        // And the way back out of a selection made by mistake, without having to find the cards again to Ctrl-click them off one at a time.
        if (event.key === 'Escape' && markedShown.length > 0 && !spotDrag.dragging) {
            event.preventDefault();
            clearMarks();
            return true;
        }
        return false;
    }, [aimedAt, clearMarks, clipboard, deleteFlowNodes, spotDrag, markedShown]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!withMod(event) || event.shiftKey || event.altKey || event.repeat) return;
            if (event.key.toLowerCase() !== 'v') return;
            const target = event.target as Element | null;
            if (target?.closest?.('input, textarea, select, .ant-modal-wrap')) return;
            if ((target as HTMLElement | null)?.isContentEditable) return;
            const onBoard = !!target?.closest?.(`[${BOARD_ATTRIBUTE}]`);
            const nowhere = target === document.body || target === document.documentElement
                || event.target === document;
            if (!onBoard && !nowhere) return;
            event.preventDefault();
            clipboard.paste();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [clipboard]);

    const clearSelection = useCallback(() => {
        if (selected !== null || selectedWorkflow !== null || marked.length > 0) select(null);
    }, [selected, selectedWorkflow, marked, select]);

    const boxAnchor = useRef<{ additive: boolean; held: string[] } | null>(null);

    const onBoxStart = useCallback((additive: boolean) => {
        boxAnchor.current = { additive, held: marked };
        if (!additive && (selected !== null || selectedWorkflow !== null)) select(null);
    }, [marked, selected, selectedWorkflow, select]);

    const onBoxChange = useCallback((flowNodeIds: string[]) => {
        const anchor = boxAnchor.current;
        if (!anchor?.additive) {
            setMarked(flowNodeIds);
            return;
        }
        const held = new Set(anchor.held);
        setMarked([...anchor.held, ...flowNodeIds.filter(id => !held.has(id))]);
    }, [setMarked]);

    const onBoxCancel = useCallback(() => {
        const anchor = boxAnchor.current;
        boxAnchor.current = null;
        if (anchor) setMarked(anchor.held);
    }, [setMarked]);

    const playProps = (flowNode: FlowNode): FlowNodePlayProps | null => {
        if (!harnessAvailable) return null;
        const on = play.runOn(flowNode.id);
        const { type } = flowNode;
        if (type !== 'ai' && type !== 'start' && type !== 'limiter' && !isWaitingEvent(type)) {
            if (!on) return null;
            return { state: on.state, retryAt: on.retryAt, chainRun: on.name };
        }
        if (!on) {
            if (!canPlay(flowNode.status, flowNode.type) || !isRunnable(flowNode, content) || !hasWork(flowNode)) return null;
            const resume = flowNode.status === 'interrupted' ? play.resumeOn(flowNode.id, flowNode.chat) : undefined;
            return { state: 'idle', onPlay: resume ?? (() => setNaming(flowNode)) };
        }
        return {
            state: on.state,
            retryAt: on.retryAt,
            chainRun: on.name,
            onStop: () => play.stop(on.id),
        };
    };

    const workProps = (flowNode: FlowNode): FlowNodeWorkProps | null => {
        if (flowNode.type !== 'human' || flowNode.archived || !canWorkOn(flowNode.status)) return null;
        return {
            onWork: () => {
                select(flowNode.id);
                if (flowNode.status !== 'running') editFlowNode(flowNode.id, { status: 'running' });
                setWorking(flowNode.id);
            },
        };
    };

    const nextProps = (flowNode: FlowNode): FlowNodeNextProps | null => {
        if (splits(flowNode.type)) {
            const titles = flowNode.onSuccess.flowNodes
                .map(id => placed.get(id))
                .filter((next): next is FlowNode => !!next)
                .map(next => next.title || 'Untitled');
            if (titles.length === 0) return null;
            return { title: titles.join(', ') };
        }
        const named = flowNode.onSuccess.flowNode ? placed.get(flowNode.onSuccess.flowNode) : undefined;
        if (!named) return null;
        return { title: named.title };
    };

    const chainProps = (flowNode: FlowNode): FlowNodeChainProps | null => {
        if (!harnessAvailable || !chains(flowNode.type)) return null;
        return {
            knobProps: link.knobProps(flowNode.id),
            source: link.source === flowNode.id,
            target: link.target === flowNode.id,
        };
    };

    const chatProps = (flowNode: FlowNode): (() => void) | null => {
        if (!harnessAvailable || !flowNode.chat) return null;
        return () => showChat(flowNode.chat);
    };

    const flowNodeMenu = (flowNode: FlowNode): FlowNodeMenuProps => ({
        onClone: () => cloneFlowNode(flowNode.id),
        onConvertType: type => {
            const onSuccess = successFor(flowNode.onSuccess, type);
            editFlowNode(flowNode.id, {
                type,
                settings: withSettings(flowNode.settings, typeChanges(flowNode.settings, type)),
                ...(onSuccess === flowNode.onSuccess ? {} : { onSuccess }),
            });
        },
        onCreateWorkflow: () => {
            createWorkflow(aimedAt(flowNode.id).filter(id => placed.has(id)));
            toolBars.showTab(WORKFLOW_TAB_ID);
        },
        creating: aimedAt(flowNode.id).filter(id => placed.has(id)).length,
        onCopy: () => clipboard.copyFlowNodes(aimedAt(flowNode.id)),
        copying: aimedAt(flowNode.id).length,
        onCut: () => clipboard.cutFlowNodes(aimedAt(flowNode.id)),
        cutting: aimedAt(flowNode.id).length,
        onMove: (targetHandle: string) => {
            const target = moveTargets.find(candidate => candidate.slug === targetHandle);
            if (!target) return;
            void moveFlowNodes(aimedAt(flowNode.id), target);
        },
        moving: aimedAt(flowNode.id).length,
        moveTargets,
        // Archived flow nodes stay in the board record.
        onArchive: () => archiveFlowNodes(aimedAt(flowNode.id)),
        archiving: aimedAt(flowNode.id).length,
        onDelete: () => deleteFlowNodes(aimedAt(flowNode.id)),
        deleting: aimedAt(flowNode.id).length,
    });

    if (error && !content) return <div className={styles.empty}><Alert type="error" title={error} showIcon /></div>;
    if (loading || !content) return <div className={styles.empty}><Spin /></div>;

    return (
        <div className={styles.boardArea}>
            <BoardCanvas
                shown={shown}
                flowNodes={everyFlowNode}
                workflows={content.workflows ?? []}
                selectedWorkflowId={selectedWorkflow}
                zoom={zoom}
                onPlace={placeFlowNodes}
                onAdd={(type, spot, workflow) => {
                    createFlowNode(type, spot, workflow);
                    toolBars.showTab(FLOW_NODE_TAB_ID);
                }}
                onPaste={clipboard.paste}
                onInstantiateHere={clipboard.instantiateHere}
                onOpenWorkflow={openWorkflow}
                onCopyWorkflow={clipboard.copyWorkflow}
                onDeleteWorkflow={deleteWorkflow}
                selectedFlowNodeId={selected}
                markedFlowNodeIds={isMarked}
                drag={spotDrag}
                flowNodePlay={playProps}
                flowNodeWork={workProps}
                flowNodeNext={nextProps}
                flowNodeChain={chainProps}
                flowNodeChat={chatProps}
                flowNodeMenu={flowNodeMenu}
                onOpen={openFlowNode}
                onMark={toggleMark}
                onKeyDown={onFlowNodeKeyDown}
                onResize={onResize}
                onDeselect={clearSelection}
                onBoxStart={onBoxStart}
                onBoxChange={onBoxChange}
                onBoxCancel={onBoxCancel}
            />

            {link.source !== null && (
                <svg className={styles.chainLine} aria-hidden="true">
                    <line ref={link.lineRef} />
                </svg>
            )}

            <NameDialog
                open={naming !== null}
                title="Start a chain run"
                label="Chain run name"
                okText="Start"
                description={`Starts at “${naming?.title || 'Untitled'}” and plays the rest of the chain.`}
                initialName={defaultChainRunName}
                inputTestId="chain-run-name"
                allowEmpty
                onSubmit={name => { if (naming) play.play(naming.id, name); }}
                onClose={() => setNaming(null)}
            />
        </div>
    );
};
