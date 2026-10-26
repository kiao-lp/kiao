import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// The dispatcher's hotkey list is derived from several UI contexts; stub them
// so the test isolates the parsing/matching + input-focus guard.
vi.mock('react-advanced-interactions', () => ({ usePointedElementContext: () => [null, vi.fn()] }));
vi.mock('../selection', () => ({ useSelectionContext: () => [[], vi.fn()] }));
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

describe('HotkeyDispatcher – matching', () => {
    it('"mod+k" fires on Ctrl+k', () => {
        const execute = vi.fn();
        register('mod+k', execute);
        press({ key: 'k', ctrlKey: true });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('"mod+k" also fires on Meta+k', () => {
        const execute = vi.fn();
        register('mod+k', execute);
        press({ key: 'k', metaKey: true });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('"mod+k" does not fire on a bare k (modifier required)', () => {
        const execute = vi.fn();
        register('mod+k', execute);
        press({ key: 'k' });
        expect(execute).not.toHaveBeenCalled();
    });

    it('single-character keys match case-insensitively', () => {
        const execute = vi.fn();
        register('a', execute);
        press({ key: 'A' });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('a shift-qualified binding does not fire without shift', () => {
        const execute = vi.fn();
        register('shift+a', execute);
        press({ key: 'a' });
        expect(execute).not.toHaveBeenCalled();
        press({ key: 'A', shiftKey: true });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('ignores hotkeys while an input is focused', () => {
        const execute = vi.fn();
        register('mod+k', execute);

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        try {
            press({ key: 'k', ctrlKey: true });
            expect(execute).not.toHaveBeenCalled();
        } finally {
            input.remove();
        }
    });
});
