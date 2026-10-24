// Plugins exchange capabilities through manifests rather than importing each other.
// The registry is fixed before first render: provider hooks keep a stable count and order.
// Missing providers are normal; accessors return no-ops and availability hooks gate controls.

import React, { useCallback, useMemo } from 'react';
import type { AgentOption } from 'kiao-worker';
import { usePluginCapabilities } from '@cms-core';

export interface ChatCapability {
    /** Opens the conversation panel; an empty chat id does nothing. */
    useShowChat: () => (chat: string) => void;
}

export type { AgentOption } from 'kiao-worker';
export type AgentChoice = import('kiao-worker').AgentOptionsEntry;

export interface ChatOptionsCapability {
    useChatOptions: () => {
        /** Publisher's agents, default first. */
        agents: AgentChoice[];
    };
}

export interface AgentRunFlowNode {
    id: string;
    title: string;
    /** Board status, or an empty string if the card no longer exists. */
    status: string;
    /** Already played; excludes the current card and upcoming cards. */
    played?: boolean;
    current?: boolean;
}

export interface AgentRun {
    id: string;
    name: string;
    /** Board handle. */
    path: string;
    /** Starting card, also used on restart. */
    rootFlowNodeId: string;
    flowNodeId: string;
    chat: string;
    state: string;
    retryAt?: number | null;
    startedAt?: number;
    endedAt?: number | null;
    documentAt?: number | null;
    /** Chain order: played, current, then upcoming. */
    flowNodes?: AgentRunFlowNode[];
    ending?: string;
}

/** Concurrent runs; ended runs remain available for restart. */
export interface ChatRunCapability {
    useChatRun: () => {
        /** Live and recently ended runs, oldest first. */
        runs: AgentRun[];
        /** Starts the named run on this card and opens its chat. */
        play: (path: string, flowNodeId: string, name: string) => void;
        stop: (runId: string) => void;
        /** Resumes a suspended run, attaching to a user-started turn or playing the card if none comes. */
        resume: (runId: string) => void;
        /** Replays an ended run from its original card, keeping its name. */
        restart: (runId: string) => void;
        /** Removes an ended run. */
        forget: (runId: string) => void;
    };
}

export interface TagsCapability {
    /** Store colours, grey for unknown labels. */
    TagChips: React.FC<{ labels?: string[]; className?: string }>;
    /** Typed labels immediately join the store's list. */
    TagPicker: React.FC<{
        value: string[];
        onChange: (next: string[]) => void;
        className?: string;
        'aria-label'?: string;
        'data-testid'?: string;
    }>;
}

/** Register new names here and in the provider manifest. */
export interface Capabilities {
    'chat.show': ChatCapability;
    'chat.options': ChatOptionsCapability;
    'chat.run': ChatRunCapability;
    'tags.ui': TagsCapability;
}

const NO_PROVIDERS: never[] = [];

/** All providers in assembly order; empty if none. */
export const useCapability = <K extends keyof Capabilities>(name: K): Capabilities[K][] =>
    (usePluginCapabilities()[name] as Capabilities[K][] | undefined) ?? NO_PROVIDERS;

const noShowChat = () => {};

/** Uses the first provider in assembly order; no-op if absent. */
export const useShowChat = (): ((chat: string) => void) => {
    const chats = useCapability('chat.show');
    const fallback = useCallback(noShowChat, []);
    const shown = chats.map(chat => chat.useShowChat());
    return shown[0] ?? fallback;
};

const NO_AGENTS: { agents: AgentChoice[] } = { agents: [] };
const NO_CHOICE: AgentChoice = { value: '', label: '', models: [], efforts: [], permissionModes: [] };

/**
 * Merges all providers in assembly order; first agent of a given value wins.
 * The first entry is the default. Empty without providers.
 */
export const useChatOptions = (): {
    agents: AgentChoice[];
    /** Empty lists for agents this assembly cannot drive. */
    optionsFor: (agent: string) => AgentChoice;
} => {
    const providers = useCapability('chat.options');
    const published = providers.map(provider => provider.useChatOptions() ?? NO_AGENTS);

    // Keep results stable while provider arrays are stable, for consumer dependencies.
    // The fixed registry also keeps this dependency array's length constant.
    return useMemo(() => {
        const agents: AgentChoice[] = [];
        for (const entry of published.flatMap(one => one.agents ?? [])) {
            if (!agents.some(held => held.value === entry.value)) agents.push(entry);
        }
        return {
            agents,
            optionsFor: (agent: string) => agents.find(entry => entry.value === agent) ?? NO_CHOICE,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, published.map(one => one.agents));
};

const NO_RUN: ReturnType<ChatRunCapability['useChatRun']> = {
    runs: [],
    play: () => {},
    stop: () => {},
    resume: () => {},
    restart: () => {},
    forget: () => {},
};

/** Uses the first run provider in assembly order; empty runs and no-op actions if absent. */
export const useChatRun = (): ReturnType<ChatRunCapability['useChatRun']> => {
    const runners = useCapability('chat.run');
    const published = runners.map(runner => runner.useChatRun());
    return published[0] ?? NO_RUN;
};

export const useChatRunAvailable = (): boolean => useCapability('chat.run').length > 0;

const NoTags: React.FC<any> = () => null;
const ABSENT_TAGS: TagsCapability = { TagChips: NoTags, TagPicker: NoTags };

/** First provider in assembly order; both components render nothing if absent. */
export const useTagsUi = (): TagsCapability => useCapability('tags.ui')[0] ?? ABSENT_TAGS;

/** Gates surfaces consisting entirely of tags, such as the board filter row. */
export const useTagsAvailable = (): boolean => useCapability('tags.ui').length > 0;
