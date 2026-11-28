import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AutoComplete, Button, ConfigProvider, Input, Modal, Select, message } from 'antd';
import { CommitInput, FormField, FormFields, InProgressFeedback, Tooltip } from '@kiao-dashboard-core';
import { useHarnessOptions } from '../../useHarnessOptions';
import { useResourceClient } from '../Client-ctx';
import type { AgentDependencyKind, AgentDto, AgentPatchDto, AgentRemoteDto, AgentVersionDto, NewAgentDto } from '../types';
import type { ReleaseBump } from '../release';
import { useAgents } from '../Agents-ctx';
import { useDraftWriter } from '../../useDraftWriter';
import { AgentDependenciesField } from './AgentDependenciesField';
import { AgentMCPDiagnostics } from './AgentMCPDiagnostics';
import { confirmAgentPush } from './confirmAgentPush';
import { ResourceEditor, useResourceOperations } from './ResourceEditor';
import styles from './ResourceEditor.module.css';

export const HARNESS_HELP = 'Runs turns and provides model and permission options. Must be available on the runner.';

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
export const useAgentHarnessOptions = () => {
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
    const { agents, error, reload, patch, publish, pull } = useAgents();
    const client = useResourceClient();
    const agent = agents.find(one => one.id === agentId) ?? null;
    const { harnesses, modelsFor, profilesFor, needsProfile, harnessLabelOf } = useAgentHarnessOptions();

    const [name, setName] = useState(agent?.name ?? '');
    const [model, setModel] = useState(agent?.model ?? '');
    const [description, setDescription] = useState(agent?.description ?? '');
    const [instructions, setInstructions] = useState(agent?.instructions ?? '');
    const [versions, setVersions] = useState<AgentVersionDto[]>([]);
    const [selectedVersion, setSelectedVersion] = useState('draft');
    const [checkingPublication, setCheckingPublication] = useState(true);
    const [checkingRemote, setCheckingRemote] = useState(true);
    const [remote, setRemote] = useState<AgentRemoteDto | null>(null);
    const [dependencyRevision, setDependencyRevision] = useState(0);
    const [localDependencies, setLocalDependencies] = useState({ skills: false, mcp: false });
    const updateLocalDependencies = useCallback((kind: AgentDependencyKind, hasLocal: boolean) => {
        setLocalDependencies(current => current[kind] === hasLocal ? current : { ...current, [kind]: hasLocal });
    }, []);
    const writer = useDraftWriter<AgentPatchDto>(change => patch(agentId, change), cause => {
        message.error(`The agent could not be changed: ${cause instanceof Error ? cause.message : cause}`);
    });
    const operations = useResourceOperations(writer.flush);
    const { busy } = operations;
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
    const remoteRead = useRef(0);
    const remotePending = useRef(false);
    const readRemote = useCallback(async (reset = false) => {
        if (!client) {
            setCheckingRemote(false);
            return;
        }
        const read = ++remoteRead.current;
        remotePending.current = true;
        if (reset) setRemote(null);
        setCheckingRemote(true);
        try {
            const state = await client.agentRemote(agentId);
            if (read === remoteRead.current) setRemote(state);
        } catch (cause) {
            if (read === remoteRead.current) setRemote({ hasRemote: false, behind: 0, problem: cause instanceof Error ? cause.message : String(cause) });
        } finally {
            if (read === remoteRead.current) {
                remotePending.current = false;
                setCheckingRemote(false);
            }
        }
    }, [client, agentId]);
    useEffect(() => {
        void readRemote();
        const timer = setInterval(() => { if (!remotePending.current) void readRemote(); }, 30000);
        return () => {
            clearInterval(timer);
            remoteRead.current++;
            remotePending.current = false;
        };
    }, [readRemote]);
    useEffect(() => {
        if (!writer.hasPending('name')) setName(agent?.name ?? '');
    }, [agent?.name]);
    useEffect(() => {
        if (!writer.hasPending('model')) setModel(agent?.model ?? '');
    }, [agent?.model]);
    useEffect(() => {
        if (!writer.hasPending('description')) setDescription(agent?.description ?? '');
    }, [agent?.description]);
    useEffect(() => {
        if (!writer.hasPending('instructions')) setInstructions(agent?.instructions ?? '');
    }, [agent?.instructions]);

    const offered = useMemo(() => {
        if (!agent) return harnesses;
        if (harnesses.some(entry => entry.value === agent.harness)) return harnesses;
        return [...harnesses, { value: agent.harness, label: agent.harness }];
    }, [harnesses, agent]);

    if (!agent) {
        return <div className={styles.hint}>That agent is gone from the store.</div>;
    }

    const hasLocalDependencies = localDependencies.skills || localDependencies.mcp;
    const draftDisabled = !!agent.draftError || busy;
    const canPublish = !checkingPublication && !error && agent.hasUnpublishedChanges && !!agent.version && !agent.draftError
        && selectedVersion === 'draft' && !hasLocalDependencies;
    const canPull = selectedVersion === 'draft' && !!remote?.hasRemote && remote.behind > 0;
    const waitingForRemote = checkingRemote && !canPull;
    let pullStatus: string | undefined;
    if (selectedVersion === 'draft' && !busy) {
        if (waitingForRemote) pullStatus = 'Checking Git remote…';
        else if (remote?.problem) pullStatus = remote.problem;
        else if (!remote?.hasRemote) pullStatus = 'No Git remote configured.';
        else if (remote.behind === 0) pullStatus = 'No remote changes to pull.';
    }
    const publishDraft = (bump: ReleaseBump) => confirmAgentPush(confirmation => publish(agentId, bump, confirmation))
        .finally(() => { void readRemote(true); });
    const pullDraft = () => pull(agentId).finally(() => { void readRemote(true); });

    const historical = versions.find(version => version.version === selectedVersion);
    const canDiagnose = historical ? !!historical.commit : !agent.draftError;

    const commitName = (value: string) => {
        const wanted = value.trim();
        if (!wanted || wanted === agent.name) {
            writer.discard('name');
            setName(agent.name);
            return;
        }
        void writer.commit({ name: wanted }, () => setName(agent.name));
    };

    return (
        <ResourceEditor kind="agent" repository={agent.repository} version={agent.version} operations={operations}
            onPublish={canPublish ? publishDraft : undefined} onPull={canPull ? pullDraft : undefined}
            checkingRemote={selectedVersion === 'draft' && !busy && waitingForRemote}
            versionPicker={<Select aria-label="Agent version" value={selectedVersion} onChange={setSelectedVersion} disabled={busy}
                options={[{ value: 'draft', label: agent.published?.version ? 'Draft' : 'Unpublished draft' },
                    ...versions.flatMap(({ version }) => version ? [{ value: version, label: `Published v${version}` }] : [])]} />}>
            {pullStatus && <span role="status" className={styles.meta}>{pullStatus}</span>}
            {selectedVersion === 'draft' && checkingPublication && <InProgressFeedback label="Checking for publishable changes…" />}
            {agent.draftError && <Alert type="error" title="Repair the APM source in Agentic resources (legacy)" description={agent.draftError} />}
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
            </div> : <FormFields disabled={draftDisabled}>
            <FormField label="Name">
                <CommitInput
                    size="middle"
                    value={name}
                    aria-label="Agent name"
                    data-testid="agent-name"
                    onDraftChange={value => {
                        setName(value);
                        const wanted = value.trim();
                        if (wanted) writer.schedule({ name: wanted });
                        else writer.discard('name');
                    }}
                    onCommit={commitName}
                />
            </FormField>
            <FormField label="Description">
                <Input.TextArea
                    value={description}
                    placeholder="When to choose this agent…"
                    autoSize={{ minRows: 3, maxRows: 12 }}
                    onChange={event => { setDescription(event.target.value); writer.schedule({ description: event.target.value.trim() }); }}
                    onBlur={() => {
                        const wanted = description.trim();
                        if (wanted === (agent.description ?? '')) return;
                        void writer.commit({ description: wanted },
                            () => setDescription(agent.description ?? ''));
                    }}
                    aria-label="Agent description"
                    data-testid="agent-description"
                />
            </FormField>
            <FormField label={<Tooltip title={INSTRUCTIONS_HELP}><span>Standing instructions</span></Tooltip>}>
                <Input.TextArea
                    value={instructions}
                    placeholder="Standing instructions…"
                    autoSize={{ minRows: 4, maxRows: 16 }}
                    onChange={event => { setInstructions(event.target.value); writer.schedule({ instructions: event.target.value.trim() }); }}
                    onBlur={() => {
                        const wanted = instructions.trim();
                        if (wanted === (agent.instructions ?? '')) return;
                        void writer.commit({ instructions: wanted },
                            () => setInstructions(agent.instructions ?? ''));
                    }}
                    aria-label="Standing instructions"
                    data-testid="agent-instructions"
                />
            </FormField>
            {agent.harnesses?.length ? (
                <FormField label="Supported harnesses">
                    <span>{agent.harnesses.map(harnessLabelOf).join(', ')}</span>
                </FormField>
            ) : <>
            {needsProfile(agent.harness) && <FormField label="Execution profile">
                <AutoComplete aria-label="Agent profile" disabled={draftDisabled} value={agent.profileId ?? ''}
                    placeholder="Profile id or configured Pi default"
                    options={profilesFor(agent.harness).map(one => ({value:one.id,label:`${one.name} · ${one.id}`}))}
                    onChange={profileId => void writer.commit({ profileId })} />
                <span>{profilesFor(agent.harness).find(one => one.id === agent.profileId)?.message
                    ?? (agent.profileId && !profilesFor(agent.harness).some(one => one.id === agent.profileId) ? 'Profile unavailable on this runner; reference preserved.' : '')}</span>
            </FormField>}
            <div className={styles.row}>
                <FormField className={styles.grow} label={<Tooltip title={HARNESS_HELP}><span>Harness</span></Tooltip>}>
                    <Select
                        disabled={draftDisabled}
                        value={agent.harness}
                        options={offered}
                        onChange={harness => void writer.commit({ harness })}
                        aria-label="Harness"
                        data-testid="agent-harness"
                        popupMatchSelectWidth={false}
                    />
                </FormField>
                <FormField className={styles.grow} label="Model">
                    <AutoComplete
                        disabled={draftDisabled}
                        value={model}
                        options={modelsFor(agent.harness,agent.profileId)}
                        placeholder="Default model"
                        onChange={value => { setModel(value); writer.schedule({ model: value.trim() }); }}
                        onBlur={() => {
                            const wanted = model.trim();
                            if (wanted === (agent.model ?? '')) return;
                            void writer.commit({ model: wanted }, () => setModel(agent.model ?? ''));
                        }}
                        aria-label="Model"
                        data-testid="agent-model"
                    />
                </FormField>
            </div>
            </>}
            <FormField label="Default effort">
                <Input value={agent.effort ?? ''} aria-label="Agent effort"
                    onChange={event => void writer.commit({ effort: event.target.value })} />
            </FormField>
            {client && (['skills', 'mcp'] as const).map(kind => <AgentDependenciesField key={kind} agentId={agentId} client={client}
                kind={kind} disabled={draftDisabled} runChange={change => { void operations.run('dependencies', change); }}
                updateLocalDependencies={updateLocalDependencies} onChanged={() => setDependencyRevision(revision => revision + 1)} />)}
            <span aria-label="The id nodes name" className={styles.id}>{agent.id}</span>
            </FormFields>}
            {canDiagnose && <AgentMCPDiagnostics key={`${agentId}/${historical?.commit ?? 'draft'}`}
                agentId={agentId} commit={historical?.commit} dependencyRevision={dependencyRevision} />}
        </ResourceEditor>
    );
};

