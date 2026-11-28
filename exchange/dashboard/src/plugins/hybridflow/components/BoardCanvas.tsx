import React, { useEffect, useMemo, useRef } from 'react';
import type { MenuProps } from 'antd';
import {
    BranchesOutlined, CaretRightOutlined, CopyOutlined, DeleteOutlined, ExclamationCircleOutlined, FieldTimeOutlined, GroupOutlined,
    FormOutlined, PlayCircleOutlined, PullRequestOutlined, PoweroffOutlined, SnippetsOutlined, UserOutlined,
} from '@ant-design/icons';
import { ContextMenu, ZoomSurface } from '@kiao-dashboard-core';
import { FlowNode, Workflow, workflowFilesError } from '../boardContent';
import {
    ARROW_HEADROOM, arrowEndsBetween, CANVAS_MARGIN, canvasSize, CardBox, cardSizeOf,
    minSizeOf, nominalHeightOf, spotsToPlace, symbolKindOf,
} from '../boardSpots';
import { BOARD_ATTRIBUTE } from '../boardDom';
import { spotAt, FlowNodeSpot } from '../flowNodeSpot';
import { FlowNodeSize } from '../flowNodeSize';
import { LIMITER_BRANCHES } from '../flowNodeLimiter';
import { carriesChat } from '../flowNodeSuccess';
import { FLOW_NODE_TYPE_ORDER, FlowNodeType } from '../flowNodeType';
import { roleValues } from '../nodeContext';
import { useCardHeights } from '../useCardHeights';
import { SpotDrag } from '../useSpotDrag';
import { workflowRectOf } from '../workflowBounds';
import type { WorkflowRect as WorkflowBounds } from '../workflowBounds';
import { useBoxSelect } from '../useBoxSelect';
import { CardResize, ResizeEdge, ResizeTarget, useCardResize } from '../useCardResize';
import {
    FlowNodeCard, FlowNodeChainProps, FlowNodeMenuProps, FlowNodeNextProps, FlowNodePlayProps, FlowNodeWorkProps,
    GatewayGlyph, RoleGlyph,
} from './FlowNodeCard';
import styles from '../Hybridflow.module.css';

/** The id the arrowhead is defined under. */
const ARROW_HEAD = 'board-arrow-head';

/** What the canvas's own menu offers, in the order the type select offers the five: the two kinds of. */
const NEW_LABEL: Record<FlowNodeType, string> = {
    ai: 'New AI node',
    human: 'New Human node',
    start: 'New Start',
    shutdown: 'New Shutdown',
    scheduler: 'New Scheduler',
    'bitbucket-pr-status': 'New Bitbucket PR Status',
    'bitbucket-commit-status': 'New Bitbucket Commit Status',
    gateway: 'New Parallel gateway',
    'exclusive-gateway': 'New Exclusive gateway',
    limiter: 'New Limiter',
    note: 'New Note',
    value: 'New Value',
    role: 'New Role',
};

const NEW_GLYPH: Record<FlowNodeType, React.ReactNode> = {
    ai: <PlayCircleOutlined />,
    human: <UserOutlined />,
    start: <CaretRightOutlined />,
    shutdown: <PoweroffOutlined />,
    scheduler: <FieldTimeOutlined />,
    'bitbucket-pr-status': <PullRequestOutlined />,
    'bitbucket-commit-status': <BranchesOutlined />,
    gateway: <GatewayGlyph />,
    'exclusive-gateway': <GatewayGlyph exclusive />,
    limiter: <GatewayGlyph exclusive />,
    note: <SnippetsOutlined />,
    value: <SnippetsOutlined />,
    role: <RoleGlyph size={14} />,
};

const newFlowNodeItems = (testId: string, add: (type: FlowNodeType) => void) =>
    FLOW_NODE_TYPE_ORDER.map(type => ({
        key: `new-${type}`,
        // Ant Design applies the spacing class to the icon element.
        icon: <span className={styles.menuIcon} aria-hidden="true">{NEW_GLYPH[type]}</span>,
        label: <span data-testid={testId} data-type={type}>{NEW_LABEL[type]}</span>,
        onClick: () => add(type),
    }));

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
    id: string;
    name: string;
    filesError?: string;
    rect: WorkflowBounds;
}

interface BoardCanvasProps {

    shown: FlowNode[];

    flowNodes: FlowNode[];

    workflows: Workflow[];

    selectedWorkflowId: string | null;

    zoom: number;

    onPlace: (spots: Map<string, FlowNodeSpot>) => void;

    onAdd: (type: FlowNodeType, spot: FlowNodeSpot, workflow?: string) => void;

