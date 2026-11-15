import React from 'react';
import { Dropdown, MenuProps } from 'antd';
import {
    ArrowRightOutlined, BlockOutlined, ClockCircleOutlined, ClusterOutlined,
    CopyOutlined, DatabaseOutlined, DeleteOutlined, DisconnectOutlined, ExclamationCircleOutlined,
    ExportOutlined, FieldTimeOutlined, GroupOutlined, InboxOutlined, LoadingOutlined,
    MessageOutlined, PlayCircleOutlined,
    PoweroffOutlined, RobotOutlined, ScissorOutlined, StopOutlined, SwapOutlined, SyncOutlined, UserOutlined,
} from '@ant-design/icons';
import { ConfiguredMarkdown, KEEP_MENU_IN_VIEWPORT, Tooltip } from '@kiao-dashboard-core';
import { useTagsUi } from '@kiao-dashboard-kit/capabilities';
import { useAgents } from '../Agents-ctx';
import { FlowNode } from '../boardContent';
import { scheduleLabel } from '../flowNodeSchedule';
import { SettingChip, settingsChips } from '../flowNodeSettings';
import { STATUS_LABELS, FlowNodeStatus, WAITING_REFRESH } from '../flowNodeStatus';
import { STATUS_GLYPH } from '../flowNodeStatusGlyph';
import { brokenTransition, TransitionMode } from '../flowNodeSuccess';
import { isTask, FlowNodeType } from '../flowNodeType';
import { symbolKindOf } from '../boardSpots';
import { FLOW_NODE_ID_ATTRIBUTE } from '../boardDom';
import { retryClock } from '../usePlayFlowNode';
import styles from '../Hybridflow.module.css';

/**
 * What the card's Play is showing.
 * Null where there is nothing to offer: no Claude, a flow node whose settings do not name what would.
 */
export interface FlowNodePlayProps {

    state: 'idle' | 'playing' | 'compacting' | 'scheduled' | 'waiting' | 'refreshing' | 'stopping';

    retryAt?: number | null;

    chainRun?: string | null;

    onPlay?: () => void;

    onStop?: () => void;
}

/** What the card's right-click menu does. */
export interface FlowNodeMenuProps {

    onClone: () => void;

    onConvertType?: (type: 'ai' | 'human') => void;

    onConvertToClass?: () => void;

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

    next: FlowNodeNextProps | null;

    chain: FlowNodeChainProps | null;

    onOpenChat: (() => void) | null;

