import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Spin } from 'antd';
import { useToolBars } from '@kiao-dashboard-core';
import { useHybridflow } from '../Hybridflow-ctx';
import { useBoardClipboard } from '../useBoardClipboard';
import { useLinkDrag } from '../useLinkDrag';
import { useSpotDrag } from '../useSpotDrag';
import { usePlayFlowNode } from '../usePlayFlowNode';
import { usePlayDefaults } from '../usePlayDefaults';
import { useFlowNodeArchive } from '../useFlowNodeArchive';
import { useFlowNodeDelete } from '../useFlowNodeDelete';
import { useFlowNodeMove } from '../useFlowNodeMove';
import { useFlowNodeClassMove } from '../useFlowNodeClassMove';
import { useInstantiateClass, useInstantiateWorkflowClass } from '../useInstantiateClass';
import {
    BoardSummary, ListedClassDto, ListedWorkflowClassDto, useHybridflowClient,
} from '../service';
import { BOARD_ATTRIBUTE } from '../boardDom';
import { ROW_STEP } from '../boardSpots';
import { spotAt } from '../flowNodeSpot';
import { filterFlowNodes } from '../boardFilter';
import { useBoardControls } from '../BoardControls-ctx';
import { canPlay, canWorkOn } from '../flowNodeStatus';
import { chains, typeChanges } from '../flowNodeType';
import { withSettings } from '../flowNodeSettings';
import { successFor } from '../flowNodeSuccess';
import { canConnect } from '../flowConnections';
import { FlowNodeClass } from '../flowNodeClass';
import { hasWork, isRunnable, FlowNode } from '../boardContent';
import { FLOW_NODE_TAB_ID, WORKFLOW_TAB_ID } from '../constants';
import { StartChainRunModal } from './StartChainRunModal';
import { BoardCanvas } from './BoardCanvas';
import { FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps, FlowNodeWorkProps } from './FlowNodeCard';
import {
    FlowNodeClassChainProps, FlowNodeClassMenuProps, FlowNodeClassNextProps,
} from './NodeClassCard';
import styles from '../Hybridflow.module.css';
import { useChatAvailable } from '../useChatAvailable';
import { useShowChat } from '@kiao-dashboard-kit/capabilities';

interface BoardProps {

    handle: string;
}

/** Whether the press carries the harness's modifier: Ctrl — and Cmd beside it, which is the same. */
const withMod = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
    event.ctrlKey || event.metaKey;

