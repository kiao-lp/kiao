import React from 'react';
import { Dropdown, MenuProps } from 'antd';
import {
    BlockOutlined, ClusterOutlined, DeleteOutlined, ExportOutlined, FieldTimeOutlined, GroupOutlined,
    PoweroffOutlined, ScissorOutlined, ArrowRightOutlined,
} from '@ant-design/icons';
import { KEEP_MENU_IN_VIEWPORT, Tooltip } from '@kiao-dashboard-core';
import { useTagsUi } from '@kiao-dashboard-kit/capabilities';
import { FlowNodeClass, latestPublished } from '../flowNodeClass';
import { scheduleLabel } from '../flowNodeSchedule';
import { shortPermission } from '../flowNodeSettings';
import { TransitionMode } from '../flowNodeSuccess';
import { FlowNodeType } from '../flowNodeType';
import { symbolKindOf } from '../boardSpots';
import { FLOW_NODE_ID_ATTRIBUTE } from '../boardDom';
import { CHAIN_HELP, MARK_HELP } from './FlowNodeCard';
import styles from '../Hybridflow.module.css';

/** What the class card's right-click menu does. */
export interface FlowNodeClassMenuProps {
    onInstantiate: () => void;
    onOpen?: () => void;

    onClone: () => void;
    onDelete: () => void;

    deleting: number;

    moveTargets?: { slug: string; name: string }[];

    onMove?: (targetHandle: string) => void;

    moving?: number;

    onCreateWorkflowClass?: () => void;

    creating?: number;
}

/** What a class hands on to when its instances come back an answer, as the card's knob reads it out. */
export interface FlowNodeClassNextProps {
    title: string;
}

/** The card's knob, and what this card is party to while a chain is being drawn on the board. */
export interface FlowNodeClassChainProps {

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

interface NodeClassCardProps {
    flowNodeClass: FlowNodeClass;

    next: FlowNodeClassNextProps | null;

    chain: FlowNodeClassChainProps | null;

    selected: boolean;
    menu: FlowNodeClassMenuProps;
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

const marking = (event: { ctrlKey: boolean; metaKey: boolean }): boolean => event.ctrlKey || event.metaKey;

const MODE_GLYPH: Record<TransitionMode, React.ReactNode> = {
    continue: <ArrowRightOutlined />,
    end: <ScissorOutlined />,
};

/**
 * One node class: its title, the tags it is filed under, and the version its instances are made from.
 * A class is never played, so it carries no Play, no status and no chat — what it carries instead is.
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

    const kind = symbolKindOf(flowNodeClass.type);


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


    const knob = chain && (
        <Tooltip title={CHAIN_HELP}>
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
                    chain.source ? styles.chainKnobDrawing : '',
                ].filter(Boolean).join(' ')}
                role="presentation"
                aria-hidden="true"
                data-testid="flow-node-class-chain"
                data-mode={next ? mode : undefined}
                data-compact={flowNodeClass.onSuccess.compact ? 'true' : undefined}
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
            >
                {next && MODE_GLYPH[mode]}
            </span>
        </Tooltip>
    );

    const onMenuOpenChange = (open: boolean) => { if (open) menu.onOpen?.(); };

    const items: MenuProps['items'] = [
        { key: 'instantiate', icon: <ClusterOutlined />, label: 'Instantiate...', onClick: menu.onInstantiate },
        { key: 'clone', icon: <BlockOutlined />, label: 'Clone class', onClick: menu.onClone },
        ...((menu.onCreateWorkflowClass && (menu.creating ?? 0) > 0) ? [{
            key: 'create-workflow-class',
            icon: <GroupOutlined />,
            label: (menu.creating ?? 0) > 1 ? `Create workflow class (${menu.creating} classes)` : 'Create workflow class (1 class)',
            onClick: menu.onCreateWorkflowClass,
        }] : []),
        { type: 'divider' },
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

    if (kind !== 'rect') {
        const glyph = flowNodeClass.type === 'shutdown' ? <PoweroffOutlined /> : <FieldTimeOutlined />;
        const help = `Reusable class: ${MARK_HELP[flowNodeClass.type] ?? 'node'}`;
        return (
            <div onContextMenu={event => event.stopPropagation()}>
                <Dropdown menu={{ items }} trigger={['contextMenu']} onOpenChange={onMenuOpenChange} {...KEEP_MENU_IN_VIEWPORT}>
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
            <Dropdown menu={{ items }} trigger={['contextMenu']} onOpenChange={onMenuOpenChange} {...KEEP_MENU_IN_VIEWPORT}>
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