    onUnlinkClass: (() => void) | null;

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

/** Whether the press is asking to **mark** the card rather than to open it: <kbd>Ctrl</kbd>,. */
const marking = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => event.ctrlKey || event.metaKey;

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

/** What the card says of a node that cannot be played as it stands: one mark, and no list of what it. */
export const INVALID_HELP = 'Incomplete — open the node to see what\u2019s missing.';

/** What the bubbles at the foot say of the two cards the board plays to **itself**. */
const TYPE_CHIPS: Partial<Record<FlowNodeType, (flowNode: FlowNode) => SettingChip[]>> = {
    shutdown: () => [{ text: 'shutdown' }],
    scheduler: flowNode => {
        const when = scheduleLabel(flowNode.at, flowNode.duration);
        return [when ? { text: when } : { text: 'no datetime', missing: true }];
    },
    gateway: flowNode => {
        const count = flowNode.onSuccess.flowNodes.length;
        return [{ text: count === 0 ? 'no branches' : `${count} branch${count === 1 ? '' : 'es'}` }];
    },
};

/** The BPMN parallel-gateway mark — a plus, and nothing round it. */
export const GatewayGlyph: React.FC<{ size?: number }> = ({ size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
        <path d="M 6 1 V 11 M 1 6 H 11" stroke="currentColor" strokeWidth="1.8" />
    </svg>
);

/** Kind marks in the title line and in machine shapes. */
const TYPE_MARK: Partial<Record<FlowNodeType, React.ReactNode>> = {
    ai: <RobotOutlined />,
    human: <UserOutlined />,
    shutdown: <PoweroffOutlined />,
    scheduler: <FieldTimeOutlined />,
    gateway: <GatewayGlyph size={36} />,
};

/** What the mark says of itself, since it is the whole of what the card says about its kind. */
export const MARK_HELP: Partial<Record<FlowNodeType, string>> = {
    ai: 'AI task',
    human: 'Somebody does this one by hand',
    shutdown: 'Turns the machine off',
    scheduler: 'Waits for a duration or datetime, then plays the node after it',
    gateway: 'Waits for every branch, then starts each successor',
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
    flowNode, next, chain, selected, play, work, menu, onOpen, onMark, onKeyDown, onOpenChat,
    onUnlinkClass, cardClass, dragProps,
}) => {
    // The chips are whatever plugin owns the store's tags; in an assembly without one they draw nothing, and a card simply wears no.
    const { TagChips } = useTagsUi();
    const { agents } = useAgents();
    const state = play?.state ?? 'idle';
    const running = state !== 'idle';
    const playing = state === 'playing';
    const mode = flowNode.onSuccess.mode;
    const broken = brokenTransition(flowNode.onSuccess, flowNode.settings);
    // What the foot of the card wears is what the type has to say: an AI card the agent its turn runs on, the two the board plays to.
    const chips = flowNode.type === 'ai'
        ? settingsChips(flowNode.settings, agents)
        : TYPE_CHIPS[flowNode.type]?.(flowNode) ?? [];
    /** Whether the node cannot be played as it stands: any setting — or the Scheduler's datetime — still. */
    const invalid = chips.some(chip => chip.missing);


    const knobTitle = broken ? BROKEN_NOTE
        : flowNode.type === 'gateway' ? GATEWAY_CHAIN_HELP : CHAIN_HELP;

    // Which chain run the Stop would end.
    const runNote = play?.chainRun ? ` (${play.chainRun})` : '';
    const retryTime = play?.retryAt ? retryClock(play.retryAt) : null;

    const playLabel = state === 'waiting'
        ? `The agent could not take this node; ${retryTime ? `it is played again at ${retryTime}` : 'waiting to retry'}`
        : state === 'refreshing'
            ? `The usage limit was reached; ${retryTime ? `this node’s turn resumes at ${retryTime}` : 'waiting for the reset'} — stop the play${runNote}`
            : state === 'compacting' ? `This node’s chat is being shortened — stop the play${runNote}`
                : state === 'scheduled' ? `Holding for this card\u2019s schedule — stop the play${runNote}`
                    : state === 'stopping' ? 'Finishing the node under way…'
                        : state === 'playing' ? `Claude is on this node — stop after it${runNote}`
                            : 'Play this node and what follows it';

    const runner = agents.find(agent => agent.id === flowNode.settings.agent)?.name
        ?? flowNode.settings.model
        ?? 'Claude';


    const playChips: SettingChip[] = flowNode.type === 'ai' || chips.length === 0
        ? [{ text: runner }]
        : chips;


    const note = state === 'waiting' ? (retryTime ? `Played again at ${retryTime}` : 'Waiting to retry')
        : state === 'refreshing'
            ? `${STATUS_LABELS[WAITING_REFRESH]}${retryTime ? ` · back at ${retryTime}` : ''}`
            : state === 'compacting' ? 'Shortening its chat…'
                : state === 'scheduled' ? 'Waiting for the schedule…'
                    : state === 'stopping' ? 'Stopping after this node…'
                        : state === 'playing' ? ''
                            : STATUS_LABELS[flowNode.status];

    const kind = symbolKindOf(flowNode.type);


    const playTestId = state === 'waiting' ? 'flow-node-card-waiting'
        : state === 'refreshing' ? 'flow-node-card-refreshing'
            : state === 'compacting' ? 'flow-node-card-compacting'
                : state === 'scheduled' ? 'flow-node-card-scheduled'
                    : state === 'stopping' ? 'flow-node-card-stopping'
                    : state === 'playing' ? 'flow-node-card-playing'
                        : 'play-flow-node';


    const playIcon = state === 'stopping' ? <LoadingOutlined />
        : state === 'waiting' || state === 'refreshing'
            ? <ClockCircleOutlined />
            : running ? <StopOutlined />
                : <PlayCircleOutlined />;


    const control = running ? play?.onStop : play?.onPlay;

    const playButton = control && (
        <button
            type="button"
            className={styles.cardPlay}
            aria-label={playLabel}
            data-testid={playTestId}
            disabled={state === 'stopping'}
            onKeyDown={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); control(); }}
        >
            {playIcon}
        </button>
    );

    const workButton = work && (
        <Tooltip title="Work on this task">
            <button
                type="button"
                className={styles.cardPlay}
                aria-label="Work on this task"
                data-testid="work-on-flow-node"
                onKeyDown={event => event.stopPropagation()}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); work.onWork(); }}
            >
                <PlayCircleOutlined />
            </button>
        </Tooltip>
    );


    const symbolMark = TYPE_MARK[flowNode.type];


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

    const classRef = flowNode.classVersion ? (
        <div className={styles.cardClassRef} data-testid="flow-node-class-ref">
            <ClusterOutlined />
            <span>
                {flowNode.classVersion.classTitle || 'Untitled'}
                {' · '}
                v{flowNode.classVersion.versionNumber}
            </span>
            {onUnlinkClass && (
                <Tooltip title="Break the link to the class — the node keeps what it says">
                    <button
                        type="button"
                        className={styles.cardClassUnlink}
                        aria-label="Break the link to the class"
                        data-testid="unlink-flow-node-class"
                        onKeyDown={event => event.stopPropagation()}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                            event.stopPropagation();
                            onUnlinkClass();
                        }}
                    >
                        <DisconnectOutlined />
                    </button>
                </Tooltip>
            )}
        </div>
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

    const chipsRow = playing ? (
        <div className={styles.cardChips} data-testid="flow-node-card-settings">
            {playChips.map((chip, slot) => (
                <span
                    key={slot}
                    className={`${styles.cardChip} ${chip.missing ? styles.cardChipMissing : ''}`}
                    data-testid="flow-node-card-chip"
                >
                    {slot === 0 && (
                        <span
                            className={styles.cardChipSpin}
                            role="img"
                            aria-label="In progress"
                            data-testid="flow-node-card-running-icon"
                        >
                            <SyncOutlined spin />
                        </span>
                    )}
                    {chip.text}
                </span>
            ))}
        </div>
    ) : !invalid && chips.length > 0 ? (
        <div className={styles.cardChips} data-testid="flow-node-card-settings">
            {chips.map((chip, slot) => (
                <span
                    key={slot}
                    className={`${styles.cardChip} ${chip.missing ? styles.cardChipMissing : ''}`}
                    data-testid="flow-node-card-chip"
                >
                    {chip.text}
                </span>
            ))}
        </div>
    ) : null;

    const foot = (
        <>
            {classRef}
            {stateLine}
            {playing ? chipsRow : invalid ? invalidMark : chipsRow}
            <TagChips labels={flowNode.tags} className={tagsClass} />
        </>
    );

    const items: MenuProps['items'] = [
        { key: 'clone', icon: <BlockOutlined />, label: 'Clone node', onClick: menu.onClone },
        ...(isTask(flowNode.type) && (menu.onConvertType || menu.onConvertToClass) ? [{
            key: 'convert',
            icon: <SwapOutlined />,
            label: 'Convert',
            children: [
                ...(menu.onConvertType ? [{
                    key: 'convert-type',
                    icon: flowNode.type === 'ai' ? <UserOutlined /> : <RobotOutlined />,
                    label: flowNode.type === 'ai' ? 'Human task' : 'AI task',
                    onClick: () => menu.onConvertType?.(flowNode.type === 'ai' ? 'human' : 'ai'),
                }] : []),
                ...(menu.onConvertToClass ? [{
                    key: 'convert-class',
                    icon: <ClusterOutlined />,
                    label: 'Node class',
                    onClick: menu.onConvertToClass,
                }] : []),
            ],
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
        <button
            type="button"
            className={kind === 'rect' ? styles.cardChat : styles.symbolChat}
            aria-label="Open the node’s chat"
            data-testid="flow-node-card-chat"
            onKeyDown={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
                event.stopPropagation();
                onOpenChat();
            }}
        >
            <MessageOutlined />
        </button>
    );


    const knob = chain && (
        <Tooltip title={knobTitle}>
            <span
                {...chain.knobProps}
                onPointerDown={event => {
                    chain.knobProps.onPointerDown(event);
                    event.stopPropagation();
                }}
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
                onClick={event => event.stopPropagation()}
            >
                {next && flowNode.type !== 'gateway' && MODE_GLYPH[mode]}
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

    if (flowNode.type === 'note' || flowNode.type === 'value') {
        return (
            <div onContextMenu={event => event.stopPropagation()}>
                <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                    <div
                        className={[styles.card, flowNode.type === 'note' ? styles.noteCard : '', selected ? styles.cardSelected : '', cardClass ?? ''].filter(Boolean).join(' ')}
                        role="button"
                        tabIndex={0}
                        data-testid={flowNode.type === 'note' ? 'flow-node-note-card' : 'flow-node-value-card'}
                        data-type={flowNode.type}
                        {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNode.id }}
                        {...dragProps}
                        onClick={event => (marking(event) ? onMark() : onOpen())}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                if (marking(event)) onMark(); else onOpen();
                                return;
                            }
                            onKeyDown(event);
                        }}
                    >
                        {flowNode.type === 'note' ? (
                            <div data-testid="flow-node-note-body">
                                {flowNode.note.trim()
                                    ? <ConfiguredMarkdown className={styles.noteBody}>{flowNode.note}</ConfiguredMarkdown>
                                    : <span>Empty note</span>}
                            </div>
                        ) : (
                            <div className={`${styles.cardTitle} ${styles.valueTitle}`}>
                                <DatabaseOutlined role="img" aria-label="Value"
                                    data-testid="flow-node-card-kind" data-type="value" />
                                <span>{flowNode.title || 'Untitled'}</span>
                            </div>
                        )}
                    </div>
                </Dropdown>
            </div>
        );
    }

    if (kind !== 'rect') {
        const circle = kind === 'event';
        const shapeClass = [
            circle ? styles.symbolEvent : styles.symbolGateway,
            circle && flowNode.type === 'shutdown' ? styles.symbolEventEnd : '',
        ].filter(Boolean).join(' ');
        return (
            // The node's menu and the canvas's are two menus on nested elements, and a right-click is one gesture: the node answers it.
            <div onContextMenu={event => event.stopPropagation()}>
                <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                    <div
                        className={[
                            styles.symbol,
                            selected ? styles.symbolSelected : '',
                            SYMBOL_RING[flowNode.status],
                            running ? styles.symbolPlaying : '',
                            chain?.target ? styles.symbolChainTarget : '',
                            cardClass ?? '',
                        ].filter(Boolean).join(' ')}
                        role="button"
                        tabIndex={0}
                        data-testid="flow-node-card"
                        data-status={flowNode.status}
                        data-shape={circle ? 'circle' : 'diamond'}
                        {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNode.id }}
                        {...dragProps}
                        onClick={event => (marking(event) ? onMark() : onOpen())}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                if (marking(event)) onMark();
                                else onOpen();
                                return;
                            }
                            onKeyDown(event);
                        }}
                    >
                        <div className={circle ? styles.symbolEventWrap : styles.symbolGatewayWrap}>
                            {symbolMark && (
                                <Tooltip title={MARK_HELP[flowNode.type]}>
                                    <div
                                        className={shapeClass}
                                        role="img"
                                        aria-label={MARK_HELP[flowNode.type]}
                                        data-testid="flow-node-card-kind"
                                        data-type={flowNode.type}
                                    >
                                        {circle ? symbolMark : (
                                            <span className={styles.symbolGatewayInner}>
                                                {symbolMark}
                                            </span>
                                        )}
                                    </div>
                                </Tooltip>
                            )}
                            {flowNode.type === 'scheduler' && playButton && (
                                <div className={styles.symbolPlay}>{playButton}</div>
                            )}
                            {chatMark}
                            {knob}
                        </div>
                        <div className={styles.symbolLabel}>
                            {flowNode.type !== 'scheduler' && (
                                <div className={styles.symbolTitle}>{flowNode.title || 'Untitled'}</div>
                            )}
                            {foot}
                        </div>
                    </div>
                </Dropdown>
            </div>
        );
    }

    return (
        // The card's menu and the canvas's are two menus on nested elements, and a right-click is one gesture: the card answers it.
        <div onContextMenu={event => event.stopPropagation()}>
            <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                <div
                    className={[
                        styles.card,
                        selected ? styles.cardSelected : '',
                        STATUS_BORDER[flowNode.status],
                        running ? styles.cardPlaying : '',
                        chain?.target ? styles.cardChainTarget : '',
                        cardClass ?? '',
                    ].filter(Boolean).join(' ')}
                    role="button"
                    tabIndex={0}
                    data-testid="flow-node-card"
                    data-status={flowNode.status}
                    {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNode.id }}
                    {...dragProps}
                    // Held down, Ctrl — Cmd where that is the key — makes the click a **mark** rather than an opening: the card joins the ones the next.
                    onClick={event => (marking(event) ? onMark() : onOpen())}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (marking(event)) onMark();
                            else onOpen();
                            return;
                        }
                        onKeyDown(event);
                    }}
                >
                    <div className={styles.cardTitle}>
                        {rectKindMark}
                        {flowNode.title || 'Untitled'}
                    </div>
                    {classRef}
                    {chipsRow}
                    {stateAndInteractions}
                    <TagChips labels={flowNode.tags} className={tagsClass} />
                </div>
            </Dropdown>
        </div>
    );
};
