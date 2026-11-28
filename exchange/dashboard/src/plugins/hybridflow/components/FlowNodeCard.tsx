import React from 'react';
import type { MenuProps } from 'antd';
import {
    ArrowRightOutlined, BlockOutlined, BranchesOutlined, CaretRightOutlined, ClockCircleOutlined,
    CopyOutlined, DatabaseOutlined, DeleteOutlined, ExclamationCircleOutlined,
    ExportOutlined, FieldTimeOutlined, GroupOutlined, InboxOutlined, LoadingOutlined,
    MessageOutlined, PlayCircleOutlined,
    PoweroffOutlined, PullRequestOutlined, RobotOutlined, ScissorOutlined, StopOutlined, SwapOutlined, SyncOutlined, UserOutlined,
} from '@ant-design/icons';
import { CardSurface, ConfiguredMarkdown, IconButton, Tooltip } from '@kiao-dashboard-core';
import { useTagsUi } from '@kiao-dashboard-kit/capabilities';
import { useAgents } from '../Agents-ctx';
import { flowNodeInput, isRunnable, type BoardContent, type FlowNode, type Workflow } from '../boardContent';
import { readLimiter } from '../flowNodeLimiter';
import { scheduleLabel } from '../flowNodeSchedule';
import { hasLegacyHarness, isPlayable } from '../flowNodeSettings';
import { STATUS_LABELS, FlowNodeStatus, WAITING_REFRESH } from '../flowNodeStatus';
import { STATUS_GLYPH } from '../flowNodeStatusGlyph';
import { brokenTransition, TransitionMode } from '../flowNodeSuccess';
import { isTask, isWaitingEvent, FlowNodeType, splits } from '../flowNodeType';
import { symbolKindOf } from '../boardSpots';
import { FLOW_NODE_ID_ATTRIBUTE } from '../boardDom';
import { hasContextReference, renderNodeContext } from '../nodeContext';
import { retryClock, type FlowNodeRun } from '../usePlayFlowNode';
import styles from '../Hybridflow.module.css';

/**
 * What the card's Play is showing.
 * Null where there is nothing to offer: no Claude, a flow node whose settings do not name what would.
 */
export interface FlowNodePlayProps {

    state: 'idle' | FlowNodeRun['state'];

    retryAt?: number | null;

    chainRun?: string | null;

    onPlay?: () => void;

    onStop?: () => void;
}

/** What the card's right-click menu does. */
export interface FlowNodeMenuProps {

    onClone: () => void;

    onConvertType?: (type: 'ai' | 'human') => void;

    onCopy: () => void;

    onCut: () => void;

    onArchive: () => void;
    onDelete: () => void;

    copying: number;

    cutting: number;

    archiving: number;

    deleting: number;

    moveTargets?: { slug: string; name: string }[];

    onMove?: (targetHandle: string) => void;

    moving?: number;

    onCreateWorkflow?: () => void;

    creating?: number;
}

/** What a flow node hands on to when it comes back an answer, as the card's knob reads it out. */
export interface FlowNodeWorkProps {
    onWork: () => void;
}

export interface FlowNodeNextProps {
    title: string;
}

/** The card's knob, and what this card is party to while a chain is being drawn on the board. */
export interface FlowNodeChainProps {

    knobProps: {
        onPointerDown: React.PointerEventHandler<HTMLElement>;
        onPointerMove: React.PointerEventHandler<HTMLElement>;
        onPointerUp: React.PointerEventHandler<HTMLElement>;
        onPointerCancel: React.PointerEventHandler<HTMLElement>;
        onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    };
    source: boolean;
    target: boolean;
}

interface FlowNodeCardProps {
    flowNode: FlowNode;
    board?: Pick<BoardContent, 'flowNodes'>;
    workflow?: Workflow;
    roles?: ReadonlyMap<string, string>;

    next: FlowNodeNextProps | null;

    chain: FlowNodeChainProps | null;

    onOpenChat: (() => void) | null;

    selected: boolean;
    play: FlowNodePlayProps | null;
    work?: FlowNodeWorkProps | null;
    menu: FlowNodeMenuProps;
    onOpen: () => void;

    onMark: () => void;

