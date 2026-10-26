import React from 'react';
import { useChatOptions } from '@cms-kit/capabilities';
import { useAgents } from '../Agents-ctx';
import { useRunners } from '../Runners-ctx';
import { SettingsChanges, effortsForAgent, FlowNodeSettings } from '../flowNodeSettings';
import { hasFolder, isForAgent, settingsPlatform, FlowNodeType } from '../flowNodeType';
import {
    AgentSelect, EffortSelect, FolderInput, PermissionSelect, RunnerSelect, ScheduleInput,
} from './FlowNodeControls';
import styles from '../Hybridflow.module.css';

interface FlowNodeMetaEditorProps {
    /** Fixed at creation; determines which settings apply. */
    type: FlowNodeType;
    settings: FlowNodeSettings;
    /** Scheduler datetime; `''` for other types. */
    at: string;
    duration?: string;
    onChange: (changes: SettingsChanges) => void;
    onSchedule: (next: string, duration?: string) => void;
}

/**
 * Type-specific settings for the panel. AI cards receive the first available agent when typed;
 * effort, permission mode and folder remain empty until chosen. Incomplete cards cannot play.
 * Shared controls are also used by the large editor; changes write to the content document.
 */
export const FlowNodeMetaEditor: React.FC<FlowNodeMetaEditorProps> = ({
    type, settings, at, duration, onChange, onSchedule,
}) => {
    const { agents: managed } = useAgents();
    const { runners } = useRunners();
    const { agents: engines, optionsFor } = useChatOptions();
    // Fetch options once here, not per select; vocabulary follows the selected agent's platform.
    const own = optionsFor(settingsPlatform(settings, managed) || engines[0]?.value || '');
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
                    <AgentSelect settings={settings} agents={managed} onChange={onChange} />
                    <EffortSelect settings={settings} options={efforts} onChange={onChange} />
                    <PermissionSelect settings={settings} options={own.permissionModes} onChange={onChange} />
                </div>
            )}
            {hasFolder(type)
                && <FolderInput settings={settings} required={isForAgent(type)} onChange={onChange} />}
            {isForAgent(type) && (
                <div className={styles.metaRow}>
                    <RunnerSelect settings={settings} runners={runners} onChange={onChange} />
                </div>
            )}
        </div>
    );
};
