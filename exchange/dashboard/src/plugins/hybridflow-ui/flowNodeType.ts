/**
 * AI and Human are tasks. Shutdown ends the play; Scheduler waits for its datetime;
 * Gateway waits for all incoming branches, then starts outgoing branches in parallel.
 */

import {
    AGENT_KEY, EFFORT_KEY, FOLDER_KEY, MODEL_KEY, PERMISSION_KEY, RUNNER_KEY,
    SettingsChanges, FlowNodeSettings, withSettings,
} from './flowNodeSettings';

export type FlowNodeType = 'ai' | 'human' | 'shutdown' | 'scheduler' | 'gateway';

export const FLOW_NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
    ai: 'AI',
    human: 'Human',
    shutdown: 'Shutdown',
    scheduler: 'Scheduler',
    gateway: 'Parallel gateway',
};

export const FLOW_NODE_TYPE_ORDER: FlowNodeType[] = ['ai', 'human', 'shutdown', 'scheduler', 'gateway'];

/** Gateways have no reusable description or completion semantics; the service rejects gateway classes. */
export const FLOW_NODE_CLASS_TYPE_ORDER: Exclude<FlowNodeType, 'gateway'>[] = [
    'ai', 'human', 'shutdown', 'scheduler',
];

/** Omitted in files. Without a type or agent/model, legacy documents remain Human. */
export const FLOW_NODE_TYPE_DEFAULT: FlowNodeType = 'human';

/** Canvas creation defaults to AI, independently of the legacy file default. */
export const NEW_FLOW_NODE_TYPE: FlowNodeType = 'ai';

/** Automatic tool approval; request only if the agent's platform advertises this mode. */
export const BYPASS_PERMISSION = 'bypassPermissions';

/** AI without an agent is incomplete and unplayable; never substitute an engine on writes. */
export const NO_AGENT = '';

/** Defaults supplied by the editor from the store's first agent. */
export interface PlayDefaults {
    agent: string;
    /**
     * Creation only: bypassPermissions if supported, otherwise ''. Retyping an existing
     * card AI must not grant unattended tool permissions.
     */
    permission?: string;
}

const KNOWN = Object.keys(FLOW_NODE_TYPE_LABELS) as FlowNodeType[];

/** Legacy boards infer AI from an agent or, before managed agents, a model. */
export const readType = (raw: unknown, settings: FlowNodeSettings): FlowNodeType => {
    const said = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if ((KNOWN as string[]).includes(said)) return said as FlowNodeType;
    return settings.agent || settings.model ? 'ai' : FLOW_NODE_TYPE_DEFAULT;
};

export const saysType = (type: FlowNodeType): boolean => type !== FLOW_NODE_TYPE_DEFAULT;

export const isForAgent = (type: FlowNodeType): boolean => type === 'ai';

/** Executed by the run without an agent turn, prompt or conversation. */
export const runsItself = (type: FlowNodeType): boolean =>
    type === 'shutdown' || type === 'scheduler' || type === 'gateway';

/** Tasks own descriptions and folders, stored in a separate task row keyed by flow node. */
export const isTask = (type: FlowNodeType): boolean => type === 'ai' || type === 'human';

/** Shutdown cannot have a successor: powering off ends the board. */
export const chains = (type: FlowNodeType): boolean => type !== 'shutdown';

/** Transition controls what happens to the AI conversation on completion. */
export const hasTransition = (type: FlowNodeType): boolean => isForAgent(type);

export const hasFolder = (type: FlowNodeType): boolean => isTask(type);

/**
 * AI preserves its agent or uses defaults. Other types clear turn settings and the legacy model;
 * Human retains its folder, while machine-only types clear it.
 */
export const typeChanges = (
    settings: FlowNodeSettings, next: FlowNodeType, defaults: PlayDefaults = FALLBACK_DEFAULTS,
): SettingsChanges => {
    if (next === 'ai') {
        return { [AGENT_KEY]: settings.agent || defaults.agent || NO_AGENT };
    }
    const bare: SettingsChanges = {
        [AGENT_KEY]: undefined, [MODEL_KEY]: undefined,
        [EFFORT_KEY]: undefined, [PERMISSION_KEY]: undefined, [RUNNER_KEY]: undefined,
    };
    return hasFolder(next) ? bare : { ...bare, [FOLDER_KEY]: undefined };
};

const FALLBACK_DEFAULTS: PlayDefaults = { agent: NO_AGENT };

/**
 * Creation may set agent and permission, but leaves effort and folder empty so work cannot
 * start with an unchosen budget or directory. Retyping does not inherit this permission default.
 */
export const newFlowNodeSettings = (
    defaults: PlayDefaults = FALLBACK_DEFAULTS, type: FlowNodeType = NEW_FLOW_NODE_TYPE,
): FlowNodeSettings =>
    withSettings({}, {
        ...typeChanges({}, type, defaults),
        [PERMISSION_KEY]: isForAgent(type) ? defaults.permission : undefined,
    });

/**
 * Unknown agent IDs are legacy engine names; use their effort/permission vocabulary.
 * Empty means editor defaults, never a playback fallback: no agent means unplayable.
 */
export const settingsPlatform = (
    settings: FlowNodeSettings, agents: { id: string; platform: string }[],
): string => {
    if (!settings.agent) return '';
    return agents.find(agent => agent.id === settings.agent)?.platform ?? settings.agent;
};
