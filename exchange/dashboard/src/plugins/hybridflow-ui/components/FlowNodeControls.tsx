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
import { readDuration } from '../flowNodeSchedule';
import styles from '../Hybridflow.module.css';

/**
 * The controls the open flow node is edited with, one component each: **what kind of flow node it is**, what
 * plays it, where it runs, when it fires, how it ends, where it stands, the chat it was played in
 * and the flow node it hands on to.
 *
 * The type is the first of them and the one the others hang off. An *AI* card is asked what plays it
 * and what becomes of its conversation; a *Human* card is asked none of that; a *Scheduler* is asked
 * for a duration or datetime and for the flow node that follows it; a *Shutdown* is asked nothing at all. What is not
 * asked is not drawn, rather than drawn and disabled — a question nobody can answer is a question
 * not worth putting.
 *
 * They live here rather than in the editors that arrange them because **the two faces of the editor
 * arrange them differently**, and not in the same groups. The panel has a column's width, so it
 * stacks them: the settings as a block, the status and the chat as a line, the chain as another.
 * The large editor has the board's width and lays them across rows that cut straight through those
 * groups — the chat handover beside the permission mode, the chat link at the end of that row, the
 * status beside the flow node that comes next. A control written once is the same control in both, and
 * each face is then only a matter of which row it is put on.
 *
 * Every one of them writes straight through to the flow node: a click on a select is a write to the
 * content document, and there is nothing to apply afterwards.
 */

/**
 * The one answer the chain select gives that is not a flow node. Prefixed so that no id can collide
 * with it.
 */
const NOTHING = '!none';

/** What a flow node named after this one is called when it is no longer on the board to be picked. */
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
}

/**
 * The list a Claude select is picked from.
 *
 * It is handed in rather than asked for here: the options capability is a request to the service and
 * not a cache, so the face of the editor doing the arranging asks once for the three lists its
 * three selects need, instead of each select asking for all three.
 */
interface OfferedProps {
    options: AgentOption[];
}

/**
 * **What kind of card this is**: one an agent plays, one a person does, one that turns the machine
 * off, or one that waits for a datetime. It is the first question the card is asked, and the one the
 * rest of the editor hangs off — the agent, the effort, the permission mode, the transition mode and
 * the chat are asked of an AI card and of no other, and the datetime of a Scheduler and of no other.
 * The lateral panel does not ask it: the kind was decided when the card was made.
 *
 * It is a **field** of the flow node, which it was not while there were two answers: the type used to be
 * the model read as a yes-or-no, so the two could never disagree. A Shutdown card has no settings at
 * all to be read off — that is what *no options* means — so the document says the type itself, and
 * the editor is what keeps it in step: picking a type writes the settings that go with it and takes
 * back the ones it has no use for.
 *
 * It used to be the model select's own first line, *Not for Claude*, which made the question of who
 * does the flow node a value of the question of what plays it — so a board mostly of work for people was
 * a board every card of which answered a question about Claude, and the answer to *is this mine?*
 * had to be found at the top of a list of models.
 *
 * **The folder survives the two types that ask for one**, and so does the flow node named after this one
 * wherever it can still be named: where the work is and what comes after it are true of the card
 * whoever does it.
 */
