import React from 'react';
import { Alert, Button, Checkbox, Input, InputNumber, Radio, Select, Tag } from 'antd';
import type { AgentProfileConnection, AgentProfileModel, AgentProfileSecret } from 'kiao-worker';
import { ProfileField } from './ProfileField';
import { endpointProblem } from './profileEditing';
import styles from './AgentProfiles.module.css';

export const ProfileConnectionEditor: React.FC<{
    connection: AgentProfileConnection;
    index: number;
    defaultModel?: string;
    secrets: AgentProfileSecret[];
    secretConfigured: boolean;
    disabled: boolean;
    onChange: (connection: AgentProfileConnection) => void;
    onDefault: (model: string) => void;
    onRemove: () => void;
    onAddKey: () => void;
}> = ({ connection, index, defaultModel, secrets, secretConfigured, disabled, onChange, onDefault, onRemove, onAddKey }) => {
    const number = index + 1;
    const update = (patch: Partial<AgentProfileConnection>) => onChange({ ...connection, ...patch });
    const updateModel = (at: number, patch: Partial<AgentProfileModel>) => update({ models: connection.models.map((model, i) => i === at ? { ...model, ...patch } : model) });
    const endpoint = endpointProblem(connection);
    const environmentKey = connection.secretRef?.startsWith('env:');
    const missingKey = connection.secretRef?.startsWith('private:') && !secrets.some(secret => secret.reference === connection.secretRef);
    return <section className={styles.connection} aria-label={`Connection ${number}`}>
        <div className={styles.row}>
            <h3>{connection.provider || `Connection ${number}`}</h3>
            <Button size="small" danger onClick={onRemove}>Remove connection</Button>
        </div>
        <div className={styles.fields}>
            <ProfileField label="Connection name" help="A unique name for this provider or account, such as deepseek-work.">
                <Input aria-label={`Provider ${number}`} placeholder="deepseek-work" value={connection.provider} onChange={event => update({ provider: event.target.value })} />
            </ProfileField>
            <ProfileField label="API format">
                <Select aria-label={`API protocol ${number}`} value={connection.api} options={[
                    { value: 'openai-completions', label: 'OpenAI compatible (Chat Completions)' },
                    { value: 'openai-responses', label: 'OpenAI Responses' },
                    { value: 'anthropic-messages', label: 'Anthropic Messages' },
                    { value: 'google-generative-ai', label: 'Google Generative AI' },
                ]} onChange={api => update({ api })} />
            </ProfileField>
        </div>
        <ProfileField label="API base URL" help="Use the provider’s base URL, for example https://api.deepseek.com. Pi adds the request path.">
            <Input aria-label={`Endpoint ${number}`} placeholder="https://api.deepseek.com" value={connection.baseUrl} status={endpoint ? 'warning' : undefined} onChange={event => update({ baseUrl: event.target.value })} />
        </ProfileField>
        {endpoint && <Alert type="warning" showIcon title={endpoint} action={<Button size="small" onClick={() => update({ baseUrl: connection.baseUrl.replace(/\/(chat\/completions|responses)\/?$/, '') })}>Use base URL</Button>} />}
        <ProfileField label="API key" help="Select a stored key, or add one below. Use no key only when the API requires none.">
            <Select aria-label={`API key ${number}`} value={environmentKey ? 'env' : connection.secretRef || ''}
                options={[
                    { value: '', label: 'No API key (local API)' },
                    ...secrets.map(secret => ({ value: secret.reference, label: `${secret.id} · ${secret.preview}` })),
                    ...(missingKey ? [{ value: connection.secretRef!, label: `${connection.secretRef!.slice(8)} (not stored)` }] : []),
                    { value: 'env', label: 'Environment variable (advanced)' },
                ]}
                onChange={value => update({ secretRef: value === 'env' ? 'env:' : value })} />
        </ProfileField>
        {environmentKey && <ProfileField label="Environment variable name" help="The variable must be set on the runner that executes Pi.">
            <Input aria-label={`Environment variable ${number}`} placeholder="PROVIDER_API_KEY" value={connection.secretRef!.slice(4)} onChange={event => update({ secretRef: `env:${event.target.value}` })} />
        </ProfileField>}
        <div className={styles.row}>
            <Tag color={!connection.secretRef ? undefined : secretConfigured ? 'green' : 'orange'}>
                {!connection.secretRef ? 'No API key selected' : secretConfigured ? 'Key available' : 'Key missing'}
            </Tag>
            <Button size="small" onClick={onAddKey}>Add API key</Button>
        </div>
        {connection.secretRef && !secretConfigured && <p className={styles.hint}>This key is not available on the runner. Store it or choose another key.</p>}
        <h4>Models offered by this connection</h4>
        <p className={styles.hint}>Add the model IDs your provider supports. Agents and conversations can choose any of these models.</p>
        {!connection.models.length && <Alert type="info" showIcon title="No models added" description="Add at least one model ID before checking this connection." />}
        {connection.models.map((model, at) => <div key={at} className={styles.model}>
            <ProfileField label={`Model ID ${at + 1}`}>
                <Input aria-label={`Model ${number}.${at + 1}`} placeholder="Model ID from your provider" value={model.id} onChange={event => updateModel(at, { id: event.target.value })} />
            </ProfileField>
            <div className={styles.row}>
                <Radio checked={!!model.id && defaultModel === `${connection.provider}/${model.id}`} disabled={disabled || !model.id.trim()} onChange={() => onDefault(`${connection.provider}/${model.id}`)}>Use by default</Radio>
                <Button size="small" onClick={() => update({ models: connection.models.filter((_, i) => i !== at) })}>Remove model</Button>
            </div>
            <details className={styles.advanced}>
                <summary>Model capabilities and limits</summary>
                <div className={styles.section}>
                    <div className={styles.row}>
                        <Checkbox checked={model.reasoning} onChange={event => updateModel(at, { reasoning: event.target.checked })}>Supports reasoning</Checkbox>
                        <Checkbox checked={model.input?.includes('image')} onChange={event => updateModel(at, { input: event.target.checked ? ['text', 'image'] : ['text'] })}>Accepts images</Checkbox>
                    </div>
                    <div className={styles.fields}>
                        <ProfileField label="Context window (tokens)">
                            <InputNumber aria-label={`Context window ${number}.${at + 1}`} placeholder="Pi default" min={1} precision={0} value={model.contextWindow} onChange={value => updateModel(at, { contextWindow: value ?? undefined })} />
                        </ProfileField>
                        <ProfileField label="Maximum output (tokens)">
                            <InputNumber aria-label={`Output limit ${number}.${at + 1}`} placeholder="Pi default" min={1} precision={0} value={model.maxTokens} onChange={value => updateModel(at, { maxTokens: value ?? undefined })} />
                        </ProfileField>
                    </div>
                </div>
            </details>
        </div>)}
        <div><Button onClick={() => update({ models: [...connection.models, { id: '', reasoning: false, input: ['text'] }] })}>Add model</Button></div>
    </section>;
};