/** New-agent form panel. */
const AgentCreatorPanel: React.FC<{
    reinstall?: boolean;
    saving: boolean;
    onClose: () => void;
    onSubmit: (draft: NewAgentDto) => Promise<void>;
}> = ({ reinstall, saving, onClose, onSubmit }) => {
    const { harnesses, modelsFor, profilesFor, needsProfile } = useAgentHarnessOptions();
    const [name, setName] = useState('');
    const [harness, setHarness] = useState(harnesses[0]?.value ?? '');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [profileId,setProfileId]=useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [repository, setRepository] = useState('');
    const [error, setError] = useState('');

    const gitRepository = repository.trim();
    const draft: NewAgentDto = {
        repository: gitRepository || undefined, importOnly: reinstall || undefined,
        name: name.trim(), harness, effort, profileId: profileId || undefined, model: model.trim() || undefined,
        description: description.trim() || undefined, instructions: instructions.trim() || undefined,
    };
    const canSubmit = !saving && (gitRepository !== '' || (!reinstall && Boolean(draft.name && harness)));

    const createAgent = () => {
        if (!canSubmit) return;
        setError('');
        void onSubmit(draft).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    };

    return (
        <div className={styles.editor} data-testid="agent-creator">
            {error && <Alert type="error" title={error} />}
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
                <div className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>Default effort</span>
                    <Input value={effort} aria-label="New agent effort"
                        onChange={event => setEffort(event.target.value)} />
                </div>
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
                    disabled={!canSubmit} loading={saving} aria-busy={saving}
                    data-testid="create-agent">
                    {reinstall ? 'Reinstall' : 'Create'}
                </Button>
            </div>
        </div>
    );
};

export const AgentCreationModal: React.FC<{ open: boolean; reinstall?: boolean; onClose: () => void; onCreated?: (agent: AgentDto) => void }> = ({ open, reinstall, onClose, onCreated }) => {
    const { create } = useAgents();
    const { componentDisabled } = ConfigProvider.useConfig();
    const [saving, setSaving] = useState(false);
    const submitting = useRef(false);

    const submit = async (draft: NewAgentDto) => {
        if (submitting.current) return;
        submitting.current = true;
        setSaving(true);
        try {
            const agent = await create(draft);
            onClose();
            onCreated?.(agent);
        } finally {
            submitting.current = false;
            setSaving(false);
        }
    };

    const dismiss = () => { if (!submitting.current) onClose(); };

    return (
        <Modal title={reinstall ? 'Reinstall agent' : 'New agent'} width={reinstall ? undefined : 720}
            open={open} onCancel={dismiss} closable={!saving} footer={null} destroyOnHidden>
            <ConfigProvider componentDisabled={saving || componentDisabled}>
                <AgentCreatorPanel reinstall={reinstall} saving={saving} onClose={dismiss} onSubmit={submit} />
            </ConfigProvider>
        </Modal>
    );
};
