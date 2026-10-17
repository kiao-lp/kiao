import React, { useState } from 'react';
import { Alert, Button, Popconfirm, Spin, message } from 'antd';
import {
    DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RightOutlined,
} from '@ant-design/icons';
import { Tooltip, useCentralStack } from '@cms-core';
import { AgentDto, useHybridflowClient } from '../service';
import { useAgents } from '../Agents-ctx';
import {
    AGENT_EDITOR_PANEL_ID, AgentCreatorPanel, AgentEditorPanel, DELETE_HELP, useAgentCatalogue,
} from './AgentEditorPanel';
import styles from './AgentsPanel.module.css';

// The tooltip texts live beside the central editor that shows them; re-exported so their
// import path never moves.
export {
    DELETE_HELP, DESCRIPTION_HELP, INSTRUCTIONS_HELP, MODEL_HELP, NAME_HELP, PLATFORM_HELP,
} from './AgentEditorPanel';

/** One agent: its name, what it runs on, and the gestures it answers to. */
const AgentRow: React.FC<{
    agent: AgentDto;
    platformLabel: string;
    expanded: boolean;
    onToggle: () => void;
    onEdit: () => void;
    onRemove: () => Promise<unknown>;
}> = ({ agent, platformLabel, expanded, onToggle, onEdit, onRemove }) => {
    const description = (agent.description ?? '').trim();
    const meta = agent.model ? `${platformLabel} · ${agent.model}` : `${platformLabel} · default model`;

    return (
        <div className={styles.row} data-testid="agent-card">
            <div className={styles.main}>
                <div className={styles.titleRow}>
                    {description && (
                        <Tooltip title={expanded ? 'Hide the description' : 'Show the description'}>
                            <Button
                                size="small"
                                type="text"
                                icon={expanded ? <DownOutlined /> : <RightOutlined />}
                                aria-label={`${expanded ? 'Hide' : 'Show'} description of ${agent.name}`}
                                aria-expanded={expanded}
                                data-testid="agent-description-toggle"
                                onClick={onToggle}
                            />
                        </Tooltip>
                    )}
                    <span className={styles.name} data-testid="agent-name-text">{agent.name}</span>
                </div>
                <span className={styles.meta} data-testid="agent-meta">{meta}</span>
                {expanded && description && (
                    <p className={styles.description} data-testid="agent-description-text">{description}</p>
                )}
                <Tooltip title="The id nodes name">
                    <span className={styles.id}>{agent.id}</span>
                </Tooltip>
            </div>
            <span className={styles.actions}>
                <Tooltip title="Edit this agent in the central area">
                    <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        aria-label={`Edit ${agent.name}`}
                        data-testid="edit-agent"
                        onClick={onEdit}
                    />
                </Tooltip>
                <Popconfirm
                    title="Delete this agent?"
                    description="The nodes naming it keep naming it, and cannot be played until they name another."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                        void onRemove().catch(cause => message.error(
                            `The agent could not be deleted: ${cause instanceof Error ? cause.message : cause}`));
                    }}
                >
                    <Tooltip title={DELETE_HELP}>
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={`Delete ${agent.name}`}
                            data-testid="delete-agent"
                        />
                    </Tooltip>
                </Popconfirm>
            </span>
        </div>
    );
};

/**
 * The managed agents: the named definitions of what plays a flow node.
 *
 * A clean list — a name, what it runs on, and the two gestures a row answers to — with
 * the selection guidance a toggle away. Editing happens in the central area, where there
 * is room for every field of a definition: the edit gesture pushes the agent's form onto
 * the central stack, and filing one pushes the same room empty.
 *
 * There is no Save button, as everywhere else in this CMS: every change is a write to the
 * hybridflow-store. And there is a **refresh**, for the same reason the boards page has one — the
 * list is rows in a database a second tab may have written to.
 */
export const AgentsPanel: React.FC = () => {
    const client = useHybridflowClient();
    const { agents, loading, error, reload, remove } = useAgents();
    const { push, close } = useCentralStack();
    const { platformLabelOf } = useAgentCatalogue();
    // The descriptions unfolded in the list, by agent id: what stays open is the reader's,
    // not the listing's, so a re-read leaves it where it was.
    const [open, setOpen] = useState<Record<string, boolean>>({});

    const edit = (agent: AgentDto) => push({
        id: AGENT_EDITOR_PANEL_ID,
        title: `Edit agent “${agent.name || 'Untitled'}”`,
        closeLabel: 'Close',
        content: <AgentEditorPanel agentId={agent.id} />,
    });

    const create = () => push({
        id: AGENT_EDITOR_PANEL_ID,
        title: 'New agent',
        closeLabel: 'Cancel',
        content: <AgentCreatorPanel onClose={() => close(AGENT_EDITOR_PANEL_ID)} />,
    });

    return (
        <div className={styles.panel} data-testid="agents-panel">
            <div className={styles.header}>
                <span className={styles.spacer} />
                <Tooltip title="Read the agents again">
                    <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        aria-label="Refresh agents"
                        onClick={() => void reload()}
                    />
                </Tooltip>
                <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={create}
                    disabled={!client}
                    data-testid="new-agent"
                >
                    New agent
                </Button>
            </div>
            {!client ? (
                <Alert type="info" showIcon
                    message="No hybridflow store"
                    description={'This instance is not configured to reach one, so it has no agents to list. '
                        + 'The agents live in a database served by operation/hybridflow-store.'} />
            ) : error ? (
                <Alert type="error" showIcon
                    message="The agents could not be read"
                    description={error}
                    action={<Button size="small" onClick={() => void reload()}>Try again</Button>} />
            ) : loading && agents.length === 0 ? (
                <div className={styles.center}><Spin size="small" /></div>
            ) : (
                <div className={styles.list}>
                    {agents.map(agent => (
                        <AgentRow
                            key={agent.id}
                            agent={agent}
                            platformLabel={platformLabelOf(agent.platform)}
                            expanded={!!open[agent.id]}
                            onToggle={() => setOpen(held => ({ ...held, [agent.id]: !held[agent.id] }))}
                            onEdit={() => edit(agent)}
                            onRemove={() => remove(agent.id)}
                        />
                    ))}
                    {agents.length === 0 && (
                        <p className={styles.hint}>
                            No agents yet. An agent is a name for a platform, a model and standing
                            instructions, with a description to help choose it for a task.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};
