import React, { useEffect, useMemo, useRef } from 'react';
import { Dropdown, MenuProps } from 'antd';
import {
    ClusterOutlined, DeleteOutlined, FieldTimeOutlined, GroupOutlined, PlayCircleOutlined,
    PoweroffOutlined, SnippetsOutlined, UserOutlined,
} from '@ant-design/icons';
import { KEEP_MENU_IN_VIEWPORT } from '@cms-core';
import { FlowNodeClass } from '../flowNodeClass';
import { FlowNode, Workflow, WorkflowClass } from '../boardContent';
import {
    ARROW_HEADROOM, arrowEndsBetween, CANVAS_MARGIN, canvasSize, CardBox, cardWidthOf,
    nominalHeightOf, spotsToPlace, symbolKindOf, SymbolKind,
} from '../boardSpots';
import { BOARD_ATTRIBUTE } from '../boardDom';
import { spotAt, FlowNodeSpot } from '../flowNodeSpot';
import { carriesChat } from '../flowNodeSuccess';
import { FLOW_NODE_CLASS_TYPE_ORDER, FLOW_NODE_TYPE_ORDER, FlowNodeType } from '../flowNodeType';
import { ListedClassDto, ListedWorkflowClassDto } from '../service';
import { useCardHeights } from '../useCardHeights';
import { SpotDrag } from '../useSpotDrag';
import { workflowRectOf } from '../workflowBounds';
import type { WorkflowRect as WorkflowBounds } from '../workflowBounds';
import { useBoxSelect } from '../useBoxSelect';
import {
    FlowNodeCard, FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps,
    GatewayGlyph,
} from './FlowNodeCard';
import {
    NodeClassCard, FlowNodeClassChainProps, FlowNodeClassMenuProps, FlowNodeClassNextProps,
} from './NodeClassCard';
import styles from '../Hybridflow.module.css';

/** The id the arrowhead is defined under. One canvas is on screen at a time. */
const ARROW_HEAD = 'board-arrow-head';

/**
 * What the canvas's own menu offers, in the order the type select offers the five: the two kinds of
 * work first — one an agent does and one a person does — and then the three the board plays to
 * itself.
 *
 * The last three are not called flow nodes, where the first two are. A Shutdown, a Scheduler and a
 * Gateway are not work somebody writes down and hands over: one turns the machine off, one waits
 * out an hour, one fires its branches, and *New Shutdown* is the whole of what any of them is.
 */
const NEW_LABEL: Record<FlowNodeType, string> = {
    ai: 'New AI node',
    human: 'New Human node',
    shutdown: 'New Shutdown',
    scheduler: 'New Scheduler',
    gateway: 'New Parallel gateway',
    note: 'New Note',
    value: 'New Value',
};

/**
 * What the canvas's menu offers for the classes: one item per kind a class can be, beside the five
 * kinds of card. A class made here arrives untitled, and the panel it opens is where it is named —
 * the same bargain a card made on the canvas makes. No gateway: a class is reusable words, and a
 * gateway holds none.
 */
const NEW_CLASS_LABEL: Record<Exclude<FlowNodeType, 'gateway' | 'note' | 'value'>, string> = {
    ai: 'New AI class',
    human: 'New Human class',
    shutdown: 'New Shutdown class',
    scheduler: 'New Scheduler class',
};

/**
 * And the glyph each of them wears, which is the glyph the card of that kind wears in its title
 * line — the triangle that plays an AI card, the person on a card somebody does by hand, the power
 * mark, the clock and the plus. The menu is the one place the five are seen side by side, so it
 * is the place they have to be the same five. See `TYPE_MARK` and `GatewayGlyph` in
 * [FlowNodeCard](./FlowNodeCard.tsx).
 */
const NEW_GLYPH: Record<FlowNodeType, React.ReactNode> = {
    ai: <PlayCircleOutlined />,
    human: <UserOutlined />,
    shutdown: <PoweroffOutlined />,
    scheduler: <FieldTimeOutlined />,
    gateway: <GatewayGlyph />,
    note: <SnippetsOutlined />,
    value: <SnippetsOutlined />,
};

/** One arrow, ready to draw: where it runs, and what it says. */
interface Arrow {
    id: string;
    /** The card the arrow lands on. Beside the source, because one Gateway draws several. */
    to: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** Whether the chat is carried on — `continue`, which forks it. A new chat is drawn dashed. */
    carries: boolean;
    title: string;
}

/** One rectangle the canvas draws: a workflow with the members on screen to draw round. */
interface ShownWorkflow {
    kind: 'workflow' | 'workflowClass';
    id: string;
    name: string;
    rect: WorkflowBounds;
}

