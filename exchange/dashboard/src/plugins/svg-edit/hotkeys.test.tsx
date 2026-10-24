import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const svgState = vi.hoisted(() => ({ value: null as any }));
const selectionState = vi.hoisted(() => ({ value: ['r1'] as string[], set: vi.fn() }));

vi.mock('./state', async () => {
    const actual = await vi.importActual<typeof import('./state')>('./state');
    return { ...actual, useSvgStateContext: () => svgState.value };
});

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    useSelectionContext: () => [selectionState.value, selectionState.set],
}));

import { CommandContext, HotkeyRegistry } from '../../cms-core/commands/HotkeyRegistry';
import { HotkeyRegistryProvider, useHotkeyRegistry } from '../../cms-core/commands/HotkeyRegistry-ctx';
import { SvgHotkeysProvider } from './hotkeys';

let hotkeys: HotkeyRegistry;
const Capture = () => {
    hotkeys = useHotkeyRegistry();
    return null;
};

const spies = vi.hoisted(() => ({
    setDocument: vi.fn(),
    saveSvg: vi.fn(),
    addShapes: vi.fn(),
    deleteShapes: vi.fn(),
    restackShapes: vi.fn(),
}));

beforeEach(() => {
    vi.clearAllMocks();
    selectionState.value = ['r1'];
    svgState.value = {
        document: {
            drawing: {
                canvas: { width: 800, height: 600 },
                nodes: [
                    { kind: 'shape', shape: { id: 'r1', tag: 'rect', attrs: { x: '10', y: '20', width: '120', height: '60' } } },
                ],
            },
            rootAttrs: {},
        },
        setDocument: spies.setDocument,
        saveSvg: spies.saveSvg,
        addShapes: spies.addShapes,
        deleteShapes: spies.deleteShapes,
        restackShapes: spies.restackShapes,
        mode: 'canvas',
    };
    render(
        <HotkeyRegistryProvider>
            <Capture />
            <SvgHotkeysProvider>{null}</SvgHotkeysProvider>
        </HotkeyRegistryProvider>,
    );
});

const ctx: CommandContext = { pointedElement: null, selection: ['r1'], currentPath: '', currentFile: null };

describe('svg restack hotkeys', () => {
    it('brings the selection to front on Ctrl+Shift+F', () => {
        const front = hotkeys.getHotkeys(ctx).find(hotkey => hotkey.key === 'Mod+Shift+F');
        expect(front).toBeDefined();
        act(() => { front!.execute(ctx); });
        expect(spies.restackShapes).toHaveBeenCalledWith(['r1'], 'front');
        expect(spies.saveSvg).toHaveBeenCalled();
    });

    it('sends the selection to back on Ctrl+Shift+B', () => {
        const back = hotkeys.getHotkeys(ctx).find(hotkey => hotkey.key === 'Mod+Shift+B');
        expect(back).toBeDefined();
        act(() => { back!.execute(ctx); });
        expect(spies.restackShapes).toHaveBeenCalledWith(['r1'], 'back');
        expect(spies.saveSvg).toHaveBeenCalled();
    });

    it('stays quiet with nothing selected', () => {
        const empty: CommandContext = { ...ctx, selection: [] };
        const keys = hotkeys.getHotkeys(empty).map(hotkey => hotkey.key);
        expect(keys).not.toContain('Mod+Shift+F');
        expect(keys).not.toContain('Mod+Shift+B');
    });
});

