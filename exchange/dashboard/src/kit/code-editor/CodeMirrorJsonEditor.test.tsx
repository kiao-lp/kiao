import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { diagnosticCount, forceLinting } from '@codemirror/lint';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { CodeMirrorJsonEditor } from './CodeMirrorJsonEditor';
import { JSON_SCHEMA_META_SCHEMA, type JsonSchema } from './jsonSchemaSupport';

vi.mock('@cms-core', () => ({ useTheme: () => ({ theme: 'dark' }) }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('shared JSON editor', () => {
    it.each([
        ['{"type":""}', 9, '"string"'],
        ['{"ty"}', 4, 'type'],
    ] as const)('offers completion inside %s', async (value, position, label) => {
        vi.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation(() => {});
        let view: EditorView | undefined;
        render(<CodeMirrorJsonEditor
            value={value}
            onChange={vi.fn()}
            onEditor={editor => { view = editor; }}
            schema={JSON_SCHEMA_META_SCHEMA}
        />);
        await waitFor(() => expect(view).toBeDefined());
        view!.dispatch({ selection: { anchor: position } });
        startCompletion(view!);
        await waitFor(() => expect(currentCompletions(view!.state).map(item => item.displayLabel ?? item.label)).toContain(label));
    });

    it('can edit a field and revalidate unchanged text when its schema changes', async () => {
        vi.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation(() => {});
        let view: EditorView | undefined;
        const schema: JsonSchema = { type: 'object', properties: { mode: { const: 'draft' } } };
        const props = {
            value: '{"mode":"draft"}',
            onChange: vi.fn(),
            onEditor: (editor: EditorView) => { view = editor; },
            height: 'auto',
            minHeight: '80px',
            maxHeight: '240px',
            lineNumbers: false,
        };
        const { container, rerender } = render(<CodeMirrorJsonEditor {...props} schema={schema} />);
        await waitFor(() => expect(view).toBeDefined());
        expect(container.querySelector('.cm-lineNumbers')).toBeNull();
        expect(container.querySelector('.code-codemirror-editor')).toHaveStyle({ height: 'auto' });
        forceLinting(view!);
        await waitFor(() => expect(diagnosticCount(view!.state)).toBe(0));

        rerender(<CodeMirrorJsonEditor {...props} schema={{ type: 'object', properties: { mode: { const: 'ready' } } }} />);
        await waitFor(() => {
            forceLinting(view!);
            expect(diagnosticCount(view!.state)).toBeGreaterThan(0);
        });
        expect(view!.state.doc.toString()).toBe(props.value);
        expect(props.onChange).not.toHaveBeenCalled();
    });
});
