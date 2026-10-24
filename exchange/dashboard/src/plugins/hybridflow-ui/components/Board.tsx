import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Spin } from 'antd';
import { useToolBars } from '@cms-core';
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
import { canPlay } from '../flowNodeStatus';
import { chains, typeChanges } from '../flowNodeType';
import { withSettings } from '../flowNodeSettings';
import { successFor } from '../flowNodeSuccess';
import { FlowNodeClass } from '../flowNodeClass';
import { hasWork, isRunnable, FlowNode } from '../boardContent';
import { FLOW_NODE_TAB_ID, WORKFLOW_TAB_ID } from '../constants';
import { StartChainRunModal } from './StartChainRunModal';
import { BoardCanvas } from './BoardCanvas';
import { FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps } from './FlowNodeCard';
import {
    FlowNodeClassChainProps, FlowNodeClassMenuProps, FlowNodeClassNextProps,
} from './NodeClassCard';
import styles from '../Hybridflow.module.css';
import { useChatAvailable } from '../useChatAvailable';
import { useShowChat } from '@cms-kit/capabilities';

interface BoardProps {
    /** The **handle** of the board being shown — its slug, which is what its URL carries. */
    handle: string;
}

/**
 * How long a click on a card waits before bringing the flow node panel up, which is how the board tells
 * one click from the first of two: the browser reports a double-click only after the second one,
 * and by then a panel opened straight away would already be on screen.
 *
 * It is a wait on the panel alone — the card is selected as it is clicked — so nothing hangs on it
 * where the panel is already up, that being the case the delay would otherwise be felt in.
 */
const PANEL_AFTER_CLICK_MS = 300;

/**
 * Whether the press carries the platform's modifier: Ctrl — and Cmd beside it, which is the same
 * gesture on a Mac and the one a Mac hand reaches for.
 */
const withMod = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
    event.ctrlKey || event.metaKey;

/**
 * One board, whole: every card where somebody put it, and an arrow from each card
 * to the one it hands on to.
 *
 * The board answers *what runs after what*, which is the one thing a chain of six flow nodes is
 * entirely about. What a play did with a flow node is on the flow node, and so is what runs after it.
 */