    onKeyDown: React.KeyboardEventHandler<HTMLElement>;

    cardClass: string | undefined;
    dragProps: {
        onPointerDown: React.PointerEventHandler<HTMLElement>;
        onPointerMove: React.PointerEventHandler<HTMLElement>;
        onPointerUp: React.PointerEventHandler<HTMLElement>;
        onPointerCancel: React.PointerEventHandler<HTMLElement>;
        onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    };
}

/** What the knob shows of the way the card ends: not that a chain leaves it — the knob being tied says. */
const MODE_GLYPH: Record<TransitionMode, React.ReactNode> = {
    continue: <ArrowRightOutlined />,
    end: <ScissorOutlined />,
};

export const CHAIN_HELP = 'Drag to connect; drop elsewhere to disconnect.';

/** What the knob says on a Gateway: a drawn line adds a branch, and takes none off. */
export const GATEWAY_CHAIN_HELP = 'Drag to add a branch; remove branches in the panel.';

/** What the card says of a mode nothing on it can honour — the settings naming no turn to play. */
export const BROKEN_NOTE = 'Nothing here can play it.';

export const INVALID_HELP = 'Incomplete — open the node to see what\u2019s missing.';

const TYPE_CHIP_LABEL: Partial<Record<FlowNodeType, (flowNode: FlowNode) => string>> = {
    shutdown: () => 'shutdown',
    scheduler: flowNode => scheduleLabel(flowNode.at, flowNode.duration),
};

export const GatewayGlyph: React.FC<{
    size?: number;
    exclusive?: boolean;
    className?: string;
    style?: React.CSSProperties;
}> = ({ size = 13, exclusive, className, style }) => (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <path d={exclusive ? 'M 2 2 L 10 10 M 2 10 L 10 2' : 'M 6 1 V 11 M 1 6 H 11'} stroke="currentColor" strokeWidth="1.8" />
    </svg>
);

export const RoleGlyph: React.FC<{ size?: number }> = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 40 52" aria-hidden="true"
        fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="20" cy="8" r="6" />
        <path d="M 20 14 V 34 M 6 22 H 34 M 9 49 L 20 34 L 31 49" />
    </svg>
);

/** Kind marks in the title line and in machine shapes. */
const TYPE_MARK: Partial<Record<FlowNodeType, React.ReactNode>> = {
    ai: <RobotOutlined />,
    human: <UserOutlined />,
    start: <CaretRightOutlined />,
    shutdown: <PoweroffOutlined />,
    scheduler: <FieldTimeOutlined />,
    'bitbucket-pr-status': <PullRequestOutlined />,
    'bitbucket-commit-status': <BranchesOutlined />,
    gateway: <GatewayGlyph size={36} />,
    'exclusive-gateway': <GatewayGlyph size={36} exclusive />,
    role: <RoleGlyph size={54} />,
};

/** What the mark says of itself, since it is the whole of what the card says about its kind. */
export const MARK_HELP: Partial<Record<FlowNodeType, string>> = {
    ai: 'AI task',
    human: 'Somebody does this one by hand',
    start: 'Start event',
    shutdown: 'Turns the machine off',
    scheduler: 'Waits for a duration or datetime, then plays the node after it',
    'bitbucket-pr-status': 'Bitbucket PR Status',
    'bitbucket-commit-status': 'Bitbucket Commit Status',
    gateway: 'Waits for every branch, then starts each successor',
    'exclusive-gateway': 'Continues on each arrival, following the first matching route when configured',
    limiter: 'Limiter',
    role: 'Role',
};

/** Status colour on the whole border. */
const STATUS_BORDER: Record<FlowNodeStatus, string> = {
    draft: styles.cardDraft,
    ready: styles.cardReady,
    todo: styles.cardTodo,
    blocked: styles.cardBlocked,
    running: styles.cardRunning,
    'waiting-refresh': styles.cardWaitingRefresh,
    interrupted: styles.cardInterrupted,
    done: styles.cardDone,
    error: styles.cardFailed,
};

