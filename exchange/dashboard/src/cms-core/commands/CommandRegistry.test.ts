import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry, CommandContext, CommandDescriptor } from './CommandRegistry';

const mockContext: CommandContext = {
    pointedElement: null,
    selection: [],
    currentPath: '/home/user',
    currentFile: null,
};

describe('CommandRegistry', () => {
    let registry: CommandRegistry;

    beforeEach(() => {
        registry = new CommandRegistry();
    });

    it('registers and retrieves commands', () => {
        const commands: CommandDescriptor[] = [{
            id: 'cmd1',
            shortcut: 'c1',
            title: 'Command 1',
            execute: vi.fn()
        }];

        registry.register('plugin1', commands);

        const retrieved = registry.getCommands(mockContext);
        expect(retrieved).toHaveLength(1);
        expect(retrieved[0].id).toBe('cmd1');
    });

    it('unregisters commands', () => {
        const commands: CommandDescriptor[] = [{
            id: 'cmd1',
            shortcut: 'c1',
            title: 'Command 1',
            execute: vi.fn()
        }];

        const unregister = registry.register('plugin1', commands);
        expect(registry.getCommands(mockContext)).toHaveLength(1);

        unregister();
        expect(registry.getCommands(mockContext)).toHaveLength(0);
    });

    it('filters commands based on context', () => {
        const commands: CommandDescriptor[] = [
            {
                id: 'always',
                shortcut: 'a',
                title: 'Always',
                execute: vi.fn()
            },
            {
                id: 'conditional',
                shortcut: 'c',
                title: 'Conditional',
                enabledWhen: (ctx) => ctx.currentPath === '/special',
                execute: vi.fn()
            }
        ];

        registry.register('plugin1', commands);

        const normalContext = { ...mockContext };
        expect(registry.getCommands(normalContext)).toHaveLength(1);
        expect(registry.getCommands(normalContext)[0].id).toBe('always');

        const specialContext = { ...mockContext, currentPath: '/special' };
        expect(registry.getCommands(specialContext)).toHaveLength(2);
    });

    it('notifies subscribers on change', () => {
        const listener = vi.fn();
        registry.subscribe(listener);

        const unregister = registry.register('plugin1', []);
        expect(listener).toHaveBeenCalledTimes(1);

        unregister();
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
