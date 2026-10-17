import React, { forwardRef, useImperativeHandle, useRef, useCallback, useMemo, useEffect, useState } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { themeMode } from 'kiao-style';
import { useCodeMirrorScrollMemory, useTheme } from '@cms-core';
import './CodeMirrorCodeEditor.css';

export interface CodeMirrorCodeEditorRef {
    // Placeholder for future methods
}

export interface CodeMirrorCodeEditorProps {
    value: string;
    onChange: (value: string) => void;
    style?: React.CSSProperties;
    /** File path used to pick a syntax-highlighting language (e.g. "scripts/deploy.sh"). */
    path?: string;
    /** Extra CodeMirror extensions appended after the resolved language. */
    extensions?: Extension[];
}

export const CodeMirrorCodeEditor = forwardRef<CodeMirrorCodeEditorRef, CodeMirrorCodeEditorProps>(
    ({ value, onChange, style, path, extensions: extraExtensions }, ref) => {
        const editorRef = useRef<ReactCodeMirrorRef>(null);
        const { theme } = useTheme();
        const [view, setView] = useState<EditorView | null>(null);
        useCodeMirrorScrollMemory(view, 'code');
        // Without a path (e.g. when reused as a plain JSON editor) default to JSON.
        const [langExt, setLangExt] = useState<Extension[]>(() => path ? [] : [json()]);

        useImperativeHandle(ref, () => ({
        }));

        const handleChange = useCallback((val: string) => {
            onChange(val);
        }, [onChange]);

        // Resolve a CodeMirror language from the file name. `@codemirror/language-data` knows
        // every extension code-edit claims (.json, .sh/.bash, .ts/.tsx, .js/.jsx, .java, .rs,
        // .go) but `.gitignore` and the Go module files, which open as plain text — all
        // their syntax asks for.
        useEffect(() => {
            if (!path) {
                setLangExt([json()]);
                return;
            }
            let cancelled = false;
            setLangExt([]);
            const fileName = path.split('/').pop() || path;
            // The plugin claims extensions case-insensitively, so match the
            // language data the same way (matchFilename itself is case-sensitive).
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
                    height: '100%',
                    fontSize: '14px',
                },
                '.cm-scroller': {
                    fontFamily: 'monospace',
                    overflow: 'auto',
                },
            }),
        ], [langExt, extraExtensions]);

        return (
            <div className="code-codemirror-editor" style={{ height: '100%', width: '100%' }}>
                <CodeMirror
                    ref={editorRef}
                    value={value}
                    onChange={handleChange}
                    onCreateEditor={setView}
                    extensions={extensions}
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

CodeMirrorCodeEditor.displayName = 'CodeMirrorCodeEditor';
