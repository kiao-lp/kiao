import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    applyInlineEdit,
    handleMarkdownTextareaKey,
    insertMarkdownLink,
    markdownInlineKeymap,
    toggleBold,
    toggleInlineCode,
    toggleItalic,
    toggleStrikethrough,
    type InlineEdit,
} from './markdownInlineFormat';

/** The document `applyInlineEdit` makes of `doc` under `edit`. */
const textOf = (doc: string, from: number, to: number, edit: (doc: string, from: number, to: number) => InlineEdit) =>
    applyInlineEdit(doc, edit(doc, from, to)).text;

describe('toggleBold', () => {
    it('wraps the selection, keeping it on the words', () => {
        const edit = toggleBold('say hello now', 4, 9);
        expect(applyInlineEdit('say hello now', edit)).toEqual({
            text: 'say **hello** now',
            selectFrom: 6,
            selectTo: 11,
        });
    });

    it('unwraps a selection that carries the markers', () => {
        expect(textOf('say **hello** now', 4, 13, toggleBold)).toBe('say hello now');
    });

    it('unwraps the markers around a double-clicked word', () => {
        const edit = toggleBold('say **hello** now', 6, 11);
        expect(applyInlineEdit('say **hello** now', edit)).toEqual({
            text: 'say hello now',
            selectFrom: 4,
            selectTo: 9,
        });
    });

    it('inserts an empty pair with the caret between, where nothing is selected', () => {
        const edit = toggleBold('say  now', 4, 4);
        expect(applyInlineEdit('say  now', edit)).toEqual({
            text: 'say **** now',
            selectFrom: 6,
            selectTo: 6,
        });
    });

    it('takes the empty pair back on a second press', () => {
        expect(textOf('say **** now', 6, 6, toggleBold)).toBe('say  now');
    });

    it('does not eat a bold marker the caret merely sits beside', () => {
        // Between the two stars opening a bold run: a pair goes in, the run survives.
        const edit = toggleBold('**hello**', 1, 1);
        expect(applyInlineEdit('**hello**', edit).text).toBe('******hello**');
    });
});

describe('toggleItalic', () => {
    it('wraps the selection in single stars', () => {
        const edit = toggleItalic('say hello now', 4, 9);
        expect(applyInlineEdit('say hello now', edit)).toEqual({
            text: 'say *hello* now',
            selectFrom: 5,
            selectTo: 10,
        });
    });

    it('unwraps a selection that carries single stars', () => {
        expect(textOf('say *hello* now', 4, 11, toggleItalic)).toBe('say hello now');
    });

    it('adds italic to bold rather than eating half its markers', () => {
        expect(textOf('**hello**', 0, 9, toggleItalic)).toBe('***hello***');
    });

    it('removes italic from bold-and-italic, keeping the bold', () => {
        expect(textOf('***hello***', 0, 11, toggleItalic)).toBe('**hello**');
    });

    it('unwraps the stars around a double-clicked word, but not half a bold run', () => {
        expect(textOf('say *hello* now', 5, 10, toggleItalic)).toBe('say hello now');
        expect(textOf('say **hello** now', 6, 11, toggleItalic)).toBe('say ***hello*** now');
    });

    it('inserts an empty pair with the caret between, where nothing is selected', () => {
        const edit = toggleItalic('say  now', 4, 4);
        expect(applyInlineEdit('say  now', edit)).toEqual({
            text: 'say ** now',
            selectFrom: 5,
            selectTo: 5,
        });
    });
});

describe('toggleInlineCode and toggleStrikethrough', () => {
    it('wraps the selection in backticks, and unwraps it back', () => {
        expect(textOf('run this now', 4, 8, toggleInlineCode)).toBe('run `this` now');
        expect(textOf('run `this` now', 4, 10, toggleInlineCode)).toBe('run this now');
    });

    it('wraps the selection in double tildes, and unwraps it back', () => {
        expect(textOf('drop this now', 5, 9, toggleStrikethrough)).toBe('drop ~~this~~ now');
        expect(textOf('drop ~~this~~ now', 5, 13, toggleStrikethrough)).toBe('drop this now');
    });
});

describe('insertMarkdownLink', () => {
    it('turns the selection into link text, with the target ready to type', () => {
        const edit = insertMarkdownLink('read this now', 5, 9);
        const applied = applyInlineEdit('read this now', edit);
        expect(applied.text).toBe('read [this](url) now');
        expect(applied.text.slice(applied.selectFrom, applied.selectTo)).toBe('url');
    });

    it('turns a selected URL into the target, with the caret where the text goes', () => {
        const edit = insertMarkdownLink('see https://example.com soon', 4, 23);
        const applied = applyInlineEdit('see https://example.com soon', edit);
        expect(applied.text).toBe('see [](https://example.com) soon');
        expect(applied.selectFrom).toBe(applied.selectTo);
        expect(applied.text.slice(0, applied.selectFrom)).toBe('see [');
    });

    it('offers an empty link with the caret in the text, where nothing is selected', () => {
        const edit = insertMarkdownLink('see  soon', 4, 4);
        const applied = applyInlineEdit('see  soon', edit);
        expect(applied.text).toBe('see [](url) soon');
        expect(applied.selectFrom).toBe(applied.selectTo);
        expect(applied.text.slice(0, applied.selectFrom)).toBe('see [');
    });

    it('unwraps a selected link back to its text', () => {
        expect(textOf('read [this](https://example.com) now', 5, 32, insertMarkdownLink)).toBe(
            'read this now',
        );
    });
});

