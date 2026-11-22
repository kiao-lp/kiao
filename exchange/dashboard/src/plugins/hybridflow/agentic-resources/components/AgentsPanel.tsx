import React, { useState } from 'react';
import { Alert, Button, Modal, Spin, message } from 'antd';
import { DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Tooltip, useCentralStack, useToolBarsOptional } from '@kiao-dashboard-core';
import type { AgentDto } from '../types';
import { useResourceClient } from '../Client-ctx';
import { useAgents } from '../Agents-ctx';
import { AGENT_EDITOR_PANEL_ID, AgentCreatorPanel, AgentEditorPanel, DELETE_HELP, useAgentCatalogue } from './AgentEditorPanel';
import styles from './AgentsPanel.module.css';

export { DELETE_HELP, INSTRUCTIONS_HELP, HARNESS_HELP } from './AgentEditorPanel';

export const AgentCreationModal: React.FC<{ open: boolean; reinstall?: boolean; onClose: () => void; onCreated?: (agent: AgentDto) => void }> = ({ open, reinstall, onClose, onCreated }) =>
    <Modal title={reinstall ? 'Reinstall agent' : 'New agent'} open={open} onCancel={onClose} footer={null} destroyOnHidden>
        <AgentCreatorPanel reinstall={reinstall} onClose={onClose} onCreated={onCreated} />
    </Modal>;

export const AgentsPanel: React.FC = () => {
    const client = useResourceClient();
    const { agents, loading, error, reload, remove } = useAgents();
    const { push } = useCentralStack();
    const bars = useToolBarsOptional();
    const { harnessLabelOf } = useAgentCatalogue();
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [creating, setCreating] = useState(false);

    const edit = (agent: AgentDto) => push({
        id: AGENT_EDITOR_PANEL_ID, host: bars?.activeCentralTab() ?? undefined,
        title: `Edit agent “${agent.name}”`, closeLabel: 'Close', content: <AgentEditorPanel key={agent.id} agentId={agent.id} />,
    });
    const confirmDelete = async (agent: AgentDto) => {
        try {
            const status = await client!.deletionStatus(agent.id);
            Modal.confirm({
                title: `Delete ${agent.name}?`, okText: 'Delete', okButtonProps: { danger: true },
                content: <div>
                    <p>{DELETE_HELP}</p>
                    {status.noRemote && <Alert type="warning" message="This repository has no remote. Its local history will be deleted." />}
                    {status.dirty && <Alert type="warning" message="This repository has uncommitted changes." />}
                    {status.unpushed && <Alert type="warning" message="This repository has local commits or tags that have not been pushed." />}
                    {status.remoteUnavailable && <Alert type="warning" message="The remote could not be checked." />}
                </div>,
                onOk: () => remove(agent.id, status.confirmation).catch(cause => { message.error(String(cause)); throw cause; }),
            });
        } catch (cause) { message.error(String(cause)); }
    };

    return <div className={styles.panel} data-testid="agents-panel">
        <div className={styles.header}>
            <span className={styles.spacer} />
            <Button size="small" type="text" icon={<ReloadOutlined />} aria-label="Refresh agents" onClick={() => void reload()} />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} disabled={!client} data-testid="new-agent">New agent</Button>
        </div>
        <AgentCreationModal open={creating} onClose={() => setCreating(false)} onCreated={edit} />
        {!client ? <Alert type="info" message="Agentic resource manager unavailable" />
            : error ? <Alert type="error" message="The agents could not be read" description={error} action={<Button onClick={() => void reload()}>Try again</Button>} />
            : loading && agents.length === 0 ? <Spin size="small" />
            : <div className={styles.list}>
                {agents.map(agent => <div key={agent.id} className={styles.row} data-testid="agent-card">
                    <div className={styles.main}>
                        <div className={styles.titleRow}>
                            {agent.description && <Button size="small" type="text" icon={expanded[agent.id] ? <DownOutlined /> : <RightOutlined />}
                                aria-label={`${expanded[agent.id] ? 'Hide' : 'Show'} description of ${agent.name}`} aria-expanded={!!expanded[agent.id]}
                                data-testid="agent-description-toggle" onClick={() => setExpanded(held => ({ ...held, [agent.id]: !held[agent.id] }))} />}
                            <span className={styles.name} data-testid="agent-name-text">{agent.name}</span>
                        </div>
                        <span className={styles.meta} data-testid="agent-meta">
                            {agent.harnesses?.length ? agent.harnesses.map(harnessLabelOf).join(' · ')
                                : `${harnessLabelOf(agent.harness)} · ${agent.model || 'default model'}`}
                        </span>
                        <span className={styles.meta}>{agent.published?.version ? `Published v${agent.published.version}` : 'Unpublished'}</span>
                        {expanded[agent.id] && agent.description && <p className={styles.description} data-testid="agent-description-text">{agent.description}</p>}
                        <span aria-label="Agent ID" className={styles.id}>{agent.id}</span>
                    </div>
                    <span className={styles.actions}>
                        <Button size="small" type="text" icon={<EditOutlined />} aria-label={`Edit ${agent.name}`} data-testid="edit-agent" onClick={() => edit(agent)} />
                        <Tooltip title={DELETE_HELP}><Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Delete ${agent.name}`}
                            data-testid="delete-agent" onClick={() => void confirmDelete(agent)} /></Tooltip>
                    </span>
                </div>)}
                {agents.length === 0 && <p className={styles.hint}>Add an agent from its Git repository or create a local agent.</p>}
            </div>}
    </div>;
};
