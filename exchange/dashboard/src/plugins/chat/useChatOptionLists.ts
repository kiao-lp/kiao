import { useEffect, useMemo, useState } from 'react';
import type { AgentOption, AgentOptions, AgentOptionsEntry } from 'kiao-worker';
import { useWorkerClient, TOOLBOX_CHANGED_EVENT } from '@cms-core';

/**
 * The agent this service binds a conversation to when the client names none, and the name every
 * store held before there was a choice. It is only ever a *fallback*: what a deployment actually
 * offers comes from `GET /hybridflow-runner/options`, and the panel never hard-codes an engine.
 */
export const DEFAULT_AGENT = 'claude';

const CLAUDE_MODELS: AgentOption[] = [
    { value: 'opus', label: 'Opus' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'fable', label: 'Fable' },
];

const CLAUDE_EFFORTS: AgentOption[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'X-High' },
    { value: 'max', label: 'Max' },
];

const CLAUDE_PERMISSION_MODES: AgentOption[] = [
    { value: 'manual', label: 'Manual' },
    { value: 'manualLive', label: 'Manual Live' },
    { value: 'bypassPermissions', label: 'Bypass permissions' },
];

/**
 * Display defaults for legacy conversation records and services predating agent lists.
 * These lists never establish that a CLI is enabled: only the service can answer that.
 */
export const FALLBACK_AGENT_OPTIONS: AgentOptions = {
    models: CLAUDE_MODELS,
    efforts: CLAUDE_EFFORTS,
    permissionModes: CLAUDE_PERMISSION_MODES,
    agents: [{
        value: DEFAULT_AGENT,
        label: 'Claude',
        models: CLAUDE_MODELS,
        efforts: CLAUDE_EFFORTS,
        permissionModes: CLAUDE_PERMISSION_MODES,
        defaultModel: 'opus',
        defaultEffort: 'max',
    }],
    defaultAgent: DEFAULT_AGENT,
    defaultModel: 'opus',
    defaultEffort: 'max',
};

const NO_AGENT_OPTIONS: AgentOptions = {
    agents: [], models: [], efforts: [], permissionModes: [],
};

export interface ChatOptionsState {
    /**
     * Every agent this deployment offers, the first being the default, each with its own lists.
     * **Empty is a real answer**: a machine with no agent CLI on it. Whoever draws a prompt has to
     * say so rather than offer one that cannot run.
     */
    agents: AgentOptionsEntry[];
    /** The default agent's name — what a conversation created without naming one is bound to. */
    defaultAgent: string;
    /** The default agent's lists, for the places that ask about no agent in particular. */
    models: AgentOption[];
    efforts: AgentOption[];
    permissionModes: AgentOption[];
    loading: boolean;
    /** What `agent` offers, or the default agent's for a name this deployment does not know. */
    optionsFor: (agent: string) => AgentOptionsEntry;
}

/**
 * The agents this deployment offers, refreshed after toolbox changes and on tab visibility.
 *
 * **The lists are per agent**, and reading them as one flat set is what this hook exists to stop:
 * a model name means nothing outside the engine whose catalogue it is in, and Codex publishes one
 * permission mode where Claude publishes three. A service that predates agents is read as the
 * single agent it has. An unreachable endpoint must not enable an agent by guessing.
 */
export const useChatOptionLists = (): ChatOptionsState => {
    const [options, setOptions] = useState<AgentOptions>(NO_AGENT_OPTIONS);
    const [loading, setLoading] = useState(true);
    const workerClient = useWorkerClient();

    useEffect(() => {
        let cancelled = false;
        let generation = 0;
        const refresh = () => {
            const current = ++generation;
            setLoading(true);
            setOptions(NO_AGENT_OPTIONS);
            workerClient.getAgentOptions()
                .then(data => {
                    if (!cancelled && current === generation) setOptions(withAgents(data));
                })
                .catch(() => undefined)
                .finally(() => {
                    if (!cancelled && current === generation) setLoading(false);
                });
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') refresh();
        };
        refresh();
        window.addEventListener(TOOLBOX_CHANGED_EVENT, refresh);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cancelled = true;
            window.removeEventListener(TOOLBOX_CHANGED_EVENT, refresh);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [workerClient]);

    return useMemo(() => {
        const agents = options.agents ?? FALLBACK_AGENT_OPTIONS.agents!;
        // The lists still have to answer for *some* agent even where none is offered: a
        // conversation written before the CLI was removed is opened, read and rendered like any
        // other, and the chips on it name a model and a mode that have to come from somewhere.
        const fallback = agents[0] ?? FALLBACK_AGENT_OPTIONS.agents![0];
        const optionsFor = (agent: string) => agents.find(entry => entry.value === agent) ?? fallback;
        return {
            agents,
            defaultAgent: options.defaultAgent || fallback.value,
            models: fallback.models,
            efforts: fallback.efforts,
            permissionModes: fallback.permissionModes,
            optionsFor,
            loading,
        };
    }, [options, loading]);
};

/**
 * The payload read as a list of agents, whatever shape it came in.
 *
 * A service that answers `agents` is taken at its word — **including when it answers none**. That
 * is a real state now that neither CLI is installed by default: the machine has no agent on it, and
 * the panel says so and points at the configuration rather than drawing a dropdown whose one entry
 * fails at the first prompt. It is told from the other case by the field being *present*: a service
 * that predates agents, where the three lists at the top level were all there was, has no `agents`
 * at all and is read as the single default agent it has always been.
 */
const withAgents = (data: AgentOptions): AgentOptions => {
    const fallback = FALLBACK_AGENT_OPTIONS.agents![0];
    if (Array.isArray(data.agents)) {
        const listed = data.agents.map(entry => ({
            ...entry,
            label: entry.label || entry.value,
            models: entry.models ?? [],
            efforts: entry.efforts ?? [],
            permissionModes: entry.permissionModes ?? [],
        }));
        return { ...data, agents: listed, defaultAgent: data.defaultAgent || listed[0]?.value || '' };
    }
    return {
        ...data,
        agents: [{
            value: data.defaultAgent || fallback.value,
            label: fallback.label,
            models: data.models?.length ? data.models : fallback.models,
            efforts: data.efforts?.length ? data.efforts : fallback.efforts,
            permissionModes: data.permissionModes?.length ? data.permissionModes : fallback.permissionModes,
        }],
        defaultAgent: data.defaultAgent || fallback.value,
    };
};
