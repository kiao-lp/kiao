import React from 'react';
import { useChatOptions } from '@kiao-dashboard-kit/capabilities';
import { useAgents } from '../Agents-ctx';
import { useRunners } from '../Runners-ctx';
import { SettingsChanges, effortsForAgent, FlowNodeSettings } from '../flowNodeSettings';
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
    const { agents: managed } = useAgents();
    const { runners } = useRunners();
    const { harnesses: engines, optionsFor } = useChatOptions();
    const own = optionsFor(settingsHarness(settings, managed) || engines[0]?.value || '');
    const agent = managed.find(one => one.id === settings.agent);
    const efforts = effortsForAgent(own, agent);

    return (
        <div className={styles.meta} data-testid="flow-node-meta">
            {type === 'scheduler' && (
                <div className={styles.metaRow}>
                    <ScheduleInput at={at} duration={duration} onChange={onSchedule} />
                </div>
            )}
            {isForAgent(type) && (
                <div className={styles.metaRow}>
                    <AgentSelect settings={settings} agents={managed} onChange={onChange} disabled={readOnly} />
                    <EffortSelect settings={settings} options={efforts} onChange={onChange} disabled={readOnly} />
                    <PermissionSelect settings={settings} options={own.permissionModes} onChange={onChange} disabled={readOnly} />
                </div>
            )}
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
