import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';
import { basicSetup } from '@uiw/react-codemirror';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { themeMode } from 'kiao-style';
import { useTheme } from '../../../ThemeContext';
import './TextComparison.css';

export interface TextComparisonNavigation {
    /** Zero-based change index, or -1 before navigating. */
    index: number;
    count: number;
}

export interface TextComparisonHandle {
    previousChange: () => void;
    nextChange: () => void;
}

export interface TextComparisonProps {
    original: string;
    modified: string;
    originalReadOnly?: boolean;
    modifiedReadOnly?: boolean;
    onOriginalChange?: (text: string) => void;
    onModifiedChange?: (text: string) => void;
    originalLabel?: React.ReactNode;
    modifiedLabel?: React.ReactNode;
    originalAriaLabel?: string;
    modifiedAriaLabel?: string;
    extensions?: Extension;
    onNavigationChange?: (navigation: TextComparisonNavigation) => void;
}

const externalChange = Annotation.define<boolean>();
const NO_EXTENSIONS: Extension = [];
const editorTheme = EditorView.theme({
    '&': { fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'monospace' },
});

/** Live comparison with a shared vertical scroller. F7 / Shift+F7 cycle through changes. */
export const TextComparison = forwardRef<TextComparisonHandle, TextComparisonProps>(({
    original, modified,
    originalReadOnly = true, modifiedReadOnly = true,
    onOriginalChange, onModifiedChange,
    originalLabel = 'Original', modifiedLabel = 'Modified',
    originalAriaLabel = 'Original text', modifiedAriaLabel = 'Modified text',
    extensions = NO_EXTENSIONS, onNavigationChange,
}, ref) => {
    const host = useRef<HTMLDivElement>(null);
    const merge = useRef<MergeView | null>(null);
    const configuration = useMemo(() => new Compartment(), []);
    const { theme } = useTheme();
    const callbacks = useRef({ onOriginalChange, onModifiedChange });
    callbacks.current = { onOriginalChange, onModifiedChange };
    const index = useRef(-1);
    const [navigation, setNavigation] = useState<TextComparisonNavigation>({ index: -1, count: 0 });

    const resetNavigation = useCallback(() => {
        index.current = -1;
        setNavigation({ index: -1, count: merge.current?.chunks.length ?? 0 });
    }, []);

    const step = useCallback((direction: 1 | -1) => {
        const view = merge.current;
        if (!view || !view.chunks.length) return;
        const count = view.chunks.length;
        const next = index.current < 0 ? (direction === 1 ? 0 : count - 1) : index.current + direction;
        index.current = (next + count) % count;
        const chunk = view.chunks[index.current];
        setNavigation({ index: index.current, count });
        for (const [editor, from, to] of [
            [view.a, chunk.fromA, chunk.endA],
            [view.b, chunk.fromB, chunk.endB],
        ] as const) {
            editor.dispatch({
                selection: { anchor: Math.min(from, editor.state.doc.length), head: Math.min(to, editor.state.doc.length) },
            });
        }
        const editor = chunk.fromA < chunk.toA ? view.a : view.b;
        const from = editor === view.a ? chunk.fromA : chunk.fromB;
        editor.dispatch({
            effects: EditorView.scrollIntoView(Math.min(from, editor.state.doc.length), {
                y: 'start', yMargin: editor.defaultLineHeight * 3,
            }),
        });
    }, []);

    useImperativeHandle(ref, () => ({
        previousChange: () => step(-1),
        nextChange: () => step(1),
    }), [step]);

    useEffect(() => {
        onNavigationChange?.(navigation);
    }, [navigation, onNavigationChange]);

    const paneExtensions = useCallback((readOnly: boolean, label: string): Extension => [
        basicSetup({
            foldGutter: !readOnly,
            highlightActiveLine: !readOnly,
            highlightActiveLineGutter: !readOnly,
            autocompletion: false,
        }),
        themeMode(theme) === 'light' ? vscodeLight : vscodeDark,
        EditorView.lineWrapping,
        editorTheme,
        extensions,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': String(readOnly), tabindex: '0' }),
    ], [theme, extensions]);

    const originalExtensions = useMemo(() => paneExtensions(originalReadOnly, originalAriaLabel),
        [paneExtensions, originalReadOnly, originalAriaLabel]);
    const modifiedExtensions = useMemo(() => paneExtensions(modifiedReadOnly, modifiedAriaLabel),
        [paneExtensions, modifiedReadOnly, modifiedAriaLabel]);

    useEffect(() => {
        if (!host.current) return;
        const listener = (side: 'a' | 'b') => EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            resetNavigation();
            if (update.transactions.some(transaction => transaction.annotation(externalChange))) return;
            const onChange = side === 'a' ? callbacks.current.onOriginalChange : callbacks.current.onModifiedChange;
            onChange?.(update.state.doc.toString());
        });
        const view = new MergeView({
            parent: host.current,
            a: { doc: original, extensions: [configuration.of(originalExtensions), listener('a')] },
            b: { doc: modified, extensions: [configuration.of(modifiedExtensions), listener('b')] },
            highlightChanges: true,
            gutter: true,
        });
        merge.current = view;
        resetNavigation();
        return () => {
            merge.current = null;
            view.destroy();
            view.dom.remove();
        };
        // Documents and configuration update through transactions to preserve selection and undo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configuration, resetNavigation]);

    useEffect(() => {
        const view = merge.current;
        if (!view) return;
        view.a.dispatch({ effects: configuration.reconfigure(originalExtensions) });
        view.b.dispatch({ effects: configuration.reconfigure(modifiedExtensions) });
    }, [configuration, originalExtensions, modifiedExtensions]);

    useEffect(() => {
        const view = merge.current;
        if (!view) return;
        for (const [editor, text] of [[view.a, original], [view.b, modified]] as const) {
            const doc = editor.state.toText(text);
            if (doc.eq(editor.state.doc)) continue;
            editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: doc },
                annotations: externalChange.of(true),
            });
        }
    }, [original, modified]);

    return (
        <div className="text-comparison" onKeyDown={event => {
            if (event.key !== 'F7' || event.ctrlKey || event.altKey || event.metaKey) return;
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
        }}>
            <div className="text-comparison-labels">
                <div>{originalLabel}</div>
                <div>{modifiedLabel}</div>
            </div>
            <div className="text-comparison-editors" ref={host} />
        </div>
    );
});

TextComparison.displayName = 'TextComparison';
