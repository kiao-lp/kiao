import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AutoComplete, Button, Input, Select, message } from 'antd';
import { Tooltip } from '@cms-core';
import { useChatOptions } from '@cms-kit/capabilities';
import { AgentPatchDto, AgentVersionDto, NewAgentDto, useHybridflowClient } from '../service';
import { useAgents } from '../Agents-ctx';
import styles from './AgentEditorPanel.module.css';

/** The agent form's entry on the central area's stack, for editing and for filing. */
export const AGENT_EDITOR_PANEL_ID = 'agent-editor';

export const NAME_HELP = 'What the node editor shows in its select. Unique across the store — two agents '
    + 'called the same thing would be two rows nobody can tell apart.';

export const PLATFORM_HELP = 'The engine it runs on. A host drives what it offers, asked per turn; '
    + 'a platform this host lacks is refused when the node is played.';

export const MODEL_HELP = 'The model, from the platform’s catalogue. Empty is the CLI’s own default. '
    + 'The list is what this host reports; other text is taken as written.';

export const DESCRIPTION_HELP = 'When to choose this agent for a task. This description is never sent to the agent.';

export const INSTRUCTIONS_HELP = 'Standing orders the agent’s turns are given, beside the prompt: the '
    + 'system prompt’s own half, rather than part of what is asked. Most agents have none.';

export const DELETE_HELP = 'Delete this agent. The nodes naming it keep naming it, and cannot be played '
    + 'until they name another.';

/**
 * The engines a definition may name where no plugin in the assembly drives one. The capability is
 * the source everywhere else — the deployment's own engines, with the labels the service gives
 * them — and this is the floor under it: the four this build knows, so definitions stay writable
 * where nothing plays them yet.
 */
const FALLBACK_PLATFORMS = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'muse', label: 'Muse' },
    { value: 'opencode', label: 'OpenCode' },
    { value: 'pi', label: 'Pi (Agent)' },
];

/**
 * The engines a definition may name, and the models each of them offers: the deployment's own
 * lists, read through the capability rather than written down — a model name belongs to the
 * catalogue of one engine. Shared by the agents list and the central editor, so the two never
 * name different engines.
 */
export const useAgentCatalogue = () => {
    const { agents: offered, optionsFor } = useChatOptions();
    return useMemo(() => {
        const platforms = [...offered.map(entry => ({ value: entry.value, label: entry.label })),
            ...FALLBACK_PLATFORMS.filter(one => !offered.some(entry => entry.value === one.value))];
        const profilesFor = (platform: string) => optionsFor(platform).profiles ?? [];
        const needsProfile = (platform: string) => optionsFor(platform).profiles !== undefined || platform === 'pi';
        const modelsFor = (platform: string, profileId?: string) => (profilesFor(platform).find(one => one.id === profileId)?.models ?? optionsFor(platform).models)
            .map(model => ({ value: model.value, label: model.label }));
        const platformLabelOf = (platform: string) =>
            platforms.find(entry => entry.value === platform)?.label ?? platform;
        return { platforms, modelsFor, platformLabelOf, profilesFor, needsProfile };
    }, [offered, optionsFor]);
};

/**
 * One agent, edited comfortably: its name, what it runs on, and what its turns are told.
 *
 * It is a **panel on the central area's stack**, pushed by the edit gesture in the lateral
 * agents list — never a dialog. The form fills the middle of the screen while the chrome
 * around it stays usable, and closing the panel is back where the list was. There is nothing
 * to save here: every change is written straight through to the hybridflow-store, like every
 * other edit made beside a board.
 *
 * The agent is read live from the agents context rather than captured when pushed, so a
 * rename from a second tab is what this panel shows.
 */