// ── The CodeMirror keymap: the shortcuts themselves ──────────────────────────────────────────────

/** An editor holding `doc`, with the inline-format keymap on. */
const editor = (doc: string) => new EditorView({
    state: EditorState.create({ doc, extensions: [markdownInlineKeymap] }),
    parent: document.body,
});

/**
 * A keypress as the browser reports it, answered or not where the caret stands. The shifted letter
 * carries its key code: CodeMirror reads the unshifted letter back off it, and jsdom reports none.
 */
const press = (view: EditorView, key: string, init: KeyboardEventInit = {}, keyCode = 0) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init });
    if (keyCode) {
        Object.defineProperty(event, 'keyCode', { value: keyCode });
        Object.defineProperty(event, 'which', { value: keyCode });
    }
    view.contentDOM.dispatchEvent(event);
    return event;
};

const selected = (view: EditorView, from: number, to: number = from) =>
    view.dispatch({ selection: { anchor: from, head: to } });

describe('the markdown shortcuts in a CodeMirror editor', () => {
    it('bolds on Ctrl+B', () => {
        const view = editor('say hello now');
        selected(view, 4, 9);

        press(view, 'b', { ctrlKey: true });

        expect(view.state.doc.toString()).toBe('say **hello** now');
        expect(view.state.selection.main.from).toBe(6);
        expect(view.state.selection.main.to).toBe(11);
        view.destroy();
    });

    it('italicises on Ctrl+I', () => {
        const view = editor('say hello now');
        selected(view, 4, 9);

        press(view, 'i', { ctrlKey: true });

        expect(view.state.doc.toString()).toBe('say *hello* now');
        view.destroy();
    });

    it('links on Ctrl+K', () => {
        const view = editor('read this now');
        selected(view, 5, 9);

        press(view, 'k', { ctrlKey: true });

        expect(view.state.doc.toString()).toBe('read [this](url) now');
        view.destroy();
    });

    it('codes on Ctrl+E', () => {
        const view = editor('run this now');
        selected(view, 4, 8);

        press(view, 'e', { ctrlKey: true });

        expect(view.state.doc.toString()).toBe('run `this` now');
        view.destroy();
    });

    it('strikes through on Ctrl+Shift+X', () => {
        const view = editor('drop this now');
        selected(view, 5, 9);

        press(view, 'X', { ctrlKey: true, shiftKey: true }, 88);

        expect(view.state.doc.toString()).toBe('drop ~~this~~ now');
        view.destroy();
    });

    it('codes on Ctrl+` too', () => {
        const view = editor('run this now');
        selected(view, 4, 8);

        press(view, '`', { ctrlKey: true });

        expect(view.state.doc.toString()).toBe('run `this` now');
        view.destroy();
    });

    it('leaves any other shortcut to whoever else wants it', () => {
        const view = editor('untouched');
        selected(view, 0, 9);

        const event = press(view, 's', { ctrlKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.toString()).toBe('untouched');
        view.destroy();
    });
});

// ── The plain <textarea>: the voice editor pane ──────────────────────────────────────────────────

/** A box wired the way the voice pane is: the shortcut handler over a controlled value. */
const Box: React.FC = () => {
    const [value, setValue] = React.useState('say hello now');
    return (
        <textarea
            aria-label="voice"
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={event => { handleMarkdownTextareaKey(event, value, setValue); }}
        />
    );
};

const box = () => screen.getByLabelText('voice') as HTMLTextAreaElement;

/** The caret is put back after the render carrying the new value, so past it. */
const afterCaret = async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
};

describe('the markdown shortcuts in a textarea', () => {
    it('bolds on Ctrl+B, keeping the selection on the words', async () => {
        render(<Box />);
        box().setSelectionRange(4, 9);

        fireEvent.keyDown(box(), { key: 'b', ctrlKey: true });

        expect(box().value).toBe('say **hello** now');
        await afterCaret();
        expect(box().selectionStart).toBe(6);
        expect(box().selectionEnd).toBe(11);
    });

    it('ignores a bare key and an unbound shortcut', () => {
        const onChange = vi.fn();
        render(
            <textarea
                aria-label="plain"
                value="untouched"
                onChange={onChange}
                onKeyDown={event => { handleMarkdownTextareaKey(event, 'untouched', onChange); }}
            />,
        );
        const plain = screen.getByLabelText('plain') as HTMLTextAreaElement;

        expect(fireEvent.keyDown(plain, { key: 'b' })).toBe(true);
        expect(fireEvent.keyDown(plain, { key: 's', ctrlKey: true })).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        expect(plain.value).toBe('untouched');
    });
});