/** Same colours as the card border, as the symbol's ring. */
const SYMBOL_RING: Record<FlowNodeStatus, string> = {
    draft: styles.symbolDraft,
    ready: styles.symbolReady,
    todo: styles.symbolTodo,
    blocked: styles.symbolBlocked,
    running: styles.symbolRunning,
    'waiting-refresh': styles.symbolWaitingRefresh,
    interrupted: styles.symbolInterrupted,
    done: styles.symbolDone,
    error: styles.symbolError,
};

const STATUS_TONE: Record<FlowNodeStatus, string> = {
    draft: styles.cardStateDraft,
    ready: styles.cardStateReady,
    todo: styles.cardStateTodo,
    blocked: styles.cardStateBlocked,
    running: styles.cardStateRunning,
    'waiting-refresh': styles.cardStateWaitingRefresh,
    interrupted: styles.cardStateInterrupted,
    done: styles.cardStateDone,
    error: styles.cardStateBad,
};

/** One flow node. */
export const FlowNodeCard: React.FC<FlowNodeCardProps> = ({
    flowNode, board, workflow, roles, next, chain, selected, play, work, menu, onOpen, onMark, onKeyDown, onOpenChat,
    cardClass, dragProps,
}) => {
    // The chips are whatever plugin owns the store's tags; in an assembly without one they draw nothing, and a card simply wears no.
    const { TagChips } = useTagsUi();
    const { agents } = useAgents();
    const state = play?.state ?? 'idle';
    const running = state !== 'idle';
    const playing = state === 'playing';
    const mode = flowNode.onSuccess.mode;
    const broken = brokenTransition(flowNode.onSuccess, flowNode.settings);

    const { type, settings } = flowNode;
    const agentName = agents.find(agent => agent.id === settings.agent)?.name;
    const agentLabel = agentName ?? (hasLegacyHarness(settings) ? settings.model : undefined);
    const label = type === 'ai' ? agentLabel : TYPE_CHIP_LABEL[type]?.(flowNode);
    const invalid = type === 'ai'
        ? !isPlayable(settings) || agentLabel === undefined
        : (isWaitingEvent(type) || type === 'limiter') && !isRunnable(flowNode, board);
    const runningAgent = agentName ?? settings.model ?? 'Claude';
    const chipLabel = playing && type === 'ai' ? runningAgent
        : invalid ? undefined
            : label ?? (playing && isTask(type) ? runningAgent : undefined);

    const knobTitle = broken ? BROKEN_NOTE
        : splits(flowNode.type) ? GATEWAY_CHAIN_HELP : CHAIN_HELP;

    // Which chain run the Stop would end.
    const runNote = play?.chainRun ? ` (${play.chainRun})` : '';
    const retryTime = play?.retryAt ? retryClock(play.retryAt) : null;

    const playLabel = state === 'polling' ? `Stop waiting for the Bitbucket pull request${runNote}`
        : state === 'queued' ? `Stop waiting for this flow node${runNote}`
        : state === 'waiting'
        ? `The agent could not take this node; ${retryTime ? `it is played again at ${retryTime}` : 'waiting to retry'}`
        : state === 'refreshing'
            ? `The usage limit was reached; ${retryTime ? `this node’s turn resumes at ${retryTime}` : 'waiting for the reset'} — stop the play${runNote}`
            : state === 'compacting' ? `This node’s chat is being shortened — stop the play${runNote}`
                : state === 'scheduled' ? `Stop waiting for the scheduled time${runNote}`
                    : state === 'stopping' ? 'Finishing the node under way…'
                        : state === 'playing' ? (type === 'start' ? `Stop the run${runNote}`
                            : type === 'limiter' ? `Stop limiter run${runNote}` : `Claude is on this node — stop after it${runNote}`)
                            : type === 'ai' && flowNode.status === 'interrupted' && flowNode.chat
                                ? 'Resume this task in its conversation'
                                : 'Play this node and what follows it';

    const note = state === 'polling' ? 'Waiting for Bitbucket…'
        : state === 'queued' ? 'Waiting for the flow node…'
        : state === 'waiting' ? (retryTime ? `Played again at ${retryTime}` : 'Waiting to retry')
        : state === 'refreshing'
            ? `${STATUS_LABELS[WAITING_REFRESH]}${retryTime ? ` · back at ${retryTime}` : ''}`
            : state === 'compacting' ? 'Shortening its chat…'
                : state === 'scheduled' ? 'Waiting for the schedule…'
                    : state === 'stopping' ? 'Stopping after this node…'
                        : state === 'playing' ? ''
                            : STATUS_LABELS[flowNode.status];

    const kind = symbolKindOf(flowNode.type);

    const playTestId = state === 'polling' ? 'flow-node-card-polling'
        : state === 'queued' ? 'flow-node-card-queued'
        : state === 'waiting' ? 'flow-node-card-waiting'
        : state === 'refreshing' ? 'flow-node-card-refreshing'
            : state === 'compacting' ? 'flow-node-card-compacting'
                : state === 'scheduled' ? 'flow-node-card-scheduled'
                    : state === 'stopping' ? 'flow-node-card-stopping'
                    : state === 'playing' ? 'flow-node-card-playing'
                        : 'play-flow-node';

    const playIcon = state === 'stopping' ? <LoadingOutlined />
        : state === 'waiting' || state === 'refreshing' || state === 'queued'
            ? <ClockCircleOutlined />
            : running ? <StopOutlined />
                : <PlayCircleOutlined />;

    const control = running ? play?.onStop : play?.onPlay;

    const playButton = control && (
        <IconButton
            type="plain"
            label={playLabel}
            icon={playIcon}
            className={styles.cardPlay}
            data-testid={playTestId}
            disabled={state === 'stopping'}
            onClick={control}
        />
    );

    const workButton = work && (
        <IconButton
            type="plain"
            label="Work on this task"
            tooltip
            icon={<PlayCircleOutlined />}
            className={styles.cardPlay}
            data-testid="work-on-flow-node"
            onClick={work.onWork}
        />
    );

    const tagsClass = kind === 'rect' ? styles.cardTags : styles.symbolTags;

    const invalidMark = invalid ? (
        <Tooltip title={INVALID_HELP}>
            <span
                className={styles.cardInvalid}
                role="img"
                aria-label={INVALID_HELP}
                data-testid="flow-node-card-invalid"
            >
                <ExclamationCircleOutlined />
            </span>
        </Tooltip>
    ) : null;

    const stateLine = note ? (
        <div
            className={`${styles.cardState} ${running ? '' : STATUS_TONE[flowNode.status]}`}
            data-testid="flow-node-card-state"
        >
            {!running && STATUS_GLYPH[flowNode.status]}
            {note}
        </div>
    ) : null;

    const chipsRow = chipLabel !== undefined ? (
        <div className={styles.cardChips} data-testid="flow-node-card-settings">
            <span className={styles.cardChip} data-testid="flow-node-card-chip">
                {playing && (
                    <span
                        className={styles.cardChipSpin}
                        role="img"
                        aria-label="In progress"
                        data-testid="flow-node-card-running-icon"
                    >
                        <SyncOutlined spin />
                    </span>
                )}
                {chipLabel}
            </span>
        </div>
    ) : null;

    const foot = (
        <>
            {invalidMark}
            {chipsRow}
            <TagChips labels={flowNode.tags} className={tagsClass} />
        </>
    );

    const items: MenuProps['items'] = [
        { key: 'clone', icon: <BlockOutlined />, label: 'Clone node', onClick: menu.onClone },
        ...(isTask(flowNode.type) && menu.onConvertType ? [{
            key: 'convert',
            icon: <SwapOutlined />,
            label: 'Convert',
            children: [{
                key: 'convert-type',
                icon: flowNode.type === 'ai' ? <UserOutlined /> : <RobotOutlined />,
                label: flowNode.type === 'ai' ? 'Human task' : 'AI task',
                onClick: () => menu.onConvertType?.(flowNode.type === 'ai' ? 'human' : 'ai'),
            }],
        }] : []),
        ...((menu.onCreateWorkflow && (menu.creating ?? 0) > 0) ? [{
            key: 'create-workflow',
            icon: <GroupOutlined />,
            label: (menu.creating ?? 0) > 1 ? `Create workflow (${menu.creating} nodes)` : 'Create workflow (1 node)',
            onClick: menu.onCreateWorkflow,
        }] : []),
        { type: 'divider' },
        {
            key: 'copy',
            icon: <CopyOutlined />,
            label: menu.copying > 1 ? `Copy ${menu.copying} nodes` : 'Copy node',
            onClick: menu.onCopy,
        },
        {
            key: 'cut',
            icon: <ScissorOutlined />,
            label: menu.cutting > 1 ? `Cut ${menu.cutting} nodes` : 'Cut node',
            onClick: menu.onCut,
        },
        {
            key: 'move',
            icon: <ExportOutlined />,
            label: (menu.moving ?? menu.cutting) > 1
                ? `Move ${menu.moving ?? menu.cutting} nodes to...`
                : 'Move to...',
            children: (menu.moveTargets ?? []).length > 0
                ? (menu.moveTargets ?? []).map(target => ({
                    key: `move-${target.slug}`,
                    label: <span data-testid={`move-to-${target.slug}`}>{target.name}</span>,
                    onClick: () => menu.onMove?.(target.slug),
                }))
                : [{ key: 'move-none', label: 'No other boards', disabled: true }],
        },
        { type: 'divider' },
        {
            key: 'archive',
            icon: <InboxOutlined />,
            label: menu.archiving > 1 ? `Archive ${menu.archiving} nodes` : 'Archive node',
            onClick: menu.onArchive,
        },
        {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: menu.deleting > 1 ? `Delete ${menu.deleting} nodes` : 'Delete node',
            danger: true,
            onClick: menu.onDelete,
        },
    ];

    const chatMark = onOpenChat && (
        <IconButton
            type="plain"
            label="Open the node’s chat"
            icon={<MessageOutlined />}
            className={kind === 'rect' ? styles.cardChat : styles.symbolChat}
            data-testid="flow-node-card-chat"
            onClick={onOpenChat}
        />
    );

    const knob = chain && (
        <Tooltip title={knobTitle}>
            <span
                {...chain.knobProps}
                data-card-control
                className={[
                    styles.chainKnob,
                    kind === 'rect' ? '' : styles.symbolKnob,
                    next ? styles.chainKnobTied : '',
                    broken ? styles.chainKnobBroken : '',
                    chain.source ? styles.chainKnobDrawing : '',
                ].filter(Boolean).join(' ')}
                role="presentation"
                aria-hidden="true"
                data-testid="flow-node-card-chain"
                data-mode={next ? mode : undefined}
                data-compact={flowNode.onSuccess.compact ? 'true' : undefined}
                data-broken={broken ? 'true' : undefined}
            >
                {next && !splits(flowNode.type) && MODE_GLYPH[mode]}
            </span>
        </Tooltip>
    );

    const stateAndInteractions = (
        <div className={styles.cardStateAndInteractions} data-testid="flow-node-card-state-and-interactions">
            {stateLine ?? <span />}
            <div className={styles.cardInteractions}>
                {invalidMark}
                {playButton}
                {workButton}
                {chatMark}
                {knob}
            </div>
        </div>
    );

    const rectKindMark = TYPE_MARK[flowNode.type] ? (
        <Tooltip title={MARK_HELP[flowNode.type]}>
            <span
                className={styles.cardKind}
                role="img"
                aria-label={MARK_HELP[flowNode.type]}
                data-testid="flow-node-card-kind"
                data-type={flowNode.type}
            >
                {TYPE_MARK[flowNode.type]}
            </span>
        </Tooltip>
    ) : null;

    const title = hasContextReference(flowNode.title)
        ? renderNodeContext(flowNode.title, { input: board && flowNodeInput(board, flowNode), workflow, roles })
        : flowNode.title;
    const cardTitle = flowNode.title ? title : 'Untitled';
    const surface = {
        selected, onOpen, onToggleSelection: onMark, onKeyDown, menuItems: items,
        [FLOW_NODE_ID_ATTRIBUTE]: flowNode.id,
        ...dragProps,
    };

    if (flowNode.type === 'note' || flowNode.type === 'value') {
        return (
            <CardSurface
                {...surface}
                className={[styles.card, flowNode.type === 'note' ? styles.noteCard : '', cardClass].filter(Boolean).join(' ')}
                data-testid={flowNode.type === 'note' ? 'flow-node-note-card' : 'flow-node-value-card'}
                data-type={flowNode.type}
            >
                {flowNode.type === 'note' ? (
                    <div className={styles.noteScroll} data-testid="flow-node-note-body">
                        {flowNode.note.trim()
                            ? <ConfiguredMarkdown className={styles.noteBody}>{renderNodeContext(flowNode.note, { workflow, roles })}</ConfiguredMarkdown>
                            : <span>Empty note</span>}
                    </div>
                ) : (
                    <div className={`${styles.cardTitle} ${styles.valueTitle}`}>
                        <DatabaseOutlined role="img" aria-label="Value"
                            data-testid="flow-node-card-kind" data-type="value" />
                        <span>{cardTitle}</span>
                    </div>
                )}
            </CardSurface>
        );
    }

    if (kind !== 'rect') {
        const circle = kind === 'event';
        const actor = kind === 'actor';
        const agentRole = actor && flowNode.roleKind === 'agent';
        const symbolTitle = type === 'scheduler' ? '' : title.trim() || (type === 'start' ? 'Start' : '');
        const remainingPasses = type === 'limiter' ? String(readLimiter(flowNode).remainingPasses) : null;
        const markTitle = agentRole ? 'Agent role' : MARK_HELP[type];
        const markLabel = remainingPasses === null ? markTitle
            : `Limiter, ${remainingPasses} ${remainingPasses === '1' ? 'pass' : 'passes'} left`;
        // As the count gains digits, shrink it to fit inside the diamond.
        const typeMark = agentRole ? <RobotOutlined style={{ fontSize: 54 }} aria-hidden="true" /> : TYPE_MARK[type];
        const symbolMark = remainingPasses === null ? typeMark : (
            <span
                className={styles.limiterPassCount}
                style={{ fontSize: Math.min(28, 60 / (1 + remainingPasses.length * 0.6)) }}
            >
                {remainingPasses}
            </span>
        );
        const shapeClass = [
            actor ? styles.symbolRole : circle ? styles.symbolEvent : styles.symbolGateway,
            circle && flowNode.type === 'shutdown' ? styles.symbolEventEnd : '',
        ].filter(Boolean).join(' ');
        return (
            <CardSurface
                {...surface}
                className={[
                    styles.symbol,
                    actor ? '' : SYMBOL_RING[flowNode.status],
                    running ? styles.symbolPlaying : '',
                    chain?.target ? styles.symbolChainTarget : '',
                    cardClass ?? '',
                ].filter(Boolean).join(' ')}
                data-testid="flow-node-card"
                data-status={flowNode.status}
                data-shape={actor ? 'actor' : circle ? 'circle' : 'diamond'}
            >
                <div className={kind === 'gateway' ? styles.symbolGatewayWrap : styles.symbolEventWrap}>
                    {symbolMark && (
                        <Tooltip title={markTitle}>
                            <div
                                className={shapeClass}
                                role="img"
                                aria-label={markLabel}
                                data-testid="flow-node-card-kind"
                                data-type={flowNode.type}
                            >
                                {kind === 'gateway' ? (
                                    <span className={styles.symbolGatewayInner}>
                                        {symbolMark}
                                    </span>
                                ) : symbolMark}
                            </div>
                        </Tooltip>
                    )}
                    {(type === 'start' || isWaitingEvent(type) || type === 'limiter') && playButton && (
                        <div className={styles.symbolPlay}>{playButton}</div>
                    )}
                    {chatMark}
                    {knob}
                </div>
                <div className={styles.symbolLabel}>
                    {symbolTitle && <div className={styles.symbolTitle}>{symbolTitle}</div>}
                    {!actor && foot}
                </div>
            </CardSurface>
        );
    }

    return (
        <CardSurface
            {...surface}
            className={[
                styles.card,
                STATUS_BORDER[flowNode.status],
                running ? styles.cardPlaying : '',
                chain?.target ? styles.cardChainTarget : '',
                cardClass ?? '',
            ].filter(Boolean).join(' ')}
            data-testid="flow-node-card"
            data-status={flowNode.status}
        >
            <div className={styles.cardTitle}>
                {rectKindMark}
                {cardTitle}
            </div>
            {chipsRow}
            {stateAndInteractions}
            <TagChips labels={flowNode.tags} className={tagsClass} />
        </CardSurface>
    );
};