export const AgentEditorPanel: React.FC<{ agentId: string }> = ({ agentId }) => {
    const { agents, patch, publish } = useAgents();
    const client = useHybridflowClient();
    const agent = agents.find(one => one.id === agentId) ?? null;
    const { platforms, modelsFor, profilesFor, needsProfile } = useAgentCatalogue();

    // Held while typed, so a name on its way to being another name is not written as each of the
    // names it passes through.
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

    // The platform this deployment withdrew, or a board's engine from before the choice: shown as
    // written rather than as a box that looks unanswered.
    const offered = useMemo(() => {
        if (!agent) return platforms;
        if (platforms.some(entry => entry.value === agent.platform)) return platforms;
        return [...platforms, { value: agent.platform, label: agent.platform }];
    }, [platforms, agent]);

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
                <p>{historical.name} · {historical.platform} · {historical.model || 'Default model'}</p>
                <p>{historical.profileId}</p>
                <p>Published {new Date(historical.publishedAt).toLocaleString()}</p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{historical.description}</p>
                <pre style={{ whiteSpace: 'pre-wrap' }}>{historical.instructions}</pre>
            </div> : <fieldset className={styles.draft} disabled={agent.archived || publishing}>
            <div className={styles.field}>
                <Tooltip title={NAME_HELP}>
                    <span className={styles.label}>Name</span>
                </Tooltip>
                <Input
                    value={name}
                    aria-label="Agent name"
                    data-testid="agent-name"
                    onChange={event => setName(event.target.value)}
                    onBlur={commitName}
                    onPressEnter={commitName}
                />
            </div>
            {needsProfile(agent.platform) && <div className={styles.field}>
                <span className={styles.label}>Execution profile</span>
                <AutoComplete aria-label="Agent profile" disabled={agent.archived || publishing} value={agent.profileId ?? ''}
                    placeholder="Profile id or configured Pi default"
                    options={profilesFor(agent.platform).map(one => ({value:one.id,label:`${one.name} · ${one.id}`}))}
                    onChange={profileId => void commit({profileId},() => {})} />
                <span>{profilesFor(agent.platform).find(one => one.id === agent.profileId)?.message
                    ?? (agent.profileId && !profilesFor(agent.platform).some(one => one.id === agent.profileId) ? 'Profile unavailable on this runner; reference preserved.' : '')}</span>
            </div>}
            <div className={styles.row}>
                <div className={`${styles.field} ${styles.grow}`}>
                    <Tooltip title={PLATFORM_HELP}>
                        <span className={styles.label}>Platform</span>
                    </Tooltip>
                    <Select
                        disabled={agent.archived || publishing}
                        value={agent.platform}
                        options={offered}
                        onChange={platform => void commit({ platform }, () => { /* drawn from the agent */ })}
                        aria-label="Platform"
                        data-testid="agent-platform"
                        popupMatchSelectWidth={false}
                    />
                </div>
                <div className={`${styles.field} ${styles.grow}`}>
                    <Tooltip title={MODEL_HELP}>
                        <span className={styles.label}>Model</span>
                    </Tooltip>
                    <AutoComplete
                        disabled={agent.archived || publishing}
                        value={model}
                        options={modelsFor(agent.platform,agent.profileId)}
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
                <Tooltip title={DESCRIPTION_HELP}>
                    <span className={styles.label}>Description</span>
                </Tooltip>
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
            <Tooltip title="The id nodes name">
                <span className={styles.id}>{agent.id}</span>
            </Tooltip>
            </fieldset>}
        </div>
    );
};

/**
 * The form a new agent is filed from, pushed onto the central area's stack by the list's
 * button — the same comfortable room as the editor, rather than a card squeezed into the
 * column the list lives in.
 */
export const AgentCreatorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { create } = useAgents();
    const { platforms, modelsFor, profilesFor, needsProfile } = useAgentCatalogue();
    const [name, setName] = useState('');
    const [platform, setPlatform] = useState(platforms[0]?.value ?? '');
    const [model, setModel] = useState('');
    const [profileId,setProfileId]=useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [saving, setSaving] = useState(false);

    const filed: NewAgentDto = {
        name: name.trim(), platform, profileId: profileId || undefined, model: model.trim() || undefined,
        description: description.trim() || undefined, instructions: instructions.trim() || undefined,
    };

    const createAgent = () => {
        if (!filed.name || !platform || saving) return;
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
            {needsProfile(platform) && <div className={styles.field}>
                <span className={styles.label}>Execution profile</span>
                <AutoComplete aria-label="New agent profile" value={profileId} placeholder="Profile id or configured Pi default"
                    options={profilesFor(platform).map(one => ({value:one.id,label:`${one.name} · ${one.id}`}))} onChange={setProfileId} />
                <span>{profilesFor(platform).find(one => one.id === profileId)?.message}</span>
            </div>}
            <div className={styles.row}>
                <div className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>Platform</span>
                    <Select
                        value={platform || undefined}
                        placeholder="Platform"
                        options={platforms}
                        onChange={setPlatform}
                        aria-label="New agent platform"
                        data-testid="new-agent-platform"
                        popupMatchSelectWidth={false}
                    />
                </div>
                <div className={`${styles.field} ${styles.grow}`}>
                    <span className={styles.label}>Model</span>
                    <AutoComplete
                        value={model}
                        options={modelsFor(platform,profileId)}
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
                    disabled={!filed.name || !platform || saving}
                    data-testid="create-agent">
                    Create
                </Button>
            </div>
        </div>
    );
};
