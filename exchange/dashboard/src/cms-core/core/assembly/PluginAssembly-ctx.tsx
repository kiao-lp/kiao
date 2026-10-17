import React, { createContext, useContext, useEffect, useState } from 'react';
import type { CmsPlugin } from '../FileBasedPlugin';
import { useDashboardConfig } from '../../config/DashboardConfig-ctx';
import { loadPluginAssembly } from './pluginAssembly';

export interface PluginAssemblyValue {
    /** The manifests that loaded, in the order the store named them. */
    plugins: CmsPlugin[];
    /** What the store named and this build could not give it. Drawn by the Configuration panel. */
    missing: string[];
}

const PluginAssemblyContext = createContext<PluginAssemblyValue>({ plugins: [], missing: [] });

export const usePluginAssembly = (): PluginAssemblyValue => useContext(PluginAssemblyContext);

/**
 * Loads the plugins the store's configuration names, and holds the application back until they are
 * all in.
 *
 * **Why it blocks.** The plugin list is not a value the app re-reads; it is the shape of the
 * provider stack. Every plugin's creation commands, app-level providers and tool bar tabs are
 * composed from it, so a list that arrives late would mount the whole tree and then remount it
 * under a different set of contexts, discarding whatever the first tree had already read. The
 * config provider above this one blocks for the same reason and says so; this is the second half
 * of the same gate.
 *
 * **And why it never blocks again.** The list is read once, at mount. Switching a plugin on in the
 * Configuration panel writes the config document and asks for a reload — a page load is the honest
 * way to change what the application is made of, and it is what the panel says it will do.
 */
export const PluginAssemblyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { plugins: wanted } = useDashboardConfig();
    const [assembly, setAssembly] = useState<PluginAssemblyValue | null>(null);

    useEffect(() => {
        let cancelled = false;
        loadPluginAssembly(wanted).then(loaded => {
            if (!cancelled) setAssembly(loaded);
        });
        return () => { cancelled = true; };
        // Read once: `wanted` is resolved before this mounts and does not change under it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (assembly === null) {
        return <div>Loading plugins…</div>;
    }

    return (
        <PluginAssemblyContext.Provider value={assembly}>{children}</PluginAssemblyContext.Provider>
    );
};
