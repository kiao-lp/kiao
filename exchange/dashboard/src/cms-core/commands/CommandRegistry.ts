import { ReactNode } from 'react';

export interface CommandContext {
    pointedElement: string | null;
    selection: string[];
    currentPath: string;
    currentFile: unknown;
    // Extensible for plugin-specific context
    [key: string]: unknown;
}

/**
 * A typed multi-letter shortcut, executed by typing its `shortcut` as a word.
 *
 * @deprecated No new shortcut may be added: this mechanism is deprecated and will be
 * removed once the mindmap has migrated its remaining ones. A plugin needing a key
 * reaches for a standard hotkey (`HotkeyDescriptor`, modifiers included), a context
 * menu, or a gesture instead — see the svg-edit plugin, which registers none.
 */
export interface CommandDescriptor {
    id: string;
    shortcut: string;
    title: ReactNode;
    group?: string;
    enabledWhen?: (ctx: CommandContext) => boolean;
    execute: (ctx: CommandContext) => void | Promise<void>;
}

/** @deprecated See {@link CommandDescriptor}: no new typed shortcut may be added. */
export class CommandRegistry {
    private commands = new Map<string, CommandDescriptor[]>();
    private listeners = new Set<() => void>();

    register(pluginId: string, commands: CommandDescriptor[]): () => void {
        this.commands.set(pluginId, commands);
        this.notifyListeners();

        return () => {
            this.unregister(pluginId);
        };
    }

    unregister(pluginId: string): void {
        if (this.commands.delete(pluginId)) {
            this.notifyListeners();
        }
    }

    getCommands(ctx: CommandContext): CommandDescriptor[] {
        const allCommands: CommandDescriptor[] = [];

        for (const pluginCommands of Array.from(this.commands.values())) {
            for (const command of pluginCommands) {
                if (!command.enabledWhen || command.enabledWhen(ctx)) {
                    allCommands.push(command);
                }
            }
        }

        return allCommands;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(): void {
        this.listeners.forEach(listener => listener());
    }
}
