import React, { useEffect, useMemo, useRef } from 'react';
import { Dropdown, MenuProps } from 'antd';
import {
    ClusterOutlined, DeleteOutlined, FieldTimeOutlined, GroupOutlined, PlayCircleOutlined,
    PoweroffOutlined, SnippetsOutlined, UserOutlined,
} from '@ant-design/icons';
import { KEEP_MENU_IN_VIEWPORT } from '@kiao-dashboard-core';
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
    FlowNodeCard, FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps, FlowNodeWorkProps,
    GatewayGlyph,
} from './FlowNodeCard';
import {
    NodeClassCard, FlowNodeClassChainProps, FlowNodeClassMenuProps, FlowNodeClassNextProps,
} from './NodeClassCard';
import styles from '../Hybridflow.module.css';

/** The id the arrowhead is defined under. */
const ARROW_HEAD = 'board-arrow-head';

/** What the canvas's own menu offers, in the order the type select offers the five: the two kinds of. */
const NEW_LABEL: Record<FlowNodeType, string> = {
    ai: 'New AI node',
    human: 'New Human node',
    shutdown: 'New Shutdown',
    scheduler: 'New Scheduler',
    gateway: 'New Parallel gateway',
    note: 'New Note',
    value: 'New Value',
};

/** What the canvas's menu offers for the classes: one item per kind a class can be, beside the five. */
const NEW_CLASS_LABEL: Record<Exclude<FlowNodeType, 'gateway' | 'note' | 'value'>, string> = {
    ai: 'New AI class',
    human: 'New Human class',
    shutdown: 'New Shutdown class',
    scheduler: 'New Scheduler class',
};

/** And the glyph each of them wears, which is the glyph the card of that kind wears in its title line. */
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

    to: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;

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

    shown: FlowNode[];

    flowNodes: FlowNode[];

    shownClasses: FlowNodeClass[];

    flowNodeClasses: FlowNodeClass[];

    workflows: Workflow[];

    workflowClasses: WorkflowClass[];

    selectedWorkflowId: string | null;

    zoom: number;

    onPlace: (spots: Map<string, FlowNodeSpot>) => void;

    onAdd: (type: FlowNodeType, spot: FlowNodeSpot) => void;

    onAddClass: (type: FlowNodeType, spot: FlowNodeSpot) => void;

    onPaste: (spot: FlowNodeSpot) => void;

    instantiateTargets: ListedClassDto[];

    instantiateWorkflows: ListedWorkflowClassDto[];

    onRefreshClasses: () => void;

    onInstantiate: (classId: string, spot: FlowNodeSpot) => void;

    onInstantiateWorkflow: (workflowClassId: string, spot: FlowNodeSpot) => void;

    onOpenWorkflow: (kind: 'workflow' | 'workflowClass', id: string) => void;

    onAddInWorkflow: (
        kind: 'workflow' | 'workflowClass', id: string, type: FlowNodeType, spot: FlowNodeSpot,
    ) => void;

    onPasteInWorkflow: (id: string, spot: FlowNodeSpot) => void;

    onInstantiateInWorkflow: (workflowId: string, classId: string, spot: FlowNodeSpot) => void;

    onDeleteWorkflow: (kind: 'workflow' | 'workflowClass', id: string) => void;
    selectedFlowNodeId: string | null;
    markedFlowNodeIds: Set<string>;

    drag: SpotDrag;
    flowNodePlay: (flowNode: FlowNode) => FlowNodePlayProps | null;
    flowNodeWork: (flowNode: FlowNode) => FlowNodeWorkProps | null;
    flowNodeNext: (flowNode: FlowNode) => FlowNodeNextProps | null;
    flowNodeChain: (flowNode: FlowNode) => FlowNodeChainProps | null;
    flowNodeChat: (flowNode: FlowNode) => (() => void) | null;

    flowNodeUnlink: (flowNode: FlowNode) => (() => void) | null;
    flowNodeMenu: (flowNode: FlowNode) => FlowNodeMenuProps;
    flowNodeClassNext: (flowNodeClass: FlowNodeClass) => FlowNodeClassNextProps | null;
    flowNodeClassChain: (flowNodeClass: FlowNodeClass) => FlowNodeClassChainProps | null;
    flowNodeClassMenu: (flowNodeClass: FlowNodeClass) => FlowNodeClassMenuProps;
    onOpen: (flowNodeId: string) => void;
    onMark: (flowNodeId: string) => void;
    onKeyDown: (flowNode: FlowNode, event: React.KeyboardEvent<HTMLElement>) => void;
    onClassKeyDown: (flowNodeClass: FlowNodeClass, event: React.KeyboardEvent<HTMLElement>) => void;

    onDeselect: () => void;

    onBoxStart: (additive: boolean) => void;

    onBoxChange: (flowNodeIds: string[]) => void;

    onBoxCancel: () => void;
}

