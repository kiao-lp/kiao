import { useEffect } from 'react';
import { ContextMenuItemDescriptor } from './ContextMenuRegistry';
import { useContextMenuRegistry } from './ContextMenuRegistry-ctx';

export const useContextMenuItems = (
    pluginId: string,
    items: ContextMenuItemDescriptor[],
    deps: unknown[] = [],
) => {
    const registry = useContextMenuRegistry();
    useEffect(() => {
        return registry.register(pluginId, items);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registry, pluginId, ...deps]);
};
