import React, { forwardRef, useImperativeHandle, useRef, useEffect, useMemo } from 'react';
import { CodeMirrorEditor, normalizeDocumentLink } from '@kiao-dashboard-core';
import { tags } from '@lezer/highlight';
import { foldService, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, keymap, Command } from '@codemirror/view';
import { Extension, Prec } from '@codemirror/state';
import {
    findTableEdits,
    parseTableAt,
    insertRowBelow,
    insertColumnRight,
    buildEmptyTable,
    columnIndexAt,
    cellContentStart,
    ParsedTable,
    TableEditResult,
} from './markdownTableFormat';
import { markdownSourceLanguage } from '../markdown/sourceLanguage';
import { markdownInlineKeymap } from './markdownInlineFormat';
import './CodeMirrorMarkdownEditor.css';

const customHighlightStyle = HighlightStyle.define([
    { tag: tags.heading1, color: 'var(--heading-1)', fontWeight: 'bold' },
    { tag: tags.heading2, color: 'var(--heading-2)', fontWeight: 'bold' },
    { tag: tags.heading3, color: 'var(--heading-3)', fontWeight: 'bold' },
    { tag: tags.heading4, color: 'var(--heading-4)', fontWeight: 'bold' },
    { tag: tags.heading5, color: 'var(--heading-5)', fontWeight: 'bold' },
    { tag: tags.heading6, color: 'var(--heading-6)', fontWeight: 'bold' },
    { tag: tags.link, color: 'var(--link)' },
    { tag: tags.url, color: 'var(--link)' },
]);

/** Folds from a heading to the next heading of equal or higher level. */
const markdownHeadingFoldService = foldService.of((state, lineStart, lineEnd) => {
    const line = state.doc.lineAt(lineStart);
    const text = line.text;

    const headingMatch = text.match(/^(#{1,6})\s/);
    if (!headingMatch) {
        return null;
    }

    const headingLevel = headingMatch[1].length;

    let foldEnd = state.doc.length;
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const nextLine = state.doc.line(i);
        const nextHeadingMatch = nextLine.text.match(/^(#{1,6})\s/);
        if (nextHeadingMatch) {
            const nextLevel = nextHeadingMatch[1].length;
            if (nextLevel <= headingLevel) {
                foldEnd = nextLine.from - 1;
                break;
            }
        }
    }

    if (foldEnd <= line.to) {
        return null;
    }

    return { from: line.to, to: foldEnd };
});

/** Reformats all tables. Only changed ranges are replaced, in one undo step. */
const formatTablesCommand: Command = (view) => {
    const { state } = view;
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const edit of findTableEdits(state.doc.toString())) {
        const from = state.doc.line(edit.fromLine + 1).from;
        const to = state.doc.line(edit.toLine + 1).to;
        if (state.doc.sliceString(from, to) !== edit.text) {
            changes.push({ from, to, insert: edit.text });
        }
    }
    if (changes.length === 0) {
        return false;
    }
    view.dispatch({ changes, userEvent: 'format.table' });
    return true;
};

/** Replaces the caret's table in one undo step. Returns false outside a table. */
const applyTableEdit = (
    view: EditorView,
    build: (table: ParsedTable, docLine: number, char: number) => TableEditResult,
): boolean => {
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const table = parseTableAt(state.doc.toString(), line.number - 1);
    if (!table) {
        return false;
    }
    const result = build(table, line.number - 1, head - line.from);
    const from = state.doc.line(table.fromLine + 1).from;
    const to = state.doc.line(table.toLine + 1).to;
    const newLines = result.text.split('\n');
    const beforeCursor = newLines.slice(0, result.cursorRow).reduce((n, l) => n + l.length + 1, 0);
    const cursor = from + beforeCursor + cellContentStart(newLines[result.cursorRow], result.cursorCol);
    view.dispatch({
        changes: { from, to, insert: result.text },
        selection: { anchor: cursor },
        userEvent: 'input.table',
    });
    return true;
};

/** Insert an empty row below the caret's row (Mod-Enter). */
const insertRowBelowCommand: Command = (view) =>
    applyTableEdit(view, (table, docLine) => insertRowBelow(table, docLine));

/** Insert an empty column to the right of the caret's column (Mod-Shift-Enter). */
const insertColumnRightCommand: Command = (view) =>
    applyTableEdit(view, (table, _docLine, char) => {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        return insertColumnRight(table, columnIndexAt(line.text, char));
    });

/** Insert a fresh `rows` x `cols` table at the caret, on its own block. */
const insertTableAt = (view: EditorView, rows: number, cols: number): void => {
    const { state } = view;
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const indent = (line.text.match(/^\s*/)?.[0]) ?? '';
    const table = buildEmptyTable(rows, cols, line.text.trim() === '' ? indent : '');
    const onEmptyLine = line.text.trim() === '';

    const from = onEmptyLine ? line.from : line.to;
    const to = onEmptyLine ? line.to : line.to;
    const insert = onEmptyLine ? table : '\n\n' + table;
    const tableStart = onEmptyLine ? from : from + 2;
    const firstLine = insert.split('\n')[onEmptyLine ? 0 : 2];
    const cursor = tableStart + cellContentStart(firstLine, 0);

    view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: cursor },
        userEvent: 'input.table',
    });
    view.focus();
};

