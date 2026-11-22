import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Button, Input, Select, message } from 'antd';
import { Tooltip } from '@kiao-dashboard-core';
import { useHarnessOptions } from '../../useHarnessOptions';
import { useResourceClient } from '../Client-ctx';
import type { AgentDependencyKind, AgentPatchDto, AgentVersionDto, NewAgentDto } from '../types';
import type { ReleaseBump } from '../release';
import { useAgents } from '../Agents-ctx';
import { AgentDependenciesField } from './AgentDependenciesField';
import { PublishButtons } from './PublishButtons';
import { confirmAgentPush } from './confirmAgentPush';
import styles from './AgentEditorPanel.module.css';

/** Panel id for the agent editor. */
export const AGENT_EDITOR_PANEL_ID = 'agent-editor';

export const HARNESS_HELP = 'The execution engine; it must be available on the runner.';

export const INSTRUCTIONS_HELP = 'Standing instructions included with every turn.';

export const DELETE_HELP = 'Delete the local clone. Tasks keep the reference for reinstalling or choosing another agent.';

/** Also list harnesses that can be configured on another runner. */
const FALLBACK_HARNESSES = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'muse', label: 'Muse' },
    { value: 'pi', label: 'Pi (Harness)' },
];

/** Harnesses and models offered by the local runner. */
export const useAgentCatalogue = () => {
    const { harnesses: offered, optionsFor } = useHarnessOptions();
    return useMemo(() => {
        const harnesses = [...offered.map(entry => ({ value: entry.value, label: entry.label })),
            ...FALLBACK_HARNESSES.filter(one => !offered.some(entry => entry.value === one.value))];
        const profilesFor = (harness: string) => optionsFor(harness).profiles ?? [];
        const needsProfile = (harness: string) => optionsFor(harness).profiles !== undefined || harness === 'pi';
        const modelsFor = (harness: string, profileId?: string) => (profilesFor(harness).find(one => one.id === profileId)?.models ?? optionsFor(harness).models)
            .map(model => ({ value: model.value, label: model.label }));
        const harnessLabelOf = (harness: string) =>
            harnesses.find(entry => entry.value === harness)?.label ?? harness;
        return { harnesses, modelsFor, harnessLabelOf, profilesFor, needsProfile };
    }, [offered, optionsFor]);
};

