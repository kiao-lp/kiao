import { describe, it, expect } from 'vitest';
import { extractKbElExpr, kbElExprParse, kbElInstantiateText, KiaoElHeap, kiaoFieldOf } from './kiao-expr-lang';

describe('kiao-expr-lang', () => {
    describe('extractKbElExpr', () => {
        it('extracts simple variables', () => {
            expect(extractKbElExpr('Hello ${name}')).toEqual(['name']);
        });

        it('extracts multiple variables', () => {
            expect(extractKbElExpr('${a} and ${b}')).toEqual(['a', 'b']);
        });

        it('returns empty array when no variables', () => {
            expect(extractKbElExpr('No variables here')).toEqual([]);
        });

        it('extracts complex expressions', () => {
            expect(extractKbElExpr('${key:type.field}')).toEqual(['key:type.field']);
        });
    });

    describe('kbElExprParse', () => {
        it('parses simple key', () => {
            const result = kbElExprParse('name');
            expect(result.key).toBe('name');
            expect(result.type).toBeUndefined();
            expect(result.field).toBe('value');
            expect(result.defaultValue).toBeUndefined();
            expect(result.enumValues).toBeUndefined();
        });

        it('parses key with type', () => {
            const result = kbElExprParse('region:AwsRegion');
            expect(result.key).toBe('region');
            expect(result.type).toBe('AwsRegion');
            expect(result.field).toBe('value');
        });

        it('parses key with type and field', () => {
            const result = kbElExprParse('region:AwsRegion.code');
            expect(result.key).toBe('region');
            expect(result.type).toBe('AwsRegion');
            expect(result.field).toBe('code');
        });

        it('parses text type', () => {
            const result = kbElExprParse('name:text');
            expect(result.key).toBe('name');
            expect(result.type).toBe('text');
        });

        it('parses default value', () => {
            const result = kbElExprParse('name:text=John');
            expect(result.key).toBe('name');
            expect(result.type).toBe('text');
            expect(result.defaultValue).toBe('John');
        });

        it('parses inline enum', () => {
            const result = kbElExprParse('type:"feat"|"fix"|"chore"');
            expect(result.key).toBe('type');
            expect(result.type).toBe('enum');
            expect(result.enumValues).toEqual(['feat', 'fix', 'chore']);
        });

        it('parses inline enum with default', () => {
            const result = kbElExprParse('level:"info"|"warn"|"error"=warn');
            expect(result.key).toBe('level');
            expect(result.type).toBe('enum');
            expect(result.enumValues).toEqual(['info', 'warn', 'error']);
            expect(result.defaultValue).toBe('warn');
        });

        it('parses single enum value', () => {
            const result = kbElExprParse('status:"active"|"inactive"');
            expect(result.enumValues).toEqual(['active', 'inactive']);
        });
    });

    describe('kbElInstantiateText', () => {
        it('substitutes simple variable', () => {
            const heap: KiaoElHeap = {
                name: { type: 'text', value: 'World' }
            };
            expect(kbElInstantiateText(heap, 'Hello ${name}')).toBe('Hello World');
        });

        it('substitutes with field', () => {
            const heap: KiaoElHeap = {
                region: { type: 'AwsRegion', value: 'eu-west-1', code: 'EW1' }
            };
            expect(kbElInstantiateText(heap, 'Region: ${region:AwsRegion.code}')).toBe('Region: EW1');
        });

        it('substitutes a grouped field through the identical placeholder', () => {
            const heap: KiaoElHeap = {
                topic: {
                    type: 'TopicToLearn',
                    value: 'Apache Kafka',
                    object: { folderName: 'Apache Kafka', objective: 'use it in reviews' },
                }
            };
            expect(kbElInstantiateText(heap, '${topic:TopicToLearn}')).toBe('Apache Kafka');
            expect(kbElInstantiateText(heap, '${topic:TopicToLearn.folderName}')).toBe('Apache Kafka');
            expect(kbElInstantiateText(heap, '${topic:TopicToLearn.objective}')).toBe('use it in reviews');
        });

        it('prefers the root where both hold the field', () => {
            const heap: KiaoElHeap = {
                topic: {
                    type: 'TopicToLearn',
                    value: 'Apache Kafka',
                    objective: 'the typed answer',
                    object: { objective: 'the configured one' },
                }
            };
            expect(kbElInstantiateText(heap, '${topic:TopicToLearn.objective}')).toBe('the typed answer');
        });

        it('leaves unresolved variables', () => {
            const heap: KiaoElHeap = {};
            expect(kbElInstantiateText(heap, 'Hello ${name}')).toBe('Hello ${name}');
        });

        it('handles recursive substitution', () => {
            const heap: KiaoElHeap = {
                inner: { type: 'temp', value: 'World' },
                outer: { type: 'temp', value: 'Hello ${inner}' }
            };
            expect(kbElInstantiateText(heap, '${outer}!')).toBe('Hello World!');
        });

        it('substitutes multiple occurrences', () => {
            const heap: KiaoElHeap = {
                x: { type: 'text', value: 'A' }
            };
            expect(kbElInstantiateText(heap, '${x}${x}${x}')).toBe('AAA');
        });
    });

    describe('kiaoFieldOf', () => {
        it('reads the root first, then the grouped fields', () => {
            expect(kiaoFieldOf({ type: 't', value: 'v', code: 'EW1' }, 'code')).toBe('EW1');
            expect(kiaoFieldOf({ type: 't', value: 'v', object: { code: 'EW1' } }, 'code')).toBe('EW1');
            expect(kiaoFieldOf({ type: 't', value: 'v' }, 'code')).toBeUndefined();
        });

        it('reads nothing for the grouping key itself', () => {
            expect(kiaoFieldOf({ type: 't', value: 'v', object: { code: 'EW1' } }, 'object')).toBeUndefined();
        });
    });
});
