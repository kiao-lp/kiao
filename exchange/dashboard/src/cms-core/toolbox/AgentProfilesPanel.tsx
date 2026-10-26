import React, { useState } from 'react';
import { Alert, Button, Checkbox, ConfigProvider, Input, Select, Spin, Tabs, Tag } from 'antd';
import type { AgentProfile, AgentProfileConnection, AgentProfileConnectionDiagnostic, AgentProfileModelOption } from 'kiao-worker';
import { useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { TOOLBOX_TAB_ID } from './panelIds';
import { TOOLBOX_CHANGED_EVENT } from './events';
import { ProfileField } from './ProfileField';
import { ProfileConnectionEditor } from './ProfileConnectionEditor';
import { PrivateKeysPanel } from './PrivateKeysPanel';
import { useAgentProfiles } from './useAgentProfiles';
import { endpointProblem, errorText, modelChoices, replaceConnections } from './profileEditing';
import styles from './AgentProfiles.module.css';

type Diagnostic = { type: 'success' | 'warning' | 'error'; message: string; details?: string; connectionStatus?: AgentProfileConnectionDiagnostic['status']; models?: AgentProfileModelOption[] };

export const AgentProfilesPanel: React.FC = () => {
    const { client, state, doc, secrets, error, saveError, saveState, change, flush, refresh } = useAgentProfiles();
    const bars = useToolBarsOptional();
    const [selection, setSelection] = useState('');
    const [tab, setTab] = useState('profiles');
    const [keyTarget, setKeyTarget] = useState<{ profile: string; connection: number; suggestedId: string } | null>(null);
    const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
    const [checkedModels, setCheckedModels] = useState<AgentProfileModelOption[]>([]);
    const [checking, setChecking] = useState('');
    const [external, setExternal] = useState({ id: '', version: '1.3.0', path: '' });

    if (!doc || !state) return <div className={styles.panel}>{error ? <Alert type="error" title={error} /> : <div className={styles.row}><Spin /><span>Loading Pi profiles…</span></div>}</div>;
    const selected = selection || doc.profiles[0]?.id || '';
    const profile = doc.profiles.find(one => one.id === selected);
    const offer = state.profiles.find(one => one.id === selected);
    const update = (patch: Partial<AgentProfile>) => {
        if (profile) {
            setDiagnostic(null);
            if (patch.connections || patch.installationId) setCheckedModels([]);
            change({ ...doc, profiles: doc.profiles.map(one => one.id === selected ? { ...one, ...patch } : one) });
        }
    };
    const updateConnection = (index: number, connection: AgentProfileConnection) => {
        if (!profile) return;
        const previous = profile.connections[index];
        const chosen = previous.models.findIndex(model => `${previous.provider}/${model.id}` === profile.defaultModel);
        const next = replaceConnections(profile, profile.connections.map((one, at) => at === index ? connection : one));
        if (chosen >= 0 && previous.models.length === connection.models.length && connection.models[chosen]?.id.trim()) {
            next.defaultModel = `${connection.provider}/${connection.models[chosen].id}`;
        }
        update(next);
    };
    const choices = profile ? modelChoices(profile) : [];
    const checkedDefault = checkedModels.find(model => model.value === profile?.defaultModel);
    const keysWithDraftUses = secrets.map(secret => ({ ...secret, usedBy: doc.profiles.flatMap(one => one.connections
        .filter(connection => connection.secretRef === secret.reference)
        .map(connection => ({ profileId: one.id, profileName: one.name, provider: connection.provider }))) }));

    const check = async (api: boolean) => {
        if (!profile) return;
        setChecking(api ? 'api' : 'models'); setDiagnostic(null);
        try {
            if (!await flush()) { setDiagnostic({ type: 'warning', message: 'Your changes could not be saved. Fix the fields indicated above and try again.' }); return; }
            if (!choices.length) { setDiagnostic({ type: 'warning', message: 'No models are configured. Add a model ID to a connection, then check again.' }); return; }
            const endpoint = profile.connections.map(endpointProblem).find(Boolean);
            if (endpoint) { setDiagnostic({ type: 'warning', message: endpoint }); return; }
            if (api) {
                const result = await client.checkAgentProfileConnection(selected, profile.defaultModel ?? '');
                setDiagnostic(result.status === 'ready'
                    ? { type: 'success', message: `API connection succeeded for ${profile.defaultModel}. The endpoint and API key accepted the test request.` }
                    : { type: result.status === 'configuration_error' ? 'warning' : 'error', message: result.message || 'The connection test could not complete.', details: result.details, connectionStatus: result.status });
            } else {
                const result = await client.diagnoseAgentProfile(selected);
                setCheckedModels(result.models);
                setDiagnostic(result.models.length
                    ? { type: 'success', message: `${result.models.length} configured model${result.models.length === 1 ? '' : 's'} recognised by Pi. API access has not been tested.`, models: result.models }
                    : { type: 'warning', message: 'Pi did not recognise any configured model. Check the connection, model IDs and API key.' });
            }
            window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
        } catch (cause) { setDiagnostic({ type: 'error', message: errorText(cause) }); }
        finally { setChecking(''); }
    };

    return <div data-testid="agent-profiles-panel" className={styles.panel}>
        <header className={styles.header}>
            <h2>Pi profiles</h2>
            <p className={styles.hint}>Choose how Pi connects to your model providers. Reuse a profile in agents and conversations. Changes apply to their next turn.</p>
            {error && <Alert type="error" showIcon title={error} />}
        </header>
        <ConfigProvider componentDisabled={!!checking}>
        <Tabs activeKey={tab} onChange={next => { if (checking) return; setTab(next); if (next !== 'keys') setKeyTarget(null); }} destroyOnHidden items={[
            { key: 'profiles', label: 'Profiles', children: <div>
                <div className={styles.section}>
                    <div className={styles.row}>
                        <Select aria-label="Execution profile" placeholder="Select a profile" value={selected || undefined} className={styles.grow}
                            options={doc.profiles.map(one => ({ value: one.id, label: one.name }))} disabled={!!checking}
                            onChange={id => { setSelection(id); setDiagnostic(null); setCheckedModels([]); }} />
                        <Button disabled={!!checking} onClick={() => {
                            const id = `pi-${crypto.randomUUID()}`;
                            change({ ...doc, defaultPiProfileId: doc.defaultPiProfileId || id, profiles: [...doc.profiles, { id, name: `Pi profile ${doc.profiles.length + 1}`, revision: 0, installationId: state.availableInstallations[0]?.id ?? '', connections: [], mcpServers: null }] });
                            setSelection(id); setDiagnostic(null); setCheckedModels([]);
                        }}>New profile</Button>
                    </div>
                    {!profile && <p>Create a profile, select a Pi installation, then add a connection and its models.</p>}
                    {profile && <>
                        <div className={styles.fields}>
                            <ProfileField label="Profile name"><Input aria-label="Profile name" value={profile.name} onChange={event => update({ name: event.target.value })} /></ProfileField>
                            <ProfileField label="Pi installation"><Select aria-label="Pi installation" placeholder="Select an installation" value={profile.installationId || undefined}
                                options={state.availableInstallations.map(one => ({ value: one.id, label: `Pi ${one.version} · ${one.id}` }))} onChange={installationId => update({ installationId })} /></ProfileField>
                        </div>
                        {!state.availableInstallations.length && <Alert type="info" showIcon title="Install Pi to use this profile" action={bars && <Button onClick={() => bars.showTab(TOOLBOX_TAB_ID)}>Open Configuration</Button>} description="Install Pi in Configuration, or declare an external installation in Advanced." />}
                        <Checkbox checked={doc.defaultPiProfileId === selected} onChange={event => change({ ...doc, defaultPiProfileId: event.target.checked ? selected : '' })}>Use this profile for new Pi conversations</Checkbox>
                        <div className={styles.row}>
                            {saveState === 'saved' && offer && <Tag color={offer.status === 'ready' ? 'green' : 'orange'}>{({ ready: 'Configured', incomplete: 'Setup incomplete', installation_missing: 'Pi unavailable', auth_required: 'API key needed', model_unavailable: 'Model unavailable' })[offer.status]}</Tag>}
                            <span className={styles.hint}>{saveState === 'saved' ? 'Changes saved automatically' : saveState === 'saving' ? 'Saving…' : saveState === 'pending' ? 'Changes waiting to save…' : 'Changes not saved'}</span>
                            <Button size="small" disabled={saveState === 'saved' || saveState === 'saving' || !!checking} onClick={() => void flush()}>Save changes</Button>
                            <Button size="small" danger disabled={!!checking} onClick={() => {
                                const profiles = doc.profiles.filter(one => one.id !== selected);
                                change({ ...doc, profiles, defaultPiProfileId: doc.defaultPiProfileId === selected ? '' : doc.defaultPiProfileId });
                                setSelection(profiles[0]?.id ?? ''); setDiagnostic(null); setCheckedModels([]);
                            }}>Remove profile</Button>
                        </div>
                    </>}
                    {saveError && <Alert type="warning" showIcon title="Changes not saved" description={saveError} />}
                </div>
                {profile && <>
                    <section className={styles.section}>
                        <h3>Connections and models</h3>
                        <p className={styles.hint}>Each connection holds an endpoint, an API key and the models available through it.</p>
                        <p><strong>Default model:</strong> {profile.defaultModel || 'Add your first model below.'}</p>
                        <p className={styles.hint}>“Use by default” selects one of your models for turns that do not specify a model.</p>
                        <div className={styles.connections}>
                            {profile.connections.map((connection, index) => <ProfileConnectionEditor key={`${selected}-${index}`} connection={connection} index={index} defaultModel={profile.defaultModel}
                                secrets={secrets} disabled={!!checking} secretConfigured={connection.secretRef?.startsWith('private:')
                                    ? secrets.some(secret => secret.reference === connection.secretRef)
                                    : !!offer?.secretStates[connection.provider] && offer.connections.some(one => one.provider === connection.provider && one.secretRef === connection.secretRef)}
                                onChange={next => updateConnection(index, next)} onDefault={defaultModel => update({ defaultModel, defaultEffort: '' })}
                                onRemove={() => update(replaceConnections(profile, profile.connections.filter((_, at) => at !== index)))}
                                onAddKey={() => { setKeyTarget({ profile: selected, connection: index, suggestedId: connection.provider || '' }); setTab('keys'); }} />)}
                        </div>
                        <div><Button onClick={() => update({ connections: [...profile.connections, { provider: '', api: 'openai-completions', baseUrl: '', secretRef: '', models: [] }] })}>Add connection</Button></div>
                    </section>
                    <section className={styles.section}>
                        <h3>Check your setup</h3>
                        <p className={styles.hint}>Check models verifies the model IDs you added in Pi. Test API connection sends a small request to check the endpoint and key.</p>
                        <div className={styles.row}>
                            <Button loading={checking === 'models'} disabled={!!checking} onClick={() => void check(false)}>Check models</Button>
                            <Button type="primary" loading={checking === 'api'} disabled={!!checking || !profile.defaultModel} onClick={() => void check(true)}>Test API connection</Button>
                        </div>
                        {!choices.length && <p className={styles.hint}>Add at least one model ID to enable the API test. The first model becomes the default.</p>}
                        {diagnostic && <div role="status"><Alert type={diagnostic.type} showIcon title={diagnostic.message} description={<>
                            {diagnostic.connectionStatus === 'runtime_error' && <p>Retry the test. If Pi stops again, include the technical details when reporting the problem.</p>}
                            {diagnostic.details && <details className={styles.advanced} open={diagnostic.connectionStatus === 'api_error'}><summary>{diagnostic.connectionStatus === 'api_error' ? 'API error details' : 'Technical details'}</summary><pre className={styles.diagnosticDetails}>{diagnostic.details}</pre></details>}
                            {diagnostic.models && <ul className={styles.resultList}>
                            {diagnostic.models.map(model => <li key={model.value}><strong>{model.value}</strong>{model.efforts.length ? ` · reasoning: ${model.efforts.map(effort => effort.label).join(', ')}` : ''}{model.capabilities.imageInput ? ' · accepts images' : ''}</li>)}
                        </ul>}
                        </>} /></div>}
                        <ProfileField label="Default reasoning level" help="Check models to load the levels supported by your default model.">
                            <Select aria-label="Default reasoning level" value={profile.defaultEffort || ''} disabled={!!checking || !checkedDefault}
                                options={[{ value: '', label: 'Automatic' }, ...(checkedDefault?.efforts ?? (profile.defaultEffort ? [{ value: profile.defaultEffort, label: profile.defaultEffort }] : []))]}
                                onChange={defaultEffort => update({ defaultEffort })} />
                        </ProfileField>
                    </section>
                </>}
            </div> },
            { key: 'keys', label: `API keys (${secrets.length})`, children: <PrivateKeysPanel secrets={keysWithDraftUses} suggestedId={keyTarget?.suggestedId ?? ''}
                onStored={async reference => {
                    if (keyTarget) {
                        change({ ...doc, profiles: doc.profiles.map(one => one.id === keyTarget.profile ? { ...one, connections: one.connections.map((connection, index) => index === keyTarget.connection ? { ...connection, secretRef: reference } : connection) } : one) });
                        setTab('profiles'); setKeyTarget(null);
                    }
                    setDiagnostic(null); setCheckedModels([]); await refresh(); window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
                }} onDeleted={async () => { setDiagnostic(null); setCheckedModels([]); await refresh(); window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT)); }} /> },
            { key: 'advanced', label: 'Advanced', children: <section className={styles.section}>
                <h3>External Pi installation</h3>
                <p className={styles.hint}>Use this only if you manage Pi outside Configuration. Provide the executable on the runner and its exact supported version.</p>
                <div className={styles.fields}>
                    <ProfileField label="Installation name"><Input aria-label="Installation id" value={external.id} onChange={event => setExternal({ ...external, id: event.target.value })} /></ProfileField>
                    <ProfileField label="Version"><Select aria-label="Installation version" value={external.version} options={['1.3.0', '1.2.0'].map(value => ({ value, label: value }))} onChange={version => setExternal({ ...external, version })} /></ProfileField>
                </div>
                <ProfileField label="Executable path"><Input aria-label="Installation executable" placeholder="Absolute path on the runner" value={external.path} onChange={event => setExternal({ ...external, path: event.target.value })} /></ProfileField>
                <div><Button disabled={!external.id || !external.path} onClick={() => change({ ...doc, installations: [...doc.installations.filter(one => one.id !== external.id), { ...external, engine: 'pi', protocol: 'pi-rpc-1.3', external: true }] })}>Declare installation</Button></div>
                {saveError && <Alert type="warning" title="Changes not saved" description={saveError} />}
            </section> },
        ]} />
        </ConfigProvider>
    </div>;
};
