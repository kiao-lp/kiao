import { describe, expect, it } from 'vitest';
import { BoardContent, FlowNode, readBoardContent, writeBoardContent } from './boardContent';
import { removeFlowNodes } from './boardOps';
import { noSuccess } from './flowNodeSuccess';
import { readValueType, resolvedValueSchema, schemaValues, valueTypeOptions } from './valueType';

const SCHEMA_ID = '11111111-1111-1111-1111-111111111111';
const TYPED_ID = '22222222-2222-2222-2222-222222222222';

const node = (over: Partial<FlowNode>): FlowNode => ({
    id: 'x', title: 'X', type: 'value', note: '', value: {}, valueType: '', tags: [], body: '',
    criteria: [], complexity: null, settings: {}, at: '', spot: null, status: 'ready',
    archived: false, chat: '', onSuccess: noSuccess(), classVersion: null, workflow: '', ...over,
});

const board = (...flowNodes: FlowNode[]): BoardContent => ({
    flowNodes, flowNodeClasses: [], workflows: [], workflowClasses: [],
});

describe('readValueType', () => {
    it('keeps empty, json-schema and ids; drops other words', () => {
        expect(readValueType('')).toBe('');
        expect(readValueType(' json-schema ')).toBe('json-schema');
        expect(readValueType(SCHEMA_ID)).toBe(SCHEMA_ID);
        expect(readValueType('yaml')).toBe('');
        expect(readValueType(3)).toBe('');
    });
});

describe('value type options', () => {
    const schema = node({ id: SCHEMA_ID, title: 'Person', valueType: 'json-schema', value: { type: 'object' } });
    const plain = node({ id: TYPED_ID, title: 'Ada' });
    const content = board(schema, plain, node({ id: 'a3', title: 'Old', valueType: 'json-schema', archived: true }));

    it('offers no type, JSON Schema and saved schema values only', () => {
        expect(valueTypeOptions(content, TYPED_ID, '')).toEqual([
            { value: '', label: 'No type' },
            { value: 'json-schema', label: 'JSON Schema' },
            { value: SCHEMA_ID, label: 'Person' },
        ]);
        expect(schemaValues(content, SCHEMA_ID)).toEqual([]);
    });

    it('keeps a dangling current type visible', () => {
        const options = valueTypeOptions(content, TYPED_ID, '99999999-9999-9999-9999-999999999999');
        expect(options.at(-1)).toEqual({
            value: '99999999-9999-9999-9999-999999999999', label: 'A value that has left the board',
        });
    });
});

describe('board codec', () => {
    it('round-trips valueType on value cards and drops it elsewhere', () => {
        const content = readBoardContent({
            flowNodes: [
                { id: SCHEMA_ID, type: 'value', title: 'Person', value: {}, valueType: 'json-schema' },
                { id: TYPED_ID, type: 'ai', title: 'Task', valueType: SCHEMA_ID },
            ],
        });
        expect(content.flowNodes[0].valueType).toBe('json-schema');
        expect(content.flowNodes[1].valueType).toBe('');
        expect(writeBoardContent(content)).toMatchObject({
            flowNodes: [{ valueType: 'json-schema' }, {}],
        });
    });

    it('clears the type of values typed by a removed schema value', () => {
        const schema = node({ id: SCHEMA_ID, valueType: 'json-schema' });
        const typed = node({ id: TYPED_ID, valueType: SCHEMA_ID });
        const after = removeFlowNodes(board(schema, typed), [SCHEMA_ID]);
        expect(after?.flowNodes).toEqual([expect.objectContaining({ id: TYPED_ID, valueType: '' })]);
    });
});

describe('resolvedValueSchema', () => {
    const schema = node({ id: SCHEMA_ID, valueType: 'json-schema', value: { type: 'object', required: ['name'] } });
    const content = board(schema);

    it('returns the meta-schema for a JSON Schema value', () => {
        expect(resolvedValueSchema(content, schema)).toEqual({ $ref: 'https://json-schema.org/draft/2020-12/schema' });
    });

    it('returns the schema value content for a typed value', () => {
        const typed = node({ id: TYPED_ID, valueType: SCHEMA_ID });
        expect(resolvedValueSchema(board(schema, typed), typed)).toEqual({ type: 'object', required: ['name'] });
    });

    it('returns nothing for untyped, dangling or non-object schemas', () => {
        expect(resolvedValueSchema(content, node({}))).toBeUndefined();
        expect(resolvedValueSchema(content, node({ valueType: TYPED_ID }))).toBeUndefined();
        const bad = node({ id: SCHEMA_ID, valueType: 'json-schema', value: [1] });
        const typed = node({ id: TYPED_ID, valueType: SCHEMA_ID });
        expect(resolvedValueSchema(board(bad, typed), typed)).toBeUndefined();
    });
});