    onPaste: (spot: FlowNodeSpot, workflow?: string) => void;
    onInstantiateHere: (spot: FlowNodeSpot, workflow?: string) => void;

    onOpenWorkflow: (id: string) => void;
    onCopyWorkflow: (id: string) => void;
    onDeleteWorkflow: (id: string) => void;

    selectedFlowNodeId: string | null;
    markedFlowNodeIds: Set<string>;

    drag: SpotDrag;
    flowNodePlay: (flowNode: FlowNode) => FlowNodePlayProps | null;
    flowNodeWork: (flowNode: FlowNode) => FlowNodeWorkProps | null;
    flowNodeNext: (flowNode: FlowNode) => FlowNodeNextProps | null;
    flowNodeChain: (flowNode: FlowNode) => FlowNodeChainProps | null;
    flowNodeChat: (flowNode: FlowNode) => (() => void) | null;

    flowNodeMenu: (flowNode: FlowNode) => FlowNodeMenuProps;
    onOpen: (flowNodeId: string) => void;
    onMark: (flowNodeId: string) => void;
    onKeyDown: (flowNode: FlowNode, event: React.KeyboardEvent<HTMLElement>) => void;

    onResize: (id: string, size: FlowNodeSize, spot: FlowNodeSpot) => void;

    onDeselect: () => void;

    onBoxStart: (additive: boolean) => void;

    onBoxChange: (flowNodeIds: string[]) => void;

    onBoxCancel: () => void;
}

