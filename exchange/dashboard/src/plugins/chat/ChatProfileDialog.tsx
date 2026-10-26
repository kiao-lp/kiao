import React, { useEffect, useState } from 'react';
import { Alert, Modal, Select, Space } from 'antd';
import type { AgentConversationCreate, AgentOptionsEntry } from 'kiao-worker';

export const ChatProfileDialog: React.FC<{
    entry: AgentOptionsEntry;
    onCancel: () => void;
    onCreate: (settings: Omit<AgentConversationCreate, 'folder'>) => Promise<void>;
}> = ({ entry, onCancel, onCreate }) => {
    const [profileId, setProfileId] = useState(entry.defaultProfileId ?? '');
    const [model, setModel] = useState('');
    const [effort, setEffort] = useState('');
    const [busy, setBusy] = useState(false);
    const profile = entry.profiles?.find(one => one.id === profileId);
    const choices = profile?.models ?? [];
    const selected = choices.find(one => one.value === model);
    useEffect(() => { setModel(profile?.defaultModel ?? ''); setEffort(profile?.defaultEffort ?? ''); }, [profileId]);
    useEffect(() => {
        if (selected && !selected.efforts.some(one => one.value === effort)) setEffort(selected.efforts[0]?.value ?? '');
    }, [selected, effort]);
    return <Modal open title={`${entry.label} — execution profile`} onCancel={onCancel}
        okText="Create conversation" confirmLoading={busy}
        okButtonProps={{ disabled: !profile || profile.status !== 'ready' || !selected }}
        onOk={async () => {
            setBusy(true);
            try { await onCreate({ agent: entry.value, profileId, model, effort, permissionMode: entry.permissionModes.some(one => one.value === 'manual') ? 'manual' : 'bypassPermissions' }); }
            finally { setBusy(false); }
        }}>
        <Space orientation="vertical" style={{ width: '100%' }}>
            <Select aria-label="Conversation profile" style={{ width: '100%' }} placeholder="Select an execution profile" value={profileId || undefined}
                options={(entry.profiles ?? []).map(one => ({ value: one.id, label: `${one.name} · ${one.id}` }))} onChange={setProfileId} />
            {profile?.status !== 'ready' && <Alert type="info" title={profile?.message ?? 'Configure an execution profile in Configuration.'} />}
            <Select aria-label="Conversation model" style={{ width: '100%' }} placeholder="Model" value={model || undefined} options={choices} onChange={setModel} />
            <Select aria-label="Conversation reasoning" style={{ width: '100%' }} value={effort || undefined} options={selected?.efforts ?? []} onChange={setEffort} />
        </Space>
    </Modal>;
};
