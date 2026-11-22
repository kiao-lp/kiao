import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Spin, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Tooltip, useWorkerClient } from '@kiao-dashboard-core';
import type { RunnerIdentity } from 'kiao-worker';
import { NewRunnerDto, RunnerDto, RunnerPatchDto, useHybridflowClient } from '../service';
import { useRunners } from '../Runners-ctx';
import { formatLastSeen, lastSeenExact } from '../runnerSeen';
import styles from './RunnersPanel.module.css';

export const SEEN_HELP = 'Last heartbeat:';

export const DELETE_HELP = 'Nodes pinned to this runner need another runner, or none, before they can play.';

export const ITS_ME_HELP = 'Assigns this runner identity to the current machine so it can play nodes pinned here.';

export const ENV_PINNED_HELP = 'Runner identity is fixed by the service configuration.';

/**
 * How often the list reads itself again, unasked.
 * Last seen is a clock, and a panel left open would otherwise show "just now" about a runner.
 */
const SEEN_REFRESH_MS = 30_000;

/** One runner: its name, when it was last heard from, and whether it is this machine. */
const RunnerCard: React.FC<{
    runner: RunnerDto;

    me: RunnerIdentity | null;
    onPatch: (patch: RunnerPatchDto) => Promise<unknown>;
    onRemove: () => Promise<unknown>;
    onClaim: () => Promise<unknown>;
}> = ({ runner, me, onPatch, onRemove, onClaim }) => {
    const [name, setName] = useState(runner.name);
    const [claiming, setClaiming] = useState(false);
    useEffect(() => {
        setName(runner.name);
    }, [runner]);

    const commitName = () => {
        const wanted = name.trim();
        if (!wanted || wanted === runner.name) {
            setName(runner.name);
            return;
        }
        void onPatch({ name: wanted })
            .catch(cause => {
                message.error(`The runner could not be changed: ${cause instanceof Error ? cause.message : cause}`);
                setName(runner.name);
            });
    };

    const claim = () => {
        if (claiming) return;
        setClaiming(true);
        void onClaim()
            .catch(cause => message.error(
                `This machine could not be named ${runner.name}: ${cause instanceof Error ? cause.message : cause}`))
            .finally(() => setClaiming(false));
    };

    const isMe = me !== null && me.runnerId !== '' && me.runnerId === runner.id;
    const pinned = me !== null && me.source === 'env';

    return (
        <div className={styles.card} data-testid="runner-card">
            <div className={styles.cardRow}>
                <Input
                    size="small"
                    className={styles.grow}
                    value={name}
                    aria-label={`Name of ${runner.name}`}
                    data-testid="runner-name"
                    onChange={event => setName(event.target.value)}
                    onBlur={commitName}
                    onPressEnter={commitName}
                />
                <Popconfirm
                    title="Delete this runner?"
                    description="The tasks naming it keep naming it, and cannot be played until they name another."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                        void onRemove().catch(cause => message.error(
                            `The runner could not be deleted: ${cause instanceof Error ? cause.message : cause}`));
                    }}
                >
                    <Tooltip title={DELETE_HELP}>
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={`Delete ${runner.name}`}
                            data-testid="delete-runner"
                        />
                    </Tooltip>
                </Popconfirm>
            </div>
            <div className={styles.cardRow}>
                <Tooltip title={`${SEEN_HELP} ${lastSeenExact(runner.lastSeen)}`}>
                    <span className={styles.seen} data-testid="runner-last-seen">
                        {formatLastSeen(runner.lastSeen)}
                    </span>
                </Tooltip>
                {me !== null && (
                    <>
                        <span className={styles.spacer} />
                        {isMe ? (
                            <span className={styles.me} data-testid="runner-is-me">This machine</span>
                        ) : (
                            <Tooltip title={pinned ? ENV_PINNED_HELP : ITS_ME_HELP}>
                                <Button
                                    size="small"
                                    type="text"
                                    disabled={pinned || claiming}
                                    loading={claiming}
                                    onClick={claim}
                                    data-testid="its-me"
                                >
                                    It&apos;s me
                                </Button>
                            </Tooltip>
                        )}
                    </>
                )}
            </div>
            <span aria-label="Runner ID" className={styles.id}>{runner.id}</span>
        </div>
    );
};

