import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SelectionProvider } from '../../selection';
import { SelectionModelProvider, useFileSelection } from './SelectionModel-ctx';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SelectionProvider>
        <SelectionModelProvider>{children}</SelectionModelProvider>
    </SelectionProvider>
);

const renderSelection = () => renderHook(() => useFileSelection(), { wrapper });

describe('SelectionModel – single & multi select', () => {
    it('replace select keeps exactly one item and marks it primary', () => {
        const { result } = renderSelection();
        act(() => result.current.select('a', 'replace'));

        expect(result.current.getSelected()).toEqual(['a']);
        expect(result.current.isSelected('a')).toBe(true);
        expect(result.current.primary).toBe('a');
        expect(result.current.selectedCount).toBe(1);
    });

    it('toggle select adds then removes an item', () => {
        const { result } = renderSelection();
        act(() => result.current.select('a', 'replace'));
        act(() => result.current.select('b', 'toggle'));

        expect(result.current.getSelected().sort()).toEqual(['a', 'b']);
        expect(result.current.primary).toBe('b');

        act(() => result.current.select('b', 'toggle'));
        expect(result.current.isSelected('b')).toBe(false);
        expect(result.current.getSelected()).toEqual(['a']);
        // primary hint pointed at the now-deselected 'b'; it falls back to a live item.
        expect(result.current.primary).toBe('a');
    });

    it('selectAll selects every path and anchors on the first', () => {
        const { result } = renderSelection();
        act(() => result.current.selectAll(['a', 'b', 'c']));

        expect(result.current.selectedCount).toBe(3);
        expect(result.current.lastClicked).toBe('a');
        expect(result.current.primary).toBe('a');
    });

    it('clear empties the selection and its anchors', () => {
        const { result } = renderSelection();
        act(() => result.current.selectAll(['a', 'b']));
        act(() => result.current.clear());

        expect(result.current.selectedCount).toBe(0);
        expect(result.current.primary).toBeNull();
        expect(result.current.lastClicked).toBeNull();
    });
});

describe('SelectionModel – range select', () => {
    const visible = ['a', 'b', 'c', 'd', 'e'];

    it('selects the inclusive range between the anchor and the target', () => {
        const { result } = renderSelection();
        act(() => result.current.select('b', 'replace')); // anchor
        act(() => result.current.selectRange('d', visible));

        expect(result.current.getSelected()).toEqual(['b', 'c', 'd']);
        expect(result.current.primary).toBe('d');
    });

    it('works when the target is above the anchor', () => {
        const { result } = renderSelection();
        act(() => result.current.select('d', 'replace'));
        act(() => result.current.selectRange('b', visible));

        expect(result.current.getSelected()).toEqual(['b', 'c', 'd']);
    });

    it('falls back to a plain select when there is no usable anchor', () => {
        const { result } = renderSelection();
        act(() => result.current.selectRange('c', visible)); // nothing selected yet

        expect(result.current.getSelected()).toEqual(['c']);
    });
});

describe('SelectionModel – keyboard primary movement', () => {
    it('moves the primary within the visible list and clamps at the ends', () => {
        const { result } = renderSelection();
        act(() => result.current.setVisiblePaths(['a', 'b', 'c']));
        act(() => result.current.select('a', 'replace'));

        act(() => { result.current.movePrimary(1, false); });
        expect(result.current.primary).toBe('b');
        expect(result.current.selectedCount).toBe(1);

        act(() => { result.current.movePrimary(1, false); });
        act(() => { result.current.movePrimary(1, false); }); // clamp at last
        expect(result.current.primary).toBe('c');

        act(() => { result.current.movePrimary(-1, false); });
        expect(result.current.primary).toBe('b');
    });

    it('starts from the first item when moving down with no primary', () => {
        const { result } = renderSelection();
        act(() => result.current.setVisiblePaths(['a', 'b', 'c']));

        let moved: string | null = null;
        act(() => { moved = result.current.movePrimary(1, false); });
        expect(moved).toBe('a');
    });

    it('extends the selection when moving with extendRange', () => {
        const { result } = renderSelection();
        act(() => result.current.setVisiblePaths(['a', 'b', 'c', 'd']));
        act(() => result.current.select('a', 'replace'));

        act(() => { result.current.movePrimary(2, true); });
        expect(result.current.getSelected()).toEqual(['a', 'b', 'c']);
        expect(result.current.primary).toBe('c');
    });

    it('returns null when there is nothing visible to move through', () => {
        const { result } = renderSelection();
        let moved: string | null = 'x';
        act(() => { moved = result.current.movePrimary(1, false); });
        expect(moved).toBeNull();
    });
});

describe('SelectionModel – select mode toggle', () => {
    it('defaults to off and can be turned on', () => {
        const { result } = renderSelection();
        expect(result.current.selectMode).toBe(false);
        act(() => result.current.setSelectMode(true));
        expect(result.current.selectMode).toBe(true);
    });
});
