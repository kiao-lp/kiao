import { ReactNode } from 'react';

export interface CommandContext {
    pointedElement: string | null;
    selection: string[];
    currentPath: string;
    currentFile: unknown;
    // Extensible for plugin-specific context
    [key: string]: unknown;
}

export interface HotkeyDescriptor {
    id: string;
    key: string;
    title: ReactNode;
    group?: string;
    enabledWhen?: (ctx: CommandContext) => boolean;
    execute: (ctx: CommandContext) => void | Promise<void>;
}

export class HotkeyRegistry {
    private hotkeys = new Map<string, HotkeyDescriptor[]>();
    private listeners = new Set<() => void>();

    register(pluginId: string, hotkeys: HotkeyDescriptor[]): () => void {
        this.hotkeys.set(pluginId, hotkeys);
        this.notifyListeners();
        return () => { this.unregister(pluginId); };
    }

    unregister(pluginId: string): void {
        if (this.hotkeys.delete(pluginId)) this.notifyListeners();
    }

    getHotkeys(ctx: CommandContext): HotkeyDescriptor[] {
        const all: HotkeyDescriptor[] = [];
        for (const group of Array.from(this.hotkeys.values()))
            for (const h of group)
                if (!h.enabledWhen || h.enabledWhen(ctx)) all.push(h);
        return all;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notifyListeners(): void {
        this.listeners.forEach(l => l());
    }
}
