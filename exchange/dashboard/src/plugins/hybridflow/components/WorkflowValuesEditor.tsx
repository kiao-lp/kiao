import React, { useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { CodeMirrorJsonEditor, type JsonSchema } from '@kiao-dashboard-kit/code-editor';
import { useHybridflow } from '../Hybridflow-ctx';
import type { Workflow } from '../boardContent';
import { useDraftWriter } from '../useDraftWriter';
import { diffWorkflowValues, equalWorkflowValues, parseWorkflowValues, type WorkflowValues } from '../workflowValues';
import styles from '../Hybridflow.module.css';

const emptyValues: WorkflowValues = {};
const schema: JsonSchema = { type: 'object' };
const extensions = [EditorView.contentAttributes.of({ 'aria-label': 'Workflow values (JSON)' })];

interface Draft {
    text: string;
    error?: string;
    savedValues?: WorkflowValues;
}

interface ValuesEdit {
    workflowId: string;
    draft: Draft;
    values: WorkflowValues;
}

export const WorkflowValuesEditor: React.FC<{ workflow: Workflow }> = ({ workflow }) => {
    const { editWorkflowValues } = useHybridflow();
    const values = workflow.values ?? emptyValues;
    const [draft, setDraft] = useState<Draft | null>(null);
    // Diff against the values the editor showed when editing began, including its own saves.
    const baseline = useRef(values);
    const writer = useDraftWriter<{ edit: ValuesEdit }>(async ({ edit }) => {
        const patch = diffWorkflowValues(baseline.current, edit.values);
        const saved = !patch || await editWorkflowValues(edit.workflowId, patch);
        if (saved) baseline.current = edit.values;
        setDraft(current => {
            if (current !== edit.draft) return current;
            return saved
                ? { text: current.text, savedValues: edit.values }
                : { text: current.text, error: 'Workflow values could not be saved.' };
        });
    }, cause => {
        setDraft(current => current && { ...current, error: String(cause) });
    });

    const onChange = (text: string) => {
        if (!draft || draft.savedValues) baseline.current = values;
        const parsed = parseWorkflowValues(text);
        if ('error' in parsed) {
            writer.discard('edit');
            setDraft({ text, error: parsed.error });
            return;
        }
        const next = { text };
        setDraft(next);
        writer.schedule({ edit: { workflowId: workflow.id, draft: next, values: parsed.values } });
    };

    const showDraft = draft && (!draft.savedValues || equalWorkflowValues(draft.savedValues, values));
    return (
        <section className={styles.workflowSection} aria-label="Shared values">
            <div>Shared values</div>
            <div className={styles.panelEditor}>
                <CodeMirrorJsonEditor
                    value={showDraft ? draft.text : JSON.stringify(values, null, 2)}
                    onChange={onChange}
                    schema={schema}
                    extensions={extensions}
                />
            </div>
            {draft?.error && <div role="alert">{draft.error}</div>}
        </section>
    );
};
