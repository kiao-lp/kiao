import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Tabs, message } from 'antd';
import { DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { AsyncList, IconButton, useCentralStack, useConfirmation, useToolBarsOptional } from '@kiao-dashboard-core';
import type { AgentDto, AgenticResourceDto, ResourceKind } from '../types';
import { useResourceClient } from '../Client-ctx';
import { useAgents } from '../Agents-ctx';
import { AgentCreationModal, AgentEditorPanel, DELETE_HELP, useAgentHarnessOptions } from './AgentEditorPanel';
import { ProjectEditorPanel } from './ProjectEditorPanel';
import { resourceLabels } from './ResourceEditor';
import styles from './AgenticResourcesPanel.module.css';

const tabs = [
    { key: 'agent', label: 'Agents' },
    { key: 'skill', label: 'Skills' },
    { key: 'mcp', label: 'MCP' },
] as const;

const plurals = { agent: 'agents', skill: 'skills', mcp: 'MCP modules' };

interface CardProps {
    kind: ResourceKind;
    id: string;
    name: string;
    description?: string;
    details?: string;
    publishedVersion?: string;
    onEdit: () => void;
    onDelete?: () => void;
    deleteDisabled?: boolean;
    checkingDeletion?: boolean;
}

const ResourceCard: React.FC<CardProps> = ({
    kind, id, name, description, details, publishedVersion, onEdit, onDelete, deleteDisabled, checkingDeletion,
}) => {
    const [expanded, setExpanded] = useState(false);
    return <div className={styles.row} data-testid={`${kind}-card`}>
        <div className={styles.main}>
            <div className={styles.titleRow}>
                {description && <IconButton
                    label={`${expanded ? 'Hide' : 'Show'} description of ${name}`}
                    icon={expanded ? <DownOutlined /> : <RightOutlined />}
                    aria-expanded={expanded}
                    data-testid={`${kind}-description-toggle`} onClick={() => setExpanded(!expanded)}
                />}
                <span className={styles.name} data-testid={`${kind}-name-text`}>{name}</span>
            </div>
            {details && <span className={styles.meta} data-testid={`${kind}-meta`}>{details}</span>}
            <span className={styles.meta}>{publishedVersion ? `Published v${publishedVersion}` : 'Unpublished'}</span>
            {expanded && description && <p className={styles.description} data-testid={`${kind}-description-text`}>{description}</p>}
            {id !== name && <span aria-label="Agent ID" className={styles.id}>{id}</span>}
        </div>
        <span className={styles.actions}>
            <IconButton
                label={`Edit ${name}`}
                icon={<EditOutlined />}
                disabled={checkingDeletion} data-testid={`edit-${kind}`} onClick={onEdit}
            />
            {onDelete && <IconButton
                label={`Delete ${name}`}
                tooltip={DELETE_HELP}
                danger icon={<DeleteOutlined />}
                disabled={deleteDisabled} loading={checkingDeletion} aria-busy={checkingDeletion}
                data-testid={`delete-${kind}`} onClick={onDelete}
            />}
        </span>
    </div>;
};

const AgenticResourcesPanel: React.FC = () => {
    const confirm = useConfirmation();
    const client = useResourceClient();
    const { agents, loading: agentsLoading, error: agentsError, reload: reloadAgents, remove } = useAgents();
    const { push } = useCentralStack();
    const bars = useToolBarsOptional();
    const { harnessLabelOf } = useAgentHarnessOptions();
    const [kind, setKind] = useState<ResourceKind>('agent');
    const [creating, setCreating] = useState(false);
    const [projects, setProjects] = useState<AgenticResourceDto[] | null>(null);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [projectsError, setProjectsError] = useState<string | null>(null);
    const [refreshingAgents, setRefreshingAgents] = useState(false);
    const [checkingDeletion, setCheckingDeletion] = useState<string | null>(null);
    const checking = useRef(false);
    const latestRead = useRef(0);

    const reloadProjects = useCallback(async () => {
        if (!client) return [];
        const read = ++latestRead.current;
        setProjectsLoading(true);
        try {
            const list = await client.agenticResources();
            if (read === latestRead.current) {
                setProjects(list);
                setProjectsError(null);
            }
            return list;
        } catch (cause) {
            if (read === latestRead.current) setProjectsError(cause instanceof Error ? cause.message : String(cause));
            throw cause;
        } finally {
            if (read === latestRead.current) setProjectsLoading(false);
        }
    }, [client]);
    useEffect(() => {
        if (kind !== 'agent') void reloadProjects().catch(() => {});
    }, [kind, reloadProjects]);

    const edit = (kind: ResourceKind, name: string, content: React.ReactNode) => push({
        id: `${kind}-editor`, host: bars?.activeCentralTab() ?? undefined,
        title: `Edit ${resourceLabels[kind]} “${name}”`, closeLabel: 'Close', content,
    });
    const editAgent = (agent: AgentDto) => edit('agent', agent.name, <AgentEditorPanel key={agent.id} agentId={agent.id} />);
    const editProject = (project: AgenticResourceDto) => {
        if (client) edit(project.kind, project.name,
            <ProjectEditorPanel key={project.name} client={client} project={project} reloadProjects={reloadProjects} />);
    };
    const confirmDelete = async (agent: AgentDto) => {
        if (!client || checking.current) return;
        checking.current = true;
        setCheckingDeletion(agent.id);
        try {
            const status = await client.deletionStatus(agent.id);
            confirm({
                title: `Delete ${agent.name}?`,
                description: <div>
                    <p>{DELETE_HELP}</p>
                    {status.noRemote && <Alert type="warning" title="This repository has no remote. Its local history will be deleted." />}
                    {status.dirty && <Alert type="warning" title="This repository has uncommitted changes." />}
                    {status.unpushed && <Alert type="warning" title="This repository has local commits or tags that have not been pushed." />}
                    {status.remoteUnavailable && <Alert type="warning" title="The remote could not be checked." />}
                </div>,
                onConfirm: () => remove(agent.id, status.confirmation),
            });
        } catch (cause) { message.error(String(cause)); }
        finally {
            checking.current = false;
            setCheckingDeletion(null);
        }
    };

    const isAgents = kind === 'agent';
    const loading = isAgents ? agentsLoading : projectsLoading || !projects;
    const error = isAgents ? agentsError : projectsError;
    const refreshing = isAgents ? agentsLoading || refreshingAgents : projectsLoading;
    const reload = async () => {
        if (refreshing) return;
        if (isAgents) {
            setRefreshingAgents(true);
            try { await reloadAgents(); }
            finally { setRefreshingAgents(false); }
        } else {
            await reloadProjects().catch(() => {});
        }
    };
    const rows = isAgents ? agents.map(agent => <ResourceCard key={agent.id} id={agent.id} name={agent.name} kind="agent"
        description={agent.description} publishedVersion={agent.published?.version}
        details={agent.harnesses?.length ? agent.harnesses.map(harnessLabelOf).join(' · ')
            : `${harnessLabelOf(agent.harness)} · ${agent.model || 'default model'}`}
        onEdit={() => editAgent(agent)} onDelete={() => void confirmDelete(agent)}
        deleteDisabled={checkingDeletion !== null} checkingDeletion={checkingDeletion === agent.id} />)
        : (projects ?? []).filter(project => project.kind === kind).map(project => <ResourceCard key={project.name}
            id={project.name} name={project.name} kind={kind} description={project.description}
            publishedVersion={project.publishedVersion} onEdit={() => editProject(project)} />);

    const content = <>
        <div className={styles.header}>
            <IconButton
                label={`Refresh ${plurals[kind]}`}
                icon={<ReloadOutlined />}
                loading={refreshing} disabled={!client || refreshing} aria-busy={refreshing} onClick={() => void reload()}
            />
            {isAgents && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}
                disabled={!client} data-testid="new-agent">New agent</Button>}
        </div>
        {!client ? <Alert type="info" showIcon title="Agentic resource manager unavailable" /> : (
            <AsyncList loading={loading && !rows.length} error={error} errorTitle={`The ${plurals[kind]} could not be read`}
                onRetry={reload} retrying={refreshing}
                empty={!rows.length && (isAgents
                    ? 'Add an agent from its Git repository or create a local agent.'
                    : `No ${plurals[kind]} in the store.`)}>
                <div className={styles.list}>{rows}</div>
            </AsyncList>
        )}
    </>;

    return <div className={styles.panel} data-testid="agentic-resources-panel">
        <Tabs size="small" activeKey={kind} onChange={key => setKind(key as ResourceKind)}
            items={tabs.map(tab => ({ ...tab, children: tab.key === kind ? content : undefined }))} />
        <AgentCreationModal open={creating} onClose={() => setCreating(false)} onCreated={editAgent} />
    </div>;
};

export default AgenticResourcesPanel;
