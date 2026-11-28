import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Tag } from 'antd';
import type { HarnessProfileSecret } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { FormField } from '../ui-foundation/forms/FormField';
import { errorText } from './profileEditing';
import styles from './HarnessProfiles.module.css';

type KeyAction = { kind: 'store' } | { kind: 'show' | 'remove'; id: string };

export const PrivateKeysPanel: React.FC<{
    secrets: HarnessProfileSecret[];
    suggestedId: string;
    onStored: (reference: string) => Promise<void>;
    onDeleted: () => Promise<void>;
    onBusyChange: (busy: boolean) => void;
}> = ({ secrets, suggestedId, onStored, onDeleted, onBusyChange }) => {
    const client = useWorkerClient();
    const [keyId, setKeyId] = useState(suggestedId);
    const [value, setValue] = useState('');
    const [shown, setShown] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<KeyAction | null>(null);
    const running = useRef(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    useEffect(() => { setKeyId(suggestedId); }, [suggestedId]);
    const action = async (next: KeyAction, work: () => Promise<void>) => {
        if (running.current) return;
        running.current = true;
        setBusy(next); onBusyChange(true); setError(''); setNotice('');
        try { await work(); } catch (cause) { setError(errorText(cause)); }
        finally {
            running.current = false;
            setBusy(null);
            onBusyChange(false);
        }
    };
    const hide = (id: string) => setShown(current => {
        const next = { ...current };
        delete next[id];
        return next;
    });
    const storing = busy?.kind === 'store';
    const replacing = secrets.some(secret => secret.id === keyId.trim());
    return <div className={styles.keys} data-testid="private-keys-panel">
        <p className={styles.hint}>Keys are shared by profiles on this runner. Choose a stored key in a connection to use it.</p>
        {error && <Alert type="error" showIcon title={error} />}
        {notice && <Alert type="success" showIcon title={notice} />}
        <div className={styles.section}>
            <h3>Store an API key</h3>
            <div className={styles.fields}>
                <FormField label="Key name" help="A name you recognise, such as deepseek-work. Letters, numbers, dots, dashes and underscores.">
                    <Input aria-label="Private key reference" placeholder="deepseek-work" value={keyId} disabled={storing}
                        onChange={event => setKeyId(event.target.value)} />
                </FormField>
                <FormField label="API key">
                    <Input.Password aria-label="Private API key" autoComplete="new-password" placeholder="Paste your API key" value={value}
                        disabled={storing} onChange={event => setValue(event.target.value)} />
                </FormField>
            </div>
            {replacing && <p className={styles.hint}>This replaces the key named {keyId.trim()} for every connection using it.</p>}
            <div><Button type="primary" disabled={!value.trim() || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(keyId.trim()) || !!busy}
                loading={storing} aria-busy={storing} onClick={() => void action({ kind: 'store' }, async () => {
                const id = keyId.trim();
                await client.putHarnessProfileSecret(id, value);
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
                <Button size="small" disabled={!!busy} loading={busy?.kind === 'show' && busy.id === secret.id} onClick={() => {
                    if (shown[secret.id]) hide(secret.id);
                    else void action({ kind: 'show', id: secret.id }, async () => {
                        const key = await client.getHarnessProfileSecret(secret.id);
                        setShown(current => ({ ...current, [secret.id]: key }));
                    });
                }}>{shown[secret.id] ? 'Hide key' : 'Show key'}</Button>
                <Button size="small" danger disabled={!!busy} loading={busy?.kind === 'remove' && busy.id === secret.id}
                    onClick={() => void action({ kind: 'remove', id: secret.id }, async () => {
                    await client.deleteHarnessProfileSecret(secret.id);
                    hide(secret.id);
                    await onDeleted();
                    setNotice(`Key ${secret.id} removed. Connections using it need another key.`);
                })}>Remove key</Button>
            </div>
        </div>)}
    </div>;
};