/** Inserts as its own block: replaces a blank line, else follows the line after a blank line. The caret lands at the end. */
export const insertBlockAt = (view: EditorView, block: string): void => {
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.head);
    const onEmptyLine = line.text.trim() === '';
    const from = onEmptyLine ? line.from : line.to;
    const to = line.to;
    const prefix = onEmptyLine ? '' : '\n\n';
    const insert = prefix + block;
    const cursor = from + insert.length;

    view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: cursor },
        userEvent: 'input',
    });
    view.focus();
};

/** Normalize Dashboard URLs and mounted hrefs pasted into Markdown. */
const normalizeDocumentLinksOnPaste = EditorView.domEventHandlers({
    paste(event, view) {
        const pasted = event.clipboardData?.getData('text/plain')?.trim();
        if (!pasted || /\s/.test(pasted)) return false;
        const link = normalizeDocumentLink(pasted);
        if (link === pasted) return false;
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(link));
        return true;
    },
});

export interface CodeMirrorMarkdownEditorRef {
    formatTables: () => void;
    insertTable: (rows: number, cols: number) => void;
    insertRowBelow: () => void;
    insertColumnRight: () => void;
    /** Insert an arbitrary markdown block (e.g. a fenced diagram) at the caret. */
    insertBlock: (text: string) => void;
    /** Rewrite a document range in place. Returns false when there is no view. */
    replaceRange: (from: number, to: number, text: string) => boolean;
    /** Whether the caret currently sits inside a GFM table. */
    isCursorInTable: () => boolean;
    /** Put the caret on a 1-based line and scroll that line to the top of the pane. */
    goToLine: (line: number) => void;
}

export interface CodeMirrorMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    /** The view is built a render after mount. Called with `null` when it goes away. */
    onViewReady?: (view: EditorView | null) => void;
    style?: React.CSSProperties;
    /** A new value reconfigures the editor. Use a constant or memoized value. */
    extensions?: Extension;
}

const markdownExtensions = [
    markdownSourceLanguage,
    Prec.highest(syntaxHighlighting(customHighlightStyle, { fallback: false })),
    // Shift+Alt+F avoids the browser DevTools binding.
    Prec.highest(keymap.of([
        { key: 'Shift-Alt-f', preventDefault: true, run: formatTablesCommand },
        { key: 'Mod-Enter', preventDefault: true, run: insertRowBelowCommand },
        { key: 'Mod-Shift-Enter', preventDefault: true, run: insertColumnRightCommand },
    ])),
    markdownInlineKeymap,
    markdownHeadingFoldService,
    normalizeDocumentLinksOnPaste,
    EditorView.theme({ '.cm-foldGutter': { width: '16px' } }),
];

export const CodeMirrorMarkdownEditor = forwardRef<CodeMirrorMarkdownEditorRef, CodeMirrorMarkdownEditorProps>(
    ({ value, onChange, onViewReady, style, extensions }, ref) => {
        const editorRef = useRef<EditorView | null>(null);

        const onViewReadyRef = useRef(onViewReady);
        onViewReadyRef.current = onViewReady;
        useEffect(() => () => {
            editorRef.current = null;
            onViewReadyRef.current?.(null);
        }, []);

        useImperativeHandle(ref, () => ({
            formatTables: () => {
                const view = editorRef.current;
                if (view) {
                    formatTablesCommand(view);
                }
            },
            insertTable: (rows, cols) => {
                const view = editorRef.current;
                if (view) {
                    insertTableAt(view, rows, cols);
                }
            },
            insertRowBelow: () => {
                const view = editorRef.current;
                if (view) {
                    insertRowBelowCommand(view);
                    view.focus();
                }
            },
            insertColumnRight: () => {
                const view = editorRef.current;
                if (view) {
                    insertColumnRightCommand(view);
                    view.focus();
                }
            },
            insertBlock: (text) => {
                const view = editorRef.current;
                if (view) {
                    insertBlockAt(view, text);
                }
            },
            replaceRange: (from, to, text) => {
                const view = editorRef.current;
                if (!view || to > view.state.doc.length) {
                    return false;
                }
                view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input' });
                return true;
            },
            isCursorInTable: () => {
                const view = editorRef.current;
                if (!view) {
                    return false;
                }
                const line = view.state.doc.lineAt(view.state.selection.main.head);
                return parseTableAt(view.state.doc.toString(), line.number - 1) !== null;
            },
            goToLine: (line) => {
                const view = editorRef.current;
                if (!view) {
                    return;
                }
                const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
                view.dispatch({
                    selection: { anchor: target.from },
                    effects: EditorView.scrollIntoView(target.from, { y: 'start' }),
                });
                view.focus();
            },
        }));

        const editorExtensions = useMemo(
            () => extensions ? [extensions, markdownExtensions] : markdownExtensions,
            [extensions],
        );

        return (
            <CodeMirrorEditor
                className="markdown-codemirror-editor"
                value={value}
                onChange={onChange}
                onEditor={view => {
                    editorRef.current = view;
                    onViewReadyRef.current?.(view);
                }}
                extensions={editorExtensions}
                style={style}
            />
        );
    }
);

CodeMirrorMarkdownEditor.displayName = 'CodeMirrorMarkdownEditor';

