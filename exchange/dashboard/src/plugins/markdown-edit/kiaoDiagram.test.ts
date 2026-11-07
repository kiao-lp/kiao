import { describe, it, expect } from 'vitest';
import {
    findKiaoDiagramTargets,
    formatKiaoDiagramBlock,
    replaceKiaoTargets,
    generateKiaoDiagramMarkdown,
    diagramAssetTarget,
} from '@cms-core';

/**
 * The finder decides what a render rewrites, so a wrong block is a document damaged in a way
 * nobody notices until they read the generated file. These pin both shapes — the plain fence not
 * yet rendered and the wrapped block a previous pass wrote — and the examples that must stay
 * examples.
 */
describe('findKiaoDiagramTargets', () => {
    it('finds a plain fence as an unwrapped target', () => {
        const source = '# Title\n\n```mermaid\ngraph TD;\n```\n';
        const targets = findKiaoDiagramTargets(source);
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ language: 'mermaid', code: 'graph TD;', wrapped: false });
        expect(source.slice(targets[0].start, targets[0].end)).toBe('```mermaid\ngraph TD;\n```');
    });

    it('finds a wrapped block as one target, picture included', () => {
        const source = [
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '```',
            '-->',
            '![Mermaid diagram 1](Doc.assets/01-mermaid.svg)',
            '',
            'After.',
            '',
        ].join('\n');
        const targets = findKiaoDiagramTargets(source);
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ language: 'mermaid', code: 'graph TD;', wrapped: true });
        expect(source.slice(targets[0].start, targets[0].end)).toBe([
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '```',
            '-->',
            '![Mermaid diagram 1](Doc.assets/01-mermaid.svg)',
        ].join('\n'));
    });

    it('finds a wrapped block with no picture yet', () => {
        const source = '<!-- kiao:diagram\n```plantuml\n@startuml\n@enduml\n```\n-->\n';
        const targets = findKiaoDiagramTargets(source);
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ language: 'plantuml', wrapped: true });
    });

    it('leaves a wrapped block quoted inside a longer fence as source', () => {
        const source = [
            '````markdown',
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '```',
            '-->',
            '````',
            '',
            '```mermaid',
            'graph TD;',
            '```',
        ].join('\n');
        const targets = findKiaoDiagramTargets(source);
        expect(targets).toHaveLength(1);
        expect(targets[0].wrapped).toBe(false);
    });

    it('ignores ordinary code and ordinary comments', () => {
        const source = ['<!-- a note -->', '', '```ts', 'const x = 1;', '```', ''].join('\n');
        expect(findKiaoDiagramTargets(source)).toHaveLength(0);
    });

    it('reads an escaped source back to what was written', () => {
        const source = [
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '  A--&gt;B;',
            '```',
            '-->',
            '![Mermaid diagram 1](Doc.assets/01-mermaid.svg)',
        ].join('\n');
        const targets = findKiaoDiagramTargets(source);
        expect(targets).toHaveLength(1);
        expect(targets[0].code).toBe('graph TD;\n  A-->B;');
    });

    it('heals a hand-typed arrow back into one target', () => {
        // Typed raw in the source pane, the arrow would close the comment early for any reader
        // splitting on the first `-->`. The finder reads the fence whole instead.
        const source = [
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '  A-->B;',
            '```',
            '-->',
            '![Mermaid diagram 1](Doc.assets/01-mermaid.svg)',
        ].join('\n');
        const targets = findKiaoDiagramTargets(source);
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ language: 'mermaid', wrapped: true });
        expect(targets[0].code).toBe('graph TD;\n  A-->B;');
    });
});

