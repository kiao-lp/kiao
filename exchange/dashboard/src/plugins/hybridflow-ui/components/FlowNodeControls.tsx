import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Select } from 'antd';
import { CloseOutlined, DisconnectOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import type { AgentOption } from 'kiao-worker';
import { useFileDrop, RevealInTreeButton, Tooltip } from '@cms-core';
import { useTagsUi } from '@cms-kit/capabilities';
import {
    AGENT_KEY, droppedFolder, EFFORT_KEY, FOLDER_KEY, folderLink, MODEL_KEY, PERMISSION_KEY, RUNNER_KEY,
    SettingsChanges, settingsFolder, shortPermission, FlowNodeSettings,
} from '../flowNodeSettings';
import { COMPLEXITIES, SuccessCriterion, TaskComplexity, newCriterion } from '../boardContent';
import type { AgentDto, RunnerDto } from '../service';
import { STATUS_LABELS, FlowNodeStatus } from '../flowNodeStatus';
import {
    brokenTransition, hasSuccess, FlowNodeSuccess, TRANSITION_MODE_LABELS, TRANSITION_MODE_ORDER,
    TransitionMode, withoutSuccessor,
} from '../flowNodeSuccess';
import {
    BYPASS_PERMISSION, settingsPlatform, FLOW_NODE_TYPE_LABELS, FLOW_NODE_TYPE_ORDER, FlowNodeType,
} from '../flowNodeType';
import { BoardContent } from '../boardContent';
import { valueTypeOptions } from '../valueType';
import { readDuration } from '../flowNodeSchedule';
import { canConnect } from '../flowConnections';
import styles from '../Hybridflow.module.css';

/** The controls the open flow node is edited with, one component each: **what kind of flow node it. */

/** The one answer the chain select gives that is not a flow node. */
const NOTHING = '!none';

const ELSEWHERE = 'A node that has left the board';

/** The list drops out of a box sized down from the app's own: it is sized down with it. */
const POPUP = { popup: { root: styles.metaPopup } };

export const TYPE_HELP = 'Who does it: a person (Human), an agent (AI), the machine off (Shutdown), '
    + 'a wait for a datetime (Scheduler), or a join of branches (Parallel gateway). Human until said otherwise.';

export const AGENT_HELP = 'Which managed agent plays it, picked by name. Engine and model come with it; '
    + 'a new conversation selects its latest published version and keeps it. Effort, permission and folder '
    + 'stay the card\u2019s own. A new platform clears effort and permission.';

export const EFFORT_HELP = 'How hard it thinks. No default — a node is played once it names an agent, an '
    + 'effort, a permission mode and a folder.';

export const PERMISSION_HELP = 'What the turn may do alone. No default: a played turn has nobody at it, '
    + 'so this is picked. Without one the node is not played.';

export const FOLDER_HELP = 'The folder it is about; / is the store root. Required of AI, asked of Human. '
    + 'Drop a folder or file from the tree to fill it.';

export const RUNNER_HELP = 'The machine that plays it, picked by name. Empty is played wherever '
    + 'a Play is pressed; a runner named is played there and refused everywhere else.';

export const SCHEDULE_HELP = 'When it fires, on the machine running the board\u2019s clock. Played, it waits '
    + 'until then and plays the next node. A past time does not wait.';

export const STATUS_HELP = 'Where it stands. The play writes in progress, waiting refresh, done, interrupted '
    + 'or error; you write draft, ready or blocked. Ready again offers a second turn.';

export const CHAT_HELP = 'The conversation it is played in. Made on the first play, or handed on by the node '
    + 'before it. A replay goes back into it.';

export const UNLINK_HELP = 'Forget this conversation. The chat itself is left alone; the node is played in '
    + 'a new one next time.';

export const NEXT_HELP = 'The node played after this one, from anywhere on the board. A chain is the '
    + 'board\u2019s only order. Nothing, and the play ends here.';

export const BRANCHES_HELP = 'The nodes started in parallel when this gateway fires, from anywhere on '
    + 'the board. Nothing, and the play ends with the gateway.';

export const TRANSITION_HELP = 'Who keeps the chat. Continue forks it for the next node, so it starts '
    + 'knowing what this one found; End hands on nothing.';

export const COMPACT_HELP = 'Shorten its chat after a good end: /compact runs as its own turn. The next '
    + 'node\u2019s fork comes from the shortened chat.';

export const TRANSITION_BROKEN = 'This claims a chat the node cannot play: name effort, permission and '
    + 'folder, or End conversation unticked.';

export const TAGS_HELP = 'What it is filed under. A tag is the word itself, so it '
    + 'travels with a copied card; colours live in the Tags panel.';

export const COMPLEXITY_HELP = 'How heavy the work looks, in Fibonacci points. Optional: '
    + 'a task without one is no less playable, and it is never sent anywhere.';

export const CRITERIA_HELP = 'What done means: short lines the turn is measured against, '
    + 'sent with the prompt whenever present. A task with a title, a description or one of these '
    + 'is valid; with none of them it carries no Play.';

interface SettingProps {
    settings: FlowNodeSettings;
    onChange: (changes: SettingsChanges) => void;
    disabled?: boolean;
}

/** The list a Claude select is picked from. */
interface OfferedProps {
    options: AgentOption[];
}

/** **What kind of card this is**: one an agent plays, one a person does, one that turns the machine. */
export const VALUE_TYPE_HELP = 'Type of this value. JSON Schema types this value as a schema; '
    + 'a value typed as JSON Schema types other values.';

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
        <Tooltip title={TYPE_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={type}
                options={options}
                onChange={onChange}
                aria-label="Node type"
                data-testid="flow-node-type"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/**
 * **Which agent plays the flow node**: one of the managed agents the store keeps, picked by name.
 * Drawn only for an **AI** flow node, first among the settings: whether the flow node is an agent's.
 */
export const AgentSelect: React.FC<SettingProps & {
    agents: AgentDto[];
    allowClear?: boolean;
    help?: string;
    testId?: string;
}> = ({
    settings, agents, onChange, disabled, allowClear, help, testId,
}) => {
    const offered = useMemo(() => {
        const list: { value: string; label: string; disabled?: boolean }[] = agents
            .filter(agent => (!agent.archived && agent.published) || agent.id === settings.agent)
            .map(agent => ({
            value: agent.id, label: agent.name,
            disabled: agent.archived || !agent.published,
        }));
        if (settings.agent && !list.some(agent => agent.value === settings.agent)) {
            list.push(settings.model
                ? { value: settings.agent, label: `${settings.agent} / ${settings.model}` }
                : { value: settings.agent, label: 'Unknown agent' });
        }
        return list;
    }, [agents, settings.agent, settings.model]);

    const pick = (value: string | undefined) => {
        const before = settingsPlatform(settings, agents);
        const after = value ? settingsPlatform({ agent: value }, agents) : '';
        onChange({
            [AGENT_KEY]: value,
            // The legacy model goes whatever the platform: picking an agent is the moment the card stops saying it.
            [MODEL_KEY]: undefined,
            ...(before && after && before !== after
                ? { [EFFORT_KEY]: undefined, [PERMISSION_KEY]: undefined }
                : {}),
        });
    };

    const unknown = !!settings.agent
        && !agents.some(agent => agent.id === settings.agent)
        && !settings.model;

    return (
        <Tooltip title={help ?? AGENT_HELP}>
            <Select
                size="small"
                className={styles.metaSelect}
                value={settings.agent || undefined}
                placeholder={agents.length ? 'Agent' : 'No agent filed yet'}
                status={!settings.agent || unknown ? 'warning' : undefined}
                options={offered}
                allowClear={allowClear}
                onChange={pick}
                aria-label="Agent"
                data-testid={testId ?? 'flow-node-agent'}
                disabled={disabled}
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
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
 * **Which runner plays the flow node**: one of the runners the store keeps, picked by name —.
 * Drawn only for an **AI** flow node, like the agent: a card nobody plays is pinned nowhere.
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
export const FolderInput: React.FC<SettingProps & { required: boolean }> = ({
    settings, required, onChange, disabled,
}) => {
    const { dropping, dropProps } = useFileDrop(dropped => {
        if (!disabled) onChange({ [FOLDER_KEY]: droppedFolder(dropped.path, dropped.isDirectory) });
    });

    const folder = settings.folder?.trim() ? settingsFolder(settings) : null;

    return (
        <Tooltip title={FOLDER_HELP}>
            <Input
                size="small"
                className={`${styles.metaFolder} ${dropping ? styles.metaFolderDrop : ''}`}
                value={settings.folder ?? ''}
                readOnly={disabled}
                status={required && !settings.folder ? 'warning' : undefined}
                placeholder="Folder (/ is the store root)"
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
export const ScheduleInput: React.FC<{
    at: string;
    duration?: string;
    onChange: (at: string, duration?: string) => void;
}> = ({ at, duration = '', onChange }) => {
    const [mode, setMode] = useState(duration ? 'duration' : 'datetime');
    const [draft, setDraft] = useState(duration);
    useEffect(() => {
        setDraft(duration);
        if (duration) setMode('duration');
        else if (at) setMode('datetime');
    }, [at, duration]);
    return <>
        <Select
            size="small"
            value={mode}
            options={[{ value: 'duration', label: 'Fixed duration' }, { value: 'datetime', label: 'Date time' }]}
            onChange={next => { setMode(next); setDraft(''); onChange('', ''); }}
            aria-label="Schedule mode"
            data-testid="flow-node-schedule-mode"
            className={styles.metaSelect}
        />
        {mode === 'duration' ? (
            <Tooltip title="Wait from each play. Use hours, minutes or seconds, for example 1h30m.">
                <Input
                    size="small"
                    value={draft}
                    placeholder="30s, 15m, 1h30m"
                    status={readDuration(draft) ? undefined : 'warning'}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={() => { if (!draft.trim() || readDuration(draft)) onChange('', draft.trim()); }}
                    onPressEnter={event => event.currentTarget.blur()}
                    aria-label="Duration"
                    data-testid="flow-node-duration"
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

/** Where the flow node stands. */
export const StatusSelect: React.FC<{ status: FlowNodeStatus; onChange: (next: FlowNodeStatus) => void }> = ({
    status, onChange,
}) => {
    const options = useMemo(
        () => (Object.keys(STATUS_LABELS) as FlowNodeStatus[]).map(value => ({
            value,
            label: (
                <span className={styles.statusTone} data-status={value}>{STATUS_LABELS[value]}</span>
            ),
            // The word, for antd: a label it cannot read as a string is an option with no title, and the title is what the list is picked from.
            title: STATUS_LABELS[value],
        })),
        [],
    );

    return (
        <Tooltip title={STATUS_HELP}>
            <Select
                size="small"
                className={`${styles.metaSelect} ${styles.metaStatus}`}
                value={status}
                options={options}
                onChange={onChange}
                aria-label="Status"
                data-testid="flow-node-status"
                classNames={POPUP}
                popupMatchSelectWidth={false}
            />
        </Tooltip>
    );
};

/** The conversation the flow node was played in: a way in, and a way to forget it. */
export const ChatLink: React.FC<{ chat: string; onOpen: () => void; onUnlink: () => void }> = ({
    chat, onOpen, onUnlink,
}) => {
    if (!chat) return <span className={styles.metaChatNone}>No chat yet</span>;

    return (
        <span className={styles.metaChat}>
            <Tooltip title={CHAT_HELP}>
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
            </Tooltip>
            <Tooltip title={UNLINK_HELP}>
                <Button
                    size="small"
                    type="text"
                    icon={<DisconnectOutlined />}
                    aria-label="Forget the node’s chat"
                    data-testid="unlink-flow-node-chat"
                    onClick={onUnlink}
                />
            </Tooltip>
        </span>
    );
};

interface NextFlowNodeProps {
    success: FlowNodeSuccess;

    content: BoardContent;

    flowNodeId: string;

    multiple?: boolean;
    onChange: (next: FlowNodeSuccess) => void;
    disabled?: boolean;
}

/**
 * The flow node played straight after this one — the only way two flow nodes are chained, and it.
 * It is asked of every card but a Shutdown, and not only of Claude's.
 */
export const NextFlowNodeSelect: React.FC<NextFlowNodeProps> = ({
    success, content, flowNodeId, multiple, onChange, disabled,
}) => {
    // Archived cards are never offered and never shown as named: their links stay stored but hidden, so a board mixing archived.
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
            <Tooltip title={BRANCHES_HELP}>
                <Select
                    size="small"
                    mode="multiple"
                    className={`${styles.metaSelect} ${styles.metaNext}`}
                    value={visibleBranches}
                    disabled={disabled}
                    options={options}
                    onChange={value => onChange({ ...success, flowNodes: [...hiddenBranches, ...value] })}
                    aria-label="Branches"
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

/** The tags the card wears. */
export const TagsControl: React.FC<{
    tags: string[];
    onChange: (next: string[]) => void;
    className?: string;
}> = ({ tags, onChange, className }) => {
    const { TagPicker } = useTagsUi();
    return (
        <Tooltip title={TAGS_HELP}>
            <div className={className ?? styles.metaTags}>
                <TagPicker
                    value={tags}
                    onChange={onChange}
                    className={styles.metaTagPicker}
                    aria-label="Node tags"
                    data-testid="flow-node-tags"
                />
            </div>
        </Tooltip>
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
                    {!readOnly && <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        aria-label="Remove success criterion"
                        onClick={() => onChange(criteria.filter(held => held.id !== criterion.id))}
                    />}
                </div>
            ))}
            {!readOnly && <Tooltip title={CRITERIA_HELP}>
                <Button
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
                </Button>
            </Tooltip>}
        </div>
    );
};
