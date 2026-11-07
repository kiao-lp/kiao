/** Pure inline-format edits shared by CodeMirror and textarea handlers. Toggles remove existing markers instead of doubling them. */
import type React from 'react';
import { keymap, type Command } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';

/** Range replaced and resulting selection. */
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

// True if the neighbouring char is not a word or marker char.
const isAlone = (char: string): boolean => char === '' || /[^A-Za-z0-9*_`~]/.test(char);

const toggleWrap = (doc: string, from: number, to: number, marker: string): InlineEdit => {
    const selected = doc.slice(from, to);
    if (from !== to) {
        // `***x***` with italic toggle: remove one `*` layer, keep bold.
        if (marker === '*' && selected.startsWith('***') && selected.endsWith('***') && selected.length >= 7) {
            const inner = selected.slice(1, -1);
            return { from, to, insert: inner, selectFrom: from, selectTo: from + inner.length };
        }
        // Do not unwrap a single `*` inside `**`: that is bold, not italic.
        if (
            selected.length >= marker.length * 2 &&
            selected.startsWith(marker) &&
            selected.endsWith(marker) &&
            (marker.length > 1 || (selected[marker.length] !== marker && selected[selected.length - marker.length - 1] !== marker))
        ) {
            const inner = selected.slice(marker.length, selected.length - marker.length);
            return { from, to, insert: inner, selectFrom: from, selectTo: from + inner.length };
        }
        // Selection between markers: remove the surrounding markers.
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
    // Empty marker pair at the caret: remove it.
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

const LINK_TARGET = /^(https?:\/\/|mailto:|ftp:\/\/|#|\/|\.\.?\/)/i;

export const insertMarkdownLink = (doc: string, from: number, to: number): InlineEdit => {
    const selected = doc.slice(from, to);
    if (from !== to) {
        // Already a link: keep only its text.
        const linked = /^\[([^\]]*)\]\([^()]*\)$/.exec(selected);
        if (linked) {
            return { from, to, insert: linked[1], selectFrom: from, selectTo: from + linked[1].length };
        }
        // URL-like selection becomes the target; other text becomes the link text.
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

/** CodeMirror keymap for the inline markdown shortcuts. */
export const markdownInlineKeymap: Extension = Prec.highest(keymap.of([
    { key: 'Mod-b', preventDefault: true, run: inlineCommand(toggleBold) },
    { key: 'Mod-i', preventDefault: true, run: inlineCommand(toggleItalic) },
    { key: 'Mod-k', preventDefault: true, run: inlineCommand(insertMarkdownLink) },
    { key: 'Mod-e', preventDefault: true, run: inlineCommand(toggleInlineCode) },
    { key: 'Mod-`', preventDefault: true, run: inlineCommand(toggleInlineCode) },
    { key: 'Mod-Shift-x', preventDefault: true, run: inlineCommand(toggleStrikethrough) },
]));

/** Same shortcuts for a controlled textarea. Returns true if a shortcut was handled. */
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
    // Set the selection after render; the current DOM text is about to be replaced.
    requestAnimationFrame(() => {
        box.focus();
        box.setSelectionRange(edit.selectFrom, edit.selectTo);
    });
    return true;
};
