import React, { useEffect, useState } from 'react';
import { Alert, Button, Input, Tag } from 'antd';
import type { AgentProfileSecret } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { ProfileField } from './ProfileField';
import { errorText } from './profileEditing';
import styles from './AgentProfiles.module.css';

export const PrivateKeysPanel: React.FC<{
    secrets: AgentProfileSecret[];
    suggestedId: string;
    onStored: (reference: string) => Promise<void>;
    onDeleted: () => Promise<void>;
}> = ({ secrets, suggestedId, onStored, onDeleted }) => {
    const client = useWorkerClient();
    const [keyId, setKeyId] = useState(suggestedId);
    const [value, setValue] = useState('');
    const [shown, setShown] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    useEffect(() => { setKeyId(suggestedId); }, [suggestedId]);
    const action = async (id: string, work: () => Promise<void>) => {
        setBusy(id); setError(''); setNotice('');
        try { await work(); } catch (cause) { setError(errorText(cause)); }
        finally { setBusy(''); }
    };
    const replacing = secrets.some(secret => secret.id === keyId.trim());
    return <div className={styles.keys} data-testid="private-keys-panel">
        <p className={styles.hint}>Keys are shared by profiles on this runner. Choose a stored key in a connection to use it.</p>
        {error && <Alert type="error" showIcon title={error} />}
        {notice && <Alert type="success" showIcon title={notice} />}
        <div className={styles.section}>
            <h3>Store an API key</h3>
            <div className={styles.fields}>
                <ProfileField label="Key name" help="A name you recognise, such as deepseek-work. Letters, numbers, dots, dashes and underscores.">
                    <Input aria-label="Private key reference" placeholder="deepseek-work" value={keyId} onChange={event => setKeyId(event.target.value)} />
                </ProfileField>
                <ProfileField label="API key">
                    <Input.Password aria-label="Private API key" autoComplete="new-password" placeholder="Paste your API key" value={value} onChange={event => setValue(event.target.value)} />
                </ProfileField>
            </div>
            {replacing && <p className={styles.hint}>This replaces the key named {keyId.trim()} for every connection using it.</p>}
            <div><Button type="primary" disabled={!value.trim() || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(keyId.trim()) || !!busy} loading={busy === 'store'} onClick={() => void action('store', async () => {
                const id = keyId.trim();
                await client.putAgentProfileSecret(id, value);
                setValue(''); setShown({});
                await onStored(`private:${id}`);
                setNotice(`Key ${id} stored.`);
            })}>{replacing ? 'Replace key' : 'Store key'}</Button></div>
        </div>
        <h3>Stored API keys ({secrets.length})</h3>
        {!secrets.length && <p>No keys stored yet. Add one above, then select it in a connection.</p>}
        {secrets.map(secret => <div key={secret.id} className={styles.keyRow} data-testid={`private-key-${secret.id}`}>
            <div className={styles.row}><strong className={styles.grow}>{secret.id}</strong><Tag color="green">Stored</Tag></div>
            <div className={styles.keyValue}>{shown[secret.id] ?? secret.preview}</div>
            <div className={styles.hint}>{secret.usedBy.length
                ? `Used by ${secret.usedBy.map(use => `${use.profileName} / ${use.provider}`).join(', ')}`
                : 'Not used by a profile'}</div>
            <div className={styles.row}>
                <Button size="small" disabled={!!busy} onClick={() => void action(secret.id, async () => {
                    if (shown[secret.id]) setShown(current => { const next = { ...current }; delete next[secret.id]; return next; });
                    else {
                        const key = await client.getAgentProfileSecret(secret.id);
                        setShown(current => ({ ...current, [secret.id]: key }));
                    }
                })}>{shown[secret.id] ? 'Hide key' : 'Show key'}</Button>
                <Button size="small" danger disabled={!!busy} onClick={() => void action(secret.id, async () => {
                    await client.deleteAgentProfileSecret(secret.id);
                    setShown(current => { const next = { ...current }; delete next[secret.id]; return next; });
                    await onDeleted();
                    setNotice(`Key ${secret.id} removed. Connections using it need another key.`);
                })}>Remove key</Button>
            </div>
        </div>)}
    </div>;
};
