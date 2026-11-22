import { ReactNode } from 'react';

export interface CreationContext {
    currentPath: string;
}

export interface CreationCommandDescriptor {
    id: string;
    label: string;
    icon: ReactNode;
    order?: number;
    execute: (ctx: CreationContext) => void | Promise<void>;
}

export class CreationCommandRegistry {
    private commands = new Map<string, CreationCommandDescriptor[]>();
    private listeners = new Set<() => void>();

    register(pluginId: string, commands: CreationCommandDescriptor[]): () => void {
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

    getDescriptors(): CreationCommandDescriptor[] {
        const all: CreationCommandDescriptor[] = [];
        for (const pluginCommands of Array.from(this.commands.values())) {
            for (const command of pluginCommands) {
                all.push(command);
            }
        }
        return all.sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
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
