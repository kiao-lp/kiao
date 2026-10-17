import { useEffect } from 'react';
import { CommandDescriptor } from './CommandRegistry';
import { useCommandRegistry } from './CommandRegistry-ctx';

/** @deprecated See {@link CommandDescriptor}: no new typed shortcut may be added. */
export const usePluginCommands = (pluginId: string, commands: CommandDescriptor[], deps: unknown[] = []) => {
    const registry = useCommandRegistry();

    useEffect(() => {
        return registry.register(pluginId, commands);
    }, [registry, pluginId, ...deps]);
};
