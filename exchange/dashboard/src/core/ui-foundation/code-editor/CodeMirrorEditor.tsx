import React, { useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { themeMode } from 'kiao-style';
import { useTheme } from '../theme/ThemeContext';
import './CodeMirrorEditor.css';

export interface CodeMirrorEditorProps {
    value: string;
    onChange?: (value: string) => void;
    /** Called when the editor view is created after the host mounts. */
    onEditor?: (view: EditorView) => void;
    /** Keep extensions stable between renders to avoid reconfiguring the editor. */
    extensions?: Extension;
    className?: string;
    style?: React.CSSProperties;
    height?: string;
    minHeight?: string;
    maxHeight?: string;
    placeholder?: string;
    autoFocus?: boolean;
    readOnly?: boolean;
    lineNumbers?: boolean;
    brackets?: boolean;
    autocompletion?: boolean;
}

const surface = [
    EditorView.lineWrapping,
    EditorView.theme({
        '&': { fontSize: '14px' },
        '.cm-scroller': { fontFamily: 'monospace', overflow: 'auto' },
    }),
];

export function CodeMirrorEditor({
    onChange, onEditor, extensions, className, style, height = '100%',
    lineNumbers = true, brackets = true, autocompletion = false, ...props
}: CodeMirrorEditorProps) {
    const { theme } = useTheme();
    const handleChange = useCallback((value: string) => onChange?.(value), [onChange]);
    const editorExtensions = useMemo(() => extensions ? [extensions, surface] : surface, [extensions]);
    const basicSetup = useMemo(() => ({
        lineNumbers,
        foldGutter: lineNumbers,
        highlightActiveLineGutter: lineNumbers,
        highlightActiveLine: lineNumbers,
        bracketMatching: brackets,
        closeBrackets: brackets,
        autocompletion,
    }), [lineNumbers, brackets, autocompletion]);

    return (
        <CodeMirror
            {...props}
            className={className ? `codemirror-editor ${className}` : 'codemirror-editor'}
            height={height}
            style={{ height, ...style }}
            onChange={onChange && handleChange}
            onCreateEditor={onEditor && (view => onEditor(view))}
            extensions={editorExtensions}
            basicSetup={basicSetup}
            theme={themeMode(theme) === 'light' ? vscodeLight : vscodeDark}
        />
    );
}