/** The form a new runner is filed from, opened by the header's button. */
const RunnerCreator: React.FC<{
    onCreate: (runner: NewRunnerDto) => Promise<unknown>;
    onClose: () => void;
}> = ({ onCreate, onClose }) => {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const create = () => {
        const wanted = name.trim();
        if (!wanted || saving) return;
        setSaving(true);
        void onCreate({ name: wanted })
            .then(onClose)
            .catch(cause => message.error(
                `The runner could not be created: ${cause instanceof Error ? cause.message : cause}`))
            .finally(() => setSaving(false));
    };

    return (
        <div className={styles.card} data-testid="runner-creator">
            <Input
                autoFocus
                size="small"
                value={name}
                placeholder="What the machine is"
                aria-label="New runner name"
                data-testid="new-runner-name"
                onChange={event => setName(event.target.value)}
                onPressEnter={create}
            />
            <div className={styles.cardRow}>
                <span className={styles.spacer} />
                <Button size="small" onClick={onClose}>Cancel</Button>
                <Button size="small" type="primary" onClick={create}
                    disabled={!name.trim() || saving}
                    data-testid="create-runner">
                    Create
                </Button>
            </div>
        </div>
    );
};

/** The runners: the machines that play cards, kept in the hybridflow-store beside the boards. */
export const RunnersPanel: React.FC = () => {
    const client = useHybridflowClient();
    const files = useWorkerClient();
    const { runners, loading, error, reload, create, patch, remove } = useRunners();
    const [creating, setCreating] = useState(false);
    const [me, setMe] = useState<RunnerIdentity | null>(null);

    const refreshMe = useCallback(async () => {
        try {
            setMe(await files.getRunnerIdentity());
        } catch {
            setMe(null);
        }
    }, [files]);

    const refresh = useCallback(() => {
        void reload();
        void refreshMe();
    }, [reload, refreshMe]);

    useEffect(() => {
        if (!client) return;
        void refreshMe();
    }, [client, refreshMe]);

    // Last seen is a clock: the list reads itself again while it is open, so a runner that went quiet stops reading as just now without.
    useEffect(() => {
        if (!client) return undefined;
        const tick = setInterval(() => void refresh(), SEEN_REFRESH_MS);
        return () => clearInterval(tick);
    }, [client, refresh]);

    const claim = useCallback(async (id: string) => {
        await files.saveConfigJson('runner.json', { runnerId: id });
        await refreshMe();
    }, [files, refreshMe]);

    return (
        <div className={styles.panel} data-testid="runners-panel">
            <div className={styles.header}>
                <span className={styles.spacer} />
                <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    aria-label="Refresh runners"
                    onClick={() => void refresh()}
                />
                <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setCreating(true)}
                    disabled={!client || creating}
                    data-testid="new-runner"
                >
                    New runner
                </Button>
            </div>
            {!client ? (
                <Alert type="info" showIcon
                    message="No hybridflow store"
                    description={'This instance is not configured to reach one, so it has no runners to list. '
                        + 'The runners live in a database served by operation/hybridflow-store.'} />
            ) : error ? (
                <Alert type="error" showIcon
                    message="The runners could not be read"
                    description={error}
                    action={<Button size="small" onClick={() => void refresh()}>Try again</Button>} />
            ) : loading && runners.length === 0 ? (
                <div className={styles.center}><Spin size="small" /></div>
            ) : (
                <div className={styles.list}>
                    {creating && (
                        <RunnerCreator
                            onCreate={runner => create(runner)}
                            onClose={() => setCreating(false)}
                        />
                    )}
                    {runners.map(runner => (
                        <RunnerCard
                            key={runner.id}
                            runner={runner}
                            me={me}
                            onPatch={change => patch(runner.id, change)}
                            onRemove={() => remove(runner.id)}
                            onClaim={() => claim(runner.id)}
                        />
                    ))}
                    {!creating && runners.length === 0 && (
                        <p className={styles.hint}>
                            No runners yet. A runner is a machine that plays cards — what a task
                            picks when it is pinned to one, and "last seen" is when it was last
                            heard from.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};
