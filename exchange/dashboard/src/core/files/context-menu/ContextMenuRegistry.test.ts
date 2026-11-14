import { describe, it, expect } from 'vitest';
import { ContextMenuRegistry, ContextMenuContext } from './ContextMenuRegistry';

const ctx: ContextMenuContext = {
    paths: ['a.md'],
    pointedPath: 'a.md',
    pointedFile: { path: 'a.md', isDirectory: false },
    currentPath: '',
    isEmptyArea: false,
};

const emptyCtx: ContextMenuContext = { ...ctx, paths: [], pointedFile: null, isEmptyArea: true };

describe('submenu children', () => {
    it('keeps the enabled children, ordered', () => {
        const registry = new ContextMenuRegistry();
        registry.register('p', [{
            id: 'parent',
            label: 'Parent',
            group: '1',
            order: 10,
            children: [
                { id: 'b', label: 'B', order: 20, execute: () => {} },
                { id: 'a', label: 'A', order: 10, execute: () => {} },
                { id: 'hidden', label: 'Hidden', order: 5, enabledWhen: () => false, execute: () => {} },
            ],
        }]);

        const [parent] = registry.getItems(ctx);

        expect(parent?.children!.map(child => child.id)).toEqual(['a', 'b']);
    });

    it('drops the parent when no child is enabled', () => {
        const registry = new ContextMenuRegistry();
        registry.register('p', [{
            id: 'parent',
            label: 'Parent',
            children: [
                { id: 'a', label: 'A', enabledWhen: () => false, execute: () => {} },
            ],
        }]);

        expect(registry.getItems(ctx)).toEqual([]);
    });

    it('drops the parent on the empty area when its condition fails', () => {
        const registry = new ContextMenuRegistry();
        registry.register('p', [{
            id: 'parent',
            label: 'Parent',
            enabledWhen: (c) => !c.isEmptyArea,
            children: [{ id: 'a', label: 'A', execute: () => {} }],
        }]);

        expect(registry.getItems(emptyCtx)).toEqual([]);
    });
});
