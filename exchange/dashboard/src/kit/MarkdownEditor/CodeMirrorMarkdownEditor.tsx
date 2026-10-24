import React, { forwardRef, useImperativeHandle, useRef, useCallback, useEffect, useMemo } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import { foldService, unfoldAll, foldAll, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, keymap, Command } from '@codemirror/view';
import { Extension, Prec } from '@codemirror/state';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
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
import { toStoredLink } from '@cms-core';
import { markdownInlineKeymap } from './markdownInlineFormat';
import { themeMode } from 'kiao-style';
import { useTheme } from '../../ThemeContext';
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

/**
 * Custom fold service for Markdown headings.
 * Folds content from a heading line to the next heading of equal or higher level, or end of document.
 */
const markdownHeadingFoldService = foldService.of((state, lineStart, lineEnd) => {
    const line = state.doc.lineAt(lineStart);
    const text = line.text;

    // Check if this line is a heading (starts with one or more #)
    const headingMatch = text.match(/^(#{1,6})\s/);
    if (!headingMatch) {
        return null;
    }

    const headingLevel = headingMatch[1].length;

    // Find the end of this section: next heading of same or higher level, or end of doc
    let foldEnd = state.doc.length;
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
        const nextLine = state.doc.line(i);
        const nextHeadingMatch = nextLine.text.match(/^(#{1,6})\s/);
        if (nextHeadingMatch) {
            const nextLevel = nextHeadingMatch[1].length;
            if (nextLevel <= headingLevel) {
                // End before this heading (don't include the blank line before it)
                foldEnd = nextLine.from - 1;
                break;
            }
        }
    }

    // Only fold if there's content after the heading
    if (foldEnd <= line.to) {
        return null;
    }

    return { from: line.to, to: foldEnd };
});

/**
 * Reformat every GFM table in the document ("Reformat Code" for tables).
 * Replaces only the changed table ranges so the cursor, scroll position and
 * folds survive and the whole operation is a single undo step.
 */
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

/**
 * Replace the table the caret is in with `result.text` and move the caret to
 * `result`'s target cell. Shared by the insert-row / insert-column commands so
 * both are a single, cursor-preserving undo step. Returns false (a no-op) when
 * the caret is not inside a GFM table.
 */
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

/**
 * Insert `block` at the caret as its own block: it replaces the current line
 * when that line is blank, otherwise it is appended after it, separated by a
 * blank line. The caret lands at the end of the inserted block.
 */
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

/**
 * Store a pasted link to another document of this app in its portable form: the URL copied from
 * the address bar carries a domain and a context path, and neither belongs in a document.
 *
 * Only a clipboard holding one bare link is touched — pasting a paragraph, or a link that is
 * already stored, falls through to CodeMirror's own handling untouched.
 */
const storeInternalLinksOnPaste = EditorView.domEventHandlers({
    paste(event, view) {
        const pasted = event.clipboardData?.getData('text/plain')?.trim();
        if (!pasted || /\s/.test(pasted)) return false;
        const stored = toStoredLink(pasted);
        if (stored === pasted) return false;
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(stored));
        return true;
    },
});

export interface CodeMirrorMarkdownEditorRef {
    foldAll: () => void;
    unfoldAll: () => void;
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
}

export interface CodeMirrorMarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    /**
     * Called with the view once it exists, and with null when it goes away. The
     * view is built a render *after* mount, so callers that must react to it
     * cannot simply read the ref in their own effect.
     */
    onViewReady?: (view: EditorView | null) => void;
    style?: React.CSSProperties;
    /**
     * Extensions on top of this editor's own — a plugin's rule about the text it is editing, say.
     * A constant, or memoized: a new value reconfigures the editor.
     */
    extensions?: Extension;
}

/** No extension of one's own, as one value rather than a new array on every render. */
const NO_EXTENSIONS: Extension = [];

export const CodeMirrorMarkdownEditor = forwardRef<CodeMirrorMarkdownEditorRef, CodeMirrorMarkdownEditorProps>(
    ({ value, onChange, onViewReady, style, extensions = NO_EXTENSIONS }, ref) => {
        const editorRef = useRef<ReactCodeMirrorRef>(null);
        const { theme } = useTheme();

        const onViewReadyRef = useRef(onViewReady);
        onViewReadyRef.current = onViewReady;
        useEffect(() => () => onViewReadyRef.current?.(null), []);

        useImperativeHandle(ref, () => ({
            foldAll: () => {
                const view = editorRef.current?.view;
                if (view) {
                    foldAll(view);
                }
            },
            unfoldAll: () => {
                const view = editorRef.current?.view;
                if (view) {
                    unfoldAll(view);
                }
            },
            formatTables: () => {
                const view = editorRef.current?.view;
                if (view) {
                    formatTablesCommand(view);
                }
            },
            insertTable: (rows, cols) => {
                const view = editorRef.current?.view;
                if (view) {
                    insertTableAt(view, rows, cols);
                }
            },
            insertRowBelow: () => {
                const view = editorRef.current?.view;
                if (view) {
                    insertRowBelowCommand(view);
                    view.focus();
                }
            },
            insertColumnRight: () => {
                const view = editorRef.current?.view;
                if (view) {
                    insertColumnRightCommand(view);
                    view.focus();
                }
            },
            insertBlock: (text) => {
                const view = editorRef.current?.view;
                if (view) {
                    insertBlockAt(view, text);
                }
            },
            replaceRange: (from, to, text) => {
                const view = editorRef.current?.view;
                if (!view || to > view.state.doc.length) {
                    return false;
                }
                view.dispatch({ changes: { from, to, insert: text }, userEvent: 'input' });
                return true;
            },
            isCursorInTable: () => {
                const view = editorRef.current?.view;
                if (!view) {
                    return false;
                }
                const line = view.state.doc.lineAt(view.state.selection.main.head);
                return parseTableAt(view.state.doc.toString(), line.number - 1) !== null;
            },
        }));

        const handleChange = useCallback((val: string) => {
            onChange(val);
        }, [onChange]);

        const allExtensions: Extension[] = useMemo(() => [
            extensions,
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            Prec.highest(syntaxHighlighting(customHighlightStyle, { fallback: false })),
            // Shift+Alt+F = "Format Document" (VS Code). Mod+Enter / Mod+Shift+Enter
            // grow the table the caret is in (no-ops elsewhere). Shift+Alt+F avoids
            // the browser's Ctrl+Shift+I DevTools binding.
            Prec.highest(keymap.of([
                { key: 'Shift-Alt-f', preventDefault: true, run: formatTablesCommand },
                { key: 'Mod-Enter', preventDefault: true, run: insertRowBelowCommand },
                { key: 'Mod-Shift-Enter', preventDefault: true, run: insertColumnRightCommand },
            ])),
            // Bold, italic, links and the rest at the keys every editor gives them.
            markdownInlineKeymap,
            markdownHeadingFoldService,
            storeInternalLinksOnPaste,
            EditorView.lineWrapping,
            EditorView.theme({
                '&': {
                    height: '100%',
                    fontSize: '14px',
                },
                '.cm-scroller': {
                    fontFamily: 'monospace',
                    overflow: 'auto',
                },
                '.cm-foldGutter': {
                    width: '16px',
                },
            }),
        ], [extensions]);

        return (
            <div className="markdown-codemirror-editor" style={{ height: '100%', width: '100%' }}>
                <CodeMirror
                    ref={editorRef}
                    value={value}
                    onChange={handleChange}
                    onCreateEditor={(view) => onViewReadyRef.current?.(view)}
                    extensions={allExtensions}
                    theme={themeMode(theme) === 'light' ? vscodeLight : vscodeDark}
                    style={{
                        height: '100%',
                        width: '100%',
                        ...style,
                    }}
                    basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLineGutter: true,
                        highlightActiveLine: true,
                        bracketMatching: true,
                        closeBrackets: true,
                        autocompletion: false,
                        searchKeymap: true,
                    }}
                />
            </div>
        );
    }
);

CodeMirrorMarkdownEditor.displayName = 'CodeMirrorMarkdownEditor';

