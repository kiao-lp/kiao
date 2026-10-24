import React, { useCallback, useMemo, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { themeMode } from 'kiao-style';
import { useTheme } from '../../../ThemeContext';
import './CodeMirrorTextEditor.css';

export interface CodeMirrorTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    style?: React.CSSProperties;
    placeholder?: string;
    autoFocus?: boolean;
    /**
     * The editor, handed over once CodeMirror has made one. A pane that has to put the caret in
     * this box itself — rather than wait for a click in it — needs the moment it comes into
     * being, which is a tick after the pane holding it is on screen.
     */
    onEditor?: (view: EditorView) => void;
    /**
     * Extensions on top of this editor's own — a plugin's rule about the text it is editing, say.
     * A constant, or memoized: a new value reconfigures the editor.
     */
    extensions?: Extension;
}

/** No extension of one's own, as one value rather than a new array on every render. */
const NO_EXTENSIONS: Extension = [];

export const CodeMirrorTextEditor: React.FC<CodeMirrorTextEditorProps> = ({
    value, onChange, style, placeholder, autoFocus, onEditor,
    extensions = NO_EXTENSIONS,
}) => {
    const editorRef = useRef<ReactCodeMirrorRef>(null);
    const { theme } = useTheme();

    const handleChange = useCallback((val: string) => {
        onChange(val);
    }, [onChange]);

    const handleCreate = useCallback((created: EditorView) => {
        onEditor?.(created);
    }, [onEditor]);

    const allExtensions: Extension[] = useMemo(() => [
        extensions,
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
        }),
    ], [extensions]);

    return (
        <div className="text-codemirror-editor" style={{ height: '100%', width: '100%' }}>
            <CodeMirror
                ref={editorRef}
                value={value}
                onChange={handleChange}
                onCreateEditor={handleCreate}
                extensions={allExtensions}
                placeholder={placeholder}
                autoFocus={autoFocus}
                theme={themeMode(theme) === 'light' ? vscodeLight : vscodeDark}
                style={{
                    height: '100%',
                    width: '100%',
                    ...style,
                }}
                basicSetup={{
                    lineNumbers: false,
                    foldGutter: false,
                    highlightActiveLineGutter: false,
                    highlightActiveLine: false,
                    bracketMatching: false,
                    closeBrackets: false,
                    autocompletion: false,
                    searchKeymap: true,
                }}
            />
        </div>
    );
};

CodeMirrorTextEditor.displayName = 'CodeMirrorTextEditor';
