import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Spin, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Tooltip, useWorkerClient } from '@cms-core';
import type { RunnerIdentity } from 'kiao-worker';
import { NewRunnerDto, RunnerDto, RunnerPatchDto, useHybridflowClient } from '../service';
import { useRunners } from '../Runners-ctx';
import { formatLastSeen, lastSeenExact } from '../runnerSeen';
import styles from './RunnersPanel.module.css';

export const NAME_HELP = 'What the task editor shows in its select. Unique across the store — two runners '
    + 'called the same thing would be two rows nobody can tell apart.';

export const SEEN_HELP = 'When this runner last said it was alive. Every runner calls the store '
    + 'every fifteen seconds; one gone quiet is a machine down, or a service stopped.';

export const DELETE_HELP = 'Delete this runner. The tasks naming it keep naming it, and cannot be played '
    + 'until they name another — or none, which is played anywhere.';

export const ITS_ME_HELP = 'Name this machine that runner: the service behind this page beats as it '
    + 'from its next heartbeat, and plays the cards pinned to it.';

export const ENV_PINNED_HELP = 'This service names its runner in KIAO_WORKER_RUNNER_ID, which wins '
    + 'over the file for the life of the process — the button stays off until the export goes.';

/**
 * How often the list reads itself again, unasked. Last seen is a clock, and a panel left open
 * would otherwise show "just now" about a runner that went quiet an hour ago.
 */
const SEEN_REFRESH_MS = 30_000;

/** One runner: its name, when it was last heard from, and whether it is this machine. */
const RunnerCard: React.FC<{
    runner: RunnerDto;
    /** Which runner this machine is, or null where the service predates the question. */
    me: RunnerIdentity | null;
    onPatch: (patch: RunnerPatchDto) => Promise<unknown>;
    onRemove: () => Promise<unknown>;
    onClaim: () => Promise<unknown>;
}> = ({ runner, me, onPatch, onRemove, onClaim }) => {
    // Held while typed, so a name on its way to being another name is not written as each of the
    // names it passes through.
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
    // An environment export wins over the file the button would write, so offering the write
    // would be offering one that changes nothing.
    const pinned = me !== null && me.source === 'env';

    return (
        <div className={styles.card} data-testid="runner-card">
            <div className={styles.cardRow}>
                <Tooltip title={NAME_HELP}>
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
                </Tooltip>
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
            <Tooltip title="The id tasks name">
                <span className={styles.id}>{runner.id}</span>
            </Tooltip>
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

/**
 * The runners: the machines that play cards, kept in the hybridflow-store beside the boards.
 *
 * It is the one place a runner is **filed, renamed and thrown away**, and the one place that says
 * which of them are up: every runner calls the store every fifteen seconds, and the list reads
 * itself again twice a minute so that "last seen" is a clock rather than a line read once.
 *
 * It is also where this machine is named one of them: the runner the service behind this page
 * beats as reads "this machine", and every other offers "it's me" — a write of `runner.json` to
 * that service's state directory, adopted on its next heartbeat. Where the service predates the
 * question, neither shows: a button whose write would land nowhere is worse than none.
 *
 * What a task picks in its editor is one of these, by the id under its last seen — so pinning the
 * cards about the home NAS to the home desktop is one pick per card rather than one deployment
 * each. There is no Save button, as everywhere else in this CMS: every change is a write to the
 * hybridflow-store.
 */
export const RunnersPanel: React.FC = () => {
    const client = useHybridflowClient();
    const files = useWorkerClient();
    const { runners, loading, error, reload, create, patch, remove } = useRunners();
    const [creating, setCreating] = useState(false);
    // Which runner this machine is — null while unknown, which is also a service that predates
    // the endpoint: the answer and the document arrived together, so nothing known means nothing
    // offered rather than a button whose write would land nowhere.
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

    // Last seen is a clock: the list reads itself again while it is open, so a runner that went
    // quiet stops reading as just now without anybody pressing refresh — and so does which runner
    // this machine is, which another tab may have pressed "it's me" on since.
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
                <Tooltip title="Read the runners again">
                    <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        aria-label="Refresh runners"
                        onClick={() => void refresh()}
                    />
                </Tooltip>
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
