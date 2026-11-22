import { describe, it, expect } from 'vitest';
import { collectVariablesFromTemplate, mergeVariables, createVariableRegistry, Variable } from './variable-registry';
import { TemplateCollectionV0 } from './model';

describe('VariableRegistry', () => {
    const template1: TemplateCollectionV0 = {
        index: 'test1',
        name: 'Template1',
        rootTemplate: {
            id: 'root1',
            textTemplate: 'Hello ${name} from ${region:AwsRegion}'
        },
        subTemplates: []
    };

    const template2: TemplateCollectionV0 = {
        index: 'test2',
        name: 'Template2',
        rootTemplate: {
            id: 'root2',
            textTemplate: 'Welcome ${name} and ${user.email}'
        },
        subTemplates: []
    };

    describe('collectVariablesFromTemplate', () => {
        it('collects variables from a simple template', () => {
            const vars = collectVariablesFromTemplate(template1);

            expect(vars).toHaveLength(2);
            expect(vars.find(v => v.key === 'name')).toBeDefined();
            expect(vars.find(v => v.key === 'region')).toBeDefined();
        });

        it('extracts sourceTemplateIds', () => {
            const vars = collectVariablesFromTemplate(template1);
            const nameVar = vars.find(v => v.key === 'name')!;

            expect(nameVar.sourceTemplateIds).toContain('root1');
        });

        it('collects expressions for each variable', () => {
            const vars = collectVariablesFromTemplate(template1);
            const regionVar = vars.find(v => v.key === 'region')!;

            expect(regionVar.expressions).toContain('region:AwsRegion');
        });
    });

    describe('mergeVariables', () => {
        it('merges variables from two templates', () => {
            const vars1: Variable[] = [
                { key: 'name', expressions: ['name'], sourceTemplateIds: ['t1'] },
                { key: 'region', expressions: ['region:AwsRegion'], sourceTemplateIds: ['t1'] }
            ];
            const vars2: Variable[] = [
                { key: 'name', expressions: ['name:text'], sourceTemplateIds: ['t2'] },
                { key: 'user', expressions: ['user.email'], sourceTemplateIds: ['t2'] }
            ];

            const merged = mergeVariables(vars1, vars2);

            expect(merged).toHaveLength(3); // name, region, user
        });

        it('deduplicates variables by key', () => {
            const vars1: Variable[] = [
                { key: 'name', expressions: ['name'], sourceTemplateIds: ['t1'] }
            ];
            const vars2: Variable[] = [
                { key: 'name', expressions: ['name:text'], sourceTemplateIds: ['t2'] }
            ];

            const merged = mergeVariables(vars1, vars2);

            expect(merged).toHaveLength(1);
            const nameVar = merged.find(v => v.key === 'name')!;
            expect(nameVar.expressions).toContain('name');
            expect(nameVar.expressions).toContain('name:text');
            expect(nameVar.sourceTemplateIds).toContain('t1');
            expect(nameVar.sourceTemplateIds).toContain('t2');
        });
    });

    describe('createVariableRegistry', () => {
        it('creates registry from single template', () => {
            const registry = createVariableRegistry([template1]);

            expect(registry.variables).toHaveLength(2);
        });

        it('creates registry from multiple templates with shared variables', () => {
            const registry = createVariableRegistry([template1, template2]);

            expect(registry.variables).toHaveLength(3); // name (shared), region, user
            const nameVar = registry.variables.find(v => v.key === 'name')!;
            expect(nameVar.sourceTemplateIds).toHaveLength(2);
        });

        it('creates empty registry for empty array', () => {
            const registry = createVariableRegistry([]);

            expect(registry.variables).toHaveLength(0);
        });
    });
});
