import { useCallback, useMemo, useState } from 'react';
import { useWorkerClient } from '../files/service/ui';
import { DASHBOARD_CONFIG_DOC, useDashboardConfig } from '../config/DashboardConfig-ctx';
import { pluginCatalogue, PluginCatalogueEntry, usePluginAssembly } from '../extensibility/assembly';

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

/** Plugin state for the Configuration panel. Toggling writes config and requires reload; the provider stack is built once at startup. The worker also syncs plugin skills from the same config. */
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
        // Catalogue order determines load order; click order must not affect it.
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
