import { describe, it, expect } from 'vitest';
import { collectRenderNodes, collectRenderNodesFromAll, RenderNode } from './input-panel-logic';
import { TemplateCollectionV0 } from './model';

describe('collectRenderNodes', () => {
    // Mock data
    const mockTemplates: TemplateCollectionV0 = {
        index: 'test',
        rootTemplate: {
            id: 'root',
            textTemplate: 'Start ${title} Middle ${instructions} End ${footer}'
        },
        subTemplates: [
            {
                id: 'title',
                textTemplate: 'Title with ${scope}',
                defaultText: 'Default Title'
            },
            {
                id: 'instructions',
                textTemplate: 'Inst with ${scope} and ${other}',
                defaultText: 'Default Inst'
            },
            {
                id: 'footer',
                textTemplate: 'Footer ${scope}'
            }
        ]
    };

    it('collects nodes and deduplicates scope across siblings', () => {
        const enabledMap = {
            title: true,
            instructions: true,
            footer: true
        };
        const seenKeys = new Set<string>();

        const nodes = collectRenderNodes(
            mockTemplates.rootTemplate.textTemplate,
            mockTemplates,
            enabledMap,
            seenKeys
        );

        // Check Title
        const titleNode = nodes.find(n => n.key === 'title');
        expect(titleNode).toBeDefined();
        expect(titleNode?.type).toBe('group');
        expect(titleNode?.children).toHaveLength(1); // just scope
        expect(titleNode?.children?.[0].key).toBe('scope');

        // Check Instructions
        const instNode = nodes.find(n => n.key === 'instructions');
        expect(instNode).toBeDefined();
        // Since scope was seen in title, it should NOT be in instructions
        expect(instNode?.children).toHaveLength(1);
        expect(instNode?.children?.[0].key).toBe('other');

        // Check Footer
        const footerNode = nodes.find(n => n.key === 'footer');
        expect(footerNode).toBeDefined();
        // scope seen in title.
        expect(footerNode?.children).toHaveLength(0);
    });

    it('handles disabled groups correctly (children not seen)', () => {
        const enabledMap = {
            title: false, // Disabled!
            instructions: true,
            footer: true
        };
        const seenKeys = new Set<string>();

        const nodes = collectRenderNodes(
            mockTemplates.rootTemplate.textTemplate,
            mockTemplates,
            enabledMap,
            seenKeys
        );

        // Title is disabled. Its children (scope) are NOT traversed.
        const titleNode = nodes.find(n => n.key === 'title');
        expect(titleNode?.isEnabled).toBe(false);
        expect(titleNode?.children).toBeDefined();
        expect(titleNode?.children).toHaveLength(0);

        // Instructions
        const instNode = nodes.find(n => n.key === 'instructions');
        // scope was NOT seen in title. So it MUST appear here.
        expect(instNode?.children).toBeDefined();
        const scopeInInst = instNode?.children?.find(n => n.key === 'scope');
        expect(scopeInInst).toBeDefined();
    });

    it('includes sourceTemplateId when provided', () => {
        const seenKeys = new Set<string>();
        const nodes = collectRenderNodes(
            mockTemplates.rootTemplate.textTemplate,
            mockTemplates,
            { title: true, instructions: true, footer: true },
            seenKeys,
            'test-template'
        );

        expect(nodes[0].sourceTemplateId).toBe('test-template');
    });
});

describe('collectRenderNodesFromAll', () => {
    const template1: TemplateCollectionV0 = {
        index: 'test1',
        name: 'Template1',
        rootTemplate: {
            id: 'root1',
            textTemplate: 'Hello ${name} from ${region}'
        },
        subTemplates: []
    };

    const template2: TemplateCollectionV0 = {
        index: 'test2',
        name: 'Template2',
        rootTemplate: {
            id: 'root2',
            textTemplate: 'Welcome ${name} and ${user}'
        },
        subTemplates: []
    };

    it('collects nodes from multiple templates', () => {
        const nodes = collectRenderNodesFromAll([template1, template2], {});

        // name (from template1), region (from template1), user (from template2)
        // name is deduplicated (appears only once)
        expect(nodes).toHaveLength(3);
    });

    it('deduplicates variables with same key across templates', () => {
        const nodes = collectRenderNodesFromAll([template1, template2], {});

        const nameNodes = nodes.filter(n => n.key === 'name');
        expect(nameNodes).toHaveLength(1);
    });

    it('tracks sourceTemplateId for each node', () => {
        const nodes = collectRenderNodesFromAll([template1, template2], {});

        const nameNode = nodes.find(n => n.key === 'name')!;
        expect(nameNode.sourceTemplateId).toBe('root1'); // First template wins

        const userNode = nodes.find(n => n.key === 'user')!;
        expect(userNode.sourceTemplateId).toBe('root2');
    });

    it('handles empty array', () => {
        const nodes = collectRenderNodesFromAll([], {});
        expect(nodes).toHaveLength(0);
    });
});
