import React, { useCallback, useMemo, useState } from 'react';
import { Button, Empty } from 'antd';
import {
    ClockCircleOutlined, DeleteOutlined, DownOutlined, LoadingOutlined, MessageOutlined,
    PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, RightOutlined, StopOutlined,
} from '@ant-design/icons';
import { useNavigation, Tooltip } from '@kiao-dashboard-core';
import { useChatRun, useShowChat } from '@kiao-dashboard-kit/capabilities';
import type { HarnessRun, HarnessRunFlowNode } from '@kiao-dashboard-kit/capabilities';
import { readStatus, STATUS_LABELS } from '../flowNodeStatus';
import { retryClock } from '../usePlayFlowNode';
import { boardUrl } from '../boardRoute';
import styles from './HybridflowPanel.module.css';

/** Chain runs tree. */

/** State labels; `ended` uses the ending text instead. */
const STATE_WORDS: Record<string, string> = {
    playing: 'Playing',
    compacting: 'Shortening the chat',
    waiting: 'Waiting to try again',
    refreshing: 'Held by the usage limit',
    scheduled: 'Waiting for the hour',
    stopping: 'Stopping after this node',
    suspended: 'Stopped in its chat',
    ended: 'Ended',
};

/** Icon for run state. */
const stateGlyph = (state: string): React.ReactNode => {
    switch (state) {
        case 'playing':
        case 'compacting':
            return <LoadingOutlined />;
        case 'waiting':
        case 'refreshing':
        case 'scheduled':
            return <ClockCircleOutlined />;
        case 'stopping':
            return <StopOutlined />;
        case 'suspended':
            return <PauseCircleOutlined />;
        default:
            return <PlayCircleOutlined />;
    }
};

/** The second line of a run's row: what it is doing, and when it goes back in where it is waiting. */
const runNote = (run: HarnessRun): string => {
    if (run.state === 'ended') return run.ending || 'Ended';
    const words = STATE_WORDS[run.state] ?? run.state;
    if ((run.state === 'waiting' || run.state === 'refreshing') && run.retryAt) {
        return `${words} — back at ${retryClock(run.retryAt)}`;
    }
    return words;
};

const FlowNodeRow: React.FC<{ flowNode: HarnessRunFlowNode }> = ({ flowNode }) => {
    const gone = !flowNode.status;
    const status = readStatus(flowNode.status);
    return (
        <div
            className={`cms-nav-tree-row ${styles.flowNodeRow}`}
            style={{ paddingLeft: 4 + 16 }}
            role="treeitem"
            aria-level={2}
            data-testid={`chain-run-flow-node-${flowNode.id}`}
            data-current={flowNode.current || undefined}
        >
            <span className="cms-nav-tree-switcher" aria-hidden="true">
                {flowNode.current ? <RightOutlined /> : null}
            </span>
            <span className={`cms-nav-tree-label ${styles.flowNodeTitle}`} title={flowNode.title || 'Untitled'}>
                {flowNode.title || 'Untitled'}
            </span>
            <span
                className={styles.flowNodeStatus}
                data-status={gone ? undefined : status}
                data-testid={`chain-run-flow-node-status-${flowNode.id}`}
            >
                {gone ? 'Off the board' : STATUS_LABELS[status]}
            </span>
        </div>
    );
};

interface RunRowProps {
    run: HarnessRun;
    expanded: boolean;
    onToggle: () => void;
}

