import React, { createRef, StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { TextComparison, type TextComparisonHandle } from './TextComparison';

const theme = vi.hoisted(() => ({ value: 'dark' }));
vi.mock('../../../ThemeContext', () => ({ useTheme: () => ({ theme: theme.value }) }));

const editor = (name: string) => EditorView.findFromDOM(screen.getByRole('textbox', { name }))!;
const replace = (view: EditorView, text: string) => act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input' });
});

beforeEach(() => {
    theme.value = 'dark';
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
});

describe('TextComparison', () => {
    it('compares text at character level and makes both panes read-only by default', () => {
        render(<TextComparison original="hello world" modified="hello earth" />);
        expect(editor('Original text').state.doc.toString()).toBe('hello world');
        expect(editor('Modified text').state.doc.toString()).toBe('hello earth');
        expect(screen.getByRole('textbox', { name: 'Original text' })).toHaveAttribute('contenteditable', 'false');
        expect(screen.getByRole('textbox', { name: 'Modified text' })).toHaveAttribute('contenteditable', 'false');
        expect(document.querySelector('.cm-merge-a .cm-changedText')).toHaveTextContent('world');
        expect(document.querySelector('.cm-merge-b .cm-changedText')).toHaveTextContent('earth');
    });

    it('updates changes as either editable pane is typed into, using the latest callbacks', async () => {
        const originalChange = vi.fn();
        const modifiedChange = vi.fn();
        const navigation = vi.fn();
        const { rerender } = render(<TextComparison original="one" modified="two" originalReadOnly={false}
            modifiedReadOnly={false} onOriginalChange={originalChange} onModifiedChange={modifiedChange}
            onNavigationChange={navigation} />);
        replace(editor('Original text'), 'two');
        expect(originalChange).toHaveBeenLastCalledWith('two');
        expect(navigation).toHaveBeenLastCalledWith({ index: -1, count: 0 });
        expect(document.querySelectorAll('.cm-changedText')).toHaveLength(0);

        const latestChange = vi.fn();
        rerender(<TextComparison original="two" modified="two" originalReadOnly={false}
            modifiedReadOnly={false} onModifiedChange={latestChange} onNavigationChange={navigation} />);
        replace(editor('Modified text'), 'three');
        expect(latestChange).toHaveBeenLastCalledWith('three');
        expect(modifiedChange).not.toHaveBeenCalled();
        expect(navigation).toHaveBeenLastCalledWith({ index: -1, count: 1 });
    });

    it('applies external text and configuration without recreating editors or reporting edits', () => {
        const originalChange = vi.fn();
        const modifiedChange = vi.fn();
        const { rerender } = render(<TextComparison original="one" modified="two"
            onOriginalChange={originalChange} onModifiedChange={modifiedChange} />);
        const original = editor('Original text');
        const modified = editor('Modified text');
        theme.value = 'light';
        rerender(<TextComparison original="three" modified="four" originalReadOnly={false} modifiedReadOnly={false}
            onOriginalChange={originalChange} onModifiedChange={modifiedChange}
            extensions={EditorView.contentAttributes.of({ 'data-extra': 'enabled' })} />);
        expect(editor('Original text')).toBe(original);
        expect(editor('Modified text')).toBe(modified);
        expect(original.state.doc.toString()).toBe('three');
        expect(modified.state.doc.toString()).toBe('four');
        expect(original.state.facet(EditorState.readOnly)).toBe(false);
        expect(modified.contentDOM).toHaveAttribute('contenteditable', 'true');
        expect(modified.contentDOM).toHaveAttribute('data-extra', 'enabled');
        expect(modified.state.facet(EditorView.darkTheme)).toBe(false);
        expect(originalChange).not.toHaveBeenCalled();
        expect(modifiedChange).not.toHaveBeenCalled();
    });

    it('preserves the cursor and undo history through controlled updates', () => {
        const onChange = vi.fn();
        const { rerender } = render(<TextComparison original="one" modified="two" modifiedReadOnly={false}
            onModifiedChange={onChange} />);
        const view = editor('Modified text');
        act(() => view.dispatch({ changes: { from: 3, insert: '!' }, selection: { anchor: 4 }, userEvent: 'input' }));
        rerender(<TextComparison original="one" modified="two!" modifiedReadOnly={false} onModifiedChange={onChange} />);
        expect(editor('Modified text')).toBe(view);
        expect(view.state.selection.main.head).toBe(4);
        act(() => { undo(view); });
        expect(view.state.doc.toString()).toBe('two');
        expect(onChange).toHaveBeenLastCalledWith('two');
    });

    it('cycles changes with the public controls and F7, and resets on edits', () => {
        const ref = createRef<TextComparisonHandle>();
        const navigation = vi.fn();
        const original = 'one\nkeep\nkeep\nkeep\nkeep\nlast';
        const modified = 'two\nkeep\nkeep\nkeep\nkeep\nend';
        render(<TextComparison ref={ref} original={original} modified={modified} onNavigationChange={navigation} />);
        expect(navigation).toHaveBeenLastCalledWith({ index: -1, count: 2 });
        act(() => ref.current!.previousChange());
        expect(navigation).toHaveBeenLastCalledWith({ index: 1, count: 2 });
        act(() => ref.current!.nextChange());
        expect(navigation).toHaveBeenLastCalledWith({ index: 0, count: 2 });
        expect(editor('Modified text').state.selection.main.from).toBe(0);
        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Modified text' }), { key: 'F7' });
        expect(navigation).toHaveBeenLastCalledWith({ index: 1, count: 2 });
        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Original text' }), { key: 'F7', shiftKey: true });
        expect(navigation).toHaveBeenLastCalledWith({ index: 0, count: 2 });
        replace(editor('Modified text'), original);
        expect(navigation).toHaveBeenLastCalledWith({ index: -1, count: 0 });
        act(() => ref.current!.nextChange());
        expect(navigation).toHaveBeenLastCalledWith({ index: -1, count: 0 });
    });

    it.each([
        ['', ''], ['', 'added'], ['removed', ''], ['last\nremoved', 'last'], ['last', 'last\nadded'],
        ['hello 🌍', 'hello 🌎'],
    ])('navigates empty sides, end-of-file changes and Unicode (%j → %j)', (original, modified) => {
        const ref = createRef<TextComparisonHandle>();
        render(<TextComparison ref={ref} original={original} modified={modified} />);
        act(() => ref.current!.nextChange());
        act(() => ref.current!.previousChange());
        expect(editor('Original text').state.selection.main.to).toBeLessThanOrEqual(original.length);
        expect(editor('Modified text').state.selection.main.to).toBeLessThanOrEqual(modified.length);
    });

    it('cleans up its views in StrictMode and on unmount', async () => {
        const { container, unmount } = render(<StrictMode><TextComparison original="one" modified="two" /></StrictMode>);
        await waitFor(() => expect(container.querySelectorAll('.cm-mergeView')).toHaveLength(1));
        const view = editor('Original text');
        const destroy = vi.spyOn(view, 'destroy');
        unmount();
        expect(destroy).toHaveBeenCalledOnce();
        expect(container.querySelector('.cm-mergeView')).toBeNull();
    });
});
