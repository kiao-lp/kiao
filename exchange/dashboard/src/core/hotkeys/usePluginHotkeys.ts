import { useLayoutEffect } from 'react';
import { HotkeyDescriptor } from './HotkeyRegistry';
import { useHotkeyRegistry } from './HotkeyRegistry-ctx';

export const usePluginHotkeys = (
    pluginId: string,
    hotkeys: HotkeyDescriptor[],
    deps: unknown[] = []
) => {
    const registry = useHotkeyRegistry();

    // Layout effect registers before paint so no keypress sees stale hotkeys.
    useLayoutEffect(() => {
        return registry.register(pluginId, hotkeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registry, pluginId, ...deps]);
};