export const Board: React.FC<BoardProps> = ({ handle }) => {
    const {
        content, loading, selected, select, setExpanded, openBoard, reloadBoard,
        marked, toggleMark, clearMarks, setMarked,
        selectedWorkflow, selectWorkflow,
        chainFlowNode, chainFlowNodeClass, placeFlowNodes, moveSpots,
        addFlowNode, cloneFlowNode, editFlowNode,
        addFlowNodeClass, cloneFlowNodeClass, removeFlowNodeClasses, convertFlowNodeToClass,
        createWorkflow, createWorkflowClass, removeWorkflows, removeWorkflowClasses,
    } = useHybridflow();
    const clipboard = useBoardClipboard();
    const toolBars = useToolBars();
    const agentAvailable = useChatAvailable();
    const play = usePlayFlowNode();
    const playDefaults = usePlayDefaults();
    const deleteFlowNodes = useFlowNodeDelete();
    const archiveFlowNodes = useFlowNodeArchive();
    const moveFlowNodes = useFlowNodeMove();
    const moveFlowNodeClasses = useFlowNodeClassMove();
    const store = useHybridflowClient();
    const showChat = useShowChat();

    // The other boards, for the card menu's "Move to..." submenu: every board but this one.
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

    // The global catalogues are refreshed whenever a context menu offers instantiation.
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

    // Instantiating a class: its templates first — one panel per version in template mode —
    // its flow nodes after, asked with the instantiated texts.
    const instantiateClass = useInstantiateClass(instantiateTargets);
    // Instantiating a workflow class: its members' templates first, its workflow after.
    const instantiateWorkflow = useInstantiateWorkflowClass(instantiateTargets);

    useEffect(() => { openBoard(handle); }, [handle, openBoard]);

    // The play writes this very board — the mark, the chat it was played in — and it does it
    // in worker, so the board is told rather than being the one that wrote. Every write says
    // when it happened, and the board reads again on a new value: that is how a card fills
    // in while somebody watches it.
    useEffect(() => {
        if (play.documentAt) reloadBoard();
    }, [play.documentAt, reloadBoard]);

    /** Every live card of the board, in the order it is read. Archived cards stay stored but are never drawn. */
    const everyFlowNode = useMemo(
        () => (content?.flowNodes ?? []).filter(flowNode => !flowNode.archived),
        [content]);

    /** Every class of the board, in the order it is read. */
    const everyClass = useMemo(() => content?.flowNodeClasses ?? [], [content]);

    // The tag filter and read size, shared with the Board tab strip.
    const { zoom, filter } = useBoardControls();

    /** The cards the board holds, and the ones the tag filter leaves of them on screen. */
    const shown = useMemo(() => filterFlowNodes(everyFlowNode, filter), [everyFlowNode, filter]);

    /** The classes the board holds, and the ones the tag filter leaves of them on screen. */
    const shownClasses = useMemo(() => filterFlowNodes(everyClass, filter), [everyClass, filter]);

    /**
     * The cards marked, as the board is **showing** them: the ids of every marked card
     * still on screen, in board order. A mark on a card the tag filter is holding back is left out of
     * it — a delete would otherwise take one without ever having shown it. Cards and classes alike.
     */
    const markedShown = useMemo(() => {
        if (marked.length === 0) return [];
        const held = new Set(marked);
        return [
            ...shown.filter(flowNode => held.has(flowNode.id)).map(flowNode => flowNode.id),
            ...shownClasses.filter(one => held.has(one.id)).map(one => one.id),
        ];
    }, [marked, shown, shownClasses]);

    const isMarked = useMemo(() => new Set(markedShown), [markedShown]);

    /** Every workflow's members, by workflow id — what a rectangle's drag carries. */
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

    /**
     * What a gesture aimed at this card is about: **every marked card** where this is one of them,
     * and this card alone where it is not. One rule for the drag, the Delete key and the menu, and
     * the one every board and file list has taught the hand already.
     *
     * Aimed at a rectangle instead, it is the rectangle's members: a pull on a workflow carries
     * its cards, filter or no filter — the rectangle is read as a whole, and a member held back
     * by the filter travels with it rather than being left behind.
     */
    const aimedAt = useCallback(
        (id: string): string[] => {
            const members = workflowMembers.get(id);
            if (members) return members;
            return isMarked.has(id) ? markedShown : [id];
        },
        [workflowMembers, isMarked, markedShown],
    );

    // The card a chain run is about to be started on, or null. A play is named before it starts —
    // several run at once, and the name is the whole of what tells them apart afterwards — so the
    // Play button opens this rather than starting anything.
    const [naming, setNaming] = useState<FlowNode | null>(null);

    /** Every class on the board, by id — what a class's chain is read out through. */
    const placedClasses = useMemo(() => {
        const map = new Map<string, FlowNodeClass>();
        everyClass.forEach(one => map.set(one.id, one));
        return map;
    }, [everyClass]);

    /**
     * A chain drawn on the board, routed to the kind it was drawn from — and refused across
     * kinds: a class chained to a card, or a card to a class, is a gesture that says nothing,
     * and nothing is what is written for it. Taking a chain off is still allowed either way,
     * which is the same nothing said twice.
     */
    const onLink = useCallback((fromId: string, toId: string | null) => {
        const fromClass = placedClasses.has(fromId);
        if (toId !== null) {
            const toClass = placedClasses.has(toId);
            if (fromClass !== toClass) return;
        }
        if (fromClass) chainFlowNodeClass(fromId, toId);
        else chainFlowNode(fromId, toId);
    }, [placedClasses, chainFlowNode, chainFlowNodeClass]);

    const link = useLinkDrag({ onLink });
    /**
     * Where a card let go on the canvas went. The same rule about marks the menu follows: a gesture
     * that carried the marked set keeps it — cards put down in the wrong place are cards somebody is
     * about to drag again — and one started on an unmarked card gives the marks up, having said
     * which card it was about.
     */
    const onSpotMove = useCallback((flowNodeIds: string[], dx: number, dy: number) => {
        if (flowNodeIds.length === 1) clearMarks();
        moveSpots(flowNodeIds, dx, dy);
    }, [clearMarks, moveSpots]);

    // The drag that moves a card across the canvas: there a card is put at a point. A marked card
    // carries the marked set, as everywhere else. At the zoom the board is read at, which the
    // gesture is measured through: the pointer travels in screen pixels and the card in canvas ones.
    const spotDrag = useSpotDrag({ onMove: onSpotMove, aimedAt, zoom });

    // The panel a click has asked for and the board is still waiting to see the gesture out on.
    const panelPending = useRef<number | null>(null);
    const holdPanel = useCallback(() => {
        if (panelPending.current === null) return;
        window.clearTimeout(panelPending.current);
        panelPending.current = null;
    }, []);
    // A board left with a click still in the air takes it away with it.
    useEffect(() => holdPanel, [holdPanel]);

    /**
     * Opening a flow node means showing its panel, in whichever bar this document keeps it. A
     * double-click asks for something else: the large editor over the central area, the room a
     * body of sub-headings and tables needs — and *only* it, the panel being the same flow node in a
     * column's width beside an editor that already has it.
     *
     * The two gestures start with the same click, so the panel is the one thing held back until
     * the gesture is known: the click that turns out to be the first of two takes its panel back
     * with it, and the card is selected either way — the editor about to open is handed the flow node
     * that first click opened.
     */
    const openFlowNode = useCallback((flowNodeId: string, large = false) => {
        // The release of the drag comes with a click, and it belongs to the gesture that has
        // just ended rather than to the card it happens to land on.
        if (spotDrag.justDragged()) return;
        select(flowNodeId);
        holdPanel();
        if (large) {
            // After `select`, which closes the large editor: this opening is one that asked for it.
            setExpanded(true);
            return;
        }
        panelPending.current = window.setTimeout(() => {
            panelPending.current = null;
            toolBars.showTab(FLOW_NODE_TAB_ID);
        }, PANEL_AFTER_CLICK_MS);
    }, [spotDrag, holdPanel, select, setExpanded, toolBars]);

    /**
     * Opening a workflow means showing the workflow panel: the rectangle's name, which is all it
     * has. Straight away, with no held-back panel — a rectangle has no double-click, so there is
     * no second gesture to wait out.
     */
    const openWorkflow = useCallback((kind: 'workflow' | 'workflowClass', workflowId: string) => {
        // The release of the drag comes with a click, and it belongs to the carry just ended
        // rather than to the rectangle let go on.
        if (spotDrag.justDragged()) return;
        holdPanel();
        selectWorkflow({ kind, id: workflowId });
        toolBars.showTab(WORKFLOW_TAB_ID);
    }, [spotDrag, holdPanel, selectWorkflow, toolBars]);

    /**
     * Takes workflows off the board. It asks first: the cards are ungrouped and stay, but the
     * rectangle is a thing somebody drew round them on purpose, and there is no undo.
     */
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

    /**
     * What a key pressed on **any** card does: **Ctrl+C** and **Ctrl+X** copy and cut it — or
     * every marked card where this is one of them — **Delete** takes it off, and **Escape** gives
     * a marked set back.
     *
     * Answers whether the key was one of them, so a face with more to say can carry on.
     */
    const onFlowNodeKeyDown = useCallback((flowNode: FlowNode, event: React.KeyboardEvent<HTMLElement>): boolean => {
        // Ctrl+C and Ctrl+X are the menu's Copy and Cut on the keys every program puts them on:
        // the marked cards where this is one of them, and this one where it is not — the same
        // rule the drag, the Delete and the menu follow.
        if (withMod(event) && !event.shiftKey && !event.altKey && !event.repeat) {
            const key = event.key.toLowerCase();
            if (key === 'c' || key === 'x') {
                // Words picked out of the card are the user's own copy: a text selection is let
                // through to the browser, which copies it as text — the nodes stay out of a gesture
                // that named words rather than cards.
                const selection = window.getSelection?.();
                if (selection && !selection.isCollapsed) return false;
                event.preventDefault();
                if (key === 'c') clipboard.copyFlowNodes(aimedAt(flowNode.id));
                else clipboard.cutFlowNodes(aimedAt(flowNode.id));
                return true;
            }
        }
        // Delete takes the marked cards, or this one where none is marked — the same rule the drag
        // and the menu follow. It asks first, either way: it is the press with nothing behind it,
        // and a board of forty cards is not a thing to lose a corner of by leaning on a key.
        if (event.key === 'Delete') {
            event.preventDefault();
            deleteFlowNodes(aimedAt(flowNode.id));
            return true;
        }
        // And the way back out of a selection made by mistake, without having to find the cards
        // again to Ctrl-click them off one at a time. Not while a drag is in the air, where Escape
        // is already the word for abandoning it: aiming badly is not a reason to pick five cards
        // out again.
        if (event.key === 'Escape' && markedShown.length > 0 && !spotDrag.dragging) {
            event.preventDefault();
            clearMarks();
            return true;
        }
        return false;
    }, [aimedAt, clearMarks, clipboard, deleteFlowNodes, spotDrag, markedShown]);

    /**
     * Takes classes off the board. It asks first: a class is the shape of work other boards
     * instantiate, and there is no undo. The nodes made from them are unlinked, keeping what
     * they say.
     */
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

    /**
     * What a key pressed on a **class** card does: **Delete** takes it off — or every marked
     * card where this is one of them — and **Escape** gives a marked set back. A class is
     * never copied, cut or pasted: it belongs to its board, and what travels is an
     * instantiation of it.
     */
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

    // The keyboard's paste: Ctrl+V with the focus on the board — a card, or nowhere at all. A
    // paste is aimed at no card, so it is not one card's key the way Copy and Cut are: after a cut
    // the card the gesture was about is gone, and the focus went with it, and the paste that
    // follows is still the board's. The cards arrive unplaced — see `pasteFlowNodes` — and the view
    // lays them out under everything already placed.
    //
    // Nowhere else answers it. A box being typed in keeps its own paste, and so does a dialog —
    // the clipboard's JSON has nothing to say to either — and a press aimed at another panel is
    // that panel's.
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

    /**
     * A click outside any card clears the selection: nothing is open and nothing is marked. Done
     * only where there is something to give up, so repeated clicks on an empty canvas cost nothing.
     * `select` already gives the marks — and the open workflow — up with the opening.
     */
    const clearSelection = useCallback(() => {
        if (selected !== null || selectedWorkflow !== null || marked.length > 0) select(null);
    }, [selected, selectedWorkflow, marked, select]);

    /**
     * The set a box found when it started, and whether it adds to it: what an adding box unions
     * its cards into — the cards the box stops covering are unpicked again, but the ones
     * picked out before the gesture stay picked — and what an abandoned box puts back.
     */
    const boxAnchor = useRef<{ additive: boolean; held: string[] } | null>(null);

    /**
     * A box has started on the empty canvas. A fresh box is a fresh selection: the opening goes
     * the way a click on the empty canvas takes it. An adding box leaves it — picking out more
     * cards must not throw away the box somebody is typing in, the way Ctrl-click leaves it.
     */
    const onBoxStart = useCallback((additive: boolean) => {
        boxAnchor.current = { additive, held: marked };
        if (!additive && (selected !== null || selectedWorkflow !== null)) select(null);
    }, [marked, selected, selectedWorkflow, select]);

    /**
     * What the box covers right now, in board order: the marked set, live, as the box moves.
     * A fresh box holds exactly those cards; an adding one holds them beside the set it found.
     */
    const onBoxChange = useCallback((flowNodeIds: string[]) => {
        const anchor = boxAnchor.current;
        if (!anchor?.additive) {
            setMarked(flowNodeIds);
            return;
        }
        const held = new Set(anchor.held);
        setMarked([...anchor.held, ...flowNodeIds.filter(id => !held.has(id))]);
    }, [setMarked]);

    /**
     * The box was abandoned — Escape, or the pointer taken away. The gesture never finished,
     * so the set goes back the way the box found it.
     */
    const onBoxCancel = useCallback(() => {
        const anchor = boxAnchor.current;
        boxAnchor.current = null;
        if (anchor) setMarked(anchor.held);
    }, [setMarked]);

    /** Every flow node on the board, by id — what a chain is read out through. */
    const placed = useMemo(() => {
        const map = new Map<string, FlowNode>();
        everyFlowNode.forEach(flowNode => map.set(flowNode.id, flowNode));
        return map;
    }, [everyFlowNode]);

    /**
     * A card's Play. Absent where the build has no Claude Code at all or the flow node's settings do not
     * name what would run it. The card a run is on gets it as a Stop instead — that is where the
     * play's Stop lives.
     *
     * AI cards and Schedulers carry Play and Stop. Shutdowns and Gateways are reached through
     * chains and show the run's state; their runs can be stopped from the chain runs panel.
     *
     * **A play elsewhere makes nothing here inert.** Several chain runs play at once, on this
     * board and on others, so every card that can take a Play carries one; what is refused, and
     * refused by the service, is a second run on the card one is already holding.
     *
     * **Only a `ready` flow node is played.** A `draft` is not finished being asked, a `running` flow node is
     * one a run is already holding, and `done`, `interrupted` and `error` are each where a play
     * left it, answer and all: playing any of them would write over what the board is there to say.
     * So none of them carries a Play, and the way to have one back is to say the flow node is ready
     * again — which the panel's status select does, and which is a thing the user decides rather
     * than a thing a press quietly undoes. The run's own card is the exception, and has to be: it
     * is showing a Stop, not a Play, and the status it wears is the one its own run wrote.
     *
     * **And there has to be something to send.** On an AI card the prompt is its title, its
     * description or its success criteria, so a card with none of them carries no Play until one of
     * them is written. The three cards the board plays to itself never run out: what they do is not
     * written in words.
     */
    const playProps = (flowNode: FlowNode): FlowNodePlayProps | null => {
        if (!agentAvailable) return null;
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

    /**
     * What a card reads out as coming after its flow node: the named flow node's title — or a
     * Gateway's branches, each by title. The transition mode is the card's own to read off the
     * flow node — it is said with no chain at all.
     */
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

    /**
     * A card's knob: the handle its chain is drawn from, and what the card shows of one being drawn
     * across the board right now. Absent where the build has no Claude Code at all, chains being an
     * order flow nodes are *played* in — a board nobody plays has no use for one.
     *
     * It is offered on every card but a **Shutdown**, agent or no agent: a flow node typed in this minute
     * is a flow node somebody is about to chain, and the settings that make it playable are picked in the
     * panel afterwards — while nothing is ever played once the machine is off. What the chain
     * carries is written by `boardOps.chainFlowNode`.
     */
    const chainProps = (flowNode: FlowNode): FlowNodeChainProps | null => {
        if (!agentAvailable || !chains(flowNode.type)) return null;
        return {
            knobProps: link.knobProps(flowNode.id),
            source: link.source === flowNode.id,
            target: link.target === flowNode.id,
        };
    };

    /**
     * A card's chat mark: the way into the conversation the flow node was played in, from the board
     * itself. Absent where there is nothing to open — a flow node never played, or one whose chat has
     * been forgotten in the panel — and absent with no Claude Code in the build, where a chat is
     * something the store holds and nothing shows.
     *
     * The flow node is *not* selected on the way: the mark answers what this card did, and a board being
     * read that way is not a board asking for the editor.
     */
    const chatProps = (flowNode: FlowNode): (() => void) | null => {
        if (!agentAvailable || !flowNode.chat) return null;
        return () => showChat(flowNode.chat);
    };

    const flowNodeMenu = (flowNode: FlowNode): FlowNodeMenuProps => ({
        // The copy is made from the card itself, wherever it sits: the board finds
        // it by id, so a filter hiding half the board moves nothing.
        onClone: () => cloneFlowNode(flowNode.id),
        onConvertType: type => {
            const onSuccess = successFor(flowNode.onSuccess, type);
            editFlowNode(flowNode.id, {
                type,
                settings: withSettings(flowNode.settings, typeChanges(flowNode.settings, type, playDefaults)),
                ...(onSuccess === flowNode.onSuccess ? {} : { onSuccess }),
            });
        },
        // The reusable shape filed from the card: its title, kind and answers become the
        // class's. A task's alone — the card shows the item only on one.
        onConvertToClass: () => convertFlowNodeToClass(flowNode.id),
        // The rectangle round the aimed set — the cards of it, where classes are picked out
        // beside them: the class menu files the classes. The card shows the item from one
        // card up, and the panel it opens is where the rectangle is named.
        onCreateWorkflow: () => {
            createWorkflow(aimedAt(flowNode.id).filter(id => placed.has(id)));
            toolBars.showTab(WORKFLOW_TAB_ID);
        },
        creating: aimedAt(flowNode.id).filter(id => placed.has(id)).length,
        // Marks or no marks, the same rule as the drag and the Delete: right-clicking one of several
        // marked cards copies them all, and the item says how many. A clipboard is written out of
        // sight, so a copy that took one card where five were picked out would be found out at the
        // other end, in another store, with nothing left on screen to explain it.
        onCopy: () => clipboard.copyFlowNodes(aimedAt(flowNode.id)),
        copying: aimedAt(flowNode.id).length,
        // The same cards as the Copy, taken off the board once the clipboard has them. It asks
        // nothing first — what a cut writes is a paste away — so the count in the item is the whole
        // of what says which cards are leaving.
        onCut: () => clipboard.cutFlowNodes(aimedAt(flowNode.id)),
        cutting: aimedAt(flowNode.id).length,
        // The same cards as the Copy, filed on the board picked from the submenu and taken off
        // this one. It asks nothing first — what a move writes is a board away, and moving back
        // is the same gesture — so the count in the item is the whole of what says which cards
        // are leaving.
        onMove: (targetHandle: string) => {
            const target = moveTargets.find(candidate => candidate.slug === targetHandle);
            if (!target) return;
            void moveFlowNodes(aimedAt(flowNode.id), target);
        },
        moving: aimedAt(flowNode.id).length,
        moveTargets,
        // The cards hidden everywhere by flipping the boolean, without deleting them.
        // Right-clicking one of several marked cards archives them all, and the item says how
        // many: a menu offering to archive "the node" on a card plainly picked out with four
        // others is a trap, the way the Delete's would be.
        onArchive: () => archiveFlowNodes(aimedAt(flowNode.id)),
        archiving: aimedAt(flowNode.id).length,
        // Through the board's own delete, which asks about the flow node's chat where it is the last card
        // naming one — the panel's Delete goes through exactly the same question. Right-clicking one
        // of several marked cards deletes them all, and the item says how many: a menu offering to
        // delete "the flow node" on a card plainly picked out with four others is a trap.
        onDelete: () => deleteFlowNodes(aimedAt(flowNode.id)),
        deleting: aimedAt(flowNode.id).length,
    });

    /**
     * A class card's own menu: filing it on another board, or taking it off — or every marked
     * class where this is one of them. Only the classes of the marked set, where cards are
     * picked out beside them: the card menu moves the cards, and this one the classes.
     */
    const flowNodeClassMenu = (flowNodeClass: FlowNodeClass): FlowNodeClassMenuProps => {
        const going = aimedAt(flowNodeClass.id).filter(id => placedClasses.has(id));
        return {
            onInstantiate: () => instantiateClass(flowNodeClass.id, spotAt(
                flowNodeClass.spot?.x ?? 0, (flowNodeClass.spot?.y ?? 0) + ROW_STEP,
            )),
            onOpen: refreshClasses,
            // The copy goes under the class the menu was opened on, marks or no marks: the
            // board files it by that class's id, the way a cloned card is filed by its own.
            onClone: () => cloneFlowNodeClass(flowNodeClass.id),
            // The rectangle round the aimed classes. The card shows the item from one class
            // up, like the card menu's.
            onCreateWorkflowClass: () => {
                createWorkflowClass(going);
                toolBars.showTab(WORKFLOW_TAB_ID);
            },
            creating: going.length,
            // The same classes as the Delete, filed on the board picked from the submenu and
            // taken off this one. It asks nothing first — what a move writes is a board away,
            // and moving back is the same gesture — so the count in the item is the whole of
            // what says which classes are leaving.
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

    /** The class after this one, read out through the board — null where none is chained. */
    const flowNodeClassNext = (flowNodeClass: FlowNodeClass): FlowNodeClassNextProps | null => {
        const next = flowNodeClass.onSuccess.flowNode
            ? placedClasses.get(flowNodeClass.onSuccess.flowNode)
            : undefined;
        return next ? { title: next.title } : null;
    };

    /** The class card's knob — chains among classes, drawn from class card to class card. */
    const flowNodeClassChain = (flowNodeClass: FlowNodeClass): FlowNodeClassChainProps | null => {
        if (!agentAvailable || !chains(flowNodeClass.type)) return null;
        return {
            knobProps: link.knobProps(flowNodeClass.id),
            source: link.source === flowNodeClass.id,
            target: link.target === flowNodeClass.id,
        };
    };

    /**
     * Breaks the link to the class version the flow node was instantiated from — or null where
     * the flow node names none. The node's words stay exactly as they are; only the link goes.
     */
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
                // The canvas has no box to type a title into, so its menu names the kind
                // of card instead and the panel is where it is written.
                onAdd={(type, spot) => {
                    addFlowNode(type, spot);
                    toolBars.showTab(FLOW_NODE_TAB_ID);
                }}
                // The same for a class: the kind is picked here, the title written in the panel.
                onAddClass={(type, spot) => {
                    addFlowNodeClass(type, spot);
                    toolBars.showTab(FLOW_NODE_TAB_ID);
                }}
                // Pasted cards open in the panel by the insert itself, as every paste does.
                onPaste={spot => clipboard.pasteFlowNodes(spot)}
                instantiateTargets={instantiateTargets}
                instantiateWorkflows={instantiateWorkflows}
                onRefreshClasses={refreshClasses}
                onInstantiate={instantiateClass}
                onInstantiateWorkflow={instantiateWorkflow}
                onOpenWorkflow={openWorkflow}
                // Made inside the rectangle: grouped in it, like every element of it.
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
                onExpand={flowNodeId => openFlowNode(flowNodeId, true)}
                onKeyDown={onFlowNodeKeyDown}
                onClassKeyDown={onClassKeyDown}
                onDeselect={clearSelection}
                onBoxStart={onBoxStart}
                onBoxChange={onBoxChange}
                onBoxCancel={onBoxCancel}
            />
            {/* The chain being drawn, from the knob it left to wherever the pointer is. Over the
                whole viewport and catching nothing: the card under the pointer is found by asking
                the document what is there, and an overlay in the way would be the answer. */}
            {link.source !== null && (
                <svg className={styles.chainLine} aria-hidden="true">
                    <line ref={link.lineRef} />
                </svg>
            )}
            {/* The name a play is started under, asked for before anything runs. */}
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
