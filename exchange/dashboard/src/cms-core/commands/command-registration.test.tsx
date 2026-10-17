import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CommandRegistry, CommandContext, CommandDescriptor } from './CommandRegistry';
import { HotkeyRegistry, HotkeyDescriptor } from './HotkeyRegistry';
import { CommandRegistryProvider, useCommandRegistry } from './CommandRegistry-ctx';
import { HotkeyRegistryProvider, useHotkeyRegistry } from './HotkeyRegistry-ctx';
import { usePluginCommands } from './usePluginCommands';
import { usePluginHotkeys } from './usePluginHotkeys';

const ctx: CommandContext = { pointedElement: null, selection: [], currentPath: '', currentFile: null };

const cmd = (id: string): CommandDescriptor => ({ id, shortcut: id, title: id, execute: vi.fn() });
const hk = (id: string): HotkeyDescriptor => ({ id, key: id, title: id, execute: vi.fn() });

describe('CommandRegistry – registration precedence', () => {
    it('returns commands grouped by plugin in registration order', () => {
        const registry = new CommandRegistry();
        registry.register('a', [cmd('a1'), cmd('a2')]);
        registry.register('b', [cmd('b1')]);

        expect(registry.getCommands(ctx).map(c => c.id)).toEqual(['a1', 'a2', 'b1']);
    });

    it('replaces (does not append) commands when a plugin re-registers', () => {
        const registry = new CommandRegistry();
        registry.register('a', [cmd('a1'), cmd('a2')]);
        registry.register('a', [cmd('a3')]);

        expect(registry.getCommands(ctx).map(c => c.id)).toEqual(['a3']);
    });

    it('unregistering a missing plugin does not notify listeners', () => {
        const registry = new CommandRegistry();
        const listener = vi.fn();
        registry.subscribe(listener);

        registry.unregister('never-registered');
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('HotkeyRegistry – registration precedence', () => {
    it('returns hotkeys from every plugin, honouring enabledWhen', () => {
        const registry = new HotkeyRegistry();
        registry.register('a', [hk('a1')]);
        registry.register('b', [
            { ...hk('b1'), enabledWhen: () => false },
            hk('b2'),
        ]);

        expect(registry.getHotkeys(ctx).map(h => h.id)).toEqual(['a1', 'b2']);
    });

    it('replaces a plugin\'s hotkeys on re-registration', () => {
        const registry = new HotkeyRegistry();
        registry.register('a', [hk('a1')]);
        registry.register('a', [hk('a2')]);

        expect(registry.getHotkeys(ctx).map(h => h.id)).toEqual(['a2']);
    });
});

describe('usePluginCommands – lifecycle', () => {
    it('registers on mount and unregisters on unmount', () => {
        let registry: CommandRegistry | undefined;
        const Capture = () => { registry = useCommandRegistry(); return null; };
        const Plugin = () => { usePluginCommands('p1', [cmd('x')]); return null; };
        const Harness = ({ show }: { show: boolean }) => (
            <CommandRegistryProvider>
                <Capture />
                {show && <Plugin />}
            </CommandRegistryProvider>
        );

        const { rerender } = render(<Harness show={true} />);
        expect(registry!.getCommands(ctx).map(c => c.id)).toEqual(['x']);

        rerender(<Harness show={false} />);
        expect(registry!.getCommands(ctx)).toHaveLength(0);
    });

    it('re-registers when deps change', () => {
        let registry: CommandRegistry | undefined;
        const Capture = () => { registry = useCommandRegistry(); return null; };
        const Plugin = ({ label }: { label: string }) => {
            usePluginCommands('p1', [cmd(label)], [label]);
            return null;
        };
        const Harness = ({ label }: { label: string }) => (
            <CommandRegistryProvider>
                <Capture />
                <Plugin label={label} />
            </CommandRegistryProvider>
        );

        const { rerender } = render(<Harness label="first" />);
        expect(registry!.getCommands(ctx).map(c => c.id)).toEqual(['first']);

        rerender(<Harness label="second" />);
        expect(registry!.getCommands(ctx).map(c => c.id)).toEqual(['second']);
    });
});

describe('usePluginHotkeys – lifecycle', () => {
    it('registers on mount and unregisters on unmount', () => {
        let registry: HotkeyRegistry | undefined;
        const Capture = () => { registry = useHotkeyRegistry(); return null; };
        const Plugin = () => { usePluginHotkeys('p1', [hk('y')]); return null; };
        const Harness = ({ show }: { show: boolean }) => (
            <HotkeyRegistryProvider>
                <Capture />
                {show && <Plugin />}
            </HotkeyRegistryProvider>
        );

        const { rerender } = render(<Harness show={true} />);
        expect(registry!.getHotkeys(ctx).map(h => h.id)).toEqual(['y']);

        rerender(<Harness show={false} />);
        expect(registry!.getHotkeys(ctx)).toHaveLength(0);
    });
});
