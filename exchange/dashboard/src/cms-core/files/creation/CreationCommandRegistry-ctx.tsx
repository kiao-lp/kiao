import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { CreationCommandDescriptor, CreationCommandRegistry, CreationContext } from './CreationCommandRegistry';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';

export interface BoundCreationCommand {
    id: string;
    label: string;
    icon: ReactNode;
    execute: () => void | Promise<void>;
}

const RegistryContext = createContext<CreationCommandRegistry | null>(null);

export const CreationCommandRegistryProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const registry = useMemo(() => new CreationCommandRegistry(), []);
    return (
        <RegistryContext.Provider value={registry}>
            {children}
        </RegistryContext.Provider>
    );
};

export const useCreationCommandRegistry = (): CreationCommandRegistry => {
    const registry = useContext(RegistryContext);
    if (!registry) {
        throw new Error('useCreationCommandRegistry must be used within a CreationCommandRegistryProvider');
    }
    return registry;
};

/**
 * The creation commands, bound to a folder. They create in the browsed folder unless
 * `targetPath` names another one — what the context menu of a row does, so that creating
 * from it lands where the pointed element is rather than where browsing happens to be.
 */
export const useCreationCommands = (targetPath?: string): BoundCreationCommand[] => {
    const registry = useCreationCommandRegistry();
    const [tick, setTick] = useState(0);
    const { currentPath } = useFileBrowsingPersistenceContext();

    // Read at execution time, so the bound commands stay stable while the menu is open.
    const currentPathRef = useRef(currentPath);
    currentPathRef.current = currentPath;
    const targetPathRef = useRef(targetPath);
    targetPathRef.current = targetPath;

    useEffect(() => {
        const unsubscribe = registry.subscribe(() => setTick(t => t + 1));
        // Re-read once after subscribing: plugins may have registered their
        // creation commands before this subscription existed, and those
        // notifications would otherwise be lost (leaving the menu empty).
        setTick(t => t + 1);
        return unsubscribe;
    }, [registry]);

    return useMemo(() => {
        return registry.getDescriptors().map(desc => ({
            id: desc.id,
            label: desc.label,
            icon: desc.icon,
            execute: () => {
                const ctx: CreationContext = { currentPath: targetPathRef.current ?? currentPathRef.current };
                return desc.execute(ctx);
            },
        }));
    }, [registry, tick]);
};
