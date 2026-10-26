import { useCallback, useMemo, useState } from 'react';
import { useWorkerClient } from '../files/service/ui';
import { DASHBOARD_CONFIG_DOC, useDashboardConfig } from '../config/DashboardConfig-ctx';
import { pluginCatalogue, PluginCatalogueEntry, usePluginAssembly } from '../core/assembly';

export interface PluginsController {
    /** Every plugin this build carries, whether or not the store switched it on. */
    catalogue: PluginCatalogueEntry[];
    enabled: string[];
    /** Ids the store asks for that this build was not assembled with. */
    missing: string[];
    saving: boolean;
    /** Something was switched since the page loaded, so the page has to be reloaded. */
    dirty: boolean;
    error: string | null;
    toggle: (id: string, on: boolean) => Promise<void>;
}

/**
 * The plugin half of the Configuration panel's state, kept beside `useToolbox` because the panel
 * now draws both from one list and should read its two sources the same way.
 *
 * The one thing it does that `useToolbox` does not is **ask for a reload**. A plugin is not a
 * feature flag: it brings creation commands, app-level providers and tool bar tabs, and the
 * provider stack is built out of the list once, before the first render (see
 * `core/assembly/PluginAssembly-ctx`). Turning one on mid-session would mean rebuilding that stack
 * under a mounted application and discarding everything it holds. So the switch writes the
 * configuration and the panel says, plainly, that the page has to be reloaded.
 *
 * The save has one effect beyond this page: the worker reads `plugins` out of the same
 * document to decide which skills a store gets — a skill is the agent half of a plugin — and
 * reinstalls them on the spot. Switching a plugin off therefore takes its skill out of the store's
 * `.agents/skills` and `.claude/skills` before the 204 comes back.
 */
export const usePlugins = (): PluginsController => {
    const workerClient = useWorkerClient();
    const config = useDashboardConfig();
    const { missing } = usePluginAssembly();
    const [enabled, setEnabled] = useState<string[]>(config.plugins);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dirty = useMemo(
        () => enabled.length !== config.plugins.length
            || enabled.some(id => !config.plugins.includes(id)),
        [enabled, config.plugins]);

    const toggle = useCallback(async (id: string, on: boolean) => {
        // Written in catalogue order rather than in the order rows were clicked: the list is read
        // back as the order plugins load in, and that should not depend on how it was arrived at.
        const next = pluginCatalogue
            .map(entry => entry.id)
            .filter(entry => (entry === id ? on : enabled.includes(entry)));
        setEnabled(next);
        setSaving(true);
        try {
            await workerClient.saveConfigJson(DASHBOARD_CONFIG_DOC, { ...config, plugins: next });
            setError(null);
        } catch (e: any) {
            setError(e?.message ?? String(e));
            setEnabled(enabled);
        } finally {
            setSaving(false);
        }
    }, [config, enabled, workerClient]);

    return { catalogue: pluginCatalogue, enabled, missing, saving, dirty, error, toggle };
};
