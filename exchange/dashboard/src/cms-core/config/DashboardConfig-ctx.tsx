import React, { createContext, useContext, useEffect, useState } from 'react';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { pluginCatalogue } from '../core/assembly/pluginAssembly';

/** Deployment flags in worker state (.kiao-config by default), inaccessible through the content file API. */
export const DASHBOARD_CONFIG_DOC = 'dashboard.json';

export interface DashboardConfig {
    /** When false, hides Conversations, including board flow-node execution. */
    chatEnabled: boolean;
    /** When false, all Git (Source Control) UI is hidden. */
    gitEnabled: boolean;
    /**
     * Plugin ids in load order. Unlisted plugins are not fetched; their files fall to other claimants.
     * Missing configuration defaults to all built plugins. Ids absent from this build are tolerated.
     */
    plugins: string[];
}

export const DEFAULT_CONFIG: DashboardConfig = {
    chatEnabled: true,
    gitEnabled: true,
    plugins: pluginCatalogue.map(entry => entry.id),
};

/** Accept older field names because stored configuration outlives a build. */
type LegacyConfig = Partial<DashboardConfig> & {
    agentEnabled?: boolean;
    claudeCodeEnabled?: boolean;
};

/** Preserve stored plugin choices across id renames. */
const PLUGIN_RENAMES: Record<string, string> = {
    claude: 'chat', agent: 'chat', 'movie-view': 'movie-edit', 'tasks-board': 'hybridflow-ui',
};

const renamedPlugin = (id: string): string => PLUGIN_RENAMES[id] ?? id;

/** Only explicit false disables a feature; any legacy chat flag can also disable Conversations. */
export const normalizeConfig = (raw: LegacyConfig | null | undefined): DashboardConfig => ({
    chatEnabled: raw?.chatEnabled !== false && raw?.agentEnabled !== false && raw?.claudeCodeEnabled !== false,
    gitEnabled: raw?.gitEnabled !== false,
    // An absent list uses all built plugins; an empty list intentionally loads none.
    plugins: Array.isArray(raw?.plugins) ? raw!.plugins.map(renamedPlugin) : DEFAULT_CONFIG.plugins,
});

const DashboardConfigContext = createContext<DashboardConfig>(DEFAULT_CONFIG);

export const useDashboardConfig = (): DashboardConfig => useContext(DashboardConfigContext);

/**
 * Seed missing configuration; use defaults on other load errors.
 * Delay children until resolved to avoid registering then removing plugin toolbars.
 */
export const DashboardConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const workerClient = useWorkerClient();
    const [config, setConfig] = useState<DashboardConfig | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const raw = await workerClient.getConfigJson<LegacyConfig>(DASHBOARD_CONFIG_DOC);
                if (!cancelled) setConfig(normalizeConfig(raw));
            } catch (e) {
                if (e instanceof WorkerError && e.response.status === 404) {
                    try {
                        await workerClient.saveConfigJson(DASHBOARD_CONFIG_DOC, DEFAULT_CONFIG);
                    } catch (saveErr) {
                        console.warn('Dashboard config: failed to create default config file', saveErr);
                    }
                    if (!cancelled) setConfig(DEFAULT_CONFIG);
                } else {
                    console.warn('Dashboard config: failed to load, using defaults', e);
                    if (!cancelled) setConfig(DEFAULT_CONFIG);
                }
            }
        };

        load();
        return () => { cancelled = true; };
    }, [workerClient]);

    if (config === null) {
        return <div>Loading configuration…</div>;
    }

    return <DashboardConfigContext.Provider value={config}>{children}</DashboardConfigContext.Provider>;
};