describe('formatKiaoDiagramBlock', () => {
    it('wraps the source in a comment and the picture after it', () => {
        expect(formatKiaoDiagramBlock('mermaid', 'graph TD;', 'Doc.assets/01-mermaid.svg', 1)).toBe([
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '```',
            '-->',
            '![Mermaid diagram 1](Doc.assets/01-mermaid.svg)',
        ].join('\n'));
    });

    it('outgrows a body carrying fences of its own', () => {
        const formatted = formatKiaoDiagramBlock('archdia', '```plantuml\ncomponent A\n```', 'D.assets/01-archdia.svg', 1);
        expect(formatted).toContain('````archdia');
        expect(formatted).toContain('````\n-->');
    });

    it('escapes the closing sequence the source would otherwise carry', () => {
        const formatted = formatKiaoDiagramBlock('mermaid', 'graph TD;\n  A-->B;', 'D.assets/01-mermaid.svg', 1);
        expect(formatted).toContain('A--&gt;B;');
        // No line between the markers holds the sequence that would close the comment early.
        const lines = formatted.split('\n');
        expect(lines.slice(1, -2).some(l => l.includes('-->'))).toBe(false);
    });
});

describe('replaceKiaoTargets', () => {
    it('splices replacements in and leaves a null target untouched', () => {
        const source = '```svg\n<svg/>\n```\n\ntext\n\n```mermaid\ngraph TD;\n```\n';
        const targets = findKiaoDiagramTargets(source);
        expect(replaceKiaoTargets(source, targets, ['![one](a.svg)', null]))
            .toBe('![one](a.svg)\n\ntext\n\n```mermaid\ngraph TD;\n```\n');
    });
});

describe('diagramAssetTarget', () => {
    it('names the asset folder after the file', () => {
        expect(diagramAssetTarget('docs/Design.md')).toEqual({
            source: 'docs/Design.md',
            assetFolder: 'Design.assets',
            assetFolderPath: 'docs/Design.assets',
        });
    });

    it('names no target for a static-version source', () => {
        expect(diagramAssetTarget('docs/Design.src.md')).toBeNull();
    });

    it('names no target outside markdown', () => {
        expect(diagramAssetTarget('docs/shot.png')).toBeNull();
    });
});

describe('generateKiaoDiagramMarkdown', () => {
    it('wraps a diagram and hands its picture back', async () => {
        const source = '# Doc\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>\n```\n\nAfter.\n';

        const result = await generateKiaoDiagramMarkdown(source, { assetFolder: 'Doc.assets' });

        expect(result.failures).toEqual([]);
        expect(result.assets.map(a => a.name)).toEqual(['01-svg.svg']);
        expect(result.assets[0].svg).toContain('<rect');
        expect(result.markdown).toBe([
            '# Doc',
            '',
            '<!-- kiao:diagram',
            '```svg',
            '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
            '```',
            '-->',
            '![SVG image 1](Doc.assets/01-svg.svg)',
            '',
            'After.',
            '',
        ].join('\n'));
    });

    it('refreshes an already wrapped block in place', async () => {
        const source = [
            '<!-- kiao:diagram',
            '```svg',
            '<svg/>',
            '```',
            '-->',
            '![SVG image 1](Doc.assets/01-svg.svg)',
        ].join('\n');

        const result = await generateKiaoDiagramMarkdown(source, { assetFolder: 'Doc.assets' });

        expect(result.failures).toEqual([]);
        expect(result.assets.map(a => a.name)).toEqual(['01-svg.svg']);
        expect(result.markdown).toBe(source);
    });

    it('keeps the block of a diagram it cannot draw, and reports it', async () => {
        const source = '```plantuml\n@startuml\n@enduml\n```';

        const result = await generateKiaoDiagramMarkdown(source, {
            assetFolder: 'a',
            plantUmlServerUrl: 'http://127.0.0.1:1/plantuml',
        });

        expect(result.assets).toEqual([]);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toMatchObject({ language: 'plantuml', position: 1 });
        expect(result.markdown).toBe(source);
    });

    it('copies a document with no diagram through unchanged', async () => {
        const source = '# Title\n\n```ts\nconst x = 1;\n```\n';

        const result = await generateKiaoDiagramMarkdown(source, { assetFolder: 'a' });

        expect(result).toMatchObject({ markdown: source, assets: [], failures: [] });
    });
});
