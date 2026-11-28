import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Space, Typography } from 'antd';
import { useResourceClient } from '../Client-ctx';
import type { AgenticResourceDto } from '../types';
import type { ReleaseBump } from '../release';
import { useAgents } from '../Agents-ctx';
import { useResourceSource } from '../useResourceSource';
import { confirmAgentPush } from './confirmAgentPush';
import { PublishButtons } from './PublishButtons';
import { useResourceOperations } from './ResourceEditor';
import { ResourceSourceFields } from './ResourceSourceFields';

/** Edits the APM project working tree and publishes through Git. */
const LegacyAgenticResourcesPanel: React.FC = () => {
    const client = useResourceClient();
    const { reload: reloadAgents } = useAgents();
    const [resources, setResources] = useState<AgenticResourceDto[]>([]);
    const [selected, setSelected] = useState('');
    const [selectedPath, setPath] = useState('apm.yml');
    const [error, setError] = useState('');
    const [reading, setReading] = useState(false);
    const latestRead = useRef(0);
    const reload = useCallback(async () => {
        if (!client) return;
        const read = ++latestRead.current;
        setReading(true);
        try {
            const list = await client.agenticResources();
            if (read === latestRead.current) { setResources(list); setError(''); }
        } catch (cause) {
            if (read === latestRead.current) setError(String(cause));
        } finally {
            if (read === latestRead.current) setReading(false);
        }
    }, [client]);
    useEffect(() => { void reload(); }, [reload]);
    const resource = resources.find(one => one.name === selected);
    const path = resource?.files.includes(selectedPath) ? selectedPath : resource?.files[0];
    const refresh = async () => { await reloadAgents(); await reload(); };
    const source = useResourceSource(client, resource?.name, path, refresh);
    const { active, busy: operating, error: operationError, dismissError, run } = useResourceOperations(source.flush);
    const busy = operating || source.switching;
    if (!client) return <p>This instance needs an agentic resource manager to manage agentic resources.</p>;

    const operate = (operation: 'install' | 'publish' | 'pull' | 'push', bump?: ReleaseBump) => run(operation, async () => {
        await confirmAgentPush(confirmation => client.resourceOperation(selected, operation, { confirmation, bump }));
        await refresh();
        await source.reload();
    }, bump);

    return <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <Alert type="error" title={error} />}
        {operationError && <Alert type="error" title={operationError.detail} closable={{ onClose: dismissError }} />}
        <Select aria-label="Agentic resource" placeholder={reading ? 'Loading resources…' : 'Select a resource'}
            value={selected || undefined} disabled={busy} loading={reading}
            onChange={name => { void source.switchFile(() => { setSelected(name); setPath('apm.yml'); }); }}
            options={resources.map(one => ({
                value: one.name,
                label: [one.name, one.version && `v${one.version}`, one.dirty && 'draft'].filter(Boolean).join(' · '),
            }))} />
        {resource && <>
            <Typography.Text>{resource.repository || 'Local Git repository'}</Typography.Text>
            <Typography.Text code>{resource.commit}</Typography.Text>
            <Space wrap>
                <Button disabled={busy} loading={active?.operation === 'install'} onClick={() => void operate('install')}>Install dependencies</Button>
                <Button disabled={busy || !resource.repository} loading={active?.operation === 'pull'} onClick={() => void operate('pull')}>Git pull</Button>
                <Button disabled={busy || !resource.repository} loading={active?.operation === 'push'} onClick={() => void operate('push')}>Git push</Button>
                <Button disabled={busy || reading} loading={reading && !operating} onClick={() => void reload()}>Refresh</Button>
            </Space>
            {resource.kind !== 'agent' && <>
                <PublishButtons disabled={busy || !resource.version} version={resource.version} publishing={active?.bump}
                    onPublish={bump => void operate('publish', bump)} />
                {!resource.version && <p role="status">Set a major.minor.patch version in apm.yml to publish.</p>}
            </>}
            <ResourceSourceFields files={resource.files} path={path} select={setPath} source={source} busy={busy}
                readOnly={resource.kind === 'agent' && path === 'agent.json'} />
        </>}
    </div>;
};
export default LegacyAgenticResourcesPanel;
