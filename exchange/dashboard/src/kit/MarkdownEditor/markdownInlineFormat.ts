/**
 * Inline markdown at a keypress: bold, italic, code, strikethrough and links.
 *
 * One set of pure edits over (document, selection), spoken two ways: as a CodeMirror keymap for
 * the source pane and the flow node's panel box, and as a key handler for the plain textarea the
 * voice pane is. Both keep the selection on the words, and every toggle takes itself back — a
 * selection carrying the markers, or standing between them, has them removed instead of doubled.
 */
import type React from 'react';
import { keymap, type Command } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';

/** One inline rewrite: the range it replaces, and where the selection lands after. */
export interface InlineEdit {
    from: number;
    to: number;
    insert: string;
    selectFrom: number;
    selectTo: number;
}

export const applyInlineEdit = (doc: string, edit: InlineEdit): { text: string; selectFrom: number; selectTo: number } => ({
    text: doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to),
    selectFrom: edit.selectFrom,
    selectTo: edit.selectTo,
});

/**
 * Whether the char beside a marker pair says the pair stands alone — the edge of the document, a
 * space or punctuation. A word char or another marker char says the pair is half of something
 * longer, which a toggle must wrap rather than eat into.
 */
const isAlone = (char: string): boolean => char === '' || /[^A-Za-z0-9*_`~]/.test(char);

const toggleWrap = (doc: string, from: number, to: number, marker: string): InlineEdit => {
    const selected = doc.slice(from, to);
    if (from !== to) {
        // Bold-and-italic answers the italic toggle with the bold it keeps.
        if (marker === '*' && selected.startsWith('***') && selected.endsWith('***') && selected.length >= 7) {
            const inner = selected.slice(1, -1);
            return { from, to, insert: inner, selectFrom: from, selectTo: from + inner.length };
        }
        // The selection carries exactly one layer of the marker: take it off. A single star fenced
        // by stars is bold, not italic, so it wraps instead of unwrapping half of it.
        if (
            selected.length >= marker.length * 2 &&
            selected.startsWith(marker) &&
            selected.endsWith(marker) &&
            (marker.length > 1 || (selected[marker.length] !== marker && selected[selected.length - marker.length - 1] !== marker))
        ) {
            const inner = selected.slice(marker.length, selected.length - marker.length);
            return { from, to, insert: inner, selectFrom: from, selectTo: from + inner.length };
        }
        // Between the markers, as a double-clicked word is: take those off instead.
        const before = doc.slice(from - marker.length, from);
        const after = doc.slice(to, to + marker.length);
        if (
            before === marker && after === marker &&
            isAlone(doc.charAt(from - marker.length - 1)) && isAlone(doc.charAt(to + marker.length))
        ) {
            return {
                from: from - marker.length,
                to: to + marker.length,
                insert: selected,
                selectFrom: from - marker.length,
                selectTo: from - marker.length + selected.length,
            };
        }
        return {
            from,
            to,
            insert: marker + selected + marker,
            selectFrom: from + marker.length,
            selectTo: to + marker.length,
        };
    }
    // An empty pair takes itself back on a second press; anywhere else a pair goes in with the
    // caret between, ready to be typed into.
    const before = doc.slice(from - marker.length, from);
    const after = doc.slice(from, from + marker.length);
    if (
        before === marker && after === marker &&
        isAlone(doc.charAt(from - marker.length - 1)) && isAlone(doc.charAt(from + marker.length))
    ) {
        return {
            from: from - marker.length,
            to: from + marker.length,
            insert: '',
            selectFrom: from - marker.length,
            selectTo: from - marker.length,
        };
    }
    return { from, to, insert: marker + marker, selectFrom: from + marker.length, selectTo: from + marker.length };
};

export const toggleBold = (doc: string, from: number, to: number): InlineEdit =>
    toggleWrap(doc, from, to, '**');

export const toggleItalic = (doc: string, from: number, to: number): InlineEdit =>
    toggleWrap(doc, from, to, '*');

export const toggleInlineCode = (doc: string, from: number, to: number): InlineEdit =>
    toggleWrap(doc, from, to, '`');

export const toggleStrikethrough = (doc: string, from: number, to: number): InlineEdit =>
    toggleWrap(doc, from, to, '~~');

/** A selection that is already an address — a scheme, a fragment, or a path from the store root. */
const LINK_TARGET = /^(https?:\/\/|mailto:|ftp:\/\/|#|\/|\.\.?\/)/i;

export const insertMarkdownLink = (doc: string, from: number, to: number): InlineEdit => {
    const selected = doc.slice(from, to);
    if (from !== to) {
        // A link answers the shortcut with the text it keeps.
        const linked = /^\[([^\]]*)\]\([^()]*\)$/.exec(selected);
        if (linked) {
            return { from, to, insert: linked[1], selectFrom: from, selectTo: from + linked[1].length };
        }
        // An address becomes the target, with the caret where the text goes; anything else becomes
        // the text, with the target ready to be typed over.
        if (LINK_TARGET.test(selected)) {
            return { from, to, insert: `[](${selected})`, selectFrom: from + 1, selectTo: from + 1 };
        }
        return {
            from,
            to,
            insert: `[${selected}](url)`,
            selectFrom: from + selected.length + 3,
            selectTo: from + selected.length + 6,
        };
    }
    return { from, to, insert: '[](url)', selectFrom: from + 1, selectTo: from + 1 };
};

const inlineCommand = (edit: (doc: string, from: number, to: number) => InlineEdit): Command => (view) => {
    const { from, to } = view.state.selection.main;
    const made = edit(view.state.doc.toString(), from, to);
    view.dispatch({
        changes: { from: made.from, to: made.to, insert: made.insert },
        selection: { anchor: made.selectFrom, head: made.selectTo },
        userEvent: 'input.format',
    });
    return true;
};

/**
 * The shortcuts themselves, for every CodeMirror box editing markdown. Mod-Shift-X crosses out —
 * the X is what is crossed — beside the four every editor agrees on.
 */
export const markdownInlineKeymap: Extension = Prec.highest(keymap.of([
    { key: 'Mod-b', preventDefault: true, run: inlineCommand(toggleBold) },
    { key: 'Mod-i', preventDefault: true, run: inlineCommand(toggleItalic) },
    { key: 'Mod-k', preventDefault: true, run: inlineCommand(insertMarkdownLink) },
    { key: 'Mod-e', preventDefault: true, run: inlineCommand(toggleInlineCode) },
    { key: 'Mod-`', preventDefault: true, run: inlineCommand(toggleInlineCode) },
    { key: 'Mod-Shift-x', preventDefault: true, run: inlineCommand(toggleStrikethrough) },
]));

/**
 * The same shortcuts over a controlled textarea's value, spread as its `onKeyDown`. Answers true
 * when a shortcut was written back, false for any other key.
 */
export const handleMarkdownTextareaKey = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    value: string,
    onChange: (next: string) => void,
): boolean => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const box = event.currentTarget;
    const from = Math.min(box.selectionStart ?? value.length, value.length);
    const to = Math.min(box.selectionEnd ?? value.length, value.length);
    const key = event.key.toLowerCase();
    const edit =
        key === 'b' && !event.shiftKey ? toggleBold(value, from, to)
            : key === 'i' && !event.shiftKey ? toggleItalic(value, from, to)
                : key === 'k' && !event.shiftKey ? insertMarkdownLink(value, from, to)
                    : key === 'e' && !event.shiftKey ? toggleInlineCode(value, from, to)
                        : key === '`' && !event.shiftKey ? toggleInlineCode(value, from, to)
                            : key === 'x' && event.shiftKey ? toggleStrikethrough(value, from, to)
                                : null;
    if (!edit) return false;
    event.preventDefault();
    onChange(applyInlineEdit(value, edit).text);
    // After the render carrying the new value: setting the selection on the box as it stands would
    // be setting it in text about to be replaced.
    requestAnimationFrame(() => {
        box.focus();
        box.setSelectionRange(edit.selectFrom, edit.selectTo);
    });
    return true;
};
