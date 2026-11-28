import React, { forwardRef, useImperativeHandle, useMemo, useEffect, useState } from 'react';
import { json } from '@codemirror/lang-json';
import type { Extension } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { CodeMirrorEditor, type CodeMirrorEditorProps } from './CodeMirrorEditor';

// CodeMirror's Shell mode also covers these extensions outside its filename registry.
const extraShellExtensions = /\.(ash|dash|zsh)$/;
const plainText: Extension = [];
const jsonLanguage = json();

export interface CodeMirrorCodeEditorRef {
}

export interface CodeMirrorCodeEditorProps extends Omit<CodeMirrorEditorProps,
    'className' | 'brackets' | 'autocompletion' | 'extensions'> {
    onChange: (value: string) => void;
    /** Picks the highlighting language. */
    path?: string;
    /** Appended after the resolved language. */
    extensions?: Extension[];
}

export const CodeMirrorCodeEditor = forwardRef<CodeMirrorCodeEditorRef, CodeMirrorCodeEditorProps>(
    ({ path, extensions, ...props }, ref) => {
        const [fileLanguage, setFileLanguage] = useState<Extension>(plainText);

        useImperativeHandle(ref, () => ({}), []);

        useEffect(() => {
            setFileLanguage(plainText);
            if (!path) return;

            // matchFilename is case-sensitive; extensions are claimed case-insensitively.
            const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
            const description = LanguageDescription.matchFilename(languages, name)
                ?? (extraShellExtensions.test(name)
                    ? LanguageDescription.matchLanguageName(languages, 'Shell', false)
                    : null);
            if (!description) return;

            let cancelled = false;
            description.load().then(support => {
                if (!cancelled) setFileLanguage(support);
            }).catch(() => {
                if (!cancelled) setFileLanguage(plainText);
            });
            return () => { cancelled = true; };
        }, [path]);

        const language = path ? fileLanguage : jsonLanguage;
        const editorExtensions = useMemo(() => [language, extensions ?? plainText], [language, extensions]);

        return <CodeMirrorEditor {...props} className="code-codemirror-editor" extensions={editorExtensions} />;
    },
);

CodeMirrorCodeEditor.displayName = 'CodeMirrorCodeEditor';
