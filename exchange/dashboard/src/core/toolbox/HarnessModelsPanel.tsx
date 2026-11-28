import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Radio } from 'antd';
import type { HarnessModelConfiguration, HarnessModelPreferences } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';
import { AsyncList } from '../ui-foundation/feedback/AsyncList';
import { InProgressFeedback } from '../ui-foundation/feedback/InProgressFeedback';
import { TOOLBOX_CHANGED_EVENT } from './events';
import { errorText } from './profileEditing';
import styles from './HarnessModelsPanel.module.css';

export const HarnessModelsPanel: React.FC<{ harness: string }> = ({ harness }) => {
    const client = useWorkerClient();
    const [config, setConfig] = useState<HarnessModelConfiguration>();
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const [saving, setSaving] = useState(false);
    const pending = useRef(false);

    useEffect(() => {
        let current = true;
        client.getHarnessModelConfiguration(harness)
            .then(next => { if (current) setConfig(next); })
            .catch(cause => { if (current) setError(errorText(cause)); });
        return () => { current = false; };
    }, [client, harness, reload]);

    const save = async (prefs: HarnessModelPreferences) => {
        if (!config || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError('');
        try {
            await client.putHarnessModelPreferences(harness, prefs);
            setConfig({ ...config, ...prefs });
            window.dispatchEvent(new Event(TOOLBOX_CHANGED_EVENT));
        } catch (cause) {
            setError(errorText(cause));
        } finally {
            pending.current = false;
            setSaving(false);
        }
    };

    const refresh = () => {
        setConfig(undefined);
        setError('');
        setReload(value => value + 1);
    };

    const toggle = (model: string, enabled: boolean) => {
        if (!config) return;
        const activeModels = enabled
            ? [...config.activeModels, model]
            : config.activeModels.filter(id => id !== model);
        const defaultModel = activeModels.includes(config.defaultModel) ? config.defaultModel : activeModels[0];
        void save({ activeModels, defaultModel });
    };

    return (
        <div className={styles.panel} data-testid={`harness-models-panel-${harness}`}>
            {saving && <InProgressFeedback label="Saving model preferences…" />}
            {config && error && <Alert type="error" showIcon title={error}
                action={<Button size="small" onClick={refresh}>Reload models</Button>} />}
            <AsyncList loading={!config} error={!config && error} onRetry={refresh}
                empty={config?.models.length === 0 && <>
                    No models are available from this harness.
                    <div><Button size="small" onClick={refresh}>Reload models</Button></div>
                </>}>
                {config && <table className={styles.models} aria-busy={saving}>
                    <thead><tr><th scope="col">Model</th><th scope="col">Active</th><th scope="col">Default</th></tr></thead>
                    <tbody>
                        {config.models.map(model => {
                            const active = config.activeModels.includes(model.value);
                            return (
                                <tr key={model.value}>
                                    <th scope="row">
                                        {model.label}
                                        {model.label !== model.value && <code>{model.value}</code>}
                                    </th>
                                    <td><Checkbox aria-label={`Activate ${model.value}`} checked={active}
                                        disabled={saving || (active && config.activeModels.length === 1)}
                                        onChange={event => toggle(model.value, event.target.checked)} /></td>
                                    <td><Radio aria-label={`Use ${model.value} by default`} name={`${harness}-default-model`}
                                        value={model.value} checked={config.defaultModel === model.value} disabled={saving || !active}
                                        onChange={() => void save({ activeModels: config.activeModels, defaultModel: model.value })} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>}
            </AsyncList>
        </div>
    );
};