/** One board, whole: every card where somebody put it, and an arrow from each card to the one it hands. */
export const Board: React.FC<BoardProps> = ({ handle }) => {
    const {
        content, loading, selected, select, openBoard, reloadBoard,
        marked, toggleMark, clearMarks, setMarked,
        selectedWorkflow, selectWorkflow,
        chainFlowNode, chainFlowNodeClass, placeFlowNodes, moveSpots,
        addFlowNode, cloneFlowNode, editFlowNode,
        addFlowNodeClass, cloneFlowNodeClass, removeFlowNodeClasses, convertFlowNodeToClass,
        createWorkflow, createWorkflowClass, removeWorkflows, removeWorkflowClasses, setWorking,
    } = useHybridflow();
    const clipboard = useBoardClipboard();
    const toolBars = useToolBars();
    const harnessAvailable = useChatAvailable();
    const play = usePlayFlowNode();
    const playDefaults = usePlayDefaults();
    const deleteFlowNodes = useFlowNodeDelete();
    const archiveFlowNodes = useFlowNodeArchive();
    const moveFlowNodes = useFlowNodeMove();
    const moveFlowNodeClasses = useFlowNodeClassMove();
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

    const [instantiateTargets, setInstantiateTargets] = useState<ListedClassDto[]>([]);
    const [instantiateWorkflows, setInstantiateWorkflows] = useState<ListedWorkflowClassDto[]>([]);
    const classesRequest = useRef(0);
    const refreshClasses = useCallback(() => {
        const request = ++classesRequest.current;
        if (!store) {
            setInstantiateTargets([]);
            setInstantiateWorkflows([]);
            return;
        }
        void store.flowNodeClasses().then(
            list => { if (request === classesRequest.current) setInstantiateTargets(list); },
            () => { if (request === classesRequest.current) setInstantiateTargets([]); },
        );
        void store.workflowClasses().then(
            list => { if (request === classesRequest.current) setInstantiateWorkflows(list); },
            () => { if (request === classesRequest.current) setInstantiateWorkflows([]); },
        );
    }, [store]);
    useEffect(() => {
        refreshClasses();
        return () => { ++classesRequest.current; };
    }, [refreshClasses]);

    const instantiateClass = useInstantiateClass(instantiateTargets);
    const instantiateWorkflow = useInstantiateWorkflowClass(instantiateTargets);

    useEffect(() => { openBoard(handle); }, [handle, openBoard]);

    useEffect(() => {
        if (play.documentAt) reloadBoard();
    }, [play.documentAt, reloadBoard]);


    const everyFlowNode = useMemo(
        () => (content?.flowNodes ?? []).filter(flowNode => !flowNode.archived),
        [content]);


    const everyClass = useMemo(() => content?.flowNodeClasses ?? [], [content]);

    const { zoom, filter } = useBoardControls();


    const shown = useMemo(() => filterFlowNodes(everyFlowNode, filter), [everyFlowNode, filter]);


    const shownClasses = useMemo(() => filterFlowNodes(everyClass, filter), [everyClass, filter]);


    const markedShown = useMemo(() => {
        if (marked.length === 0) return [];
        const held = new Set(marked);
        return [
            ...shown.filter(flowNode => held.has(flowNode.id)).map(flowNode => flowNode.id),
            ...shownClasses.filter(one => held.has(one.id)).map(one => one.id),
        ];
    }, [marked, shown, shownClasses]);

    const isMarked = useMemo(() => new Set(markedShown), [markedShown]);


    const workflowMembers = useMemo(() => {
        const members = new Map<string, string[]>();
        const file = (workflowId: string, cardId: string) => {
            members.set(workflowId, [...(members.get(workflowId) ?? []), cardId]);
        };
        for (const flowNode of everyFlowNode) {
            if (flowNode.workflow) file(flowNode.workflow, flowNode.id);
        }
        for (const flowNodeClass of everyClass) {
            if (flowNodeClass.workflowClass) file(flowNodeClass.workflowClass, flowNodeClass.id);
        }
        return members;
    }, [everyFlowNode, everyClass]);


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


    const placedClasses = useMemo(() => {
        const map = new Map<string, FlowNodeClass>();
        everyClass.forEach(one => map.set(one.id, one));
        return map;
    }, [everyClass]);


    const onLink = useCallback((fromId: string, toId: string | null) => {
        const fromClass = placedClasses.has(fromId);
        if (toId !== null) {
            const toClass = placedClasses.has(toId);
            if (fromClass !== toClass) return;
        }
        if (fromClass) chainFlowNodeClass(fromId, toId);
        else chainFlowNode(fromId, toId);
    }, [placedClasses, chainFlowNode, chainFlowNodeClass]);

    const canLink = useCallback((from: string, to: string) => {
        const fromClass = placedClasses.has(from);
        if (fromClass !== placedClasses.has(to)) return false;
        return fromClass || canConnect(content?.flowNodes ?? [], from, to);
    }, [placedClasses, content]);
    const link = useLinkDrag({ onLink, canLink });

    const onSpotMove = useCallback((flowNodeIds: string[], dx: number, dy: number) => {
        if (flowNodeIds.length === 1) clearMarks();
        moveSpots(flowNodeIds, dx, dy);
    }, [clearMarks, moveSpots]);

    const spotDrag = useSpotDrag({ onMove: onSpotMove, aimedAt, zoom });

    const openFlowNode = useCallback((flowNodeId: string) => {
        if (spotDrag.justDragged()) return;
        select(flowNodeId);
        toolBars.showTab(FLOW_NODE_TAB_ID);
    }, [spotDrag, select, toolBars]);


    const openWorkflow = useCallback((kind: 'workflow' | 'workflowClass', workflowId: string) => {
        if (spotDrag.justDragged()) return;
        selectWorkflow({ kind, id: workflowId });
        toolBars.showTab(WORKFLOW_TAB_ID);
    }, [spotDrag, selectWorkflow, toolBars]);


    const deleteWorkflows = useCallback((
        kind: 'workflow' | 'workflowClass', workflowIds: string[],
    ) => {
        const names = new Map<string, string>();
        for (const workflow of content?.workflows ?? []) names.set(workflow.id, workflow.name);
        for (const workflow of content?.workflowClasses ?? []) names.set(workflow.id, workflow.name);
        const going = workflowIds.filter(id => names.has(id));
        if (going.length === 0) return;
        const plural = kind === 'workflowClass' ? 'workflow classes' : 'workflows';
        const singular = kind === 'workflowClass' ? 'workflow class' : 'workflow';
        Modal.confirm({
            title: going.length > 1
                ? `Delete ${going.length} ${plural}?`
                : `Delete the ${singular} “${names.get(going[0]) || 'Untitled'}”?`,
            content: kind === 'workflowClass'
                ? 'Its classes are ungrouped and stay where they are.'
                : 'Its cards are ungrouped and stay where they are.',
            okText: going.length > 1 ? `Delete ${plural}` : `Delete ${singular}`,
            okType: 'danger',
            cancelText: 'Keep',
            onOk: () => (kind === 'workflowClass'
                ? removeWorkflowClasses(going)
                : removeWorkflows(going)),
        });
    }, [content, removeWorkflows, removeWorkflowClasses]);


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


    const deleteClasses = useCallback((classIds: string[]) => {
        const going = classIds.filter(id => placedClasses.has(id));
        if (going.length === 0) return;
        const title = going.length > 1
            ? `Delete ${going.length} classes?`
            : `Delete the class “${placedClasses.get(going[0])?.title || 'Untitled'}”?`;
        Modal.confirm({
            title,
            content: 'Their versions go with them, and the nodes made from them are unlinked — keeping what they say.',
            okText: going.length > 1 ? 'Delete classes' : 'Delete class',
            okType: 'danger',
            cancelText: 'Keep',
            onOk: () => removeFlowNodeClasses(going),
        });
    }, [placedClasses, removeFlowNodeClasses]);


    const onClassKeyDown = useCallback((flowNodeClass: FlowNodeClass, event: React.KeyboardEvent<HTMLElement>): void => {
        if (event.key === 'Delete') {
            event.preventDefault();
            deleteClasses(aimedAt(flowNodeClass.id));
            return;
        }
        if (event.key === 'Escape' && markedShown.length > 0 && !spotDrag.dragging) {
            event.preventDefault();
            clearMarks();
        }
    }, [aimedAt, clearMarks, spotDrag, markedShown, deleteClasses]);

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
            clipboard.pasteFlowNodes();
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
        if (flowNode.type !== 'ai' && flowNode.type !== 'scheduler') {
            if (!on) return null;
            return { state: on.state, retryAt: on.retryAt, chainRun: on.name };
        }
        if (!on && (!isRunnable(flowNode) || !canPlay(flowNode.status) || !hasWork(flowNode))) return null;
        if (!on) return { state: 'idle', onPlay: () => setNaming(flowNode) };
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
                if (flowNode.status === 'todo') editFlowNode(flowNode.id, { status: 'running' });
                setWorking(flowNode.id);
            },
        };
    };


    const nextProps = (flowNode: FlowNode): FlowNodeNextProps | null => {
        if (flowNode.type === 'gateway') {
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
                settings: withSettings(flowNode.settings, typeChanges(flowNode.settings, type, playDefaults)),
                ...(onSuccess === flowNode.onSuccess ? {} : { onSuccess }),
            });
        },
        // The reusable shape filed from the card: its title, kind and answers become the class's.
        onConvertToClass: () => convertFlowNodeToClass(flowNode.id),
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
        // The cards hidden everywhere by flipping the boolean, without deleting them.
        onArchive: () => archiveFlowNodes(aimedAt(flowNode.id)),
        archiving: aimedAt(flowNode.id).length,
        onDelete: () => deleteFlowNodes(aimedAt(flowNode.id)),
        deleting: aimedAt(flowNode.id).length,
    });


    const flowNodeClassMenu = (flowNodeClass: FlowNodeClass): FlowNodeClassMenuProps => {
        const going = aimedAt(flowNodeClass.id).filter(id => placedClasses.has(id));
        return {
            onInstantiate: () => instantiateClass(flowNodeClass.id, spotAt(
                flowNodeClass.spot?.x ?? 0, (flowNodeClass.spot?.y ?? 0) + ROW_STEP,
            )),
            onOpen: refreshClasses,
            onClone: () => cloneFlowNodeClass(flowNodeClass.id),
            onCreateWorkflowClass: () => {
                createWorkflowClass(going);
                toolBars.showTab(WORKFLOW_TAB_ID);
            },
            creating: going.length,
            onMove: (targetHandle: string) => {
                const target = moveTargets.find(candidate => candidate.slug === targetHandle);
                if (!target) return;
                void moveFlowNodeClasses(going, target);
            },
            moving: going.length,
            moveTargets,
            onDelete: () => deleteClasses(going),
            deleting: going.length,
        };
    };


    const flowNodeClassNext = (flowNodeClass: FlowNodeClass): FlowNodeClassNextProps | null => {
        const next = flowNodeClass.onSuccess.flowNode
            ? placedClasses.get(flowNodeClass.onSuccess.flowNode)
            : undefined;
        return next ? { title: next.title } : null;
    };


    const flowNodeClassChain = (flowNodeClass: FlowNodeClass): FlowNodeClassChainProps | null => {
        if (!harnessAvailable || !chains(flowNodeClass.type)) return null;
        return {
            knobProps: link.knobProps(flowNodeClass.id),
            source: link.source === flowNodeClass.id,
            target: link.target === flowNodeClass.id,
        };
    };


    const unlinkClass = (flowNode: FlowNode): (() => void) | null =>
        (flowNode.classVersion
            ? () => editFlowNode(flowNode.id, { classVersion: null })
            : null);

    if (loading || !content) return <div className={styles.empty}><Spin /></div>;

    return (
        <div className={styles.boardArea}>
            <BoardCanvas
                shown={shown}
                flowNodes={everyFlowNode}
                shownClasses={shownClasses}
                flowNodeClasses={everyClass}
                workflows={content.workflows ?? []}
                workflowClasses={content.workflowClasses ?? []}
                selectedWorkflowId={selectedWorkflow?.id ?? null}
                zoom={zoom}
                onPlace={placeFlowNodes}
                onAdd={(type, spot) => {
                    addFlowNode(type, spot);
                    toolBars.showTab(FLOW_NODE_TAB_ID);
                }}
                onAddClass={(type, spot) => {
                    addFlowNodeClass(type, spot);
                    toolBars.showTab(FLOW_NODE_TAB_ID);
                }}
                onPaste={spot => clipboard.pasteFlowNodes(spot)}
                instantiateTargets={instantiateTargets}
                instantiateWorkflows={instantiateWorkflows}
                onRefreshClasses={refreshClasses}
                onInstantiate={instantiateClass}
                onInstantiateWorkflow={instantiateWorkflow}
                onOpenWorkflow={openWorkflow}
                onAddInWorkflow={(kind, id, type, spot) => {
                    if (kind === 'workflowClass') addFlowNodeClass(type, spot, id);
                    else addFlowNode(type, spot, id);
                    toolBars.showTab(FLOW_NODE_TAB_ID);
                }}
                onPasteInWorkflow={(id, spot) => clipboard.pasteFlowNodes(spot, id)}
                onInstantiateInWorkflow={(workflowId, classId, spot) =>
                    instantiateClass(classId, spot, workflowId)}
                onDeleteWorkflow={(kind, id) => deleteWorkflows(kind, [id])}
                selectedFlowNodeId={selected}
                markedFlowNodeIds={isMarked}
                drag={spotDrag}
                flowNodePlay={playProps}
                flowNodeWork={workProps}
                flowNodeNext={nextProps}
                flowNodeChain={chainProps}
                flowNodeChat={chatProps}
                flowNodeUnlink={unlinkClass}
                flowNodeMenu={flowNodeMenu}
                flowNodeClassNext={flowNodeClassNext}
                flowNodeClassChain={flowNodeClassChain}
                flowNodeClassMenu={flowNodeClassMenu}
                onOpen={openFlowNode}
                onMark={toggleMark}
                onKeyDown={onFlowNodeKeyDown}
                onClassKeyDown={onClassKeyDown}
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

            <StartChainRunModal
                flowNode={naming ? naming.title : null}
                onCancel={() => setNaming(null)}
                onStart={name => {
                    if (naming) play.play(naming.id, name);
                    setNaming(null);
                }}
            />
        </div>
    );
};
