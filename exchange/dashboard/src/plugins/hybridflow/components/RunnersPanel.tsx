import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { AsyncList, CommitInput, IconButton, InProgressFeedback, Tooltip, useWorkerClient, useConfirmation } from '@kiao-dashboard-core';
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
    claimingRunner: string | null;
    onPatch: (patch: RunnerPatchDto) => Promise<unknown>;
    onRemove: () => Promise<unknown>;
    onClaim: () => Promise<unknown>;
}> = ({ runner, me, claimingRunner, onPatch, onRemove, onClaim }) => {
    const confirm = useConfirmation();
    const [name, setName] = useState(runner.name);
    const [operation, setOperation] = useState<'rename' | 'delete' | null>(null);
    const writing = useRef(false);
    const claiming = claimingRunner === runner.id;
    const busy = operation !== null || claiming;
    useEffect(() => {
        setName(runner.name);
    }, [runner.name]);

    const write = async (kind: 'rename' | 'delete', run: () => Promise<unknown>) => {
        if (writing.current || claiming) return;
        writing.current = true;
        setOperation(kind);
        try {
            await run();
        } catch (cause) {
            message.error(`The runner could not be ${kind === 'rename' ? 'changed' : 'deleted'}: ${cause instanceof Error ? cause.message : cause}`);
            if (kind === 'rename') setName(runner.name);
        } finally {
            writing.current = false;
            setOperation(null);
        }
    };

    const commitName = (value: string) => {
        if (writing.current || claiming) return;
        const wanted = value.trim();
        if (!wanted || wanted === runner.name) {
            setName(runner.name);
            return;
        }
        void write('rename', () => onPatch({ name: wanted }));
    };

    const claim = () => {
        void onClaim()
            .catch(cause => message.error(
                `This machine could not be named ${runner.name}: ${cause instanceof Error ? cause.message : cause}`));
    };

    const isMe = me !== null && me.runnerId !== '' && me.runnerId === runner.id;
    const pinned = me !== null && me.source === 'env';

    return (
        <div className={styles.card} data-testid="runner-card">
            <div className={styles.cardRow}>
                <CommitInput
                    className={styles.grow}
                    value={name}
                    aria-label={`Name of ${runner.name}`}
                    data-testid="runner-name"
                    disabled={busy}
                    onDraftChange={setName}
                    onCommit={commitName}
                />
                <IconButton
                    label={`Delete ${runner.name}`}
                    tooltip={DELETE_HELP}
                    danger
                    icon={<DeleteOutlined />}
                    disabled={busy}
                    data-testid="delete-runner"
                    onClick={() => confirm({
                        title: `Delete runner “${runner.name}”?`,
                        description: 'The tasks naming it keep naming it, and cannot be played until they name another.',
                        onConfirm: () => write('delete', onRemove),
                    })}
                />
            </div>
            {operation === 'rename' && <InProgressFeedback label="Saving runner name…" />}
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
                                    disabled={pinned || claimingRunner !== null || operation !== null}
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
    const submitting = useRef(false);

    const create = () => {
        const wanted = name.trim();
        if (!wanted || submitting.current) return;
        submitting.current = true;
        setSaving(true);
        void onCreate({ name: wanted })
            .then(onClose)
            .catch(cause => message.error(
                `The runner could not be created: ${cause instanceof Error ? cause.message : cause}`))
            .finally(() => {
                submitting.current = false;
                setSaving(false);
            });
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
                disabled={saving}
                onChange={event => setName(event.target.value)}
                onPressEnter={create}
            />
            <div className={styles.cardRow}>
                <span className={styles.spacer} />
                <Button size="small" disabled={saving} onClick={onClose}>Cancel</Button>
                <Button size="small" type="primary" onClick={create}
                    disabled={!name.trim() || saving}
                    loading={saving} aria-label="Create" aria-busy={saving}
                    data-testid="create-runner">
                    Create
                </Button>
            </div>
        </div>
    );
};

/** The runners: the machines that play flow nodes, kept in the hybridflow-store beside the boards. */
export const RunnersPanel: React.FC = () => {
    const client = useHybridflowClient();
    const files = useWorkerClient();
    const { runners, loading, error, reload, create, patch, remove } = useRunners();
    const [creating, setCreating] = useState(false);
    const [me, setMe] = useState<RunnerIdentity | null>(null);
    const [claimingRunner, setClaimingRunner] = useState<string | null>(null);
    const claiming = useRef(false);
    const identityRead = useRef(0);

    const refreshMe = useCallback(async () => {
        const read = ++identityRead.current;
        try {
            const identity = await files.getRunnerIdentity();
            if (read === identityRead.current) setMe(identity);
        } catch {
            if (read === identityRead.current) setMe(null);
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
        if (claiming.current) return;
        claiming.current = true;
        setClaimingRunner(id);
        try {
            await files.saveConfigJson('runner.json', { runnerId: id });
            await refreshMe();
        } finally {
            claiming.current = false;
            setClaimingRunner(null);
        }
    }, [files, refreshMe]);

    return (
        <div className={styles.panel} data-testid="runners-panel">
            <div className={styles.header}>
                <span className={styles.spacer} />
                <IconButton
                    label="Refresh runners"
                    icon={<ReloadOutlined />}
                    loading={loading} disabled={!client || loading} aria-busy={loading}
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
                    title="No hybridflow store"
                    description={'This instance is not configured to reach one, so it has no runners to list. '
                        + 'The runners live in a database served by operation/hybridflow-store.'} />
            ) : (
                <AsyncList loading={loading && !runners.length} error={error} errorTitle="The runners could not be read"
                    onRetry={refresh} retrying={loading}
                    empty={!creating && !runners.length && ('No runners yet. A runner is a machine that plays flow nodes — '
                        + 'what a task picks when it is pinned to one, and "last seen" is when it was last heard from.')}>
                    <div className={styles.list}>
                        {creating && <RunnerCreator onCreate={create} onClose={() => setCreating(false)} />}
                        {runners.map(runner => (
                            <RunnerCard
                                key={runner.id}
                                runner={runner}
                                me={me}
                                claimingRunner={claimingRunner}
                                onPatch={change => patch(runner.id, change)}
                                onRemove={() => remove(runner.id)}
                                onClaim={() => claim(runner.id)}
                            />
                        ))}
                    </div>
                </AsyncList>
            )}
        </div>
    );
};
