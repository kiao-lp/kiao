import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useWorkerClient } from '@cms-core';
import { WorkerClient } from 'kiao-worker';
import { KiaoElObject } from '@cms-kit/template-lang';
import { loadAllValueProviders } from './configValuesService';

interface ConfigValuesContextType {
    objects: KiaoElObject[];
    isLoading: boolean;
    reload: () => Promise<void>;
}

const ConfigValuesContext = createContext<ConfigValuesContextType>({
    objects: [],
    isLoading: true,
    reload: async () => { },
});

/**
 * Provider that loads config values from kiao-user-config/values/*.json files.
 * A store without that folder simply has no value providers.
 */
export const ConfigValuesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient() as WorkerClient;
    const [objects, setObjects] = useState<KiaoElObject[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const reload = useCallback(async () => {
        setIsLoading(true);
        try {
            const loadedObjects = await loadAllValueProviders(client);
            setObjects(loadedObjects);
        } catch (error) {
            console.error('[ConfigValues] Error loading config values:', error);
            setObjects([]);
        } finally {
            setIsLoading(false);
        }
    }, [client]);

    useEffect(() => {
        reload();
    }, [reload]);

    return (
        <ConfigValuesContext.Provider value={{ objects, isLoading, reload }}>
            {children}
        </ConfigValuesContext.Provider>
    );
};

/**
 * Hook to access config values loaded from JSON files.
 */
export const useConfigValues = (): ConfigValuesContextType => {
    return useContext(ConfigValuesContext);
};