interface BoardCanvasProps {
    /**
     * The cards as the tag filter leaves them: the cards drawn, and the arrows drawn between them.
     */
    shown: FlowNode[];
    /**
     * Every card of the board, filter or no filter. The **placing** is done against these: a card
     * the filter is holding back still has a place on the canvas, and one given a place among the
     * cards on screen alone would be given one already taken.
     */
    flowNodes: FlowNode[];
    /** The classes as the tag filter leaves them: the class cards drawn. */
    shownClasses: FlowNodeClass[];
    /** Every class of the board, filter or no filter: the placing is done against these too. */
    flowNodeClasses: FlowNodeClass[];
    /** Every workflow of the board: the rectangles round the sets of cards. */
    workflows: Workflow[];
    /** Every workflow class of the board: the rectangles round the sets of classes. */
    workflowClasses: WorkflowClass[];
    /** The open workflow or workflow class, drawn selected — or null where none is open. */
    selectedWorkflowId: string | null;
    /**
     * The size the board is read at — one of `BOARD_ZOOM_LEVELS`. The sheet is drawn
     * at its own size and scaled to this; everything inside stays in canvas pixels, so the cards,
     * the arrows and the drag that carries them need no other word of it, and only the gestures
     * that read the pointer — the right-click that aims a card — divide by it.
     */
    zoom: number;
    /** Writes the places of cards that have none — see `boardSpots.spotsToPlace`. */
    onPlace: (spots: Map<string, FlowNodeSpot>) => void;
    /**
     * Makes a card of a kind at a point on the canvas — what the canvas's own menu asks for. The
     * point is where the right-click landed, in the sheet's own coordinates, so the card is drawn
     * where it was asked for.
     */
    onAdd: (type: FlowNodeType, spot: FlowNodeSpot) => void;
    /**
     * Makes a class of a kind at a point on the canvas — the canvas's own menu, beside the four
     * kinds of card. The class lands under the pointer that asked for it.
     */
    onAddClass: (type: FlowNodeType, spot: FlowNodeSpot) => void;
    /**
     * Pastes the clipboard's flow nodes at a point on the canvas — the same menu, the same gesture, for
     * the block the clipboard is holding rather than for a card of a kind.
     */
    onPaste: (spot: FlowNodeSpot) => void;
    /**
     * Every class of every board, as the Instantiate submenu lists the ticked ones — the
     * unticked ones stay out of the menu but are still followed as successors.
     */
    instantiateTargets: ListedClassDto[];
    /** Every workflow class of every board, as the Instantiate submenu lists them. */
    instantiateWorkflows: ListedWorkflowClassDto[];
    /** Refreshes the global class catalogues when a context menu opens. */
    onRefreshClasses: () => void;
    /**
     * Makes flow nodes from a class and all its successors at a point on the canvas — the
     * Instantiate submenu, for the class picked from it.
     */
    onInstantiate: (classId: string, spot: FlowNodeSpot) => void;
    /**
     * Makes a workflow from a workflow class at a point on the canvas — the Instantiate
     * submenu, for the rectangle picked from it.
     */
    onInstantiateWorkflow: (workflowClassId: string, spot: FlowNodeSpot) => void;
    /** Opens a workflow — a click on a rectangle outside any card. */
    onOpenWorkflow: (kind: 'workflow' | 'workflowClass', id: string) => void;
    /**
     * Makes a card inside a workflow — the rectangle's own menu, at the point that was
     * right-clicked. The card is grouped in the rectangle it is made in, like every element of
     * it; a rectangle of nodes takes no classes and a rectangle of classes takes no nodes, so
     * the menu only ever asks for the kind its rectangle holds.
     */
    onAddInWorkflow: (
        kind: 'workflow' | 'workflowClass', id: string, type: FlowNodeType, spot: FlowNodeSpot,
    ) => void;
    /** Pastes the clipboard inside a workflow — grouped in it, like a card made there. */
    onPasteInWorkflow: (id: string, spot: FlowNodeSpot) => void;
    /** Instantiates a class inside a workflow — the nodes it makes are grouped in it. */
    onInstantiateInWorkflow: (workflowId: string, classId: string, spot: FlowNodeSpot) => void;
    /**
     * Takes a workflow off the board — the rectangle's own menu. Its cards are ungrouped and
     * left where they are; the ask is the menu's to make, the confirm the caller's.
     */
    onDeleteWorkflow: (kind: 'workflow' | 'workflowClass', id: string) => void;
    selectedFlowNodeId: string | null;
    markedFlowNodeIds: Set<string>;
    /** The drag that moves a card across the canvas. The card itself is the handle. */
    drag: SpotDrag;
    flowNodePlay: (flowNode: FlowNode) => FlowNodePlayProps | null;
    flowNodeNext: (flowNode: FlowNode) => FlowNodeNextProps | null;
    flowNodeChain: (flowNode: FlowNode) => FlowNodeChainProps | null;
    flowNodeChat: (flowNode: FlowNode) => (() => void) | null;
    /** Breaks the link to the class version the node names — or null where it names none. */
    flowNodeUnlink: (flowNode: FlowNode) => (() => void) | null;
    flowNodeMenu: (flowNode: FlowNode) => FlowNodeMenuProps;
    flowNodeClassNext: (flowNodeClass: FlowNodeClass) => FlowNodeClassNextProps | null;
    flowNodeClassChain: (flowNodeClass: FlowNodeClass) => FlowNodeClassChainProps | null;
    flowNodeClassMenu: (flowNodeClass: FlowNodeClass) => FlowNodeClassMenuProps;
    onOpen: (flowNodeId: string) => void;
    onMark: (flowNodeId: string) => void;
    onExpand: (flowNodeId: string) => void;
    onKeyDown: (flowNode: FlowNode, event: React.KeyboardEvent<HTMLElement>) => void;
    onClassKeyDown: (flowNodeClass: FlowNodeClass, event: React.KeyboardEvent<HTMLElement>) => void;
    /** Clears the selection — what a click outside any card asks for. */
    onDeselect: () => void;
    /** A box has started on the empty canvas: whether it adds to the set it found. */
    onBoxStart: (additive: boolean) => void;
    /** The cards the box covers right now — called live, as the box moves. */
    onBoxChange: (flowNodeIds: string[]) => void;
    /** The box was abandoned: the set goes back the way the gesture found it. */
    onBoxCancel: () => void;
}