export const TypeSelect: React.FC<{
    type: FlowNodeType;
    onChange: (next: FlowNodeType) => void;
    /** What the select offers. Every kind — unless a class is being typed, which is never a gateway. */
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
 * **Which agent plays the flow node**: one of the managed agents the store keeps, picked by name. Drawn
 * only for an **AI** flow node, first among the settings: whether the flow node is an agent's at all is the
 * question above it — see {@link TypeSelect} — and this one is only ever which one.
 *
 * Changing it **clears the legacy model** — picking an agent is the moment a card written before
 * managed agents stops saying it — and the effort and the permission mode where the new agent runs
 * on another platform: the two are that platform's vocabulary, and a card left holding them would
 * read as answered and play as refused. The folder stays, being a place in the store and nobody's
 * vocabulary.
 *
 * A value no agent of the list holds is still shown: a card written before managed agents names the
 * engine itself, with the model beside it, and a card whose agent has gone names an id — both have
 * to be readable before they can be changed. The second is marked like an unanswered box: the
 * engine and the model are still an answer, while an id nothing holds names nothing to play the
 * card — which is what the card's own mark says, without naming the field.
 *
 * The class editor asks it too, for the version being read: whose default agent it holds. There
 * it is `disabled` on a published version — what stays said stays — `allowClear` where none is
 * a legitimate answer, and `help` says whose agent it is rather than which agent plays a card.
 */
export const AgentSelect: React.FC<SettingProps & {
    agents: AgentDto[];
    disabled?: boolean;
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
            // The engine and the model, as a card written before managed agents reads — or the id
            // of an agent that has gone, which no name in the list answers any more.
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
            // The legacy model goes whatever the platform: picking an agent is the moment the card
            // stops saying it. The effort and the permission mode go only where the platform
            // changed under them — they are questions this platform has not been asked.
            [MODEL_KEY]: undefined,
            ...(before && after && before !== after
                ? { [EFFORT_KEY]: undefined, [PERMISSION_KEY]: undefined }
                : {}),
        });
    };

    // An id nothing holds, beside no model: an agent that has gone, naming nothing to play the
    // card. A card written before managed agents names the engine with the model beside it, which
    // is still an answer and is read as one.
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
 * How hard it thinks. Empty rather than defaulted: the placeholder asks for the one thing still
 * missing, and the warning is what says the flow node is not playable without it.
 *
 * It is the one setting about the turn that stays the flow node's own to say where the agent is picked:
 * the type gives the card its agent, and this is the first thing the user is left to say about the
 * turn. Drawn only for an **AI** flow node, so there is nothing here to disable: a flow node a person does is
 * not asked how hard an agent thinks about it.
 */
