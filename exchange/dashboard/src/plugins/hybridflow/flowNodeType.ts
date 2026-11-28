/** AI and Human are tasks. */

import {
    AGENT_KEY, EFFORT_KEY, FOLDER_KEY, MODEL_KEY, PERMISSION_KEY, RUNNER_KEY,
    SettingsChanges, FlowNodeSettings, withSettings,
} from './flowNodeSettings';

export type FlowNodeType =
    'ai' | 'human' | 'start' | 'shutdown' | 'scheduler' | 'bitbucket-pr-status' | 'bitbucket-commit-status'
    | 'gateway' | 'exclusive-gateway' | 'limiter' | 'note' | 'value' | 'role';

export const FLOW_NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
    ai: 'AI',
    human: 'Human',
    start: 'Start',
    shutdown: 'Shutdown',
    scheduler: 'Scheduler',
    'bitbucket-pr-status': 'Bitbucket PR Status',
    'bitbucket-commit-status': 'Bitbucket Commit Status',
    gateway: 'Parallel gateway',
    'exclusive-gateway': 'Exclusive gateway',
    limiter: 'Limiter',
    note: 'Note',
    value: 'Value',
    role: 'Role',
};

export const FLOW_NODE_TYPE_ORDER: FlowNodeType[] = [
    'ai', 'human', 'start', 'shutdown', 'scheduler', 'bitbucket-pr-status', 'bitbucket-commit-status',
    'gateway', 'exclusive-gateway', 'limiter', 'note', 'value', 'role',
];

/** Omitted in files. Without a type or agent/model, legacy documents remain Human. */
export const FLOW_NODE_TYPE_DEFAULT: FlowNodeType = 'human';

/** Canvas creation defaults to AI, independently of the legacy file default. */
export const NEW_FLOW_NODE_TYPE: FlowNodeType = 'ai';

/** Automatic tool approval; request only if the agent's harness advertises this mode. */
export const BYPASS_PERMISSION = 'bypassPermissions';

/** New AI tasks require a selected agent before they can play. */
export const NO_AGENT = '';

const KNOWN = Object.keys(FLOW_NODE_TYPE_LABELS) as FlowNodeType[];

/** Legacy boards infer AI from an agent or, before managed agents, a model. */
export const readType = (raw: unknown, settings: FlowNodeSettings): FlowNodeType => {
    const said = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if ((KNOWN as string[]).includes(said)) return said as FlowNodeType;
    return settings.agent || settings.model ? 'ai' : FLOW_NODE_TYPE_DEFAULT;
};

export const saysType = (type: FlowNodeType): boolean => type !== FLOW_NODE_TYPE_DEFAULT;

export const isForAgent = (type: FlowNodeType): boolean => type === 'ai';

export const joins = (type: FlowNodeType): boolean => type === 'gateway' || type === 'exclusive-gateway';

export const splits = (type: FlowNodeType): boolean => joins(type) || type === 'limiter';

export const isBitbucketEvent = (type: FlowNodeType): boolean =>
    type === 'bitbucket-pr-status' || type === 'bitbucket-commit-status';

export const isWaitingEvent = (type: FlowNodeType): boolean => type === 'scheduler' || isBitbucketEvent(type);

/** The runner executes these nodes directly. */
export const runsItself = (type: FlowNodeType): boolean =>
    type === 'start' || type === 'shutdown' || isWaitingEvent(type) || splits(type);

export const isDisplay = (type: FlowNodeType): boolean => type === 'note' || type === 'value' || type === 'role';

/** Tasks own descriptions and folders, stored in a separate task row keyed by flow node. */
export const isTask = (type: FlowNodeType): boolean => type === 'ai' || type === 'human';

/** Shutdown and display nodes cannot have a successor. */
export const chains = (type: FlowNodeType): boolean => type !== 'shutdown' && !isDisplay(type);

export const acceptsPredecessor = (type: FlowNodeType): boolean => type !== 'start' && !isDisplay(type);

/** Transition controls what happens to the AI conversation on completion. */
export const hasTransition = (type: FlowNodeType): boolean => isForAgent(type);

export const hasFolder = (type: FlowNodeType): boolean => isTask(type);

/**
 * AI preserves an explicit agent.
 * Other types clear turn settings and the legacy model; Human retains its folder, while machine-only.
 */
export const typeChanges = (
    settings: FlowNodeSettings, next: FlowNodeType,
): SettingsChanges => {
    if (next === 'ai') {
        return { [AGENT_KEY]: settings.agent || NO_AGENT };
    }
    const bare: SettingsChanges = {
        [AGENT_KEY]: undefined, [MODEL_KEY]: undefined,
        ...(settings.harness ? { harness: undefined } : {}),
        ...(settings.profileId ? { profileId: undefined } : {}),
        [EFFORT_KEY]: undefined, [PERMISSION_KEY]: undefined, [RUNNER_KEY]: undefined,
    };
    return hasFolder(next) ? bare : { ...bare, [FOLDER_KEY]: undefined };
};

/** New tasks receive their agent from the creation dialog. */
export const newFlowNodeSettings = (type: FlowNodeType = NEW_FLOW_NODE_TYPE): FlowNodeSettings =>
    withSettings({}, typeChanges({}, type));

/**
 * Legacy settings can name a harness in the agent field. Use it to look up editor options.
 * An empty result selects editor defaults only.
 */
export const settingsHarness = (
    settings: FlowNodeSettings, agents: { id: string; harness: string; published?: { harness: string } }[],
): string => {
    if (!settings.agent) return '';
    if (settings.harness) return settings.harness;
    const agent = agents.find(agent => agent.id === settings.agent);
    return agent?.published?.harness ?? agent?.harness ?? settings.agent;
};
