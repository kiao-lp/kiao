/** AI tasks require agent, effort, permission and folder; Human tasks use only folder. */

import { storeLinkOf, storePathOf } from 'kiao-worker/utils';

export interface FlowNodeSettings {
    /** Managed agent id; legacy documents may name an engine instead. */
    agent?: string;
    /** Legacy model beside an engine in `agent`; read for compatibility, no longer written. */
    model?: string;
    effort?: string;
    /** AgentPermissionMode wire value supported by the selected agent. */
    permission?: string;
    /** Store link: `/` means root, empty means unset. Used only when creating a conversation; its folder is immutable. */
    folder?: string;
    /** Optional runner id: pinned nodes refuse execution on other runners; not required by isPlayable. */
    runner?: string;
}

/** Dropped files select their parent folder. Returns a store link, including `/` for root. */
export const droppedFolder = (path: string, isDirectory: boolean): string =>
    storeLinkOf(isDirectory ? path : path.slice(0, Math.max(path.lastIndexOf('/'), 0)));

export const AGENT_KEY = 'agent';
export const MODEL_KEY = 'model';
export const EFFORT_KEY = 'effort';
export const PERMISSION_KEY = 'permission';
export const FOLDER_KEY = 'folder';
export const RUNNER_KEY = 'runner';

// Unknown settings, including retired shutdown flags, are discarded on read.
const TEXT_KEYS = [AGENT_KEY, MODEL_KEY, EFFORT_KEY, PERMISSION_KEY, FOLDER_KEY, RUNNER_KEY] as const;

type TextKey = typeof TEXT_KEYS[number];

/** `undefined` removes a key; type changes remove settings no longer applicable. */
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

/** Require explicit choices: unattended turns must not default their cost, permissions or write location. */
export const isPlayable = (settings: FlowNodeSettings): boolean =>
    !!settings.agent && !!settings.effort && !!settings.permission && !!settings.folder;

/** Service path without surrounding slashes; root is the empty string. */
export const normalizeFolder = (folder: string): string =>
    storePathOf(folder.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '').replace(/^\.$/, ''));

/** Keep unset distinct from root. Store links need a leading slash for rename tracking. */
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

/** Managed UUIDs are instance-local references, stripped on cross-instance paste; legacy engine names travel. */
export const isAgentId = (value: string): boolean =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
        .test(value.trim());

const PERMISSION_WORDS: Record<string, string> = {
    manual: 'manual',
    manualLive: 'live',
    bypassPermissions: 'bypass',
};

/** First camel-case word: `acceptEdits` becomes `accept`. */
const firstWord = (value: string): string =>
    value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/)[0].toLowerCase();

export const shortPermission = (permission: string): string =>
    PERMISSION_WORDS[permission] ?? firstWord(permission);

export interface SettingChip {
    text: string;
    missing?: boolean;
}

/** Show only the agent name (legacy model fallback) and missing required settings to keep cards compact. */
export const settingsChips = (
    settings: FlowNodeSettings, agents: { id: string; name: string }[] = [],
): SettingChip[] => {
    const chips: SettingChip[] = [];
    if (!settings.agent) {
        chips.push(absent('agent'));
        if (settings.model) chips.push({ text: settings.model });
    } else {
        const held = agents.find(agent => agent.id === settings.agent);
        if (held) chips.push({ text: held.name });
        else if (settings.model) chips.push({ text: settings.model });
        else chips.push(absent('agent'));
    }
    if (!settings.effort) chips.push(absent('effort'));
    if (!settings.permission) chips.push(absent('permission'));
    if (!settings.folder) chips.push(absent('folder'));
    return chips;
};

const absent = (what: string): SettingChip => ({ text: `no ${what}`, missing: true });
