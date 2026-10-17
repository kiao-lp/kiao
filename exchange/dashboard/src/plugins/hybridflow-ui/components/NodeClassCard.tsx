import React from 'react';
import { Dropdown, MenuProps } from 'antd';
import {
    BlockOutlined, ClusterOutlined, DeleteOutlined, ExportOutlined, FieldTimeOutlined, GroupOutlined,
    PoweroffOutlined, ScissorOutlined, ArrowRightOutlined,
} from '@ant-design/icons';
import { KEEP_MENU_IN_VIEWPORT, Tooltip } from '@cms-core';
import { useTagsUi } from '@cms-kit/capabilities';
import { FlowNodeClass, latestPublished } from '../flowNodeClass';
import { scheduleLabel } from '../flowNodeSchedule';
import { shortPermission } from '../flowNodeSettings';
import { TransitionMode } from '../flowNodeSuccess';
import { FlowNodeType } from '../flowNodeType';
import { symbolKindOf } from '../boardSpots';
import { FLOW_NODE_ID_ATTRIBUTE } from '../boardDom';
import { MODE_NOTE, CHAIN_HELP, MARK_HELP } from './FlowNodeCard';
import styles from '../Hybridflow.module.css';

/** What the class card's right-click menu does. */
export interface FlowNodeClassMenuProps {
    /**
     * Files a second class just like this one directly under it, and opens it. One class, marks
     * or no marks: the copy goes under the class the menu was opened on, which is the class the
     * gesture named.
     */
    onClone: () => void;
    onDelete: () => void;
    /**
     * How many classes the Delete takes: this one, or every marked card where this is one of
     * them. The item says so, because a menu offering to delete "the class" on a card plainly
     * picked out with four others is a menu that lies about what the click does.
     */
    deleting: number;
    /**
     * The other boards, as the "Move to..." submenu lists them — every board but this one, by
     * handle and name. Empty while they are being read, or where there is no other board.
     */
    moveTargets?: { slug: string; name: string }[];
    /** Files this class on the board of that handle — or every marked class, where this is one of them. */
    onMove?: (targetHandle: string) => void;
    /**
     * How many classes the Move takes. Said in the item the way the Delete says it — the
     * submenu names the board, and the item names how many classes are going.
     */
    moving?: number;
    /**
     * Files a workflow class round this class — or every marked class, where this is one
     * of them. Offered from one class up.
     */
    onCreateWorkflowClass?: () => void;
    /** How many classes the workflow class groups. Said in the item the way the Move says it. */
    creating?: number;
}

/** What a class hands on to when its instances come back an answer, as the card's knob reads it out. */
export interface FlowNodeClassNextProps {
    title: string;
}

/**
 * The card's knob, and what this card is party to while a chain is being drawn on the board. Null
 * where chains mean nothing at all, which is a build with no Claude Code in it.
 */
export interface FlowNodeClassChainProps {
    /** The knob's own pointer handlers: a chain is pulled from here — see `useLinkDrag`. */
    knobProps: {
        onPointerDown: React.PointerEventHandler<HTMLElement>;
        onPointerMove: React.PointerEventHandler<HTMLElement>;
        onPointerUp: React.PointerEventHandler<HTMLElement>;
        onPointerCancel: React.PointerEventHandler<HTMLElement>;
        onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    };
    /** The chain being drawn starts here. */
    source: boolean;
    /** The chain being drawn would land here. */
    target: boolean;
}

interface NodeClassCardProps {
    flowNodeClass: FlowNodeClass;
    /** The class after this one, or null where none is. */
    next: FlowNodeClassNextProps | null;
    /** The knob a chain is drawn from, or null where there is none to offer. */
    chain: FlowNodeClassChainProps | null;
    /** Drawn picked out: the class open in the panel, or a card **marked**. */
    selected: boolean;
    menu: FlowNodeClassMenuProps;
    onOpen: () => void;
    /** <kbd>Ctrl</kbd>-click: this card taken into the marked set, or back out of it. */
    onMark: () => void;
    onKeyDown: React.KeyboardEventHandler<HTMLElement>;
    /** What the card shows of a drag aimed at it. The drag itself starts anywhere on the card. */
    cardClass: string | undefined;
    dragProps: {
        onPointerDown: React.PointerEventHandler<HTMLElement>;
        onPointerMove: React.PointerEventHandler<HTMLElement>;
        onPointerUp: React.PointerEventHandler<HTMLElement>;
        onPointerCancel: React.PointerEventHandler<HTMLElement>;
        onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
    };
}

