import React, { useState } from 'react';
import { Button } from 'antd';
import { AgentCreationModal } from '../agentic-resources/components/AgentEditorPanel';
import { useHarnessOptions } from '../useHarnessOptions';
import { useAgents } from '../Agents-ctx';
import { useRunners } from '../Runners-ctx';
import { hasLegacyHarness, SettingsChanges, effortsForSelection, FlowNodeSettings } from '../flowNodeSettings';
import { hasFolder, isForAgent, settingsHarness, FlowNodeType } from '../flowNodeType';
import {
    AgentSelect, EffortSelect, FolderInput, PermissionSelect, RunnerSelect, ScheduleInput,
} from './FlowNodeControls';
import styles from '../Hybridflow.module.css';

interface FlowNodeMetaEditorProps {
    type: FlowNodeType;
    settings: FlowNodeSettings;
    at: string;
    duration?: string;
    readOnly?: boolean;
    showFolder?: boolean;
    showRunner?: boolean;
    onChange: (changes: SettingsChanges) => void;
    onSchedule: (next: string, duration?: string) => void;
}

/** Type-specific settings. */
export const FlowNodeMetaEditor: React.FC<FlowNodeMetaEditorProps> = ({
    type, settings, at, duration, onChange, onSchedule, readOnly, showFolder = true, showRunner = true,
}) => {
    const { agents: managed, loading, error } = useAgents();
    const [installing, setInstalling] = useState(false);
    const { runners } = useRunners();
    const { harnesses, optionsFor } = useHarnessOptions();
    const own = optionsFor(settingsHarness(settings, managed) || harnesses[0]?.value || '');
    const agent = managed.find(one => one.id === settings.agent);
    const efforts = effortsForSelection(own, agent, settings.profileId, settings.model);

    return (
        <div className={styles.meta} data-testid="flow-node-meta">
            {type === 'scheduler' && (
                <div className={styles.metaRow}>
                    <ScheduleInput at={at} duration={duration} onChange={onSchedule} />
                </div>
            )}
            {isForAgent(type) && (
                <div className={styles.metaRow}>
                    <AgentSelect settings={settings} agents={managed} agentsLoading={loading} error={error}
                        onChange={onChange} disabled={readOnly} />
                    <EffortSelect settings={settings} options={efforts} onChange={onChange} disabled={readOnly} />
                    <PermissionSelect settings={settings} options={own.permissionModes} onChange={onChange} disabled={readOnly} />
                </div>
            )}
            {isForAgent(type) && settings.agent && !agent && !hasLegacyHarness(settings) && !loading && !error && <div role="alert">
                Missing agent · {settings.agent}. Choose another agent or <Button type="link" disabled={readOnly} onClick={() => setInstalling(true)}>Reinstall agent…</Button>
            </div>}
            <AgentCreationModal open={installing} reinstall onClose={() => setInstalling(false)} />
            {showFolder && hasFolder(type)
                && <FolderInput settings={settings} required={isForAgent(type)} onChange={onChange} disabled={readOnly} />}
            {showRunner && isForAgent(type) && (
                <div className={styles.metaRow}>
                    <RunnerSelect settings={settings} runners={runners} onChange={onChange} />
                </div>
            )}
        </div>
    );
};
