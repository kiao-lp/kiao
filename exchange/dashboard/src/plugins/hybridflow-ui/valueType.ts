import type { BoardContent, FlowNode } from './boardContent';

export const VALUE_TYPE_JSON_SCHEMA = 'json-schema';

const idShape = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const readValueType = (raw: unknown): string => {
    const said = typeof raw === 'string' ? raw.trim() : '';
    return said === '' || said === VALUE_TYPE_JSON_SCHEMA || idShape.test(said) ? said : '';
};

export const isSchemaValue = (node: Pick<FlowNode, 'type' | 'valueType'>): boolean =>
    node.type === 'value' && node.valueType === VALUE_TYPE_JSON_SCHEMA;

export const schemaValues = (content: BoardContent, selfId: string): FlowNode[] =>
    content.flowNodes.filter(node => node.id !== selfId && !node.archived && isSchemaValue(node));

export const valueTypeOptions = (content: BoardContent, selfId: string, current: string) => {
    const options = [
        { value: '', label: 'No type' },
        { value: VALUE_TYPE_JSON_SCHEMA, label: 'JSON Schema' },
        ...schemaValues(content, selfId).map(node => ({
            value: node.id,
            label: node.title.trim() || 'Untitled value',
        })),
    ];
    if (current && !options.some(option => option.value === current)) {
        options.push({ value: current, label: 'A value that has left the board' });
    }
    return options;
};

const META_SCHEMA = { $ref: 'https://json-schema.org/draft/2020-12/schema' };

export const resolvedValueSchema = (content: BoardContent, node: FlowNode): unknown => {
    if (node.type !== 'value' || node.valueType === '') return undefined;
    if (node.valueType === VALUE_TYPE_JSON_SCHEMA) return META_SCHEMA;
    const target = content.flowNodes.find(other => other.id === node.valueType);
    if (!target || !isSchemaValue(target)) return undefined;
    const schema: unknown = target.value;
    return typeof schema === 'boolean' || (schema !== null && typeof schema === 'object' && !Array.isArray(schema))
        ? schema
        : undefined;
};