/** The board: every card where somebody put it, and an arrow from each card to the one it hands on to. */
export const BoardCanvas: React.FC<BoardCanvasProps> = ({
    shown, flowNodes, shownClasses, flowNodeClasses, workflows, workflowClasses, selectedWorkflowId,
    zoom, onPlace, onAdd, onAddClass, onPaste,
    instantiateTargets, instantiateWorkflows, onRefreshClasses, onInstantiate, onInstantiateWorkflow,
    onOpenWorkflow, onAddInWorkflow, onPasteInWorkflow,
    onInstantiateInWorkflow, onDeleteWorkflow,
    selectedFlowNodeId, markedFlowNodeIds, drag, flowNodePlay, flowNodeWork, flowNodeNext,
    flowNodeChain, flowNodeChat, flowNodeUnlink, flowNodeMenu,
    flowNodeClassNext, flowNodeClassChain, flowNodeClassMenu,
    onOpen, onMark, onKeyDown, onClassKeyDown, onDeselect,
    onBoxStart, onBoxChange, onBoxCancel,
}) => {
    const canvas = useRef<HTMLDivElement>(null);

    const toPlace = useMemo(
        () => spotsToPlace([...flowNodes, ...flowNodeClasses]), [flowNodes, flowNodeClasses]);
    useEffect(() => { if (toPlace.size > 0) onPlace(toPlace); }, [toPlace, onPlace]);


    const cards = useMemo(() => shown.map(flowNode => ({
        flowNode,
        spot: flowNode.spot ?? toPlace.get(flowNode.id) ?? { x: 0, y: 0 },
    })), [shown, toPlace]);


    const classCards = useMemo(() => shownClasses.map(flowNodeClass => ({
        flowNodeClass,
        spot: flowNodeClass.spot ?? toPlace.get(flowNodeClass.id) ?? { x: 0, y: 0 },
    })), [shownClasses, toPlace]);

    const ids = useMemo(() => [
        ...cards.map(card => card.flowNode.id),
        ...classCards.map(card => card.flowNodeClass.id),
    ], [cards, classCards]);
    const heights = useCardHeights(canvas, ids);


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
        const kinds = new Map<string, SymbolKind>([
            ...cards.map(card => [card.flowNode.id, symbolKindOf(card.flowNode.type)] as const),
            ...classCards.map(card => [card.flowNodeClass.id, symbolKindOf(card.flowNodeClass.type)] as const),
        ]);
        const arrowOf = (id: string, next: string, carries: boolean): Arrow[] => {
            const from = boxes.get(id);
            const to = next ? boxes.get(next) : undefined;
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
                ...flowNode.onSuccess.flowNodes,
            ].flatMap(next => arrowOf(flowNode.id, next, carriesChat(flowNode.onSuccess)))),
            ...classCards.flatMap(({ flowNodeClass }) => arrowOf(
                flowNodeClass.id, flowNodeClass.onSuccess.flowNode,
                carriesChat(flowNodeClass.onSuccess))),
        ];
    }, [cards, classCards, boxes]);

    const size = useMemo(
        () => canvasSize([...boxes.values(), ...shownWorkflows.map(entry => entry.rect)]),
        [boxes, shownWorkflows]);


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

    const box = useBoxSelect({ boxes, zoom, onStart: onBoxStart, onChange: onBoxChange, onCancel: onBoxCancel });


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

    // The right-click on a rectangle: aimed here — the canvas's own aim never runs, because the bubble is stopped so the canvas's menu.
    const aimOnWorkflow = (event: React.MouseEvent<HTMLElement>) => {
        aimAt(event);
        event.stopPropagation();
    };

    const instantiableTargets = useMemo(
        () => instantiateTargets.filter(target => target.instantiable)
            .sort((left, right) => (left.title || 'Untitled').localeCompare(right.title || 'Untitled')),
        [instantiateTargets]);


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
        // After the classes, which is what it is made from: the class picked here — and all its successors — is instantiated into nodes at.
        {
            key: 'instantiate-class',
            icon: <ClusterOutlined />,
            label: 'Instantiate class...',
            children: (instantiateWorkflows.length > 0 || instantiableTargets.length > 0)
                ? [
                    ...instantiateWorkflows.map(target => ({
                        name: target.name || 'Untitled',
                        item: {
                            key: `instantiate-workflow-${target.id}`,
                            icon: <GroupOutlined />,
                            label: (
                                <span data-testid={`instantiate-workflow-${target.id}`}>
                                    {target.name || 'Untitled'} ({target.boardName || target.boardSlug})
                                </span>
                            ),
                            onClick: () => onInstantiateWorkflow(target.id, aim.current),
                        },
                    })),
                    ...instantiableTargets.map(target => ({
                        name: target.title || 'Untitled',
                        item: {
                            key: `instantiate-${target.id}`,
                            icon: <ClusterOutlined />,
                            label: (
                                <span data-testid={`instantiate-${target.id}`}>
                                    {target.title || 'Untitled'} ({target.boardName || target.boardSlug})
                                </span>
                            ),
                            onClick: () => onInstantiate(target.id, aim.current),
                        },
                    })),
                ].sort((left, right) => left.name.localeCompare(right.name)).map(entry => entry.item)
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
        <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
            <div
                className={styles.board}
                ref={canvas}
                data-testid="content-canvas"
                onContextMenu={aimAt}
                onClick={clearOnEmptyClick}
                {...box.boxProps}
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
                                        work={flowNodeWork(flowNode)}
                                        menu={flowNodeMenu(flowNode)}
                                        onOpenChat={flowNodeChat(flowNode)}
                                        onUnlinkClass={flowNodeUnlink(flowNode)}
                                        onOpen={() => onOpen(flowNode.id)}
                                        onMark={() => onMark(flowNode.id)}
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

/** One workflow's rectangle: the bounds its members are drawn in, with the label naming it. */
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
