import React, { forwardRef, useImperativeHandle, useRef, useCallback, useMemo, useEffect, useState } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { themeMode } from 'kiao-style';
import { useTheme } from '../theme/ThemeContext';
import './CodeMirrorCodeEditor.css';

export interface CodeMirrorCodeEditorRef {
}

export interface CodeMirrorCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    style?: React.CSSProperties;
    /** Picks the highlighting language. */
    path?: string;
    /** Appended after the resolved language. */
    extensions?: Extension[];
    height?: string;
    minHeight?: string;
    maxHeight?: string;
    lineNumbers?: boolean;
    placeholder?: string;
    readOnly?: boolean;
    autoFocus?: boolean;
    onEditor?: (view: EditorView) => void;
}

export const CodeMirrorCodeEditor = forwardRef<CodeMirrorCodeEditorRef, CodeMirrorCodeEditorProps>(
    ({ value, onChange, style, path, extensions: extraExtensions, height = '100%',
        minHeight, maxHeight, lineNumbers = true, placeholder, readOnly, autoFocus, onEditor }, ref) => {
        const editorRef = useRef<ReactCodeMirrorRef>(null);
        const { theme } = useTheme();
        const [langExt, setLangExt] = useState<Extension[]>(() => path ? [] : [json()]);

        useImperativeHandle(ref, () => ({
        }));

        const handleChange = useCallback((val: string) => {
            onChange(val);
        }, [onChange]);

        // `.gitignore` and Go module files have no language and open as plain text.
        useEffect(() => {
            if (!path) {
                setLangExt([json()]);
                return;
            }
            let cancelled = false;
            setLangExt([]);
            const fileName = path.split('/').pop() || path;
            // matchFilename is case-sensitive; extensions are claimed case-insensitively.
            const desc = LanguageDescription.matchFilename(languages, fileName.toLowerCase());
            if (!desc) return () => { cancelled = true; };
            desc.load().then(support => {
                if (!cancelled) setLangExt([support]);
            }).catch(() => {
                if (!cancelled) setLangExt([]);
            });
            return () => { cancelled = true; };
        }, [path]);

        const extensions: Extension[] = useMemo(() => [
            ...langExt,
            ...(extraExtensions ?? []),
            EditorView.lineWrapping,
            EditorView.theme({
                '&': {
                    fontSize: '14px',
                },
                '.cm-scroller': {
                    fontFamily: 'monospace',
                    overflow: 'auto',
                },
            }),
        ], [langExt, extraExtensions]);

        return (
            <div className="code-codemirror-editor" style={{ height, width: '100%' }}>
                <CodeMirror
                    ref={editorRef}
                    value={value}
                    onChange={handleChange}
                    onCreateEditor={onEditor}
                    extensions={extensions}
                    height={height}
                    minHeight={minHeight}
                    maxHeight={maxHeight}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    autoFocus={autoFocus}
                    theme={themeMode(theme) === 'light' ? vscodeLight : vscodeDark}
                    style={{
                        height,
                        width: '100%',
                        ...style,
                    }}
                    basicSetup={{
                        lineNumbers,
                        foldGutter: lineNumbers,
                        highlightActiveLineGutter: lineNumbers,
                        highlightActiveLine: lineNumbers,
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

CodeMirrorCodeEditor.displayName = 'CodeMirrorCodeEditor';