/** The board: every card where somebody put it, and an arrow from each card to the one it hands on to. */
export const BoardCanvas: React.FC<BoardCanvasProps> = ({
    shown, flowNodes, workflows, selectedWorkflowId,
    zoom, onPlace, onAdd, onPaste, onInstantiateHere,
    onOpenWorkflow, onCopyWorkflow, onDeleteWorkflow,
    selectedFlowNodeId, markedFlowNodeIds, drag, flowNodePlay, flowNodeWork, flowNodeNext,
    flowNodeChain, flowNodeChat, flowNodeMenu,
    onOpen, onMark, onKeyDown, onResize, onDeselect,
    onBoxStart, onBoxChange, onBoxCancel,
}) => {
    const canvas = useRef<HTMLDivElement>(null);
    const workflowsById = useMemo(() => new Map(workflows.map(workflow => [workflow.id, workflow])), [workflows]);
    const roles = useMemo(() => roleValues(flowNodes), [flowNodes]);

    const toPlace = useMemo(
        () => spotsToPlace(flowNodes), [flowNodes]);
    useEffect(() => { if (toPlace.size > 0) onPlace(toPlace); }, [toPlace, onPlace]);

    const cards = useMemo(() => shown.map(flowNode => ({
        flowNode,
        spot: flowNode.spot ?? toPlace.get(flowNode.id) ?? { x: 0, y: 0 },
    })), [shown, toPlace]);

    const ids = useMemo(() => cards.map(card => card.flowNode.id), [cards]);
    const heights = useCardHeights(canvas, ids);

    const resize = useCardResize(onResize, zoom);

    const boxes = useMemo(() => {
        const held = new Map<string, CardBox>();
        const boxOf = (
            id: string, spot: FlowNodeSpot, type: FlowNodeType, size: FlowNodeSize | null,
        ) => {
            const offset = drag.offsetOf(id);
            const shownSpot = resize.spotOf(id) ?? spot;
            const own = cardSizeOf(type, resize.sizeOf(id) ?? size);
            held.set(id, {
                x: shownSpot.x + CANVAS_MARGIN + (offset?.x ?? 0),
                y: shownSpot.y + CANVAS_MARGIN + (offset?.y ?? 0),
                w: own.w,
                h: own.h ?? heights.get(id) ?? nominalHeightOf(type),
            });
        };
        cards.forEach(({ flowNode, spot }) =>
            boxOf(flowNode.id, spot, flowNode.type, flowNode.size));
        return held;
    }, [cards, drag, heights, resize]);

    const shownWorkflows = useMemo((): ShownWorkflow[] => {
        const members = new Map<string, CardBox[]>();
        for (const { flowNode } of cards) {
            const box = boxes.get(flowNode.id);
            if (!flowNode.workflow || !box) continue;
            const rectangles = members.get(flowNode.workflow);
            if (rectangles) rectangles.push(box);
            else members.set(flowNode.workflow, [box]);
        }
        const out: ShownWorkflow[] = [];
        for (const [id, rectangles] of members) {
            const workflow = workflowsById.get(id);
            const rect = workflowRectOf(rectangles);
            if (workflow && rect) {
                out.push({ id, name: workflow.name, rect, filesError: workflowFilesError(workflow) });
            }
        }
        return out;
    }, [cards, boxes, workflowsById]);

    const arrows = useMemo((): Arrow[] => {
        const titles = new Map(cards.map(({ flowNode }) => [flowNode.id, flowNode.title || 'Untitled']));
        const kinds = new Map(cards.map(({ flowNode }) => [flowNode.id, symbolKindOf(flowNode.type)]));
        const arrowOf = (id: string, next: string, carries: boolean, branch?: string): Arrow[] => {
            const from = boxes.get(id);
            const to = next ? boxes.get(next) : undefined;
            if (!from || !to) return [];
            const ends = arrowEndsBetween(
                from, kinds.get(id) ?? 'rect', to, kinds.get(next) ?? 'rect', ARROW_HEADROOM,
            );
            if (!ends) return [];
            const title = `“${titles.get(id)}” hands on to “${titles.get(next)}”`;
            return [{
                id,
                to: next,
                ...ends,
                carries,
                title: branch ? `${title} (${branch})` : title,
            }];
        };
        return cards.flatMap(({ flowNode }) => {
            const { onSuccess } = flowNode;
            const carries = carriesChat(onSuccess);
            return [
                ...arrowOf(flowNode.id, onSuccess.flowNode, carries),
                ...onSuccess.flowNodes.flatMap((next, index) =>
                    arrowOf(flowNode.id, next, carries, flowNode.type === 'limiter' ? LIMITER_BRANCHES[index] : undefined)),
            ];
        });
    }, [cards, boxes]);

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
    };

    const box = useBoxSelect({ boxes, zoom, onStart: onBoxStart, onChange: onBoxChange, onCancel: onBoxCancel });

    const clearOnEmptyClick = (event: React.MouseEvent) => {
        if (drag.justDragged() || box.justSelected()) return;
        const at = event.target as Element | null;
        if (at?.closest?.('[data-flow-node-id]')) return;
        const workflowId = at?.closest?.('[data-workflow-id]')?.getAttribute('data-workflow-id');
        if (workflowId) {
            onOpenWorkflow(workflowId);
            return;
        }
        onDeselect();
    };

    const clipboardItems = (workflow?: string): NonNullable<MenuProps['items']> => [
        {
            key: 'paste',
            icon: <SnippetsOutlined />,
            label: <span data-testid="paste-here">Paste here</span>,
            onClick: () => onPaste(aim.current, workflow),
        },
        {
            key: 'instantiate-here',
            icon: <FormOutlined />,
            label: 'Instantiate here',
            onClick: () => onInstantiateHere(aim.current, workflow),
        },
    ];

    const items: MenuProps['items'] = [
        ...newFlowNodeItems('new-flow-node', type => onAdd(type, aim.current)),
        { type: 'divider' },
        ...clipboardItems(),
    ];

    const workflowItems = ({ id }: ShownWorkflow): MenuProps['items'] => [
        ...newFlowNodeItems('new-flow-node-in-workflow', type => onAdd(type, aim.current, id)),
        { type: 'divider' },
        {
            key: 'copy-workflow',
            icon: <CopyOutlined />,
            label: 'Copy workflow as JSON',
            onClick: () => onCopyWorkflow(id),
        },
        ...clipboardItems(id),
        { type: 'divider' },
        {
            key: 'delete-workflow',
            icon: <DeleteOutlined />,
            danger: true,
            label: 'Delete workflow',
            onClick: () => onDeleteWorkflow(id),
        },
    ];

    if (cards.length === 0) {
        return (
            <ContextMenu items={items}>
                <div
                    className={styles.board}
                    ref={canvas}
                    data-testid="content-canvas"
                    onContextMenu={aimAt}
                    onClick={clearOnEmptyClick}
                >
                    <div className={styles.boardEmpty}>
                        No flow nodes to display. Right-click to add one.
                    </div>
                </div>
            </ContextMenu>
        );
    }

    return (
        <ContextMenu items={items}>
            <ZoomSurface
                className={styles.board}
                ref={canvas}
                zoom={zoom}
                contentSize={size}
                data-testid="content-canvas"
                onContextMenu={aimAt}
                onClick={clearOnEmptyClick}
                {...box.boxProps}
                {...{ [BOARD_ATTRIBUTE]: '' }}
            >
                {shownWorkflows.map(entry => (
                    <WorkflowRect
                        key={entry.id}
                        entry={entry}
                        selected={selectedWorkflowId === entry.id}
                        dragProps={drag.dragProps(entry.id)}
                        items={workflowItems(entry)}
                        onContextMenu={aimAt}
                    />
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
                    const shownSpot = resize.spotOf(flowNode.id) ?? spot;
                    const size = cardSizeOf(flowNode.type, resize.sizeOf(flowNode.id) ?? flowNode.size);
                    const target = resizeTargetOf(
                        flowNode.id, shownSpot, size, heights.get(flowNode.id), flowNode.type);
                    const selected = selectedFlowNodeId === flowNode.id;
                    return (
                        <div
                            key={flowNode.id}
                            className={[
                                styles.boardCard,
                                offset ? styles.boardCardMoving : '',
                            ].filter(Boolean).join(' ')}
                            style={{
                                left: shownSpot.x + CANVAS_MARGIN,
                                top: shownSpot.y + CANVAS_MARGIN,
                                width: size.w,
                                height: size.h ?? undefined,
                                transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
                            }}
                            data-testid="content-card"
                            data-flow-node={flowNode.id}
                        >
                            <FlowNodeCard
                                flowNode={flowNode}
                                board={{ flowNodes }}
                                workflow={workflowsById.get(flowNode.workflow)}
                                roles={roles}
                                next={flowNodeNext(flowNode)}
                                chain={flowNodeChain(flowNode)}
                                selected={selected || markedFlowNodeIds.has(flowNode.id)}
                                play={flowNodePlay(flowNode)}
                                work={flowNodeWork(flowNode)}
                                menu={flowNodeMenu(flowNode)}
                                onOpenChat={flowNodeChat(flowNode)}
                                onOpen={() => onOpen(flowNode.id)}
                                onMark={() => onMark(flowNode.id)}
                                onKeyDown={event => onKeyDown(flowNode, event)}
                                cardClass={size.h === null ? undefined : styles.cardSized}
                                dragProps={drag.dragProps(flowNode.id)}
                            />
                            {selected && <CardResizeEdges resize={resize} target={target} />}
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
            </ZoomSurface>
        </ContextMenu>
    );
};

/** The four edges of a selected card, each changing the dimension it faces. */
const RESIZE_EDGES: ResizeEdge[] = ['top', 'right', 'bottom', 'left'];

const EDGE_CLASS: Record<ResizeEdge, string> = {
    top: styles.resizeEdgeTop,
    right: styles.resizeEdgeRight,
    bottom: styles.resizeEdgeBottom,
    left: styles.resizeEdgeLeft,
};

const resizeTargetOf = (
    id: string, spot: FlowNodeSpot, size: { w: number; h: number | null },
    measuredHeight: number | undefined, type: FlowNodeType,
): ResizeTarget => ({
    id,
    spot,
    size: { w: size.w, ...(size.h === null ? {} : { h: size.h }) },
    height: size.h ?? measuredHeight ?? nominalHeightOf(type),
    minWidth: minSizeOf(type).w,
    minHeight: minSizeOf(type).h,
});

const CardResizeEdges: React.FC<{ resize: CardResize; target: ResizeTarget }> = ({ resize, target }) => (
    <>
        {RESIZE_EDGES.map(edge => (
            <span
                key={edge}
                className={[
                    styles.resizeEdge,
                    EDGE_CLASS[edge],
                    resize.resizing?.id === target.id && resize.resizing.edge === edge
                        ? styles.resizeEdgeActive : '',
                ].filter(Boolean).join(' ')}
                data-testid="card-resize-edge"
                data-edge={edge}
                {...resize.resizeProps(target, edge)}
                onClick={event => event.stopPropagation()}
            />
        ))}
    </>
);

type RectangleDragProps = ReturnType<SpotDrag['dragProps']>;

/** One workflow's rectangle: the bounds its members are drawn in, with the label naming it. */
const WorkflowRect: React.FC<{
    entry: ShownWorkflow;
    selected: boolean;
    dragProps: RectangleDragProps;
    items: MenuProps['items'];
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}> = ({ entry, selected, dragProps, items, onContextMenu }) => {
    const { onPointerDown, ...carried } = dragProps;
    return (
        <ContextMenu items={items}>
            <div
                className={[
                    styles.workflowRect,
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
                title={entry.filesError}
                onContextMenu={onContextMenu}
                onPointerDown={event => {
                    if ((event.target as Element | null)?.closest?.('[data-flow-node-id]')) return;
                    onPointerDown(event);
                }}
                {...carried}
            >
                <div className={styles.workflowLabel} data-testid="content-workflow-label">
                    {entry.filesError && (
                        <span className={styles.workflowInvalidMark} role="img" aria-label={entry.filesError}>
                            <ExclamationCircleOutlined aria-hidden="true" />
                        </span>
                    )}
                    {entry.name || 'Untitled'}
                </div>
            </div>
        </ContextMenu>
    );
};