/** Agent editor panel. */
export const AgentEditorPanel: React.FC<{ agentId: string }> = ({ agentId }) => {
    const { agents, error, reload, patch, publish } = useAgents();
    const client = useResourceClient();
    const agent = agents.find(one => one.id === agentId) ?? null;
    const { harnesses, modelsFor, profilesFor, needsProfile, harnessLabelOf } = useAgentCatalogue();

    const [name, setName] = useState(agent?.name ?? '');
    const [model, setModel] = useState(agent?.model ?? '');
    const [description, setDescription] = useState(agent?.description ?? '');
    const [instructions, setInstructions] = useState(agent?.instructions ?? '');
    const [versions, setVersions] = useState<AgentVersionDto[]>([]);
    const [selectedVersion, setSelectedVersion] = useState('draft');
    const [checkingPublication, setCheckingPublication] = useState(true);
    const [publishingBump, setPublishingBump] = useState<ReleaseBump | null>(null);
    const publishing = publishingBump !== null;
    const [savingDependency, setSavingDependency] = useState<AgentDependencyKind | null>(null);
    const [localDependencies, setLocalDependencies] = useState({ skills: false, mcp: false });
    const updateLocalDependencies = useCallback((kind: AgentDependencyKind, hasLocal: boolean) => {
        setLocalDependencies(current => current[kind] === hasLocal ? current : { ...current, [kind]: hasLocal });
    }, []);
    const writing = useRef<Promise<boolean> | null>(null);
    const pending = useRef<AgentPatchDto>({});
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const flushPending = useRef<() => Promise<boolean>>(async () => true);
    useEffect(() => {
        const flush = () => { void flushPending.current(); };
        window.addEventListener('beforeunload', flush);
        return () => { window.removeEventListener('beforeunload', flush); flush(); };
    }, []);
    useEffect(() => {
        let current = true;
        void reload().then(() => { if (current) setCheckingPublication(false); });
        return () => { current = false; };
    }, [reload]);
    useEffect(() => {
        let current = true;
        if (client) void client.agentVersions(agentId).then(list => { if (current) setVersions(list); })
            .catch(cause => { if (current) message.error(String(cause)); });
        return () => { current = false; };
    }, [client, agentId, agent?.published?.version]);
    useEffect(() => {
        if (!('name' in pending.current)) setName(agent?.name ?? '');
    }, [agent?.name]);
    useEffect(() => {
        if (!('model' in pending.current)) setModel(agent?.model ?? '');
    }, [agent?.model]);
    useEffect(() => {
        if (!('description' in pending.current)) setDescription(agent?.description ?? '');
    }, [agent?.description]);
    useEffect(() => {
        if (!('instructions' in pending.current)) setInstructions(agent?.instructions ?? '');
    }, [agent?.instructions]);

    const offered = useMemo(() => {
        if (!agent) return harnesses;
        if (harnesses.some(entry => entry.value === agent.harness)) return harnesses;
        return [...harnesses, { value: agent.harness, label: agent.harness }];
    }, [harnesses, agent]);

    if (!agent) {
        return <div className={styles.hint}>That agent is gone from the store.</div>;
    }

    const commit = async (change: AgentPatchDto, revert: () => void) => {
        for (const key of Object.keys(change) as (keyof AgentPatchDto)[]) delete pending.current[key];
        if (Object.keys(pending.current).length === 0) clearTimeout(timer.current);
        const saving = Promise.resolve(writing.current).then(async () => {
            try {
                await patch(agent.id, change);
                return true;
            } catch (cause) {
                message.error(`The agent could not be changed: ${cause instanceof Error ? cause.message : cause}`);
                revert();
                return false;
            }
        });
        writing.current = saving;
        try {
            return await saving;
        } finally {
            if (writing.current === saving) writing.current = null;
        }
    };

    flushPending.current = async () => {
        clearTimeout(timer.current);
        const change = pending.current;
        pending.current = {};
        return Object.keys(change).length === 0 ? (writing.current ?? true) : commit(change, () => {});
    };
    const schedule = (change: AgentPatchDto) => {
        pending.current = { ...pending.current, ...change };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { void flushPending.current(); }, 1000);
    };

    const hasLocalDependencies = localDependencies.skills || localDependencies.mcp;
    const canPublish = !checkingPublication && !error && agent.hasUnpublishedChanges && !!agent.version && !agent.draftError
        && selectedVersion === 'draft' && !publishing && !savingDependency && !hasLocalDependencies;

    const publishDraft = async (bump: ReleaseBump) => {
        if (!canPublish) return;
        setPublishingBump(bump);
        try {
            if (await flushPending.current()) await confirmAgentPush(confirmation => publish(agent.id, bump, confirmation));
        } catch (cause) {
            message.error(`The agent could not be published: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setPublishingBump(null);
        }
    };

    const historical = versions.find(version => version.version === selectedVersion);

    const commitName = () => {
        const wanted = name.trim();
        if (!wanted || wanted === agent.name) {
            setName(agent.name);
            return;
        }
        void commit({ name: wanted }, () => setName(agent.name));
    };

    return (
        <div className={styles.editor} data-testid="agent-editor">
            <div className={styles.row}>
                <Select aria-label="Agent version" value={selectedVersion} onChange={setSelectedVersion} disabled={!!savingDependency || publishing}
                    options={[{ value: 'draft', label: agent.published?.version ? 'Draft' : 'Unpublished draft' },
                        ...versions.flatMap(({ version }) => version ? [{ value: version, label: `Published v${version}` }] : [])]} />
                <PublishButtons version={agent.version} disabled={!canPublish} publishing={publishingBump}
                    onPublish={bump => void publishDraft(bump)} />
            </div>
            <p className={styles.meta}>{agent.repository}</p>
            {agent.draftError && <p role="alert">Repair the APM source in Agentic resources: {agent.draftError}</p>}
            {selectedVersion === 'draft' && hasLocalDependencies && <p role="status">Turn off Local for all checked dependencies before publishing.</p>}
            {historical ? <div data-testid="agent-publication">
                <p>{historical.name} · {(historical.harnesses ?? [historical.harness]).map(harnessLabelOf).join(', ')}
                    {historical.model ? ` · ${historical.model}` : ''}</p>
                <p>{historical.profileId} · {historical.effort}</p>
                <p>{historical.repository}</p>
                <code>{historical.commit}</code>
                <p>Published {new Date(historical.publishedAt).toLocaleString()}</p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{historical.description}</p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{historical.instructions}</pre>
            </div> : <fieldset className={styles.draft} disabled={!!agent.draftError || publishing}>
            <div className={styles.field}>
                <span className={styles.label}>Name</span>
                <Input
                    value={name}
                    aria-label="Agent name"
                    data-testid="agent-name"
                    onChange={event => { setName(event.target.value); if (event.target.value.trim()) schedule({ name: event.target.value.trim() }); }}
                    onBlur={commitName}
                    onPressEnter={commitName}
                />
            </div>
            <div className={styles.field}>
                <span className={styles.label}>Description</span>
                <Input.TextArea
                    value={description}
                    placeholder="When to choose this agent…"
                    autoSize={{ minRows: 3, maxRows: 12 }}
                    onChange={event => { setDescription(event.target.value); schedule({ description: event.target.value.trim() }); }}
                    onBlur={() => {
                        const wanted = description.trim();
                        if (wanted === (agent.description ?? '')) return;
                        void commit({ description: wanted },
                            () => setDescription(agent.description ?? ''));
                    }}
                    aria-label="Agent description"
                    data-testid="agent-description"
                />
            </div>
            <div className={styles.field}>
                <Tooltip title={INSTRUCTIONS_HELP}>
                    <span className={styles.label}>Standing instructions</span>
                </Tooltip>
                <Input.TextArea
                    value={instructions}
                    placeholder="Standing instructions…"
                    autoSize={{ minRows: 4, maxRows: 16 }}
                    onChange={event => { setInstructions(event.target.value); schedule({ instructions: event.target.value.trim() }); }}
                    onBlur={() => {
                        const wanted = instructions.trim();
                        if (wanted === (agent.instructions ?? '')) return;
                        void commit({ instructions: wanted },
                            () => setInstructions(agent.instructions ?? ''));
                    }}
                    aria-label="Standing instructions"
                    data-testid="agent-instructions"
                />
            </div>
            {agent.harnesses?.length ? (
                <div className={styles.field}>
                    <span className={styles.label}>Supported harnesses</span>
                    <span>{agent.harnesses.map(harnessLabelOf).join(', ')}</span>
                </div>
            ) : <>
            {needsProfile(agent.harness) && <div className={styles.field}>
                <span className={styles.label}>Execution profile</span>
                <AutoComplete aria-label="Agent profile" disabled={publishing} value={agent.profileId ?? ''}
                    placeholder="Profile id or configured Pi default"
                    options={profilesFor(agent.harness).map(one => ({value:one.id,label:`${one.name} · ${one.id}`}))}
                    onChange={profileId => void commit({profileId},() => {})} />
                <span>{profilesFor(agent.harness).find(one => one.id === agent.profileId)?.message
                    ?? (agent.profileId && !profilesFor(agent.harness).some(one => one.id === agent.profileId) ? 'Profile unavailable on this runner; reference preserved.' : '')}</span>
            </div>}
            <div className={styles.row}>
                <div className={`${styles.field} ${styles.grow}`}>
                    <Tooltip title={HARNESS_HELP}>
                        <span className={styles.label}>Harness</span>
                    </Tooltip>
                    <Select
                        disabled={publishing}
                        value={agent.harness}
                        options={offered}
                        onChange={harness => void commit({ harness }, () => { /* drawn from the agent */ })}
                        aria-label="Harness"
                        data-testid="agent-harness"
                        popupMatchSelectWidth={false}
                    />
                </div>
                <div className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>Model</span>
                    <AutoComplete
                        disabled={publishing}
                        value={model}
                        options={modelsFor(agent.harness,agent.profileId)}
                        placeholder="Default model"
                        onChange={value => { setModel(value); schedule({ model: value.trim() }); }}
                        onBlur={() => {
                            const wanted = model.trim();
                            if (wanted === (agent.model ?? '')) return;
                            void commit({ model: wanted }, () => setModel(agent.model ?? ''));
                        }}
                        aria-label="Model"
                        data-testid="agent-model"
                    />
                </div>
            </div>
            </>}
            <div className={styles.field}>
                <span className={styles.label}>Default effort</span>
                <Input value={agent.effort ?? ''} aria-label="Agent effort"
                    onChange={event => void commit({ effort: event.target.value }, () => {})} />
            </div>
            {client && (['skills', 'mcp'] as const).map(kind => <AgentDependenciesField key={kind} agentId={agentId} client={client}
                kind={kind} disabled={!!agent.draftError || publishing} saving={savingDependency} setSaving={setSavingDependency}
                updateLocalDependencies={updateLocalDependencies} />)}
            <span aria-label="The id nodes name" className={styles.id}>{agent.id}</span>
            </fieldset>}
        </div>
    );
};

/** New-agent form panel. */
export const AgentCreatorPanel: React.FC<{ reinstall?: boolean; onClose: () => void; onCreated?: (agent: import('../types').AgentDto) => void }> = ({ reinstall, onClose, onCreated }) => {
    const { create } = useAgents();
    const { harnesses, modelsFor, profilesFor, needsProfile } = useAgentCatalogue();
    const [name, setName] = useState('');
    const [harness, setHarness] = useState(harnesses[0]?.value ?? '');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [profileId,setProfileId]=useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [saving, setSaving] = useState(false);
    const [repository, setRepository] = useState('');

    const gitRepository = repository.trim();
    const draft: NewAgentDto = {
        repository: gitRepository || undefined, importOnly: reinstall || undefined,
        name: name.trim(), harness, effort, profileId: profileId || undefined, model: model.trim() || undefined,
        description: description.trim() || undefined, instructions: instructions.trim() || undefined,
    };
    const canSubmit = !saving && (gitRepository !== '' || (!reinstall && Boolean(draft.name && harness)));

    const createAgent = () => {
        if (!canSubmit) return;
        setSaving(true);
        void create(draft)
            .then(agent => { onClose(); onCreated?.(agent); })
            .catch(cause => message.error(
                `The agent could not be ${reinstall ? 'reinstalled' : 'created'}: ${cause instanceof Error ? cause.message : cause}`))
            .finally(() => setSaving(false));
    };

    return (
        <div className={styles.editor} data-testid="agent-creator">
            <div className={styles.field}>
                <span className={styles.label}>Git repository URL or path</span>
                <Input autoFocus value={repository} aria-label="Git repository URL or path" placeholder="https://github.com/owner/agent.git"
                    onChange={event => setRepository(event.target.value)} onPressEnter={createAgent} />
                {!reinstall && <span>{gitRepository
                    ? 'Draft settings apply when initializing the repository. The initial commit is pushed to Git.'
                    : 'Leave empty to create a local Git repository.'}</span>}
            </div>
            {!reinstall && <>
            <div className={styles.field}>
                <span className={styles.label}>Name</span>
                <Input
                    value={name}
                    placeholder={gitRepository ? 'Repository name by default' : 'Agent name'}
                    aria-label="New agent name"
                    data-testid="new-agent-name"
                    onChange={event => setName(event.target.value)}
                    onPressEnter={createAgent}
                />
            </div>
            {needsProfile(harness) && <div className={styles.field}>
                <span className={styles.label}>Execution profile</span>
                <AutoComplete aria-label="New agent profile" value={profileId} placeholder="Profile id or configured Pi default"
                    options={profilesFor(harness).map(one => ({value:one.id,label:`${one.name} · ${one.id}`}))} onChange={setProfileId} />
                <span>{profilesFor(harness).find(one => one.id === profileId)?.message}</span>
            </div>}
            <div className={styles.row}>
                <div className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>Harness</span>
                    <Select
                        value={harness || undefined}
                        placeholder="Harness"
                        options={harnesses}
                        onChange={setHarness}
                        aria-label="New agent harness"
                        data-testid="new-agent-harness"
                        popupMatchSelectWidth={false}
                    />
                </div>
                <div className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>Model</span>
                    <AutoComplete
                        value={model}
                        options={modelsFor(harness,profileId)}
                        placeholder="Default model"
                        onChange={setModel}
                        aria-label="New agent model"
                        data-testid="new-agent-model"
                    />
                </div>
            </div>
            <div className={styles.field}>
                <span className={styles.label}>Default effort</span>
                <Input value={effort} aria-label="New agent effort"
                    onChange={event => setEffort(event.target.value)} />
            </div>
            <div className={styles.field}>
                <span className={styles.label}>Description</span>
                <Input.TextArea
                    value={description}
                    placeholder="When to choose this agent…"
                    autoSize={{ minRows: 3, maxRows: 12 }}
                    onChange={event => setDescription(event.target.value)}
                    aria-label="New agent description"
                    data-testid="new-agent-description"
                />
            </div>
            <div className={styles.field}>
                <span className={styles.label}>Standing instructions</span>
                <Input.TextArea
                    value={instructions}
                    placeholder="Standing instructions…"
                    autoSize={{ minRows: 4, maxRows: 16 }}
                    onChange={event => setInstructions(event.target.value)}
                    aria-label="New agent instructions"
                    data-testid="new-agent-instructions"
                />
            </div>
            </>}
            <div className={styles.actions}>
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary" onClick={createAgent}
                    disabled={!canSubmit}
                    data-testid="create-agent">
                    {reinstall ? 'Reinstall' : 'Create'}
                </Button>
            </div>
        </div>
    );
};
