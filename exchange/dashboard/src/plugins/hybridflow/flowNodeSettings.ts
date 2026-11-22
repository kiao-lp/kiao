/** AI tasks require agent, effort, permission and folder; Human tasks use only folder. */

import type { HarnessOption, HarnessOptionsEntry, HarnessProfileOffer } from 'kiao-worker';
import { storeLinkOf, storePathOf } from 'kiao-worker/utils';

export interface AgentSelection {
    agent?: string;
    harness?: string;
    profileId?: string;
    model?: string;
}

export interface FlowNodeSettings extends AgentSelection {

    effort?: string;

    permission?: string;

    folder?: string;
    /** Optional runner id: pinned nodes refuse execution on other runners; not required by isPlayable. */
    runner?: string;
}

/** Dropped files select their parent folder. */
export const droppedFolder = (path: string, isDirectory: boolean): string =>
    storeLinkOf(isDirectory ? path : path.slice(0, Math.max(path.lastIndexOf('/'), 0)));

export const AGENT_KEY = 'agent';
export const HARNESS_KEY = 'harness';
export const PROFILE_KEY = 'profileId';
export const MODEL_KEY = 'model';
export const EFFORT_KEY = 'effort';
export const PERMISSION_KEY = 'permission';
export const FOLDER_KEY = 'folder';
export const RUNNER_KEY = 'runner';

const TEXT_KEYS = [AGENT_KEY, HARNESS_KEY, PROFILE_KEY, MODEL_KEY, EFFORT_KEY, PERMISSION_KEY, FOLDER_KEY, RUNNER_KEY] as const;

type TextKey = typeof TEXT_KEYS[number];

export type SettingsChanges = Partial<Record<string, string | undefined>>;

export const readSettings = (raw: unknown): FlowNodeSettings => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const source = raw as Record<string, unknown>;
    const settings: FlowNodeSettings = {};
    for (const key of TEXT_KEYS) {
        const value = source[key];
        if (typeof value === 'string' && value.trim() !== '') settings[key] = value.trim();
    }
    return settings;
};

/** Empty settings are omitted from the document. */
export const noSettings = (settings: FlowNodeSettings): boolean => TEXT_KEYS.every(key => !settings[key]);

export const withSettings = (settings: FlowNodeSettings, changes: SettingsChanges): FlowNodeSettings => {
    const next: FlowNodeSettings = { ...settings };
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === '') delete next[key as keyof FlowNodeSettings];
        else next[key as TextKey] = String(value);
    }
    return next;
};

/** Require explicit choices: unattended turns must not default their cost, permissions or write. */
export const isPlayable = (settings: FlowNodeSettings): boolean =>
    !!settings.agent && !!settings.effort && !!settings.permission && !!settings.folder;

/** Service path without surrounding slashes; root is the empty string. */
export const normalizeFolder = (folder: string): string =>
    storePathOf(folder.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '').replace(/^\.$/, ''));

/** Keep unset distinct from root. */
export const folderLink = (folder: string): string | undefined => {
    const written = folder.trim();
    return written === '' ? undefined : storeLinkOf(normalizeFolder(written));
};

/** Call only for playable nodes: an unset folder is not a root fallback. */
export const settingsFolder = (settings: FlowNodeSettings): string => normalizeFolder(settings.folder ?? '');

/** Call only for playable nodes; no permission fallback. */
export const settingsPermission = (settings: FlowNodeSettings): string => settings.permission ?? '';

/** Call only for playable nodes; no agent fallback. */
export const settingsAgent = (settings: FlowNodeSettings): string => settings.agent ?? '';

/** Managed UUIDs are instance-local references, stripped on cross-instance paste; legacy engine names. */
export const isAgentId = (value: string): boolean =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        .test(value.trim());

const PERMISSION_WORDS: Record<string, string> = {
    manual: 'manual',
    manualLive: 'live',
    bypassPermissions: 'bypass',
};

/** First camel-case word: acceptEdits becomes accept. */
const firstWord = (value: string): string =>
    value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/)[0].toLowerCase();

export const shortPermission = (permission: string): string =>
    PERMISSION_WORDS[permission] ?? firstWord(permission);

export const isLegacyAgent = (settings: FlowNodeSettings): boolean =>
    !!settings.model && ['claude', 'codex', 'muse', 'pi', 'gemini'].includes(settings.agent ?? '');

/** The profile a managed agent runs on; an unset id is the deployment default. */
export const profileForAgent = (
    own: HarnessOptionsEntry, agent?: { profileId?: string; published?: { profileId?: string } },
    profileId?: string,
): HarnessProfileOffer | undefined =>
    own.profiles?.find(one => one.id === (profileId || (agent?.published ?? agent)?.profileId || own.defaultProfileId));

/** The efforts a managed agent offers. */
export const effortsForAgent = (
    own: HarnessOptionsEntry, agent?: { profileId?: string; model?: string; published?: { profileId?: string; model?: string } },
    profileId?: string, modelId?: string,
): HarnessOption[] => {
    const profile = profileForAgent(own, agent, profileId);
    const chosen = modelId || (agent?.published ?? agent)?.model;
    if (!profile) return own.models.find(one => one.value === (chosen || own.defaultModel))?.efforts ?? own.efforts;
    const model = profile.models.find(one => one.value === (chosen || profile.defaultModel));
    if (model) return model.efforts;
    return [...new Map(profile.models.flatMap(one => one.efforts)
        .map(one => [one.value, one])).values()];
};