/**
 * The board: every card where somebody put it, and an arrow from each card to the one it hands on to.
 *
 * The canvas answers *what runs after what*, which is the one thing a chain of six flow nodes is
 * entirely about: a chain laid out on a canvas is a line, and the whole order of a board is read
 * without opening anything.
 *
 * **Every card drawn has a place, and gets one the first time it is drawn.** A board that has never
 * been laid out says no place on any of its cards; the opening layout follows the chains — a
 * row per chain, left to right along it — and is written down at once, so that from then
 * on nothing moves unless somebody moves it. See [boardSpots.ts](../boardSpots.ts).
 *
 * **The arrows share one layer**, above the workflow backgrounds and under the cards: within one
 * workflow, across workflows, grouped or not, every arrow is drawn there, so no rectangle clips
 * one. They run edge to edge between the two cards they join, and their heads touch the card they
 * point at whichever side of it that turns out to be — or the circle or diamond a symbol is, shape
 * to shape over the labels under them. Solid where the chat is handed on to the next flow node and
 * dashed where it is not: the line says the work carries on, the dashes say the next flow node
 * starts fresh. Each stroke takes the pointer while the empty sheet passes it through to the
 * rectangle or the board underneath, so a hovered arrow reads its title.
 *
 * **The canvas itself carries a menu**, on a right-click anywhere no card is: the four kinds of
 * card, made where the pointer is, and the paste of whatever flow nodes the clipboard holds. A canvas
 * has nowhere to put a box to type a title into — so the gesture that makes a card here is the
 * gesture that makes a file in a file manager, and the card lands under the pointer that asked for
 * it. It names the **kind** rather than taking a title, because the kind is the one thing a card
 * cannot be given afterwards without retyping what it was made as: the title is typed in the panel
 * it opens.
 */
