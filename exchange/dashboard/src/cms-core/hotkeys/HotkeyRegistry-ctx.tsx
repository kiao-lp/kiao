import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { HotkeyRegistry, HotkeyDescriptor, CommandContext } from './HotkeyRegistry';
import { usePointedElementContext } from 'react-advanced-interactions';
import { useSelectionContext } from '../ui-foundation/interactions/selection';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';

export interface BoundHotkey {
    key: string;
    title: ReactNode;
    group?: string;
    enabled: boolean;
    execute: () => void | Promise<void>;
}

const RegistryContext = createContext<HotkeyRegistry | null>(null);

export const HotkeyRegistryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const registry = useMemo(() => new HotkeyRegistry(), []);
    return (
        <RegistryContext.Provider value={registry}>
            {children}
        </RegistryContext.Provider>
    );
};

export const useHotkeyRegistry = (): HotkeyRegistry => {
    const registry = useContext(RegistryContext);
    if (!registry) {
        throw new Error('useHotkeyRegistry must be used within a HotkeyRegistryProvider');
    }
    return registry;
};

export const useRegisteredHotkeys = (): BoundHotkey[] => {
    const registry = useHotkeyRegistry();
    const [tick, setTick] = useState(0);

    const [pointedElement] = usePointedElementContext();
    const [selection] = useSelectionContext();
    const { currentPath, currentFile } = useFileBrowsingPersistenceContext();

    useEffect(() => {
        return registry.subscribe(() => setTick(t => t + 1));
    }, [registry]);

    const context: CommandContext = useMemo(() => ({
        pointedElement,
        selection,
        currentPath,
        currentFile
    }), [pointedElement, selection, currentPath, currentFile]);

    // tick forces recompute after re-registration; otherwise hotkeys lag one registration.
    return useMemo(() => {
        const descriptors = registry.getHotkeys(context);
        return descriptors.map((desc: HotkeyDescriptor) => ({
            key: desc.key,
            title: desc.title,
            group: desc.group,
            enabled: true,
            execute: () => desc.execute(context)
        }));
    }, [registry, context, tick]);
};
