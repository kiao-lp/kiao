import React from 'react';
import { CodeMirrorEditor, type CodeMirrorEditorProps } from './CodeMirrorEditor';

export interface CodeMirrorTextEditorProps extends Pick<CodeMirrorEditorProps,
    'value' | 'style' | 'placeholder' | 'autoFocus' | 'onEditor' | 'extensions'> {
    onChange: (value: string) => void;
}

export function CodeMirrorTextEditor(props: CodeMirrorTextEditorProps) {
    return (
        <CodeMirrorEditor
            {...props}
            className="text-codemirror-editor"
            lineNumbers={false}
            brackets={false}
        />
    );
}
