import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Select } from 'antd';
import { CloseOutlined, DisconnectOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import type { HarnessOption } from 'kiao-worker';
import { CommitInput, IconButton, useFileDrop, RevealInTreeButton, Tooltip } from '@kiao-dashboard-core';
import { useTagsUi } from '@kiao-dashboard-kit/capabilities';
import {
    AGENT_KEY, droppedFolder, EFFORT_KEY, FOLDER_KEY, folderLink, HARNESS_KEY, MODEL_KEY, PERMISSION_KEY, PROFILE_KEY, RUNNER_KEY,
    effortsForSelection, hasLegacyHarness, profileForSelection, SettingsChanges, settingsFolder, shortPermission, FlowNodeSettings,
} from '../flowNodeSettings';
import { COMPLEXITIES, SuccessCriterion, TaskComplexity, newCriterion } from '../boardContent';
import type { AgentDto, RunnerDto } from '../service';
import { AgentMatrixDialog, type AgentChoice } from '../agentic-resources/components/AgentMatrixDialog';
import { useHarnessOptions } from '../useHarnessOptions';
import {
    brokenTransition, hasSuccess, FlowNodeSuccess, TRANSITION_MODE_LABELS, TRANSITION_MODE_ORDER,
    TransitionMode, withoutSuccessor,
} from '../flowNodeSuccess';
import {
    BYPASS_PERMISSION, settingsHarness, FLOW_NODE_TYPE_LABELS, FLOW_NODE_TYPE_ORDER, FlowNodeType,
} from '../flowNodeType';
import { BoardContent } from '../boardContent';
import { valueTypeOptions } from '../valueType';
import { readDuration, readSchedule } from '../flowNodeSchedule';
import { hasContextReference, renderNodeContext, type NodeContext } from '../nodeContext';
import { canConnect } from '../flowConnections';
import styles from '../Hybridflow.module.css';

/** The controls the open flow node is edited with, one component each: **what kind of flow node it. */

/** The one answer the chain select gives that is not a flow node. */
const NOTHING = '!none';

const ELSEWHERE = 'A node that has left the board';

/** The list drops out of a box sized down from the app's own: it is sized down with it. */
const POPUP = { popup: { root: styles.metaPopup } };

export const AGENT_HELP = 'Uses the latest published agent version when starting a conversation; keeps that version afterward.';

export const EFFORT_HELP = 'Reasoning effort is required before this node can play.';

export const PERMISSION_HELP = 'Choose which actions the agent can perform without approval during unattended turns.';

export const FOLDER_HELP = 'Use a DCMS link, drop a file or folder, or reference a value such as {{input.folder}}.';

export const RUNNER_HELP = 'Pins execution to this machine. Leave empty to run wherever Play is pressed.';

export const SCHEDULE_HELP = 'Waits until this local time before playing the next node; past times continue immediately.';

export const STATUS_HELP = 'Ready and Done nodes can play. Replaying a completed AI task starts a new conversation.';

export const UNLINK_HELP = 'Detaches this conversation without deleting it; the next play starts a new one.';

export const NEXT_HELP = 'Plays this node next; Nothing ends the chain.';

export const BRANCHES_HELP = 'Starts these branches in parallel when the gateway fires.';

export const TRANSITION_HELP = 'Continue forks this conversation for the next node; End starts a new conversation.';

export const COMPACT_HELP = 'Shortens this conversation before the next node receives its fork.';

export const TRANSITION_BROKEN = 'Set effort, permission and folder, or choose End conversation.';

export const COMPLEXITY_HELP = 'Estimated effort in Fibonacci points; used for planning, excluded from the agent prompt.';

interface SettingProps {
    settings: FlowNodeSettings;
    onChange: (changes: SettingsChanges) => void;
    disabled?: boolean;
}

/** The list a Claude select is picked from. */
interface OfferedProps {
    options: HarnessOption[];
}

export const VALUE_TYPE_HELP = 'JSON Schema values define the structure expected of other values.';

export const ValueTypeSelect: React.FC<{
    valueType: string;
    content: BoardContent;
    flowNodeId: string;
    onChange: (next: string) => void;
}> = ({ valueType, content, flowNodeId, onChange }) => {
    const options = useMemo(
        () => valueTypeOptions(content, flowNodeId, valueType),
        [content, flowNodeId, valueType],
    );
    return (
        <Tooltip title={VALUE_TYPE_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={valueType}
                options={options}
                onChange={onChange}
                aria-label="Value type"
                data-testid="flow-node-value-type"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

export const TypeSelect: React.FC<{
    type: FlowNodeType;
    onChange: (next: FlowNodeType) => void;

    choices?: FlowNodeType[];
}> = ({ type, onChange, choices = FLOW_NODE_TYPE_ORDER }) => {
    const options = useMemo(
        () => choices.map(value => ({ value, label: FLOW_NODE_TYPE_LABELS[value] })),
        [choices],
    );

    return (
        <Select
            size="small"
            className={styles.metaSelect}
            value={type}
            options={options}
            onChange={onChange}
            aria-label="Flow node type"
            data-testid="flow-node-type"
            classNames={POPUP}
            popupMatchSelectWidth={false}
        />
    );
};

export const AgentSelect: React.FC<SettingProps & {
    agents: AgentDto[];
    agentsLoading?: boolean;
    error?: string | null;
    allowClear?: boolean;
    help?: string;
    testId?: string;
}> = ({
    settings, agents, agentsLoading, error, onChange, disabled, allowClear, help, testId,
}) => {
    const [open, setOpen] = useState(false);
    const { harnesses, optionsFor, loading } = useHarnessOptions();
    const current = agents.find(agent => agent.id === settings.agent);
    const harness = settingsHarness(settings, agents);
    const own = optionsFor(harness);
    const profile = profileForSelection(own, current, settings.profileId);
    const profileId = settings.profileId || (harness === 'pi' ? (current?.published?.profileId || profile?.id) : undefined);
    const target = harness === 'pi' && profileId ? (profile?.name ?? profileId)
        : [own.label || harness, settings.model].filter(Boolean).join(' / ');
    const label = current ? [current.name, target].filter(Boolean).join(' · ') : hasLegacyHarness(settings)
        ? `${settings.agent} / ${settings.model}` : settings.agent ? `Missing agent · ${settings.agent}` : 'Choose agent';

    const pick = (choice?: AgentChoice) => {
        const changedHarness = choice && harness && harness !== choice.harness;
        const changedTarget = choice && (choice.agent !== settings.agent || choice.model !== settings.model || choice.profileId !== profileId);
        const invalidEffort = changedTarget && settings.effort &&
            !effortsForSelection(optionsFor(choice.harness), agents.find(agent => agent.id === choice.agent), choice.profileId, choice.model)
                .some(effort => effort.value === settings.effort);
        onChange({
            [AGENT_KEY]: choice?.agent,
            [HARNESS_KEY]: choice?.harness,
            [PROFILE_KEY]: choice?.profileId,
            [MODEL_KEY]: choice?.model,
            ...(changedHarness || invalidEffort ? { [EFFORT_KEY]: undefined } : {}),
            ...(changedHarness ? { [PERMISSION_KEY]: undefined } : {}),
        });
        setOpen(false);
    };

    return (
        <>
            <Tooltip title={help ?? AGENT_HELP}>
                <Button size="small" className={styles.agentChoice} aria-label="Agent" aria-haspopup="dialog"
                    aria-invalid={!!settings.agent && !current && !hasLegacyHarness(settings)}
                    data-testid={testId ?? 'flow-node-agent'} disabled={disabled} onClick={() => setOpen(true)}>
                    <span title={label}>{label}</span>
                </Button>
            </Tooltip>
            {allowClear && settings.agent && (
                <IconButton
                    label="Clear agent"
                    type="default"
                    icon={<CloseOutlined />} disabled={disabled}
                    onClick={() => pick()}
                />
            )}
            {open && (
                <AgentMatrixDialog title="Choose agent and harness" agents={agents} agentsLoading={agentsLoading}
                    error={error} harnesses={harnesses} harnessesLoading={loading}
                    initial={{ agent: settings.agent, harness, profileId, model: settings.model }}
                    onCancel={() => setOpen(false)} onConfirm={pick} />
            )}
        </>
    );
};

/**
 * How hard it thinks.
 * Empty rather than defaulted: the placeholder asks for the one thing still missing, and the warning.
 */
export const EffortSelect: React.FC<SettingProps & OfferedProps> = ({ settings, options, onChange, disabled }) => {
    const offered = useMemo(
        () => options.map(effort => ({ value: effort.value, label: effort.label })),
        [options],
    );

    return (
        <Tooltip title={EFFORT_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={settings.effort || undefined}
                disabled={disabled}
                placeholder="Effort"
                status={settings.effort ? undefined : 'warning'}
                options={offered}
                onChange={value => onChange({ [EFFORT_KEY]: value })}
                aria-label="Effort"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/** What the played turn may do on its own. */
export const PermissionSelect: React.FC<SettingProps & OfferedProps> = ({ settings, options, onChange, disabled }) => {
    const offered = useMemo(() => {
        const modes = options.map(mode => ({ value: mode.value, label: mode.label, title: mode.label }));
        if (settings.permission && !modes.some(mode => mode.value === settings.permission)) {
            modes.push({ value: settings.permission, label: settings.permission, title: settings.permission });
        }
        return modes;
    }, [options, settings.permission]);

    const risky = settings.permission === BYPASS_PERMISSION;

    return (
        <Tooltip title={PERMISSION_HELP}>
            <Select
                size="small"
                className={`${styles.metaSelect} ${risky ? styles.metaSelectRisky : ''}`}
                value={settings.permission || undefined}
                disabled={disabled}
                placeholder="Permission"
                status={settings.permission ? undefined : 'warning'}
                options={offered}
                labelRender={picked => shortPermission(String(picked.value))}
                onChange={value => onChange({ [PERMISSION_KEY]: value })}
                aria-label="Permission mode"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/**
 * Selects a runner from the shared store for an AI task.
 */
export const RunnerSelect: React.FC<SettingProps & { runners: RunnerDto[] }> = ({
    settings, runners, onChange,
}) => {
    const offered = useMemo(() => {
        const list = runners.map(runner => ({ value: runner.id, label: runner.name }));
        if (settings.runner && !list.some(runner => runner.value === settings.runner)) {
            list.push({ value: settings.runner, label: 'Unknown runner' });
        }
        return list;
    }, [runners, settings.runner]);

    const unknown = !!settings.runner && !runners.some(runner => runner.id === settings.runner);

    return (
        <Tooltip title={RUNNER_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={settings.runner || undefined}
                placeholder={runners.length ? 'Any runner' : 'No runner filed yet'}
                status={unknown ? 'warning' : undefined}
                options={offered}
                allowClear
                onChange={value => onChange({ [RUNNER_KEY]: value || undefined })}
                aria-label="Runner"
                data-testid="flow-node-runner"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/** The folder the flow node is about. */
export const FolderInput: React.FC<SettingProps & { required: boolean; context?: NodeContext }> = ({
    settings, required, onChange, disabled, context = {},
}) => {
    const { dropping, dropProps } = useFileDrop(dropped => {
        if (!disabled) onChange({ [FOLDER_KEY]: droppedFolder(dropped.path, dropped.isDirectory) });
    });

    const rendered = renderNodeContext(settings.folder ?? '', context);
    const folder = rendered.trim() && !hasContextReference(rendered) ? settingsFolder({ folder: rendered }) : null;

    return (
        <Tooltip title={FOLDER_HELP}>
            <Input
                size="small"
                className={`${styles.metaFolder} ${dropping ? styles.metaFolderDrop : ''}`}
                value={settings.folder ?? ''}
                readOnly={disabled}
                status={required && !settings.folder ? 'warning' : undefined}
                placeholder="Folder (/ is the DCMS root)"
                onChange={event => onChange({ [FOLDER_KEY]: folderLink(event.target.value) })}
                aria-label="Working directory"
                data-testid="flow-node-folder"
                suffix={<RevealInTreeButton path={folder} subject="folder" data-testid="flow-node-folder-locate" />}
                {...(disabled ? {} : dropProps)}
            />
        </Tooltip>
    );
};

/** Scheduler modes are mutually exclusive. */
type ScheduleMode = 'duration' | 'datetime' | 'datetime-reference';

const scheduleMode = (at: string, duration: string): ScheduleMode =>
    duration ? 'duration' : hasContextReference(at) ? 'datetime-reference' : 'datetime';

export const ScheduleInput: React.FC<{
    at: string;
    duration?: string;
    onChange: (at: string, duration?: string) => void;
}> = ({ at, duration = '', onChange }) => {
    const [mode, setMode] = useState(() => scheduleMode(at, duration));
    const [draft, setDraft] = useState(duration || at);
    useEffect(() => {
        setDraft(duration || at);
        if (duration || at) setMode(scheduleMode(at, duration));
    }, [at, duration]);
    const waitingForDuration = mode === 'duration';
    const parsed = waitingForDuration ? readDuration(draft) : readSchedule(draft);
    return <>
        <Select<ScheduleMode>
            size="small"
            value={mode}
            options={[
                { value: 'duration', label: 'Fixed duration' },
                { value: 'datetime', label: 'Date time' },
                { value: 'datetime-reference', label: 'Date time from a value' },
            ]}
            onChange={next => { setMode(next); setDraft(''); onChange('', ''); }}
            aria-label="Schedule mode"
            data-testid="flow-node-schedule-mode"
            className={styles.metaSelect}
        />
        {mode !== 'datetime' ? (
            <Tooltip title={waitingForDuration
                ? 'Wait from each play. Enter a duration such as 1h30m or a reference such as {{input.delay}}.'
                : 'Enter a value reference that supplies a local date and time.'}>
                <CommitInput
                    value={draft}
                    placeholder={waitingForDuration ? '30s, 15m, 1h30m' : '{{currentWorkflow.scheduledAt}}'}
                    status={parsed ? undefined : 'warning'}
                    onDraftChange={setDraft}
                    onCommit={() => {
                        if (!draft.trim() || parsed) {
                            if (waitingForDuration) onChange('', parsed);
                            else onChange(parsed, '');
                        }
                    }}
                    blurOnEnter
                    aria-label={waitingForDuration ? 'Duration' : 'Scheduled for'}
                    data-testid={waitingForDuration ? 'flow-node-duration' : 'flow-node-schedule'}
                    className={styles.metaSelect}
                />
            </Tooltip>
        ) : (
            <Tooltip title={SCHEDULE_HELP}>
                <Input
                    size="small"
                    type="datetime-local"
                    className={styles.metaSelect}
                    value={at}
                    status={at ? undefined : 'warning'}
                    onChange={event => onChange(event.target.value, '')}
                    aria-label="Scheduled for"
                    data-testid="flow-node-schedule"
                />
            </Tooltip>
        )}
    </>;
};

/** The conversation the flow node was played in: a way in, and a way to forget it. */
export const ChatLink: React.FC<{ chat: string; onOpen: () => void; onUnlink: () => void }> = ({
    chat, onOpen, onUnlink,
}) => {
    if (!chat) return <span className={styles.metaChatNone}>No chat yet</span>;

    return (
        <span className={styles.metaChat}>
            <Button
                size="small"
                type="link"
                icon={<MessageOutlined />}
                className={styles.metaChatOpen}
                aria-label="Open the node’s chat"
                data-testid="open-flow-node-chat"
                onClick={onOpen}
            >
                Chat
            </Button>
            <IconButton
                label="Forget the node’s chat"
                tooltip={UNLINK_HELP}
                icon={<DisconnectOutlined />}
                data-testid="unlink-flow-node-chat"
                onClick={onUnlink}
            />
        </span>
    );
};

interface NextFlowNodeProps {
    success: FlowNodeSuccess;

    content: BoardContent;

    flowNodeId: string;

    multiple?: boolean;
    exclusive?: boolean;
    onChange: (next: FlowNodeSuccess) => void;
    disabled?: boolean;
}

/**
 * Selects a successor for a flow node with one outgoing link.
 */
export const NextFlowNodeSelect: React.FC<NextFlowNodeProps> = ({
    success, content, flowNodeId, multiple, exclusive, onChange, disabled,
}) => {
    // Keep saved links to archived flow nodes out of the selector.
    const live = useMemo(() => new Map(
        content.flowNodes.filter(flowNode => !flowNode.archived).map(flowNode => [flowNode.id, flowNode] as const),
    ), [content]);
    const hiddenBranches = useMemo(
        () => success.flowNodes.filter(id => !live.has(id) && content.flowNodes.some(flowNode => flowNode.id === id)),
        [success.flowNodes, live, content]);
    const options = useMemo(() => {
        const offered: unknown[] = [
            ...(multiple ? [] : [{ value: NOTHING, label: 'Nothing next' }]),
            ...[...live.values()]
                .filter(flowNode => flowNode.id !== flowNodeId)
                .filter(flowNode => !['note', 'value'].includes(flowNode.type))
                .filter(flowNode => canConnect(content.flowNodes, flowNodeId, flowNode.id)
                    || success.flowNode === flowNode.id || success.flowNodes.includes(flowNode.id))
                .map(flowNode => ({ value: flowNode.id, label: flowNode.title || 'Untitled' })),
        ];
        // A named flow node may have been deleted since.
        const known = (id: string) => live.has(id);
        if (multiple) {
            for (const branch of success.flowNodes) {
                if (!known(branch) && !hiddenBranches.includes(branch)) offered.push({ value: branch, label: ELSEWHERE });
            }
        } else if (hasSuccess(success) && !known(success.flowNode) && !hiddenBranches.includes(success.flowNode)) {
            offered.push({ value: success.flowNode, label: ELSEWHERE });
        }
        return offered as { value: string; label: string }[];
    }, [live, flowNodeId, success, multiple, hiddenBranches]);

    if (multiple) {
        const visibleBranches = success.flowNodes.filter(id => !hiddenBranches.includes(id));
        return (
            <Tooltip title={exclusive ? 'Choose the successors available to the routes.' : BRANCHES_HELP}>
                <Select
                    size="small"
                    mode="multiple"
                    className={`${styles.metaSelect} ${styles.metaNext}`}
                    value={visibleBranches}
                    disabled={disabled}
                    options={options}
                    onChange={value => onChange({ ...success, flowNodes: [...hiddenBranches, ...value] })}
                    aria-label={exclusive ? 'Linked successors' : 'Branches'}
                    placeholder={exclusive ? 'Link successors' : undefined}
                    classNames={POPUP}
                    popupMatchSelectWidth={false}
                />
            </Tooltip>
        );
    }

    const goneSingle = hasSuccess(success) && !live.has(success.flowNode) &&
        !content.flowNodes.some(flowNode => flowNode.id === success.flowNode);
    const visibleNext = hasSuccess(success) && (live.has(success.flowNode) || goneSingle) ? success.flowNode : NOTHING;
    return (
        <Tooltip title={NEXT_HELP}>
            <Select
                size="small"
                className={`${styles.metaSelect} ${styles.metaNext}`}
                value={visibleNext}
                disabled={disabled}
                options={options}
                // Nothing next is what a flow node says by saying nothing, so it is written by taking the id out — and only the id.
                onChange={value => onChange(
                    value === NOTHING ? withoutSuccessor(success) : { ...success, flowNode: value })}
                aria-label="On success"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/**
 * **The transition mode**: who gets the conversation once the flow node is done — the flow node after.
 * It is one select of two, because a flow node hands its chat on or it does not.
 */
export const TransitionModeSelect: React.FC<{
    success: FlowNodeSuccess;

    settings: FlowNodeSettings;
    onChange: (next: FlowNodeSuccess) => void;
    disabled?: boolean;
}> = ({ success, settings, onChange, disabled }) => {
    const options = useMemo(
        () => TRANSITION_MODE_ORDER.map(value => ({ value, label: TRANSITION_MODE_LABELS[value] })),
        [],
    );
    const broken = brokenTransition(success, settings);

    return (
        <Tooltip title={broken ? TRANSITION_BROKEN : TRANSITION_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={success.mode}
                disabled={disabled}
                status={broken ? 'warning' : undefined}
                options={options}
                onChange={(value: TransitionMode) => onChange({ ...success, mode: value })}
                aria-label="Transition mode"
                data-testid="flow-node-transition-mode"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/**
 * **Compact**: whether the flow node shortens the chat it ran in when it ends well.
 * A box rather than a third answer in the select beside it, because it answers a different question.
 */
export const CompactCheck: React.FC<{
    success: FlowNodeSuccess;

    settings: FlowNodeSettings;
    onChange: (next: FlowNodeSuccess) => void;
    disabled?: boolean;
}> = ({ success, settings, onChange, disabled }) => {
    const broken = brokenTransition(success, settings);
    return (
        <Tooltip title={broken ? TRANSITION_BROKEN : COMPACT_HELP}>
            <Checkbox
                className={`${styles.metaCheck} ${broken ? styles.metaCheckBroken : ''}`}
                checked={success.compact}
                disabled={disabled}
                onChange={event => onChange({ ...success, compact: event.target.checked })}
                data-testid="flow-node-compact"
            >
                Compact
            </Checkbox>
        </Tooltip>
    );
};

export const TagsControl: React.FC<{
    tags: string[];
    onChange: (next: string[]) => void;
    className?: string;
}> = ({ tags, onChange, className }) => {
    const { TagPicker } = useTagsUi();
    return (
        <div className={className ?? styles.metaTags}>
            <TagPicker
                value={tags}
                onChange={onChange}
                className={styles.metaTagPicker}
                aria-label="Flow node tags"
                data-testid="flow-node-tags"
            />
        </div>
    );
};

/** How heavy the work looks, in Fibonacci points. */
export const ComplexitySelect: React.FC<{
    complexity: TaskComplexity;
    onChange: (next: TaskComplexity) => void;
}> = ({ complexity, onChange }) => {
    const options = useMemo(
        () => COMPLEXITIES.map(value => ({ value, label: String(value) })),
        [],
    );

    return (
        <Tooltip title={COMPLEXITY_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={complexity ?? undefined}
                placeholder="Complexity"
                allowClear
                options={options}
                onChange={(value: number | undefined) => onChange(value ?? null)}
                aria-label="Complexity"
                data-testid="flow-node-complexity"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/** What done means: the short lines the turn is measured against. */
export const SuccessCriteriaEditor: React.FC<{
    criteria: SuccessCriterion[];
    onChange: (next: SuccessCriterion[]) => void;
    readOnly?: boolean;
}> = ({ criteria, onChange, readOnly }) => {
    const pendingFocus = useRef<string | null>(null);
    const boxes = useRef(new Map<string, HTMLTextAreaElement | null>());

    useEffect(() => {
        if (!pendingFocus.current) return;
        const box = boxes.current.get(pendingFocus.current);
        pendingFocus.current = null;
        box?.focus();
    });

    const addFresh = (next: SuccessCriterion[], fresh: SuccessCriterion) => {
        pendingFocus.current = fresh.id;
        onChange(next);
    };

    const breakLine = (criterion: SuccessCriterion, box: HTMLTextAreaElement | null) => {
        const at = box?.selectionStart ?? criterion.text.length;
        const to = box?.selectionEnd ?? criterion.text.length;
        const text = `${criterion.text.slice(0, at)}\n${criterion.text.slice(to)}`;
        onChange(criteria.map(held => (
            held.id === criterion.id ? { ...held, text } : held
        )));
        if (box && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => box.setSelectionRange(at + 1, at + 1));
        }
    };

    return (
        <div className={styles.metaCriteria} data-testid="flow-node-criteria">
            {criteria.map((criterion, index) => (
                <div key={criterion.id ? `${index}-${criterion.id}` : `new-${index}`} className={styles.metaCriterionRow}>
                    <Input.TextArea
                        size="small"
                        value={criterion.text}
                        readOnly={readOnly}
                        placeholder="What done means"
                        maxLength={280}
                        aria-label="Success criterion"
                        autoSize={{ minRows: 1 }}
                        className={styles.metaCriterionBox}
                        ref={node => {
                            if (node) boxes.current.set(criterion.id, node.resizableTextArea?.textArea ?? null);
                            else boxes.current.delete(criterion.id);
                        }}
                        onChange={event => onChange(criteria.map(held => (
                            held.id === criterion.id ? { ...held, text: event.target.value } : held
                        )))}
                        onKeyDown={event => {
                            if (readOnly || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                                breakLine(criterion, boxes.current.get(criterion.id) ?? null);
                            } else {
                                const fresh = newCriterion();
                                addFresh(
                                    [...criteria.slice(0, index + 1), fresh, ...criteria.slice(index + 1)],
                                    fresh,
                                );
                            }
                        }}
                    />
                    {!readOnly && <IconButton
                        label="Remove success criterion"
                        icon={<CloseOutlined />}
                        onClick={() => onChange(criteria.filter(held => held.id !== criterion.id))}
                    />}
                </div>
            ))}
            {!readOnly && <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                aria-label="Add success criterion"
                data-testid="flow-node-criteria-add"
                onClick={() => {
                    const fresh = newCriterion();
                    addFresh([...criteria, fresh], fresh);
                }}
            >
                Add criterion
            </Button>}
        </div>
    );
};
