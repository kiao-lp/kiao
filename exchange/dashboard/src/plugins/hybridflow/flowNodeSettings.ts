/** AI tasks require agent, effort, permission and folder; Human tasks use only folder. */

import type { HarnessOption, HarnessOptionsEntry, HarnessProfileOffer } from 'kiao-worker';
import { dcmsLinkOf, storePathOf } from 'kiao-worker/utils';
import { hasContextReference } from './nodeContext';

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

    extra?: Record<string, string>;
}

/** Dropped files select their parent folder. */
export const droppedFolder = (path: string, isDirectory: boolean): string =>
    dcmsLinkOf(isDirectory ? path : path.slice(0, Math.max(path.lastIndexOf('/'), 0)));

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
    if (source.extra && typeof source.extra === 'object' && !Array.isArray(source.extra)) {
        const entries = Object.entries(source.extra).filter((entry): entry is [string, string] =>
            typeof entry[1] === 'string');
        if (entries.length > 0) settings.extra = Object.fromEntries(entries);
    }
    return settings;
};

/** Empty settings are omitted from the document. */
export const noSettings = (settings: FlowNodeSettings): boolean =>
    TEXT_KEYS.every(key => !settings[key]) && !Object.keys(settings.extra ?? {}).length;

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
    if (hasContextReference(written)) return written;
    return written === '' ? undefined : dcmsLinkOf(normalizeFolder(written));
};

/** Call only for playable nodes: an unset folder is not a root fallback. */
export const settingsFolder = (settings: FlowNodeSettings): string => normalizeFolder(settings.folder ?? '');

/** Call only for playable nodes; no permission fallback. */
export const settingsPermission = (settings: FlowNodeSettings): string => settings.permission ?? '';

/** Call only for playable nodes; no agent fallback. */
export const settingsAgent = (settings: FlowNodeSettings): string => settings.agent ?? '';

/** Agent UUIDs are local to the store. Legacy harness IDs can travel between stores. */
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

export const hasLegacyHarness = (settings: FlowNodeSettings): boolean =>
    !!settings.model && ['claude', 'codex', 'muse', 'pi', 'gemini'].includes(settings.agent ?? '');

/** Resolve the selected profile, then the agent's preference, then the harness default. */
export const profileForSelection = (
    own: HarnessOptionsEntry, defaults?: { profileId?: string; published?: { profileId?: string } },
    profileId?: string,
): HarnessProfileOffer | undefined =>
    own.profiles?.find(one => one.id === (profileId || (defaults?.published ?? defaults)?.profileId || own.defaultProfileId));

/** Reasoning levels offered by the selected harness, profile and model. */
export const effortsForSelection = (
    own: HarnessOptionsEntry, defaults?: { profileId?: string; model?: string; published?: { profileId?: string; model?: string } },
    profileId?: string, modelId?: string,
): HarnessOption[] => {
    const profile = profileForSelection(own, defaults, profileId);
    const chosen = modelId || (defaults?.published ?? defaults)?.model;
    if (!profile) return own.models.find(one => one.value === (chosen || own.defaultModel))?.efforts ?? own.efforts;
    const model = profile.models.find(one => one.value === (chosen || profile.defaultModel));
    if (model) return model.efforts;
    return [...new Map(profile.models.flatMap(one => one.efforts)
        .map(one => [one.value, one])).values()];
};
