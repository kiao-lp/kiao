import { useEffect } from 'react';
import { CreationCommandDescriptor } from './CreationCommandRegistry';
import { useCreationCommandRegistry } from './CreationCommandRegistry-ctx';

export const useCreationCommand = (pluginId: string, command: CreationCommandDescriptor, deps: unknown[] = []) => {
    const registry = useCreationCommandRegistry();

    useEffect(() => {
        return registry.register(pluginId, [command]);
    }, [registry, pluginId, ...deps]);
};

export const useCreationCommandList = (pluginId: string, commands: CreationCommandDescriptor[], deps: unknown[] = []) => {
    const registry = useCreationCommandRegistry();

    useEffect(() => {
        return registry.register(pluginId, commands);
    }, [registry, pluginId, ...deps]);
};