export const BoardCanvas: React.FC<BoardCanvasProps> = ({
    shown, flowNodes, shownClasses, flowNodeClasses, workflows, workflowClasses, selectedWorkflowId,
    zoom, onPlace, onAdd, onAddClass, onPaste,
    instantiateTargets, instantiateWorkflows, onRefreshClasses, onInstantiate, onInstantiateWorkflow,
    onOpenWorkflow, onAddInWorkflow, onPasteInWorkflow,
    onInstantiateInWorkflow, onDeleteWorkflow,
    selectedFlowNodeId, markedFlowNodeIds, drag, flowNodePlay, flowNodeNext,
    flowNodeChain, flowNodeChat, flowNodeUnlink, flowNodeMenu,
    flowNodeClassNext, flowNodeClassChain, flowNodeClassMenu,
    onOpen, onMark, onExpand, onKeyDown, onClassKeyDown, onDeselect,
    onBoxStart, onBoxChange, onBoxCancel,
}) => {
    const canvas = useRef<HTMLDivElement>(null);

    // Against the whole board, not against what the filter leaves: a card held back is still a card
    // with a place, and giving one to the cards on screen alone would hand out places already taken.
    // Cards and classes together: the two kinds share the canvas, so an unplaced class starts a row
    // under everything rather than on top of somebody's arrangement.
    const toPlace = useMemo(
        () => spotsToPlace([...flowNodes, ...flowNodeClasses]), [flowNodes, flowNodeClasses]);
    // One write, and then none: what has been placed says so, so the next reading finds nothing to
    // do. A card made tomorrow is placed the same way, on a row of its own.
    useEffect(() => { if (toPlace.size > 0) onPlace(toPlace); }, [toPlace, onPlace]);

    /** The cards on screen, each with the point it is drawn at. */
    const cards = useMemo(() => shown.map(flowNode => ({
        flowNode,
        spot: flowNode.spot ?? toPlace.get(flowNode.id) ?? { x: 0, y: 0 },
    })), [shown, toPlace]);

    /** The class cards on screen, each with the point it is drawn at. */
    const classCards = useMemo(() => shownClasses.map(flowNodeClass => ({
        flowNodeClass,
        spot: flowNodeClass.spot ?? toPlace.get(flowNodeClass.id) ?? { x: 0, y: 0 },
    })), [shownClasses, toPlace]);

    const ids = useMemo(() => [
        ...cards.map(card => card.flowNode.id),
        ...classCards.map(card => card.flowNodeClass.id),
    ], [cards, classCards]);
    const heights = useCardHeights(canvas, ids);

    /**
     * Where every card is on the sheet, as it is being drawn *now* — the place the document gives
     * it, the margin every card is drawn inside, and whatever a drag in flight is carrying it by.
     * The arrows are computed from this, which is what makes them follow a card across the canvas
     * instead of catching up when it is let go. A symbol is narrower than a card — a shape with a
     * label under it — so the width is the type's own.
     */
    const boxes = useMemo(() => {
        const held = new Map<string, CardBox>();
        const boxOf = (id: string, spot: FlowNodeSpot, type: FlowNodeType) => {
            const offset = drag.offsetOf(id);
            held.set(id, {
                x: spot.x + CANVAS_MARGIN + (offset?.x ?? 0),
                y: spot.y + CANVAS_MARGIN + (offset?.y ?? 0),
                w: cardWidthOf(type),
                h: heights.get(id) ?? nominalHeightOf(type),
            });
        };
        cards.forEach(({ flowNode, spot }) => boxOf(flowNode.id, spot, flowNode.type));
        classCards.forEach(({ flowNodeClass, spot }) => boxOf(flowNodeClass.id, spot, flowNodeClass.type));
        return held;
    }, [cards, classCards, drag, heights]);

    // The rectangles, from the boxes on screen: each groups the shown members of one workflow —
    // a group held back by the filter draws round what is left, and a group with nothing on
    // screen draws nothing. The boxes carry the drag's offsets, so a member pulled out redraws
    // its rectangle live, and a rectangle pulled carries the members it is drawn round.
    const shownWorkflows = useMemo((): ShownWorkflow[] => {
        const names = new Map<string, string>();
        for (const workflow of workflows ?? []) names.set(`workflow:${workflow.id}`, workflow.name);
        for (const workflow of workflowClasses ?? []) {
            names.set(`workflowClass:${workflow.id}`, workflow.name);
        }
        const owner = new Map<string, { kind: 'workflow' | 'workflowClass'; id: string }>();
        for (const flowNode of shown) {
            if (flowNode.workflow) owner.set(flowNode.id, { kind: 'workflow', id: flowNode.workflow });
        }
        for (const flowNodeClass of shownClasses) {
            if (flowNodeClass.workflowClass) {
                owner.set(flowNodeClass.id, { kind: 'workflowClass', id: flowNodeClass.workflowClass });
            }
        }
        const members = new Map<string, CardBox[]>();
        for (const [id, box] of boxes) {
            const own = owner.get(id);
            if (!own) continue;
            const key = `${own.kind}:${own.id}`;
            members.set(key, [...(members.get(key) ?? []), box]);
        }
        const out: ShownWorkflow[] = [];
        for (const [key, rectangles] of members) {
            // A rectangle whose row is gone — deleted elsewhere a frame ago — draws nothing:
            // its cards read as ungrouped on the next read.
            if (!names.has(key)) continue;
            const rect = workflowRectOf(rectangles);
            if (!rect) continue;
            const cut = key.indexOf(':');
            out.push({
                kind: key.slice(0, cut) as 'workflow' | 'workflowClass',
                id: key.slice(cut + 1),
                name: names.get(key) ?? '', rect,
            });
        }
        return out;
    }, [shown, shownClasses, boxes, workflows, workflowClasses]);

    const arrows = useMemo((): Arrow[] => {
        const titles = new Map([
            ...cards.map(card => [card.flowNode.id, card.flowNode.title || 'Untitled'] as const),
            ...classCards.map(card => [card.flowNodeClass.id, card.flowNodeClass.title || 'Untitled'] as const),
        ]);
        // What shape each node on screen is drawn as: a chain joining two symbols runs shape to
        // shape, over the labels under them.
        const kinds = new Map<string, SymbolKind>([
            ...cards.map(card => [card.flowNode.id, symbolKindOf(card.flowNode.type)] as const),
            ...classCards.map(card => [card.flowNodeClass.id, symbolKindOf(card.flowNodeClass.type)] as const),
        ]);
        const arrowOf = (id: string, next: string, carries: boolean): Arrow[] => {
            const from = boxes.get(id);
            const to = next ? boxes.get(next) : undefined;
            // A chain naming a card the filter is holding back, or one that has left the board, is
            // a chain with one end: there is nothing on screen to draw it to.
            if (!from || !to) return [];
            const ends = arrowEndsBetween(
                from, kinds.get(id) ?? 'rect', to, kinds.get(next) ?? 'rect', ARROW_HEADROOM,
            );
            if (!ends) return [];
            return [{
                id,
                to: next,
                ...ends,
                carries,
                title: `“${titles.get(id)}” hands on to “${titles.get(next)}”`,
            }];
        };
        return [
            ...cards.flatMap(({ flowNode }) => [
                flowNode.onSuccess.flowNode,
                // A Gateway's branches, each with an arrow of its own: the run starts them all
                // when it fires, and the board draws every one.
                ...flowNode.onSuccess.flowNodes,
            ].flatMap(next => arrowOf(flowNode.id, next, carriesChat(flowNode.onSuccess)))),
            ...classCards.flatMap(({ flowNodeClass }) => arrowOf(
                flowNodeClass.id, flowNodeClass.onSuccess.flowNode,
                carriesChat(flowNodeClass.onSuccess))),
        ];
    }, [cards, classCards, boxes]);

    // The rectangles included, which stand a padding proud of their members on every side.
    const size = useMemo(
        () => canvasSize([...boxes.values(), ...shownWorkflows.map(entry => entry.rect)]),
        [boxes, shownWorkflows]);

    /**
     * Where the card the menu is about to make goes: the point the canvas was right-clicked at, in
     * the sheet's own coordinates — the scroll taken into account, so a card made after panning
     * lands under the pointer rather than at the same place on a sheet that has moved, the zoom
     * divided out, the pointer travelling in screen pixels and the sheet being drawn in canvas
     * ones, and the margin taken off, that being the difference between a spot and where it is
     * drawn.
     *
     * The menu item's click reads this ref. A card's own menu stops the event before it gets here.
     */
    const aim = useRef<FlowNodeSpot>({ x: 0, y: 0 });
    const aimAt = (event: React.MouseEvent) => {
        const box = canvas.current;
        if (!box) return;
        const edge = box.getBoundingClientRect();
        aim.current = spotAt(
            (event.clientX - edge.left + box.scrollLeft) / zoom - CANVAS_MARGIN,
            (event.clientY - edge.top + box.scrollTop) / zoom - CANVAS_MARGIN,
        );
        onRefreshClasses();
    };

    // The box pulled on the empty canvas to pick cards out, read against the boxes above —
    // cards and classes alike, at the zoom the board is read at. What it covers is reported
    // live, as it moves.
    const box = useBoxSelect({ boxes, zoom, onStart: onBoxStart, onChange: onBoxChange, onCancel: onBoxCancel });

    /**
     * A click outside any card clears the selection. A click on a card bubbles here too, so one
     * starting inside a card is left to the card — and the release of a drag carries a click that
     * belongs to the gesture just ended rather than to the canvas under it, the box's own
     * release being one of those gestures. A click inside a rectangle but outside any card opens
     * the rectangle instead: the workflow's own edit, in the workflow's own panel.
     */
    const clearOnEmptyClick = (event: React.MouseEvent) => {
        if (drag.justDragged() || box.justSelected()) return;
        const at = event.target as Element | null;
        if (at?.closest?.('[data-flow-node-id],[data-flow-node]')) return;
        const rect = at?.closest?.('[data-workflow-id]');
        if (rect) {
            const kind = rect.getAttribute('data-workflow-kind') === 'workflowClass'
                ? 'workflowClass' as const : 'workflow' as const;
            onOpenWorkflow(kind, rect.getAttribute('data-workflow-id') ?? '');
            return;
        }
        onDeselect();
    };

    // The right-click on a rectangle: aimed here — the canvas's own aim never runs, because the
    // bubble is stopped so the canvas's menu does not open under the rectangle's.
    const aimOnWorkflow = (event: React.MouseEvent<HTMLElement>) => {
        aimAt(event);
        event.stopPropagation();
    };

    // The classes the Instantiate submenu lists: the ticked ones alone — the unticked ones
    // stay out of the menu but are still followed as successors when one of these is picked.
    // The workflow classes beside them need no tick: every rectangle is offered.
    const instantiableTargets = useMemo(
        () => instantiateTargets.filter(target => target.instantiable),
        [instantiateTargets]);

    /**
     * The canvas's own menu: one item per kind of card, made where the pointer is — one item per
     * kind of class beside them, the classes and workflow classes of all boards to instantiate,
     * and the paste of whatever flow nodes the clipboard holds, laid out from that same point.
     */
    const items: MenuProps['items'] = [
        ...FLOW_NODE_TYPE_ORDER.map(type => ({
            key: `new-${type}`,
            icon: NEW_GLYPH[type],
            label: <span data-testid="new-card" data-type={type}>{NEW_LABEL[type]}</span>,
            onClick: () => onAdd(type, aim.current),
        })),
        { type: 'divider' },
        ...FLOW_NODE_CLASS_TYPE_ORDER.map(type => ({
            key: `new-class-${type}`,
            icon: <ClusterOutlined />,
            label: <span data-testid="new-class" data-type={type}>{NEW_CLASS_LABEL[type]}</span>,
            onClick: () => onAddClass(type, aim.current),
        })),
        // After the classes, which is what it is made from: the class picked here — and all its
        // successors — is instantiated into nodes at the point right-clicked, and the workflow
        // class picked here into a workflow of nodes. Named with their board, because the menu
        // lists the classes of all boards — a rectangle wearing the group's glyph and a node
        // class the class's, so the two are told apart at a glance.
        {
            key: 'instantiate-class',
            icon: <ClusterOutlined />,
            label: 'Instantiate class...',
            children: (instantiateWorkflows.length > 0 || instantiableTargets.length > 0)
                ? [
                    ...instantiateWorkflows.map(target => ({
                        key: `instantiate-workflow-${target.id}`,
                        icon: <GroupOutlined />,
                        label: (
                            <span data-testid={`instantiate-workflow-${target.id}`}>
                                {target.name || 'Untitled'} ({target.boardName || target.boardSlug})
                            </span>
                        ),
                        onClick: () => onInstantiateWorkflow(target.id, aim.current),
                    })),
                    ...instantiableTargets.map(target => ({
                        key: `instantiate-${target.id}`,
                        icon: <ClusterOutlined />,
                        label: (
                            <span data-testid={`instantiate-${target.id}`}>
                                {target.title || 'Untitled'} ({target.boardName || target.boardSlug})
                            </span>
                        ),
                        onClick: () => onInstantiate(target.id, aim.current),
                    })),
                ]
                : [{ key: 'instantiate-none', label: 'Nothing instantiable anywhere yet', disabled: true }],
        },
        { type: 'divider' },
        {
            key: 'paste-flow-node',
            icon: <SnippetsOutlined />,
            label: <span data-testid="paste-flow-node">Paste node here</span>,
            onClick: () => onPaste(aim.current),
        },
    ];

    /**
     * A rectangle's own menu: the canvas's menu, made inside the rectangle — every element it
     * makes is grouped in it. A rectangle of nodes takes no classes and a rectangle of classes
     * takes no nodes, so each is offered the half of the menu its rectangle holds; the paste
     * and the instantiate make nodes, so they stand on the nodes' half alone — and a workflow
     * class makes a rectangle of its own, so it is offered on the canvas alone.
     */
    const workflowItems = (entry: ShownWorkflow): MenuProps['items'] => {
        const classes = entry.kind === 'workflowClass';
        const making = classes
            ? FLOW_NODE_CLASS_TYPE_ORDER.map(type => ({
                key: `new-class-${type}`,
                icon: <ClusterOutlined />,
                label: <span data-testid="new-class-in-workflow" data-type={type}>{NEW_CLASS_LABEL[type]}</span>,
                onClick: () => onAddInWorkflow(entry.kind, entry.id, type, aim.current),
            }))
            : FLOW_NODE_TYPE_ORDER.map(type => ({
                key: `new-${type}`,
                icon: NEW_GLYPH[type],
                label: <span data-testid="new-card-in-workflow" data-type={type}>{NEW_LABEL[type]}</span>,
                onClick: () => onAddInWorkflow(entry.kind, entry.id, type, aim.current),
            }));
        return [
            ...making,
            ...(!classes ? [{
                key: 'instantiate-class',
                icon: <ClusterOutlined />,
                label: 'Instantiate class...',
                children: instantiableTargets.length > 0
                    ? instantiableTargets.map(target => ({
                        key: `instantiate-${target.id}`,
                        icon: <ClusterOutlined />,
                        label: (
                            <span data-testid={`instantiate-in-workflow-${target.id}`}>
                                {target.title || 'Untitled'} ({target.boardName || target.boardSlug})
                            </span>
                        ),
                        onClick: () => onInstantiateInWorkflow(entry.id, target.id, aim.current),
                    }))
                    : [{ key: 'instantiate-none', label: 'Nothing instantiable anywhere yet', disabled: true }],
            }] : []),
            ...(!classes ? [{
                key: 'paste-flow-node',
                icon: <SnippetsOutlined />,
                label: <span data-testid="paste-node-in-workflow">Paste node here</span>,
                onClick: () => onPasteInWorkflow(entry.id, aim.current),
            }] : []),
            { type: 'divider' },
            {
                key: 'delete-workflow',
                icon: <DeleteOutlined />,
                danger: true,
                label: classes ? 'Delete workflow class' : 'Delete workflow',
                onClick: () => onDeleteWorkflow(entry.kind, entry.id),
            },
        ];
    };

    // An empty canvas is the one place the menu has to say it is there: there is no card to
    // right-click, no quick box, and nothing on screen that could be mistaken for either.
    if (cards.length === 0 && classCards.length === 0) {
        return (
            <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                <div
                    className={styles.board}
                    ref={canvas}
                    data-testid="content-canvas"
                    onContextMenu={aimAt}
                    onClick={clearOnEmptyClick}
                >
                    <div className={styles.boardEmpty}>
                        No card to lay out — right-click to make one.
                    </div>
                </div>
            </Dropdown>
        );
    }

    return (
        // The canvas's menu and a card's are two menus on nested elements, and a right-click is one
        // gesture: the card answers it — and stops it — and the canvas answers everywhere else.
        <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
            <div
                className={styles.board}
                ref={canvas}
                data-testid="content-canvas"
                onContextMenu={aimAt}
                onClick={clearOnEmptyClick}
                // The box that picks cards out, pulled on the empty canvas — a press on a card
                // is the card's own, and the hook leaves those alone.
                {...box.boxProps}
                // What the drag that carries a card across it finds by walking up from the card —
                // see [boardDom.ts](../boardDom.ts).
                {...{ [BOARD_ATTRIBUTE]: '' }}
            >
                <div
                    className={styles.boardSheet}
                    style={{ width: size.width * zoom, height: size.height * zoom }}
                    data-testid="content-sheet"
                >
                    <div
                        className={styles.boardScaled}
                        style={{ transform: `scale(${zoom})`, width: size.width, height: size.height }}
                        data-testid="content-scaled"
                    >
                        {/* The rectangles, the back layer: each fits its members with a small padding,
                            the way an archdia container does, and its label names it. A press on one is
                            the rectangle's own — the drag that carries its members, the click that opens
                            it — and a press on a card inside one belongs to the card. */}
                        {shownWorkflows.map(entry => (
                            <Dropdown
                                key={entry.id}
                                menu={{ items: workflowItems(entry) }}
                                trigger={['contextMenu']}
                                {...KEEP_MENU_IN_VIEWPORT}
                            >
                                <WorkflowRect
                                    entry={entry}
                                    selected={selectedWorkflowId === entry.id}
                                    dragProps={drag.dragProps(entry.id)}
                                    onContextMenu={aimOnWorkflow}
                                />
                            </Dropdown>
                        ))}
                        {/* The one relation layer of the board, above the rectangles and below the
                            cards: within one workflow, across workflows, grouped or not, every arrow
                            is drawn here, so no rectangle clips one. The sheet takes no pointer itself
                            and each stroke takes its own, so the empty surface answers the rectangle or
                            the board underneath while a hovered arrow still reads its title. */}
                        <svg
                            className={styles.boardLinks}
                            width={size.width}
                            height={size.height}
                            aria-hidden="true"
                            data-testid="content-links"
                        >
                            <defs>
                                <marker
                                    id={ARROW_HEAD}
                                    viewBox="0 0 10 10"
                                    refX="9"
                                    refY="5"
                                    markerUnits="userSpaceOnUse"
                                    markerWidth="11"
                                    markerHeight="11"
                                    orient="auto"
                                >
                                    <path d="M 0 0 L 10 5 L 0 10 z" />
                                </marker>
                            </defs>
                            {arrows.map(arrow => (
                                <line
                                    key={`${arrow.id} ${arrow.to}`}
                                    className={arrow.carries ? styles.boardLink : styles.boardLinkEnds}
                                    x1={arrow.x1}
                                    y1={arrow.y1}
                                    x2={arrow.x2}
                                    y2={arrow.y2}
                                    markerEnd={`url(#${ARROW_HEAD})`}
                                    data-testid="content-link"
                                    data-from={arrow.id}
                                    data-to={arrow.to}
                                >
                                    <title>{arrow.title}</title>
                                </line>
                            ))}
                        </svg>
                        {cards.map(({ flowNode, spot }) => {
                            const offset = drag.offsetOf(flowNode.id);
                            return (
                                <div
                                    key={flowNode.id}
                                    className={[
                                        styles.boardCard,
                                        offset ? styles.boardCardMoving : '',
                                    ].filter(Boolean).join(' ')}
                                    style={{
                                        left: spot.x + CANVAS_MARGIN,
                                        top: spot.y + CANVAS_MARGIN,
                                        width: cardWidthOf(flowNode.type),
                                        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
                                    }}
                                    data-testid="content-card"
                                    data-flow-node={flowNode.id}
                                >
                                    <FlowNodeCard
                                        flowNode={flowNode}
                                        next={flowNodeNext(flowNode)}
                                        chain={flowNodeChain(flowNode)}
                                        selected={selectedFlowNodeId === flowNode.id || markedFlowNodeIds.has(flowNode.id)}
                                        play={flowNodePlay(flowNode)}
                                        menu={flowNodeMenu(flowNode)}
                                        onOpenChat={flowNodeChat(flowNode)}
                                        onUnlinkClass={flowNodeUnlink(flowNode)}
                                        onOpen={() => onOpen(flowNode.id)}
                                        onMark={() => onMark(flowNode.id)}
                                        onExpand={() => onExpand(flowNode.id)}
                                        onKeyDown={event => onKeyDown(flowNode, event)}
                                        cardClass={undefined}
                                        dragProps={drag.dragProps(flowNode.id)}
                                    />
                                </div>
                            );
                        })}
                        {classCards.map(({ flowNodeClass, spot }) => {
                            const offset = drag.offsetOf(flowNodeClass.id);
                            return (
                                <div
                                    key={flowNodeClass.id}
                                    className={[
                                        styles.boardCard,
                                        offset ? styles.boardCardMoving : '',
                                    ].filter(Boolean).join(' ')}
                                    style={{
                                        left: spot.x + CANVAS_MARGIN,
                                        top: spot.y + CANVAS_MARGIN,
                                        width: cardWidthOf(flowNodeClass.type),
                                        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
                                    }}
                                    data-testid="content-class-card"
                                    data-flow-node={flowNodeClass.id}
                                >
                                    <NodeClassCard
                                        flowNodeClass={flowNodeClass}
                                        next={flowNodeClassNext(flowNodeClass)}
                                        chain={flowNodeClassChain(flowNodeClass)}
                                        selected={selectedFlowNodeId === flowNodeClass.id
                                            || markedFlowNodeIds.has(flowNodeClass.id)}
                                        menu={flowNodeClassMenu(flowNodeClass)}
                                        onOpen={() => onOpen(flowNodeClass.id)}
                                        onMark={() => onMark(flowNodeClass.id)}
                                        onKeyDown={event => onClassKeyDown(flowNodeClass, event)}
                                        cardClass={undefined}
                                        dragProps={drag.dragProps(flowNodeClass.id)}
                                    />
                                </div>
                            );
                        })}
                        {/* The box being pulled to pick cards out, in the sheet's own coordinates —
                            over the cards and catching nothing, so what is under the pointer stays
                            the canvas under it. */}
                        {box.rect && (
                            <div
                                className={styles.boxSelect}
                                style={{
                                    left: box.rect.x,
                                    top: box.rect.y,
                                    width: box.rect.w,
                                    height: box.rect.h,
                                }}
                                data-testid="box-select-rect"
                                aria-hidden="true"
                            />
                        )}
                    </div>
                </div>
            </div>
        </Dropdown>
    );
};

