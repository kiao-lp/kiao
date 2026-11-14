import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Button, Input, Select, message } from 'antd';
import { Tooltip } from '@kiao-dashboard-core';
import { useChatOptions } from '@kiao-dashboard-kit/capabilities';
import { AgentPatchDto, AgentVersionDto, NewAgentDto, useHybridflowClient } from '../service';
import { useAgents } from '../Agents-ctx';
import styles from './AgentEditorPanel.module.css';

/** Panel id for the agent editor. */
export const AGENT_EDITOR_PANEL_ID = 'agent-editor';

export const HARNESS_HELP = 'The execution engine; it must be available on the runner.';

export const INSTRUCTIONS_HELP = 'Standing instructions included with every turn, alongside its task prompt.';

export const DELETE_HELP = 'Nodes referencing this agent need another agent before they can play.';

/** Fallback harnesses when no engine capability is available. */
const FALLBACK_HARNESSES = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'muse', label: 'Muse' },
    { value: 'opencode', label: 'OpenCode' },
    { value: 'pi', label: 'Pi (Harness)' },
];

/** Harnesses and models from the engine capability. */
export const useAgentCatalogue = () => {
    const { harnesses: offered, optionsFor } = useChatOptions();
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
    const { agents, patch, publish } = useAgents();
    const client = useHybridflowClient();
    const agent = agents.find(one => one.id === agentId) ?? null;
    const { harnesses, modelsFor, profilesFor, needsProfile } = useAgentCatalogue();

    const [name, setName] = useState(agent?.name ?? '');
    const [model, setModel] = useState(agent?.model ?? '');
    const [description, setDescription] = useState(agent?.description ?? '');
    const [instructions, setInstructions] = useState(agent?.instructions ?? '');
    const [versions, setVersions] = useState<AgentVersionDto[]>([]);
    const [selectedVersion, setSelectedVersion] = useState<number>(0);
    const [publishing, setPublishing] = useState(false);
    const writing = useRef<Promise<unknown>>(Promise.resolve());
    useEffect(() => {
        let current = true;
        if (client) void client.agentVersions(agentId).then(list => { if (current) setVersions(list); })
            .catch(cause => { if (current) message.error(String(cause)); });
        return () => { current = false; };
    }, [client, agentId, agent?.published?.version]);
    useEffect(() => {
        setName(agent?.name ?? '');
    }, [agent?.name]);
    useEffect(() => {
        setModel(agent?.model ?? '');
    }, [agent?.model]);
    useEffect(() => {
        setDescription(agent?.description ?? '');
    }, [agent?.description]);
    useEffect(() => {
        setInstructions(agent?.instructions ?? '');
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
        const pending = writing.current.then(() => patch(agent.id, change));
        writing.current = pending.catch(() => {});
        try {
            await pending;
            return true;
        } catch (cause) {
            message.error(`The agent could not be changed: ${cause instanceof Error ? cause.message : cause}`);
            revert();
            return false;
        }
    };

    const publishDraft = async () => {
        if (publishing) return;
        setPublishing(true);
        try {
            const flushed = await commit({ name: name.trim() || agent.name, model: model.trim(),
                description: description.trim(), instructions: instructions.trim() }, () => {});
            if (flushed) await publish(agent.id);
        } catch (cause) {
            message.error(`The agent could not be published: ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setPublishing(false);
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
                <Select aria-label="Agent version" value={selectedVersion} onChange={setSelectedVersion}
                    options={[{ value: 0, label: agent.published ? `Draft · latest published v${agent.published.version}` : 'Unpublished draft' },
                        ...versions.map(version => ({ value: version.version, label: `Published v${version.version}` }))]} />
                <Button type="primary" disabled={agent.archived || selectedVersion !== 0} loading={publishing}
                    onClick={() => void publishDraft()} data-testid="publish-agent">
                    Publish v{(agent.published?.version ?? 0) + 1}
                </Button>
            </div>
            <p className={styles.hint}>Publishing applies to new conversations. Existing conversations keep their version.</p>
            {historical ? <div data-testid="agent-publication">
                <p>{historical.name} · {historical.harness} · {historical.model || 'Default model'}</p>
                <p>{historical.profileId}</p>
                <p>Published {new Date(historical.publishedAt).toLocaleString()}</p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{historical.description}</p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{historical.instructions}</pre>
            </div> : <fieldset className={styles.draft} disabled={agent.archived || publishing}>
            <div className={styles.field}>
                <span className={styles.label}>Name</span>
                <Input
                    value={name}
                    aria-label="Agent name"
                    data-testid="agent-name"
                    onChange={event => setName(event.target.value)}
                    onBlur={commitName}
                    onPressEnter={commitName}
                />
            </div>
            {needsProfile(agent.harness) && <div className={styles.field}>
                <span className={styles.label}>Execution profile</span>
                <AutoComplete aria-label="Agent profile" disabled={agent.archived || publishing} value={agent.profileId ?? ''}
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
                        disabled={agent.archived || publishing}
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
                        disabled={agent.archived || publishing}
                        value={model}
                        options={modelsFor(agent.harness,agent.profileId)}
                        placeholder="Default model"
                        onChange={value => setModel(value)}
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
            <div className={styles.field}>
                <span className={styles.label}>Description</span>
                <Input.TextArea
                    value={description}
                    placeholder="When to choose this agent…"
                    autoSize={{ minRows: 3, maxRows: 12 }}
                    onChange={event => setDescription(event.target.value)}
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
                    onChange={event => setInstructions(event.target.value)}
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
            <span aria-label="The id nodes name" className={styles.id}>{agent.id}</span>
            </fieldset>}
        </div>
    );
};

/** New-agent form panel. */
export const AgentCreatorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { create } = useAgents();
    const { harnesses, modelsFor, profilesFor, needsProfile } = useAgentCatalogue();
    const [name, setName] = useState('');
    const [harness, setHarness] = useState(harnesses[0]?.value ?? '');
    const [model, setModel] = useState('');
    const [profileId,setProfileId]=useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [saving, setSaving] = useState(false);

    const filed: NewAgentDto = {
        name: name.trim(), harness, profileId: profileId || undefined, model: model.trim() || undefined,
        description: description.trim() || undefined, instructions: instructions.trim() || undefined,
    };

    const createAgent = () => {
        if (!filed.name || !harness || saving) return;
        setSaving(true);
        void create(filed)
            .then(onClose)
            .catch(cause => message.error(
                `The agent could not be created: ${cause instanceof Error ? cause.message : cause}`))
            .finally(() => setSaving(false));
    };

    return (
        <div className={styles.editor} data-testid="agent-creator">
            <div className={styles.field}>
                <span className={styles.label}>Name</span>
                <Input
                    autoFocus
                    value={name}
                    placeholder="Agent name"
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
            <div className={styles.actions}>
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary" onClick={createAgent}
                    disabled={!filed.name || !harness || saving}
                    data-testid="create-agent">
                    Create
                </Button>
            </div>
        </div>
    );
};