const RunRow: React.FC<RunRowProps> = ({ run, expanded, onToggle }) => {
    const { stop, resume, restart, forget } = useChatRun();
    const showChat = useShowChat();
    const nav = useNavigation();
    const flowNodes = run.flowNodes ?? [];
    const live = run.state !== 'ended';

    return (
        <>
            <div
                className={`cms-nav-tree-row ${styles.runRow}`}
                style={{ paddingLeft: 4 }}
                role="treeitem"
                aria-level={1}
                aria-expanded={flowNodes.length > 0 ? expanded : undefined}
                data-testid={`chain-run-${run.id}`}
                data-state={run.state}
            >
                <span
                    className="cms-nav-tree-switcher"
                    onClick={flowNodes.length ? onToggle : undefined}
                    data-testid={`chain-run-toggle-${run.id}`}
                    aria-hidden={flowNodes.length === 0}
                >
                    {flowNodes.length > 0 && (expanded ? <DownOutlined /> : <RightOutlined />)}
                </span>
                <span className={styles.runGlyph} data-state={run.state} aria-hidden="true">
                    {stateGlyph(run.state)}
                </span>

                <span
                    className={`cms-nav-tree-label ${styles.runName}`}
                    title={`${run.name} — ${run.path}`}
                    onClick={() => nav.open(boardUrl(run.path))}
                    data-testid={`chain-run-open-${run.id}`}
                >
                    <span className={styles.runTitle}>{run.name}</span>
                    <span className={styles.runNote} data-state={run.state}>{runNote(run)}</span>
                </span>
                <span className={styles.runActions}>
                    {run.chat && (
                        <Button
                            type="text"
                            size="small"
                            icon={<MessageOutlined />}
                            aria-label={`Open the chat of ${run.name}`}
                            data-testid={`chain-run-chat-${run.id}`}
                            onClick={() => showChat(run.chat)}
                        />
                    )}
                    {run.state === 'suspended' && (
                        <Tooltip title="Carry on — the node it stopped on is played again in its chat">
                            <Button
                                type="text"
                                size="small"
                                icon={<PlayCircleOutlined />}
                                aria-label={`Resume ${run.name}`}
                                data-testid={`chain-run-resume-${run.id}`}
                                onClick={() => resume(run.id)}
                            />
                        </Tooltip>
                    )}
                    {live && (
                        <Tooltip title="Stop — the node under way is finished and marked, and nothing after it starts">
                            <Button
                                type="text"
                                size="small"
                                icon={<StopOutlined />}
                                aria-label={`Stop ${run.name}`}
                                data-testid={`chain-run-stop-${run.id}`}
                                onClick={() => stop(run.id)}
                            />
                        </Tooltip>
                    )}
                    {!live && (
                        <>
                            <Tooltip title="Play it again, from the card it started on">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ReloadOutlined />}
                                    aria-label={`Restart ${run.name}`}
                                    data-testid={`chain-run-restart-${run.id}`}
                                    onClick={() => restart(run.id)}
                                />
                            </Tooltip>
                            <Button
                                type="text"
                                size="small"
                                icon={<DeleteOutlined />}
                                aria-label={`Forget ${run.name}`}
                                data-testid={`chain-run-forget-${run.id}`}
                                onClick={() => forget(run.id)}
                            />
                        </>
                    )}
                </span>
            </div>
            <div className={styles.runBoard} style={{ paddingLeft: 24 }} aria-hidden="true">
                {run.path}
            </div>
            {expanded && flowNodes.map(flowNode => <FlowNodeRow key={flowNode.id} flowNode={flowNode} />)}
        </>
    );
};

export const HybridflowPanel: React.FC = () => {
    const { runs } = useChatRun();
    const [open, setOpen] = useState<Record<string, boolean>>({});

    // The click is given what the row is showing rather than what the record says, because most rows are in neither state yet: a live.
    const toggle = useCallback((id: string, was: boolean) => {
        setOpen(current => ({ ...current, [id]: !was }));
    }, []);

    const ordered = useMemo(() => [...runs].reverse(), [runs]);

    if (!ordered.length) {
        return (
            <div className={styles.panel} data-testid="chain-runs-panel">
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No chain run has been played yet. Press a card’s Play button to start one."
                />
            </div>
        );
    }

    return (
        <div className={`${styles.panel} cms-nav-tree`} role="tree" data-testid="chain-runs-panel">
            {ordered.map(run => {
                const expanded = open[run.id] ?? run.state !== 'ended';
                return (
                    <RunRow
                        key={run.id}
                        run={run}
                        expanded={expanded}
                        onToggle={() => toggle(run.id, expanded)}
                    />
                );
            })}
        </div>
    );
};
