import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useMindmapMenuItems } from './MindmapContextMenu';

const state = vi.hoisted(() => ({
    elements: [] as any[],
    selection: [] as string[],
    setSelection: vi.fn(),
    setMode: vi.fn(),
    clean: vi.fn(),
    mapElements: vi.fn(),
    saveMindmap: vi.fn(),
    setMindmap: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    createNote: vi.fn(),
    createNoteGroup: vi.fn(),
    ungroupNotes: vi.fn(),
    pasteLink: vi.fn(),
    pasteCode: vi.fn(),
    pasteImage: vi.fn(),
}));

vi.mock('../state', () => ({
    useMindmapStateContext: () => ({
        selectElements: (fn: (e: any) => boolean) => state.elements.filter(fn),
        mapElements: state.mapElements,
        saveMindmap: state.saveMindmap,
        setMindmap: state.setMindmap,
    }),
    useMindmapMode: () => ['EDIT', state.setMode],
}));

vi.mock('@cms-core', () => ({
    useSelectionContext: () => [state.selection, state.setSelection],
    useCleanSelectionAndPointing: () => state.clean,
}));

vi.mock('../hotkeys/useClipboardHotkeys', () => ({
    useMindmapClipboard: () => ({ copy: state.copy, cut: state.cut, paste: state.paste }),
}));

vi.mock('../hooks/useNote', () => ({
    useCreateNote: () => state.createNote,
    useCreateNoteGroup: () => state.createNoteGroup,
    useUngroupNotes: () => state.ungroupNotes,
    usePasteLink: () => state.pasteLink,
    usePasteCode: () => state.pasteCode,
    usePasteImage: () => state.pasteImage,
}));

const note = (id: string, extra = {}) => ({
    id, userBounds: [0, 0, null, null], content: id, ...extra,
});

const relationOf = (id: string, ends: any[]) => ({ id, ends });

const keysOf = (target: string | null) => {
    const { result } = renderHook(() => useMindmapMenuItems(target));
    return result.current.items.map((item: any) => item.key);
};

const itemOf = (target: string | null, key: string) => {
    const { result } = renderHook(() => useMindmapMenuItems(target));
    return result.current.items.find((item: any) => item.key === key) as any;
};

beforeEach(() => {
    vi.clearAllMocks();
    state.elements = [];
    state.selection = [];
});

describe('mindmap context menu', () => {
    it('offers a new note and the pastes on the bare map', () => {
        expect(keysOf(null)).toEqual([
            'new-note', 'sep-new', 'paste', 'paste-link', 'paste-code', 'paste-image',
        ]);
    });

    it('makes the new note where the menu opened', () => {
        const { result } = renderHook(() => useMindmapMenuItems(null));
        expect(result.current.selectedKeys).toEqual([]);
        const newNote = itemOf(null, 'new-note');
        act(() => { newNote.onClick(); });
        expect(state.createNote).toHaveBeenCalledWith(undefined);
    });

    it('cuts, copies and deletes a targeted note', () => {
        state.elements = [note('n1')];
        state.selection = ['n1'];

        const keys = keysOf('n1');
        expect(keys).toContain('cut');
        expect(keys).toContain('copy');
        expect(keys).toContain('paste');
        expect(keys).toContain('delete');
        expect(keys).not.toContain('new-note');

        const cut = itemOf('n1', 'cut');
        act(() => { cut.onClick(); });
        expect(state.cut).toHaveBeenCalledWith(['n1']);

        const del = itemOf('n1', 'delete');
        act(() => { del.onClick(); });
        expect(state.setMindmap).toHaveBeenCalled();
        expect(state.clean).toHaveBeenCalled();
    });

    it('sizes only a note that is the whole selection', () => {
        state.elements = [note('n1'), note('n2')];
        state.selection = ['n1', 'n2'];
        expect(keysOf('n1')).not.toContain('text-size');
        expect(keysOf('n1')).not.toContain('note-size');

        state.selection = ['n1'];
        const keys = keysOf('n1');
        expect(keys).toContain('text-size');
        expect(keys).toContain('note-size');

        const sizes = itemOf('n1', 'note-size').children.map((child: any) => child.key);
        expect(sizes).toEqual([
            'rect-wider', 'rect-narrower', 'rect-taller', 'rect-shorter', 'rect-natural',
        ]);

        const larger = itemOf('n1', 'text-size').children[0];
        act(() => { larger.onClick(); });
        expect(state.mapElements).toHaveBeenCalled();
        expect(state.saveMindmap).toHaveBeenCalled();
    });

    it('groups two notes and ungroups only what is grouped', () => {
        state.elements = [note('n1'), note('n2')];
        state.selection = ['n1', 'n2'];
        expect(keysOf('n1')).toContain('group');
        expect(keysOf('n1')).not.toContain('ungroup');

        state.elements = [note('n1', { group: 'g1' }), note('n2', { group: 'g1' })];
        expect(keysOf('n1')).toContain('ungroup');
    });

    it('styles a targeted relation', () => {
        state.elements = [relationOf('r1', [
            { id: 'e1', target: 'n1' }, { id: 'e2', target: 'n2' },
        ])];
        state.selection = ['r1'];

        expect(keysOf('r1')).toContain('style-relation');
        const style = itemOf('r1', 'style-relation');
        act(() => { style.onClick(); });
        expect(state.setSelection).toHaveBeenCalledWith(['r1']);
        expect(state.setMode).toHaveBeenCalledWith('EDIT_MODIFY_ELEMENT');
    });

    it('addresses a pointed end with selection, decoration and attach point', () => {
        state.elements = [
            note('n1'), note('n2'),
            relationOf('r1', [
                { id: 'e1', target: 'n1', decoration: 'FULL_TRIANGLE', attachPointNumber: 3 },
                { id: 'e2', target: 'n2' },
            ]),
        ];

        expect(keysOf('e1')).toEqual([
            'select-relation', 'decoration', 'attach', 'sep-end-delete', 'delete-relation',
        ]);

        const { result } = renderHook(() => useMindmapMenuItems('e1'));
        expect(result.current.selectedKeys).toEqual(['decoration-FULL_TRIANGLE', 'attach-3']);

        const select = itemOf('e1', 'select-relation');
        act(() => { select.onClick(); });
        expect(state.setSelection).toHaveBeenCalledWith(['r1']);

        const decorations = itemOf('e1', 'decoration').children.map((child: any) => child.key);
        expect(decorations).toEqual([
            'decoration-none', 'decoration-EMPTY_TRIANGLE', 'decoration-FULL_TRIANGLE',
            'decoration-EMPTY_RECTANGLE', 'decoration-FULL_RECTANGLE',
        ]);

        const attach = itemOf('e1', 'attach').children;
        expect(attach).toHaveLength(13);
        act(() => { attach[0].onClick(); });
        expect(state.mapElements).toHaveBeenCalled();
        expect(state.saveMindmap).toHaveBeenCalled();
        expect(state.clean).not.toHaveBeenCalled();
    });
});