type RectangleDragProps = ReturnType<SpotDrag['dragProps']>;

/**
 * One workflow's rectangle: the bounds its members are drawn in, with the label naming it.
 * The whole of it is the way in — the press that carries its members, the click that opens
 * it — except where a card stands on it, which answers its own presses the way it always
 * has. What the drag carries for a rectangle is the rectangle's members, named by the board
 * that aimed them.
 */
const WorkflowRect: React.FC<{
    entry: ShownWorkflow;
    selected: boolean;
    dragProps: RectangleDragProps;
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}> = ({ entry, selected, dragProps, onContextMenu }) => {
    const { onPointerDown, ...carried } = dragProps;
    return (
        <div
            className={[
                styles.workflowRect,
                entry.kind === 'workflowClass' ? styles.workflowRectClass : '',
                selected ? styles.workflowRectSelected : '',
            ].filter(Boolean).join(' ')}
            style={{
                left: entry.rect.x,
                top: entry.rect.y,
                width: entry.rect.w,
                height: entry.rect.h,
            }}
            data-testid="content-workflow"
            data-workflow-id={entry.id}
            data-workflow-kind={entry.kind}
            onContextMenu={onContextMenu}
            onPointerDown={event => {
                // A card inside the rectangle answers its own presses — the drag that carries
                // it, the menu that opens on it — and the rectangle answers everywhere else.
                if ((event.target as Element | null)?.closest?.('[data-flow-node-id]')) return;
                onPointerDown(event);
            }}
            {...carried}
        >
            <div className={styles.workflowLabel} data-testid="content-workflow-label">
                {entry.name || 'Untitled'}
            </div>
        </div>
    );
};
