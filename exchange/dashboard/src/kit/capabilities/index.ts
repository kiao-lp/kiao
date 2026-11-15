// Capabilities pass through manifests, not imports. The registry is fixed before first render.
// Missing providers are normal; accessors return no-ops.

import React, { useCallback, useMemo } from 'react';
import type { HarnessOption } from 'kiao-worker';
import { usePluginCapabilities } from '@kiao-dashboard-core';

export interface ChatCapability {
    /** An empty chat id does nothing. */
    useShowChat: () => (chat: string) => void;
}

export type { HarnessOption } from 'kiao-worker';
export type HarnessChoice = import('kiao-worker').HarnessOptionsEntry;

export interface ChatOptionsCapability {
    useChatOptions: () => {
        /** Default first. */
        harnesses: HarnessChoice[];
    };
}

export interface HarnessRunFlowNode {
    id: string;
    title: string;
    /** Empty string if the card no longer exists. */
    status: string;
    /** Played; excludes current and upcoming cards. */
    played?: boolean;
    current?: boolean;
}

export interface HarnessRun {
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
    flowNodes?: HarnessRunFlowNode[];
    ending?: string;
}

/** Ended runs remain available for restart. */
export interface ChatRunCapability {
    useChatRun: () => {
        /** Live and recently ended, oldest first. */
        runs: HarnessRun[];
        /** Opens the run's chat. */
        play: (path: string, flowNodeId: string, name: string) => void;
        stop: (runId: string) => void;
        /** Attaches to a user-started turn, or plays the card if none comes. */
        resume: (runId: string) => void;
        /** From its original card, keeping its name. */
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

const NO_HARNESSES: { harnesses: HarnessChoice[] } = { harnesses: [] };
const NO_CHOICE: HarnessChoice = { value: '', label: '', models: [], efforts: [], permissionModes: [] };

/** Merges providers in assembly order; first value wins and is the default. Empty without providers. */
export const useChatOptions = (): {
    harnesses: HarnessChoice[];
    /** Empty lists for harnesses this assembly cannot drive. */
    optionsFor: (harness: string) => HarnessChoice;
} => {
    const providers = useCapability('chat.options');
    const published = providers.map(provider => provider.useChatOptions() ?? NO_HARNESSES);

    // Stable results while provider arrays are stable; the fixed registry keeps the dependency length constant.
    return useMemo(() => {
        const harnesses: HarnessChoice[] = [];
        for (const entry of published.flatMap(one => one.harnesses ?? [])) {
            if (!harnesses.some(held => held.value === entry.value)) harnesses.push(entry);
        }
        return {
            harnesses,
            optionsFor: (harness: string) => harnesses.find(entry => entry.value === harness) ?? NO_CHOICE,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, published.map(one => one.harnesses));
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
