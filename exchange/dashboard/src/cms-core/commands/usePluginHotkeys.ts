import { useLayoutEffect } from 'react';
import { HotkeyDescriptor } from './HotkeyRegistry';
import { useHotkeyRegistry } from './HotkeyRegistry-ctx';

export const usePluginHotkeys = (
    pluginId: string,
    hotkeys: HotkeyDescriptor[],
    deps: unknown[] = []
) => {
    const registry = useHotkeyRegistry();

    // A layout effect rather than a passive one: registration must land before the paint that
    // shows the state the descriptors close over. A mode flip renders first and registers after,
    // and a key pressed in between — Ctrl+V straight after the click that entered EDIT mode —
    // meets a registry that still calls the hotkey disabled, and is silently dropped. Layout
    // effects, and the re-render the notify schedules, flush before paint, so no keypress can
    // observe a screen the registry has not caught up with. Registration is a Map write — it
    // reads no layout and holds up no paint.
    useLayoutEffect(() => {
        return registry.register(pluginId, hotkeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registry, pluginId, ...deps]);
};
