import React, { useCallback, useEffect, useState } from 'react';
import { DisconnectOutlined, WarningOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Select, Tooltip } from 'antd';
import { useAgents } from '../Agents-ctx';
import type { ResourceClient } from '../Client';
import type { AgentDependencyDto, AgentDependencyKind } from '../types';
import styles from './AgentEditorPanel.module.css';

interface Props {
    agentId: string;
    client: ResourceClient;
    kind: AgentDependencyKind;
    disabled: boolean;
    saving: AgentDependencyKind | null;
    setSaving: (kind: AgentDependencyKind | null) => void;
    updateLocalDependencies: (kind: AgentDependencyKind, hasLocal: boolean) => void;
}

const labels = {
    skills: { title: 'Skills', plural: 'skills', link: 'Link a skill', prefix: 'skill-' },
    mcp: { title: 'MCP modules', plural: 'MCP modules', link: 'Link an MCP module', prefix: 'mcp-' },
};

const noRemoteWarning = 'This resource is not backed up in a remote Git repository.';

export const AgentDependenciesField: React.FC<Props> = ({ agentId, client, kind, disabled, saving, setSaving, updateLocalDependencies }) => {
    const { setDependency } = useAgents();
    const [dependencies, setDependencies] = useState<AgentDependencyDto[] | null>(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const { title, plural, link, prefix } = labels[kind];
    const labelOf = (name: string) => name.slice(prefix.length);
    const update = useCallback((list: AgentDependencyDto[]) => {
        setDependencies(list);
        updateLocalDependencies(kind, list.some(entry => entry.linked && entry.local));
    }, [kind, updateLocalDependencies]);

    useEffect(() => {
        let current = true;
        void client.agentDependencies(agentId, kind).then(list => {
            if (current) update(list);
        }).catch(cause => {
            if (current) setError(`Could not load ${plural}. ${cause.message}`);
        });
        return () => { current = false; };
    }, [agentId, client, kind, plural, attempt, update]);

    const change = async (name: string, linked: boolean, local = false) => {
        setSaving(kind);
        setError('');
        try {
            await setDependency(agentId, kind, name, linked, local);
            update(await client.agentDependencies(agentId, kind));
        } catch (cause) {
            setError(`Could not update ${labelOf(name)}. ${cause instanceof Error ? cause.message : cause}`);
        } finally {
            setSaving(null);
        }
    };

    const linked = dependencies?.filter(entry => entry.linked) ?? [];
    const options = dependencies?.filter(entry => entry.available && !entry.linked)
        .map(entry => ({ value: entry.name, label: labelOf(entry.name) })) ?? [];
    const controlsDisabled = disabled || saving !== null;

    return <section aria-label={title} className={styles.field}>
        <span className={styles.label}>{title}</span>
        {error && <Alert type="error" showIcon message={error} action={!dependencies && <Button size="small"
            onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</Button>} />}
        {!dependencies && !error && <span role="status">Loading {plural}…</span>}
        {dependencies && <>
            {linked.length ? <table className={styles.dependencyTable} aria-label={`Linked ${plural}`}>
                <thead><tr>
                    <th scope="col">Resource</th>
                    <th scope="col">Local</th>
                    <th scope="col">Unlink</th>
                </tr></thead>
                <tbody>{linked.map(entry => <tr key={entry.name}>
                    <td>{labelOf(entry.name)}</td>
                    <td>{entry.hasRemote
                        ? <Checkbox checked={entry.local} disabled={controlsDisabled || (!entry.available && !entry.local)}
                            aria-label={`Use local repository for ${labelOf(entry.name)}`}
                            onChange={event => void change(entry.name, true, event.target.checked)} />
                        : <Tooltip title={noRemoteWarning} trigger={['hover', 'focus']}>
                            <WarningOutlined className={styles.dependencyWarning} aria-label={noRemoteWarning} tabIndex={0} />
                        </Tooltip>}
                    </td>
                    <td><Button size="small" type="text" icon={<DisconnectOutlined />} disabled={controlsDisabled}
                        aria-label={`Unlink ${labelOf(entry.name)}`} title={`Unlink ${labelOf(entry.name)}`}
                        onClick={() => void change(entry.name, false)} /></td>
                </tr>)}</tbody>
            </table> : <span>No {plural} linked.</span>}
            <Select<string> aria-label={link} placeholder={`${link}…`} value={null}
                showSearch={{ optionFilterProp: 'label' }} options={options} disabled={controlsDisabled} loading={saving === kind}
                notFoundContent={options.length ? `No matching ${plural}` : `No ${plural} available to link`}
                onSelect={name => void change(name, true)} />
        </>}
    </section>;
};
