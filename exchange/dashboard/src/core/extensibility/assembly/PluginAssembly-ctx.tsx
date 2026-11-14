import React, { createContext, useContext, useEffect, useState } from 'react';
import type { DashboardPlugin } from '../FileBasedPlugin';
import { useDashboardConfig } from '../../config/DashboardConfig-ctx';
import { loadPluginAssembly } from './pluginAssembly';

export interface PluginAssemblyValue {
    /** The manifests that loaded, in the order the store named them. */
    plugins: DashboardPlugin[];
    /** Store-named plugins absent from this build; shown in Configuration panel. */
    missing: string[];
}

const PluginAssemblyContext = createContext<PluginAssemblyValue>({ plugins: [], missing: [] });

export const usePluginAssembly = (): PluginAssemblyValue => useContext(PluginAssemblyContext);

/** Blocks until plugins load; a late list would remount the tree. */
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
