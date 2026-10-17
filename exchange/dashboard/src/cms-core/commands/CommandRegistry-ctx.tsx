import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { CommandRegistry, CommandContext } from './CommandRegistry';
import { usePointedElementContext } from 'react-advanced-interactions';
import { useSelectionContext } from '../selection';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';

// Compatible interface with the old Command system
export interface BoundCommand {
    shortcut: string;
    title: ReactNode;
    group?: string;
    // execute() with no args, context is bound
    execute: () => void | Promise<void>;
    // enabled is implicitly true because useRegisteredCommands only returns enabled ones
    enabled: boolean;
}

const RegistryContext = createContext<CommandRegistry | null>(null);

export const CommandRegistryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const registry = useMemo(() => new CommandRegistry(), []);

    return (
        <RegistryContext.Provider value={registry}>
            {children}
        </RegistryContext.Provider>
    );
};

export const useCommandRegistry = (): CommandRegistry => {
    const registry = useContext(RegistryContext);
    if (!registry) {
        throw new Error('useCommandRegistry must be used within a CommandRegistryProvider');
    }
    return registry;
};

export const useRegisteredCommands = (): BoundCommand[] => {
    const registry = useCommandRegistry();
    const [_, setTick] = useState(0);

    // Context dependencies
    const [pointedElement] = usePointedElementContext();
    const [selection] = useSelectionContext();
    const { currentPath, currentFile } = useFileBrowsingPersistenceContext();

    // Re-render when registry changes
    useEffect(() => {
        return registry.subscribe(() => setTick(t => t + 1));
    }, [registry]);

    const context: CommandContext = useMemo(() => ({
        pointedElement,
        selection,
        currentPath,
        currentFile
    }), [pointedElement, selection, currentPath, currentFile]);

    return useMemo(() => {
        const descriptors = registry.getCommands(context);
        return descriptors.map(desc => ({
            shortcut: desc.shortcut,
            title: desc.title,
            group: desc.group,
            enabled: true, // filtered by getCommands
            execute: () => desc.execute(context)
        }));
    }, [registry, context, _]);
};
