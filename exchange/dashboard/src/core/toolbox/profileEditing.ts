import type { HarnessProfile, HarnessProfileConnection, HarnessProfileModel, HarnessProfilesDocument, HarnessProfilesState } from 'kiao-worker';

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export const editableProfiles = (state: HarnessProfilesState): HarnessProfilesDocument => ({
    version: 1, defaultPiProfileId: state.defaultPiProfileId, installations: state.installations,
    profiles: state.profiles.map(({ status, message, models, secretStates, ...profile }) => profile),
});

/** Pi's thinking levels, in the order it offers them. */
export const PI_THINKING_LEVELS: { value: string; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'X-High' },
    { value: 'max', label: 'Max' },
];

export const modelChoices = (profile: HarnessProfile) => profile.connections.flatMap(connection =>
    connection.models.filter(model => model.id.trim()).map(model => ({
        value: `${connection.provider}/${model.id}`, label: model.name || model.id, provider: connection.provider,
    })));

/** Pi keeps levels up to high unless the model nulls them; xhigh and max need a mapped value. */
export const thinkingLevelOffered = (model: HarnessProfileModel, level: string): boolean => level === 'xhigh' || level === 'max'
    ? typeof model.thinkingLevelMap?.[level] === 'string'
    : model.thinkingLevelMap?.[level] !== null;

export const replaceConnections = (profile: HarnessProfile, connections: HarnessProfileConnection[]): HarnessProfile => {
    const next = { ...profile, connections };
    const models = modelChoices(next);
    const defaultModel = models.some(model => model.value === profile.defaultModel) ? profile.defaultModel : models[0]?.value ?? '';
    return { ...next, defaultModel, defaultEffort: defaultModel === profile.defaultModel ? profile.defaultEffort : '' };
};

export const profileDraftProblem = (doc: HarnessProfilesDocument): string => {
    for (const profile of doc.profiles) {
        if (!profile.name.trim()) return 'Enter a profile name.';
        const providers = new Set<string>();
        for (const [index, connection] of profile.connections.entries()) {
            const label = `${profile.name}, connection ${index + 1}`;
            if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(connection.provider)) return `${label}: enter a connection name using letters, numbers, dots, dashes or underscores.`;
            if (providers.has(connection.provider)) return `${label}: choose a unique connection name.`;
            providers.add(connection.provider);
            try {
                const url = new URL(connection.baseUrl);
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
            } catch { return `${label}: enter an API base URL starting with https:// or http://.`; }
            if (connection.secretRef && !/^(env:[A-Za-z_][A-Za-z0-9_]*|private:[A-Za-z0-9][A-Za-z0-9_.-]{0,95})$/.test(connection.secretRef)) return `${label}: choose a stored API key or enter env:VARIABLE_NAME.`;
            const ids = new Set<string>();
            for (const model of connection.models) {
                if (!model.id.trim() || /[\r\n]/.test(model.id)) return `${label}: enter a model ID or remove its empty row.`;
                if (ids.has(model.id)) return `${label}: each model ID must be unique.`;
                ids.add(model.id);
                for (const [level, value] of Object.entries(model.thinkingLevelMap ?? {})) {
                    if (!PI_THINKING_LEVELS.some(one => one.value === level) || !(value === null || typeof value === 'string')) {
                        return `${label}: reasoning levels must use Pi's level names, with a provider effort name or null.`;
                    }
                }
            }
        }
    }
    return '';
};

export const endpointProblem = (connection: HarnessProfileConnection): string => {
    if (connection.api === 'openai-completions' && /\/chat\/completions\/?$/.test(connection.baseUrl)) {
        return `Use the API base URL ${connection.baseUrl.replace(/\/chat\/completions\/?$/, '')}. Pi adds /chat/completions itself.`;
    }
    if (connection.api === 'openai-responses' && /\/responses\/?$/.test(connection.baseUrl)) {
        return `Use the API base URL ${connection.baseUrl.replace(/\/responses\/?$/, '')}. Pi adds /responses itself.`;
    }
    return '';
};
