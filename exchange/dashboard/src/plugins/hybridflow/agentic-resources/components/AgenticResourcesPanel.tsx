import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space, Typography, message } from 'antd';
import { useResourceClient } from '../Client-ctx';
import type { AgenticResourceDto } from '../types';
import type { ReleaseBump } from '../release';
import { useAgents } from '../Agents-ctx';
import { confirmAgentPush } from './confirmAgentPush';
import { PublishButtons } from './PublishButtons';

/** Edits the APM project working tree and publishes through Git. */
const AgenticResourcesPanel: React.FC = () => {
    const client = useResourceClient();
    const { reload: reloadAgents } = useAgents();
    const [resources, setResources] = useState<AgenticResourceDto[]>([]);
    const [selected, setSelected] = useState('');
    const [path, setPath] = useState('apm.yml');
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const writing = useRef<Promise<unknown>>(Promise.resolve());
    const pending = useRef<null | (() => Promise<void>)>(null);
    const generation = useRef(0);
    const revision = useRef<string>();
    const reload = useCallback(async () => {
        if (!client) return;
        try { setResources(await client.agenticResources()); setError(''); }
        catch (cause) { setError(String(cause)); }
    }, [client]);
    useEffect(() => { void reload(); }, [reload]);
    const flush = useCallback(async () => {
        clearTimeout(timer.current);
        const save = pending.current;
        pending.current = null;
        if (save) writing.current = writing.current.catch(() => {}).then(save);
        await writing.current;
    }, []);
    useEffect(() => {
        const current = ++generation.current;
        setLoaded(false);
        if (client && selected) void flush().then(() => client.resourceFile(selected, path)).then(file => {
            if (current === generation.current) { setContent(file.content); revision.current = file.revision; setLoaded(true); }
        }).catch(cause => { if (current === generation.current) setError(String(cause)); });
    }, [client, selected, path, flush]);
    useEffect(() => {
        const save = () => { void flush().catch(cause => message.error(String(cause))); };
        window.addEventListener('beforeunload', save);
        return () => { window.removeEventListener('beforeunload', save); save(); };
    }, [flush]);
    const resource = resources.find(one => one.name === selected);
    const change = (value: string) => {
        setContent(value);
        clearTimeout(timer.current);
        pending.current = async () => {
            const saved = await client!.writeResourceFile(selected, { path, content: value, revision: revision.current });
            revision.current = saved.revision;
            await reloadAgents();
            await reload();
        };
        timer.current = setTimeout(() => { void flush().catch(cause => setError(String(cause))); }, 1000);
    };
    const operate = async (operation: 'install' | 'publish' | 'pull' | 'push', bump?: ReleaseBump) => {
        setBusy(true);
        try {
            await flush();
            await confirmAgentPush(confirmation => client!.resourceOperation(selected, operation, { confirmation, bump }));
            await reloadAgents();
            await reload();
            const file = await client!.resourceFile(selected, path);
            setContent(file.content);
            revision.current = file.revision;
            setError('');
        } catch (cause) { setError(String(cause)); }
        finally { setBusy(false); }
    };
    if (!client) return <p>This instance needs an agentic resource manager to manage agentic resources.</p>;
    return <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <Alert type="error" message={error} />}
        <Select aria-label="Agentic resource" placeholder="Select a resource" value={selected || undefined} disabled={busy}
            onChange={name => { setSelected(name); setPath('apm.yml'); }}
            options={resources.map(one => ({
                value: one.name,
                label: [one.name, one.version && `v${one.version}`, one.dirty && 'draft'].filter(Boolean).join(' · '),
            }))} />
        {resource && <>
            <Typography.Text>{resource.repository || 'Local Git repository'}</Typography.Text>
            <Typography.Text code>{resource.commit}</Typography.Text>
            <Space wrap>
                <Button disabled={busy} onClick={() => void operate('install')}>Install dependencies</Button>
                <Button disabled={busy || !resource.repository} onClick={() => void operate('pull')}>Git pull</Button>
                <Button disabled={busy || !resource.repository} onClick={() => void operate('push')}>Git push</Button>
                <Button disabled={busy} onClick={() => void reload()}>Refresh</Button>
            </Space>
            {resource.kind !== 'agent' && <>
                <PublishButtons disabled={busy || !resource.version} onPublish={bump => void operate('publish', bump)} />
                {!resource.version && <p role="status">Set a major.minor.patch version in apm.yml to publish.</p>}
            </>}
            <Select aria-label="Resource file" value={path} onChange={setPath} disabled={busy}
                options={resource.files.map(file => ({ value: file, label: file }))} />
            {resource.kind === 'agent' && path === 'agent.json' && <p>Identity metadata is managed in the agent editor.</p>}
            <Input.TextArea aria-label="Resource source" disabled={busy || !loaded || (resource.kind === 'agent' && path === 'agent.json')} value={content}
                onChange={event => change(event.target.value)} autoSize={{ minRows: 12, maxRows: 35 }}
                style={{ fontFamily: 'monospace' }} />
        </>}
    </div>;
};
export default AgenticResourcesPanel;
