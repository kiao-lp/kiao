import React from 'react';
import { CodeMirrorJsonEditor } from '@cms-kit/code-editor';

export interface GraphCodeEditorProps {
    value: string;
    onChange?: (value: string) => void;
}

export const GraphCodeEditor: React.FC<GraphCodeEditorProps> = ({ value, onChange }) => (
    <div className="graph-code-editor">
        <CodeMirrorJsonEditor
            value={value}
            onChange={value => onChange?.(value)}
        />
    </div>
);