export const EffortSelect: React.FC<SettingProps & OfferedProps> = ({ settings, options, onChange }) => {
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

/**
 * What the played turn may do on its own. Empty rather than defaulted, like the effort: it is the
 * one field that says what the agent may do to the store while nobody is looking, which is the last
 * thing to decide on the user's behalf. Drawn only for an **AI** flow node, there being no turn to
 * answer for on any other.
 *
 * **Which modes exist is the platform's answer**, not the deployment's alone: `codex exec` has
 * no approval channel at all and publishes `bypassPermissions` by itself, so the list here is the
 * one the card's agent runs on.
 *
 * The box shows the short name (`bypass`, `live`), as the card does: the three selects share one
 * line, and the wire value is a box that takes it to itself. The list keeps the full names, so
 * the choice is picked from words that say what they do.
 */
export const PermissionSelect: React.FC<SettingProps & OfferedProps> = ({ settings, options, onChange }) => {
    const offered = useMemo(() => {
        const modes = options.map(mode => ({ value: mode.value, label: mode.label, title: mode.label }));
        // A deployment may withdraw a mode (`bypassPermissions` is the one it withdraws) after a
        // flow node has already asked for it. Showing the line the flow node holds beats an empty box.
        if (settings.permission && !modes.some(mode => mode.value === settings.permission)) {
            modes.push({ value: settings.permission, label: settings.permission, title: settings.permission });
        }
        return modes;
    }, [options, settings.permission]);

    // The one mode that changes what an agent may do on its own, marked here as it is in the chat.
    const risky = settings.permission === BYPASS_PERMISSION;

    return (
        <Tooltip title={PERMISSION_HELP}>
            <Select
                size="small"
                className={`${styles.metaSelect} ${risky ? styles.metaSelectRisky : ''}`}
                value={settings.permission || undefined}
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
 * **Which runner plays the flow node**: one of the runners the store keeps, picked by name — or
 * nothing, which is played wherever a Play is pressed. Drawn only for an **AI** flow node, like
 * the agent: a card nobody plays is pinned nowhere.
 *
 * It is the one setting that may stay empty: an unpinned card is no less playable, and the box
 * clears back to it. A value no runner of the list holds is still shown — a card whose runner has
 * gone names an id — and marked like an unanswered box: it names nothing to play the card, and the
 * play is refused until another is picked or the pin is taken off.
 */
export const RunnerSelect: React.FC<SettingProps & { runners: RunnerDto[] }> = ({
    settings, runners, onChange,
}) => {
    const offered = useMemo(() => {
        const list = runners.map(runner => ({ value: runner.id, label: runner.name }));
        if (settings.runner && !list.some(runner => runner.value === settings.runner)) {
            // The id of a runner that has gone, which no name in the list answers any more.
            list.push({ value: settings.runner, label: 'Unknown runner' });
        }
        return list;
    }, [runners, settings.runner]);

    // An id nothing holds: the runner has gone, and the card names nothing to play it.
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

/**
 * The folder the flow node is about. It is **asked of every flow node**, whichever type it is: where the work
 * is is worth writing down on a card a person will do by hand, and a flow node typed AI later arrives
 * with the one setting nothing else can supply. Only of an AI flow node is it *required* — the warning is
 * the mark of a card that cannot be played until this is filled in.
 *
 * The box also takes what is dragged onto it out of the file tree or the file browser, which is
 * the shorter way of saying a path than typing one: the entry of the drag names the folder, and a
 * file names the folder holding it — see `droppedFolder`. Taking the drop at all is `useFileDrop`,
 * shared with the template `file` field, which is the other box in the CMS filled that way.
 *
 * At the end of the box, the crosshair that shows the folder in the file navigator — a path typed
 * or dropped here is one the eye cannot place, and a card is read far more often than it is
 * filled in. It is dark until there is a path to point at, the box being asked for one either way.
 *
 * **What is written down is a link**, opened by the slash that makes it one, whether it was typed
 * or dropped (`folderLink`). A flow node's working directory is a reference like any other, and the link
 * fixer follows one only when it carries the slash — so a board whose folder was written bare would
 * quietly go on naming a folder that has since been renamed.
 */
export const FolderInput: React.FC<SettingProps & { required: boolean }> = ({
    settings, required, onChange,
}) => {
    const { dropping, dropProps } = useFileDrop(dropped =>
        onChange({ [FOLDER_KEY]: droppedFolder(dropped.path, dropped.isDirectory) }));

    // What the box holds, said the way the store names a folder: `/` is the root, which is the
    // empty path, and a flow node with nothing written on it names no folder at all.
    const folder = settings.folder?.trim() ? settingsFolder(settings) : null;

    return (
        <Tooltip title={FOLDER_HELP}>
            <Input
                size="small"
                className={`${styles.metaFolder} ${dropping ? styles.metaFolderDrop : ''}`}
                value={settings.folder ?? ''}
                status={required && !settings.folder ? 'warning' : undefined}
                placeholder="Folder (/ is the store root)"
                onChange={event => onChange({ [FOLDER_KEY]: folderLink(event.target.value) })}
                aria-label="Working directory"
                data-testid="flow-node-folder"
                suffix={<RevealInTreeButton path={folder} subject="folder" data-testid="flow-node-folder-locate" />}
                {...dropProps}
            />
        </Tooltip>
    );
};

/**
 * Scheduler modes are mutually exclusive. Duration drafts save on blur or Enter, allowing
 * partial input while typing; date times use the runner machine's local wall clock.
 */
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

/**
 * Where the flow node stands. Four of the eight are the play's — a flow node is in progress while it is held,
 * waiting refresh while a usage limit holds it, and done, interrupted or an error once it is let go
 * — and this select is where the other four are written, a draft being said to be ready, a flow node
 * waiting on the world outside being said to be blocked, and a flow node that ended badly being offered
 * again.
 *
 * Each status is shown in the colour its card is striped with, so the select is the board's legend:
 * the one place all eight are named at once is the place to learn which colour means what.
 */
export const StatusSelect: React.FC<{ status: FlowNodeStatus; onChange: (next: FlowNodeStatus) => void }> = ({
    status, onChange,
}) => {
    const options = useMemo(
        () => (Object.keys(STATUS_LABELS) as FlowNodeStatus[]).map(value => ({
            value,
            label: (
                <span className={styles.statusTone} data-status={value}>{STATUS_LABELS[value]}</span>
            ),
            // The word, for antd: a label it cannot read as a string is an option with no title,
            // and the title is what the list is picked from by anything but a pointer.
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

/**
 * The conversation the flow node was played in: a way in, and a way to forget it. The link is what the
 * user follows to read what a played flow node actually did; forgetting it leaves the chat where it is,
 * and the flow node is played in a new one next time.
 */
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
    /** The board, as the chain is picked from: every card of it, with the open flow node left out. */
    content: BoardContent;
    /** The open flow node, which is not offered — a flow node after itself would be a play with no end. */
    flowNodeId: string;
    /** A Gateway's branches: several cards picked at once, each started when it fires. */
    multiple?: boolean;
    onChange: (next: FlowNodeSuccess) => void;
}

/**
 * The flow node played straight after this one — the only way two flow nodes are chained, and it names
 * any card of the board.
 *
 * It is asked of every card but a Shutdown, and not only of Claude's. A chain is the order a board
 * has, and an order is worth writing down whoever plays the cards; a play, when there is one,
 * follows it as far as the cards it can take. A Shutdown is not asked because nothing is ever played
 * after the machine goes off.
 *
 * On a Gateway it picks the **branches**: several cards at once, each started in parallel when the
 * gateway fires. A branch taken off here is the one way a branch is taken off — a line drawn on the
 * board only ever adds one.
 */
export const NextFlowNodeSelect: React.FC<NextFlowNodeProps> = ({
    success, content, flowNodeId, multiple, onChange,
}) => {
    // Archived cards are never offered and never shown as named: their links stay stored but
    // hidden, so a board mixing archived and live cards shows no link to or from an archived one.
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
                .map(flowNode => ({ value: flowNode.id, label: flowNode.title || 'Untitled' })),
        ];
        // A named flow node may have been deleted since. Saying so beats an empty box over a document
        // that says otherwise. Archived ones stay hidden instead: their link is stored but not shown.
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
        // Deleted branches stay shown as left-the-board; archived ones stay hidden but stored.
        const visibleBranches = success.flowNodes.filter(id => !hiddenBranches.includes(id));
        return (
            <Tooltip title={BRANCHES_HELP}>
                <Select
                    size="small"
                    mode="multiple"
                    className={`${styles.metaSelect} ${styles.metaNext}`}
                    value={visibleBranches}
                    options={options}
                    onChange={value => onChange({ ...success, flowNodes: [...hiddenBranches, ...value] })}
                    aria-label="Branches"
                    classNames={POPUP}
                    popupMatchSelectWidth={false}
                />
            </Tooltip>
        );
    }

    // Deleted stays shown as left-the-board; archived hides as nothing next, kept stored until rewritten.
    const goneSingle = hasSuccess(success) && !live.has(success.flowNode) &&
        !content.flowNodes.some(flowNode => flowNode.id === success.flowNode);
    const visibleNext = hasSuccess(success) && (live.has(success.flowNode) || goneSingle) ? success.flowNode : NOTHING;
    return (
        <Tooltip title={NEXT_HELP}>
            <Select
                size="small"
                className={`${styles.metaSelect} ${styles.metaNext}`}
                value={visibleNext}
                options={options}
                // Nothing next is what a flow node says by saying nothing, so it is written by taking
                // the id out — and only the id. How the flow node ends is its own, not the line's.
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
 * **The transition mode**: who gets the conversation once the flow node is done — the flow node after it, in a
 * fork of it, or nobody.
 *
 * It is one select of two, because a flow node hands its chat on or it does not. The machine going off
 * was an answer here for a while, and a box among the settings before that; it is a card of its own
 * now, which is what it always was underneath — a step with an end of its own rather than something
 * a turn leaves behind. Shortening the chat was an answer here too, and is the box beside this one:
 * it says what this flow node leaves its own conversation as, which a card with nothing after it has as
 * much right to say as a card in the middle of a chain.
 *
 * **It is asked of an AI card and of no other.** Carrying a conversation on claims one to carry,
 * which no other type has, so the question is not put to them at all; a card typed away from AI
 * gives up the mode with the settings. Within an AI card it stays offered whatever else is missing:
 * a mode picked before the effort is a plan, not an error. Where those settings leave the card
 * unplayable the select carries the warning every unanswered setting carries and says what is
 * missing — nothing is taken away and nothing is corrected, the contradiction is shown and the user
 * resolves it either way round.
 */
export const TransitionModeSelect: React.FC<{
    success: FlowNodeSuccess;
    /** The flow node's settings: what says whether a mode claiming a played turn can be honoured. */
    settings: FlowNodeSettings;
    onChange: (next: FlowNodeSuccess) => void;
}> = ({ success, settings, onChange }) => {
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
 *
 * A box rather than a third answer in the select beside it, because it answers a different question.
 * The mode says who the conversation goes to next; this says what state this flow node leaves it in — and
 * that is worth saying of the last card of a chain, which hands it to nobody, as much as of the
 * first. The two were one word for a while (`Compact and continue`), and a word that says two things
 * is a word one of whose halves cannot be picked on its own.
 *
 * It is asked of an AI card and of no other, and it carries the same warning the select does: a card
 * that claims a conversation to shorten and names nothing to play it is contradicting itself, said
 * where the box was ticked rather than left for the user to work out from a Play button that is not
 * there.
 */
export const CompactCheck: React.FC<{
    success: FlowNodeSuccess;
    /** The flow node's settings: what says whether a chat to shorten can be honoured. */
    settings: FlowNodeSettings;
    onChange: (next: FlowNodeSuccess) => void;
}> = ({ success, settings, onChange }) => {
    const broken = brokenTransition(success, settings);
    return (
        <Tooltip title={broken ? TRANSITION_BROKEN : COMPACT_HELP}>
            <Checkbox
                className={`${styles.metaCheck} ${broken ? styles.metaCheckBroken : ''}`}
                checked={success.compact}
                onChange={event => onChange({ ...success, compact: event.target.checked })}
                data-testid="flow-node-compact"
            >
                Compact
            </Checkbox>
        </Tooltip>
    );
};

/**
 * The tags the card wears.
 *
 * It is asked of **every** flow node, Claude's or not, and it is not one of the four settings: a tag
 * says nothing about what runs the flow node or how, it says what the flow node is *about*.
 *
 * The picker is published by whichever plugin owns the store's tags, so a word typed here joins that
 * list on the spot. The board holds the words; the store holds their colours. An assembly with no
 * such plugin draws no picker at all, and the control is not offered.
 */
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

/**
 * How heavy the work looks, in Fibonacci points.
 *
 * Empty rather than defaulted, like the effort: it is a question, not a value — and an optional
 * one, a task without it being no less playable. Drawn only for a **task**, there being no work
 * to weigh on any other card.
 */
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

/**
 * What done means: the short lines the turn is measured against.
 *
 * One row per criterion — the entered text, and the cross that takes it off — and the button
 * that adds one. The button's name is the section's only title: no label says *Success criteria*
 * above the rows. A fresh line gets an id of its own on the spot, so it is a pair from the first
 * keystroke. Drawn only for a **task**: the two the board plays to itself describe no work, so
 * there is nothing of theirs to measure.
 *
 * Every keystroke writes straight through to the flow node, like the tags: there is nothing to
 * apply afterwards.
 *
 * Each line is a box of its own that starts one row high and grows with what is typed, wrapping
 * instead of scrolling sideways. **Enter** validates the line being typed and opens a fresh one
 * after it, ready to type in; **Control+Enter** drops to the next line inside the same criterion,
 * as do Command+Enter and Shift+Enter. The *Add criterion* button appends a line the same way,
 * caret and all.
 */
export const SuccessCriteriaEditor: React.FC<{
    criteria: SuccessCriterion[];
    onChange: (next: SuccessCriterion[]) => void;
}> = ({ criteria, onChange }) => {
    // The box a fresh line is typed in gets the caret: its id is kept here across the write
    // that adds it, and the effect below focuses it once that write has landed.
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

    // Control+Enter drops to the next line inside the same criterion. The browser puts no line
    // break in for a modified Enter, so the break is written in at the caret and the caret put
    // back after the write re-renders the box.
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
                            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
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
                    <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        aria-label="Remove success criterion"
                        onClick={() => onChange(criteria.filter(held => held.id !== criterion.id))}
                    />
                </div>
            ))}
            <Tooltip title={CRITERIA_HELP}>
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
            </Tooltip>
        </div>
    );
};
