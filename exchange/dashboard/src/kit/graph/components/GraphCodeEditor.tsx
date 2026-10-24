/**
 * CodeMirror-based JSON editor for .graph.json files.
 */

import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { EditorView } from '@codemirror/view';

export interface GraphCodeEditorProps {
    value: string;
    onChange?: (value: string) => void;
}

export const GraphCodeEditor: React.FC<GraphCodeEditorProps> = ({ value, onChange }) => (
    <div className="graph-code-editor">
        <CodeMirror
            value={value}
            extensions={[json(), EditorView.lineWrapping]}
            theme={vscodeDark}
            onChange={onChange}
            height="100%"
            style={{ height: '100%' }}
        />
    </div>
);
