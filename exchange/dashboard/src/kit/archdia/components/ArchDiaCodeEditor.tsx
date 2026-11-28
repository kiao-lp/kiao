import React from 'react';
import { CodeMirrorEditor } from '@kiao-dashboard-core';
import { markdownSourceLanguage } from '../../markdown/sourceLanguage';

export interface ArchDiaCodeEditorProps {
    value: string;
    onChange?: (value: string) => void;
}

export function ArchDiaCodeEditor(props: ArchDiaCodeEditorProps) {
    return (
        <CodeMirrorEditor
            {...props}
            className="archdia-code-editor"
            extensions={markdownSourceLanguage}
            autocompletion
        />
    );
}
