import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Stable context values (unlike hotkey-matching.test.tsx, which re-creates them
// on every render): the dispatcher must pick up re-registered hotkeys even when
// none of the CommandContext inputs change identity.
const stableSelection: string[] = [];
vi.mock('react-advanced-interactions', () => ({ usePointedElementContext: () => [null, vi.fn()] }));
vi.mock('../selection', () => ({ useSelectionContext: () => [stableSelection, vi.fn()] }));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentPath: '', currentFile: null }),
}));

import { HotkeyRegistry, HotkeyDescriptor } from './HotkeyRegistry';
import { HotkeyRegistryProvider, useHotkeyRegistry } from './HotkeyRegistry-ctx';
import { HotkeyDispatcherProvider } from './HotkeyDispatcher-ctx';

let registry: HotkeyRegistry;
const Capture = () => { registry = useHotkeyRegistry(); return null; };

const mount = () =>
    render(
        <HotkeyRegistryProvider>
            <Capture />
            <HotkeyDispatcherProvider>{null}</HotkeyDispatcherProvider>
        </HotkeyRegistryProvider>,
    );

const register = (key: string, execute: () => void) => {
    const descriptor: HotkeyDescriptor = { id: key, key, title: key, execute };
    act(() => { registry.register('test', [descriptor]); });
};

const press = (init: KeyboardEventInit) => {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    });
};

beforeEach(() => { mount(); });

describe('HotkeyDispatcher – descriptor freshness', () => {
    it('fires the latest descriptor after a re-registration', () => {
        const first = vi.fn();
        const second = vi.fn();

        register('Delete', first);
        register('Delete', second);

        press({ key: 'Delete' });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('stops firing a hotkey once its plugin unregisters', () => {
        const execute = vi.fn();
        register('Delete', execute);
        act(() => { registry.unregister('test'); });

        press({ key: 'Delete' });

        expect(execute).not.toHaveBeenCalled();
    });
});
