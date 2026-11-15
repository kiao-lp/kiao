import { describe, expect, it } from 'vitest';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createJsonSchemaSupport, JSON_SCHEMA_META_SCHEMA, type JsonSchema } from './jsonSchemaSupport';

const stateFor = (doc: string) => EditorState.create({ doc, extensions: [json()] });
const meta = () => createJsonSchemaSupport(JSON_SCHEMA_META_SCHEMA);

async function suggestions(doc: string, position: number, schema: JsonSchema = JSON_SCHEMA_META_SCHEMA) {
    const state = stateFor(doc);
    const result = await createJsonSchemaSupport(schema).complete(new CompletionContext(state, position, true));
    expect(result).not.toBeNull();
    return { state, result: result! };
}

function accept(state: EditorState, result: CompletionResult, label: string) {
    const option = result.options.find(item => (item.displayLabel ?? item.label) === label);
    expect(option, `completion ${label}`).toBeDefined();
    const view = new EditorView({ state, parent: document.createElement('div') });
    try {
        if (typeof option!.apply === 'function') {
            option!.apply(view, option!, result.from, result.to ?? state.doc.length);
        } else {
            view.dispatch({ changes: { from: result.from, to: result.to, insert: option!.apply ?? option!.label } });
        }
        return { text: view.state.doc.toString(), selection: view.state.selection.main };
    } finally {
        view.destroy();
    }
}

describe('JSON Schema assistance', () => {
    it.each([
        '{}', 'true', 'false',
        '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
        '{"prefixItems":[{"type":"string"}],"items":false}',
        '{"$defs":{"node":{"type":"object","properties":{"next":{"$ref":"#/$defs/node"}}}}}',
    ])('accepts the valid schema %s', async doc => {
        expect(await meta().validate(stateFor(doc))).toEqual([]);
    });

    it.each([
        '{"type":"strng"}',
        '{"properties":{"name":{"type":42}}}',
        '{"required":"name"}',
        '{"minLength":-1}',
        '{"items":[{"type":"string"}]}',
        '42',
    ])('reports schema errors in %s', async doc => {
        expect(await meta().validate(stateFor(doc))).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'error' }),
        ]));
    });

    it('reports JSON syntax errors, comments and trailing commas', async () => {
        for (const doc of ['{"type": }', '{/* comment */}', '{"type":"string",}']) {
            const errors = await meta().validate(stateFor(doc));
            expect(errors.some(item => item.severity === 'error')).toBe(true);
        }
    });

    it('maps diagnostic ranges to the invalid value', async () => {
        const doc = '{\n  "properties": {"name": {"type": "strng"}}\n}';
        const [error] = await meta().validate(stateFor(doc));
        expect(doc.slice(error.from, error.to)).toBe('"strng"');
    });

    it('honours the meta-schema declared in $schema', async () => {
        const doc = '{"$schema":"https://json-schema.org/draft-07/schema#","items":[{"type":"string"}]}';
        expect(await meta().validate(stateFor(doc))).toEqual([]);
    });

    it('offers keywords at the root and in nested schemas', async () => {
        for (const [doc, position] of [['{}', 1], ['{"properties":{"name":{}}}', 23]] as const) {
            const { result } = await suggestions(doc, position);
            expect(result.options.map(item => item.displayLabel ?? item.label)).toEqual(expect.arrayContaining(['type', 'properties', 'required']));
        }
    });

    it('offers valid types and replaces the whole quoted value', async () => {
        const doc = '{"type":"strng"}';
        const { state, result } = await suggestions(doc, doc.indexOf('strng') + 3);
        expect(result.options.map(item => item.label)).toContain('"string"');
        expect(accept(state, result, '"string"').text).toBe('{"type":"string"}');
    });

    it('refreshes completion after the document changes', async () => {
        const support = meta();
        const root = stateFor('{}');
        await support.complete(new CompletionContext(root, 1, true));
        const value = stateFor('{"type":""}');
        const result = await support.complete(new CompletionContext(value, 9, true));
        expect(result?.options.map(item => item.label)).toContain('"string"');
    });

    it('inserts property snippets without LSP escapes or placeholders', async () => {
        const { state, result } = await suggestions('{}', 1);
        expect(accept(state, result, '$id').text).toBe('{"$id": ""}');
        const properties = accept(state, result, 'properties');
        expect(JSON.parse(properties.text)).toEqual({ properties: {} });
        expect(properties.text[properties.selection.from - 1]).toBe('{');
    });

    it('uses a custom schema for validation, enum and const completion', async () => {
        const schema: JsonSchema = {
            type: 'object',
            properties: {
                status: { enum: ['draft', 'ready'] },
                version: { const: 1 },
            },
            required: ['status'],
            additionalProperties: false,
        };
        const support = createJsonSchemaSupport(schema);
        expect(await support.validate(stateFor('{"status":"ready","version":1}'))).toEqual([]);
        expect((await support.validate(stateFor('{"status":"unknown"}'))).length).toBeGreaterThan(0);
        expect((await support.validate(stateFor('{}'))).length).toBeGreaterThan(0);
        const { result } = await suggestions('{"status":""}', 11, schema);
        expect(result.options.map(item => item.label)).toEqual(expect.arrayContaining(['"draft"', '"ready"']));
        const version = await suggestions('{"version": }', 12, schema);
        expect(accept(version.state, version.result, '1').text).toBe('{"version": 1}');
    });

    it('preserves literal dollars, backslashes and braces in proposed values', async () => {
        const value = '$1 ${literal} C:\\folder\\file }';
        const { state, result } = await suggestions('{"value":""}', 10, {
            properties: { value: { enum: [value, 'other'] } },
        });
        expect(JSON.parse(accept(state, result, JSON.stringify(value)).text)).toEqual({ value });
    });

    it('inserts a property whose const value contains literal snippet characters', async () => {
        const value = '$1 ${literal} C:\\folder\\file }';
        const { state, result } = await suggestions('{}', 1, {
            properties: { template: { const: value } },
        });
        expect(JSON.parse(accept(state, result, 'template').text)).toEqual({ template: value });
    });

    it('supports boolean schemas and keeps editor schemas isolated', async () => {
        const allowed = createJsonSchemaSupport(true);
        const forbidden = createJsonSchemaSupport(false);
        expect(await allowed.validate(stateFor('42'))).toEqual([]);
        expect((await forbidden.validate(stateFor('42'))).length).toBeGreaterThan(0);
        expect(await allowed.validate(stateFor('42'))).toEqual([]);
    });

    it('resolves local references in custom schemas for validation and completion', async () => {
        const schema: JsonSchema = {
            $defs: { status: { enum: ['draft', 'ready'] } },
            properties: { status: { $ref: '#/$defs/status' } },
        };
        const support = createJsonSchemaSupport(schema);
        expect(await support.validate(stateFor('{"status":"ready"}'))).toEqual([]);
        expect((await support.validate(stateFor('{"status":"unknown"}'))).length).toBeGreaterThan(0);
        const { result } = await suggestions('{"status":""}', 11, schema);
        expect(result.options.map(item => item.label)).toEqual(expect.arrayContaining(['"draft"', '"ready"']));
    });

    it('reports unresolved schema declarations instead of silently validating without them', async () => {
        const errors = await meta().validate(stateFor('{"$schema":"https://example.com/custom-schema"}'));
        expect(errors).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'warning', message: expect.stringContaining('Unable to load schema') }),
        ]));
    });
});
