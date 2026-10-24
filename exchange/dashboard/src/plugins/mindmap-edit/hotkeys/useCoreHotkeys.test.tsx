import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mindmapState = vi.hoisted(() => ({
    mode: 'EDIT' as string,
    setMode: vi.fn(),
    elements: [] as any[],
    mapElements: vi.fn(),
    saveMindmap: vi.fn(),
    setMindmap: vi.fn(),
}));
const selectionState = vi.hoisted(() => ({ value: ['n1'] as string[], set: vi.fn() }));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({
        selectElements: (fn: (e: any) => boolean) => mindmapState.elements.filter(fn),
        mapElements: mindmapState.mapElements,
        saveMindmap: mindmapState.saveMindmap,
        setMindmap: mindmapState.setMindmap,
    }),
    useMindmapMode: () => [mindmapState.mode, mindmapState.setMode],
}));

vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    useSelectionContext: () => [selectionState.value, selectionState.set],
    useCleanSelectionAndPointing: () => vi.fn(),
}));

vi.mock('react-advanced-interactions', () => ({
    usePointedElementContext: () => [null, vi.fn()],
}));

import { HotkeyRegistry, CommandContext } from '../../../cms-core/commands/HotkeyRegistry';
import { HotkeyRegistryProvider, useHotkeyRegistry } from '../../../cms-core/commands/HotkeyRegistry-ctx';
import { useCoreHotkeys } from './useCoreHotkeys';
import { useNoteHotkeys } from './useNoteHotkeys';

let hotkeys: HotkeyRegistry;
const Capture = () => {
    hotkeys = useHotkeyRegistry();
    return null;
};
const Probe = () => {
    useCoreHotkeys();
    useNoteHotkeys();
    return null;
};

const mount = () =>
    render(
        <HotkeyRegistryProvider>
            <Capture />
            <Probe />
        </HotkeyRegistryProvider>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    mindmapState.mode = 'EDIT';
    mindmapState.elements = [{ id: 'n1', userBounds: [0, 0, null, null], content: 'one' }];
    selectionState.value = ['n1'];
    mount();
});

const ctx: CommandContext = { pointedElement: null, selection: ['n1'], currentPath: '', currentFile: null };

describe('mindmap Escape hotkey', () => {
    it('empties the selection', () => {
        const escape = hotkeys.getHotkeys(ctx).find(hotkey => hotkey.key === 'Escape');
        expect(escape).toBeDefined();
        act(() => { escape!.execute(ctx); });
        expect(selectionState.set).toHaveBeenCalledWith([]);
        expect(mindmapState.setMode).not.toHaveBeenCalled();
    });

    it('steps back to visualising with nothing selected', () => {
        const empty: CommandContext = { ...ctx, selection: [] };
        const escape = hotkeys.getHotkeys(empty).find(hotkey => hotkey.key === 'Escape');
        expect(escape).toBeDefined();
        act(() => { escape!.execute(empty); });
        expect(mindmapState.setMode).toHaveBeenCalledWith('VISUALIZE');
    });

    it('stays quiet outside EDIT mode', () => {
        mindmapState.mode = 'VISUALIZE';
        mount();
        const keys = hotkeys.getHotkeys(ctx).map(hotkey => hotkey.key);
        expect(keys).not.toContain('Escape');
    });
});

describe('mindmap Backspace hotkey', () => {
    it('deletes what is named on the map', () => {
        const backspace = hotkeys.getHotkeys(ctx).find(hotkey => hotkey.key === 'Backspace');
        expect(backspace).toBeDefined();
        act(() => { backspace!.execute(ctx); });
        expect(mindmapState.setMindmap).toHaveBeenCalled();
        expect(mindmapState.saveMindmap).toHaveBeenCalled();
    });

    it('stays quiet with nothing named', () => {
        const empty: CommandContext = { ...ctx, selection: [] };
        const keys = hotkeys.getHotkeys(empty).map(hotkey => hotkey.key);
        expect(keys).not.toContain('Backspace');
    });
});

describe('mindmap group hotkeys', () => {
    const pair: CommandContext = { ...ctx, selection: ['n1', 'n2'] };

    beforeEach(() => {
        mindmapState.elements = [
            { id: 'n1', userBounds: [0, 0, null, null], content: 'one' },
            { id: 'n2', userBounds: [0, 0, null, null], content: 'two' },
        ];
    });

    it('groups two notes on Ctrl+G', () => {
        const group = hotkeys.getHotkeys(pair).find(hotkey => hotkey.key === 'Mod+G');
        expect(group).toBeDefined();
    });

    it('offers no grouping to a single note', () => {
        const keys = hotkeys.getHotkeys(ctx).map(hotkey => hotkey.key);
        expect(keys).not.toContain('Mod+G');
    });

    it('ungroups on Ctrl+Shift+G only what is grouped', () => {
        const ungrouped = hotkeys.getHotkeys(pair).map(hotkey => hotkey.key);
        expect(ungrouped).not.toContain('Mod+Shift+G');

        mindmapState.elements = mindmapState.elements.map(element => ({ ...element, group: 'g1' }));
        const grouped = hotkeys.getHotkeys(pair).map(hotkey => hotkey.key);
        expect(grouped).toContain('Mod+Shift+G');
    });
});