const marking = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => event.ctrlKey || event.metaKey;

const MODE_GLYPH: Record<TransitionMode, React.ReactNode> = {
    continue: <ArrowRightOutlined />,
    end: <ScissorOutlined />,
};

/**
 * One node class: its title, the tags it is filed under, and the version its instances are
 * made from. A class is never played, so it carries no Play, no status and no chat — what it
 * carries instead is the succession: which version is the latest published one, and how many
 * past versions it keeps.
 *
 * Drawn with a bolder dotted border, which is what tells it from a card at a glance: a class
 * is the shape of work, not the work. A Shutdown or a Scheduler class is drawn as a BPMN event's
 * circle instead, with a dotted ring — the label under it is the card's own. Clicking it opens
 * the class in its panel; right-clicking it moves it to another board, or deletes it. A mouse
 * press anywhere on it, held and pulled, moves it across the canvas (`useSpotDrag`) — and the
 * knob keeps the presses that draw a chain.
 */
export const NodeClassCard: React.FC<NodeClassCardProps> = ({
    flowNodeClass, next, chain, selected, menu, onOpen, onMark, onKeyDown, cardClass, dragProps,
}) => {
    const { TagChips } = useTagsUi();
    const mode = flowNodeClass.onSuccess.mode;
    const published = latestPublished(flowNodeClass);
    const drafts = flowNodeClass.versions.filter(version => version.status === 'draft').length;

    const chips: string[] = [];
    if (flowNodeClass.type === 'ai') {
        if (flowNodeClass.permission) chips.push(shortPermission(flowNodeClass.permission));
        if (flowNodeClass.runner) chips.push('pinned');
    }
    if (flowNodeClass.type === 'scheduler') {
        const when = scheduleLabel(flowNodeClass.at, flowNodeClass.duration);
        chips.push(when || 'no datetime');
    }

    const chainNote = [
        next ? `Next: “${next.title || 'Untitled'}” · ${MODE_NOTE[mode]}.` : '',
        flowNodeClass.onSuccess.compact ? 'Chat shortened.' : '',
    ].filter(Boolean).join(' ');

    // What shape the class is drawn as: a card for the two kinds of work, a BPMN circle for a
    // Shutdown or a Scheduler.
    const kind = symbolKindOf(flowNodeClass.type);

    /**
     * Everything under the title: the tags, the succession, and the bubbles. The card's rows and
     * the symbol's label are the same rows — only the tags' alignment differs, centred under a
     * shape.
     */
    const foot = (
        <>
            <TagChips
                labels={flowNodeClass.tags}
                className={kind === 'rect' ? styles.cardTags : styles.symbolTags}
            />
            <div className={styles.cardState} data-testid="flow-node-class-version">
                {published
                    ? `v${published.number} published`
                    : 'no published version'}
                {drafts > 0 && ` · ${drafts} draft${drafts > 1 ? 's' : ''}`}
            </div>
            {chips.length > 0 && (
                <div className={styles.cardChips} data-testid="flow-node-class-settings">
                    {chips.map((chip, slot) => (
                        <span
                            key={slot}
                            className={styles.cardChip}
                            data-testid="flow-node-class-chip"
                        >
                            {chip}
                        </span>
                    ))}
                </div>
            )}
        </>
    );

    /**
     * The knob a chain is drawn from. At the card's bottom-right corner, or at the symbol's shape
     * edge — the same handle and the same tooltip, only the seat differs.
     */
    const knob = chain && (
        <span
            {...chain.knobProps}
            // The card underneath starts a move, and a press meant for
            // the knob draws a chain instead.
            onPointerDown={event => {
                chain.knobProps.onPointerDown(event);
                event.stopPropagation();
            }}
            className={[
                styles.chainKnob,
                kind === 'rect' ? '' : styles.symbolKnob,
                next ? styles.chainKnobTied : '',
                chain.source ? styles.chainKnobDrawing : '',
            ].filter(Boolean).join(' ')}
            role="presentation"
            aria-hidden="true"
            title={[chainNote, CHAIN_HELP].filter(Boolean).join(' ')}
            data-testid="flow-node-class-chain"
            data-mode={next ? mode : undefined}
            data-compact={flowNodeClass.onSuccess.compact ? 'true' : undefined}
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
        >
            {next && MODE_GLYPH[mode]}
        </span>
    );

    const items: MenuProps['items'] = [
        // First: the copy of this class on the board already open — the one wanted here rather
        // than on another board, which is what the Move below is for.
        { key: 'clone', icon: <BlockOutlined />, label: 'Clone class', onClick: menu.onClone },
        // Beside the Clone: the rectangle round the marked set, from one class up.
        ...((menu.onCreateWorkflowClass && (menu.creating ?? 0) > 0) ? [{
            key: 'create-workflow-class',
            icon: <GroupOutlined />,
            label: (menu.creating ?? 0) > 1 ? `Create workflow class (${menu.creating} classes)` : 'Create workflow class (1 class)',
            onClick: menu.onCreateWorkflowClass,
        }] : []),
        { type: 'divider' },
        // Before the Delete, which is the way off the board: this one files the classes on
        // another board instead, through the service. The count reads the way the Delete's
        // does, for the same reason — the submenu names the board, and the item names how
        // many classes are going.
        {
            key: 'move',
            icon: <ExportOutlined />,
            label: (menu.moving ?? menu.deleting) > 1
                ? `Move ${menu.moving ?? menu.deleting} classes to...`
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
            key: 'delete',
            icon: <DeleteOutlined />,
            label: menu.deleting > 1 ? `Delete ${menu.deleting} classes` : 'Delete class',
            danger: true,
            onClick: menu.onDelete,
        },
    ];

    // A Shutdown or a Scheduler class: a BPMN event's circle with a dotted ring, the label
    // under it the card's own.
    if (kind !== 'rect') {
        const glyph = flowNodeClass.type === 'shutdown' ? <PoweroffOutlined /> : <FieldTimeOutlined />;
        const help = `${MARK_HELP[flowNodeClass.type] ?? 'A node class'} — as a reusable class`;
        return (
            <div onContextMenu={event => event.stopPropagation()}>
                <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                    <div
                        className={[
                            styles.symbol,
                            styles.symbolClass,
                            selected ? styles.symbolSelected : '',
                            chain?.target ? styles.symbolChainTarget : '',
                            cardClass ?? '',
                        ].filter(Boolean).join(' ')}
                        role="button"
                        tabIndex={0}
                        data-testid="flow-node-class-card"
                        data-type={flowNodeClass.type}
                        data-shape="circle"
                        {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNodeClass.id }}
                        // The whole symbol is the drag's handle, the way the whole card is: a
                        // mouse press anywhere on it starts a move, and the knob keeps the
                        // presses that draw a chain.
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
                        <div className={styles.symbolEventWrap}>
                            <Tooltip title={help}>
                                <span
                                    className={[
                                        styles.symbolEvent,
                                        flowNodeClass.type === 'shutdown' ? styles.symbolEventEnd : '',
                                    ].filter(Boolean).join(' ')}
                                    role="img"
                                    aria-label={help}
                                    data-testid="flow-node-class-kind"
                                    data-type={flowNodeClass.type as FlowNodeType}
                                >
                                    {glyph}
                                </span>
                            </Tooltip>
                            {knob}
                        </div>
                        <div className={styles.symbolLabel}>
                            {flowNodeClass.type !== 'scheduler' && (
                                <div className={styles.symbolTitle}>{flowNodeClass.title || 'Untitled'}</div>
                            )}
                            {foot}
                        </div>
                    </div>
                </Dropdown>
            </div>
        );
    }

    return (
        <div onContextMenu={event => event.stopPropagation()}>
            <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
                <div
                    className={[
                        styles.card,
                        styles.cardClass,
                        selected ? styles.cardSelected : '',
                        chain?.target ? styles.cardChainTarget : '',
                        cardClass ?? '',
                    ].filter(Boolean).join(' ')}
                    role="button"
                    tabIndex={0}
                    data-testid="flow-node-class-card"
                    data-type={flowNodeClass.type}
                    {...{ [FLOW_NODE_ID_ATTRIBUTE]: flowNodeClass.id }}
                    // The whole card is the drag's handle: a mouse press anywhere on it starts
                    // a move, and the knob below keeps the presses that draw a chain.
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
                    <div className={styles.cardTitle}>
                        <Tooltip title="A node class — the reusable shape of work, never played itself">
                            <span
                                className={styles.cardKind}
                                role="img"
                                aria-label="Node class"
                                data-testid="flow-node-class-kind"
                                data-type={flowNodeClass.type as FlowNodeType}
                            >
                                <ClusterOutlined />
                            </span>
                        </Tooltip>
                        {flowNodeClass.title || 'Untitled'}
                    </div>
                    {foot}
                    {knob}
                </div>
            </Dropdown>
        </div>
    );
};
