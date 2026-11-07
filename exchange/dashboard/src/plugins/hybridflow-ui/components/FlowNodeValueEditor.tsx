import React from 'react';
import { EditorView } from '@codemirror/view';
import { CodeMirrorJsonEditor, type JsonSchema } from '@cms-kit/code-editor';
import styles from '../Hybridflow.module.css';

const extensions = [EditorView.contentAttributes.of({ 'aria-label': 'Value JSON' })];

export const FlowNodeValueEditor: React.FC<{
    value: string;
    onChange: (next: string) => void;
    error: string;
    testId: string;
    schema?: JsonSchema;
}> = ({ value, onChange, error, testId, schema }) => (
    <>
        <div className={styles.panelEditor} data-testid={testId}>
            <CodeMirrorJsonEditor value={value} onChange={onChange} extensions={extensions} schema={schema} />
        </div>
        {error && <div role="alert" data-testid="flow-node-value-error">{error}</div>}
    </>
);
