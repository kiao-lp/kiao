import { ReactNode } from 'react';

export interface PointedFileInfo {
    path: string;
    isDirectory: boolean;
}

export interface ContextMenuContext {
    paths: string[];
    pointedPath: string | null;
    pointedFile: PointedFileInfo | null;
    currentPath: string;
    isEmptyArea: boolean;
}

export interface ContextMenuItemDescriptor {
    id: string;
    label: string;
    icon?: ReactNode;
    danger?: boolean;
    group?: string;
    order?: number;
    enabledWhen?: (ctx: ContextMenuContext) => boolean;
    execute?: (ctx: ContextMenuContext) => void | Promise<void>;
    children?: ContextMenuItemDescriptor[];
}

export class ContextMenuRegistry {
    private items = new Map<string, ContextMenuItemDescriptor[]>();
    private listeners = new Set<() => void>();

    register(pluginId: string, items: ContextMenuItemDescriptor[]): () => void {
        this.items.set(pluginId, items);
        this.notifyListeners();
        return () => this.unregister(pluginId);
    }

    unregister(pluginId: string): void {
        if (this.items.delete(pluginId)) this.notifyListeners();
    }

    getItems(ctx: ContextMenuContext): ContextMenuItemDescriptor[] {
        const all: ContextMenuItemDescriptor[] = [];
        for (const group of Array.from(this.items.values())) {
            for (const item of group) {
                if (item.children) {
                    const children = item.children
                        .filter(child => !child.enabledWhen || child.enabledWhen(ctx))
                        .sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
                    if (children.length > 0 && (!item.enabledWhen || item.enabledWhen(ctx))) {
                        all.push({ ...item, children });
                    }
                } else if (!item.enabledWhen || item.enabledWhen(ctx)) {
                    all.push(item);
                }
            }
        }
        return all.sort((a, b) => {
            const ga = a.group ?? '_';
            const gb = b.group ?? '_';
            if (ga !== gb) return ga.localeCompare(gb);
            return (a.order ?? 1000) - (b.order ?? 1000);
        });
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notifyListeners(): void {
        this.listeners.forEach(l => l());
    }
}
