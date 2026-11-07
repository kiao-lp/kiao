import { describe, it, expect } from 'vitest';
import {
    findDiagramBlocks,
    generateStaticMarkdown,
    replaceBlocks,
    withIntrinsicSize,
} from '@cms-core';

/**
 * The scanner decides what a static export rewrites, so a wrong block is a document damaged in a
 * way nobody notices until they read the generated file. These pin the fence shapes that actually
 * occur in this store's documents — a diagram shown as an example inside a longer fence above all,
 * which is what a page documenting this very feature is made of.
 */
describe('findDiagramBlocks', () => {
    it('finds a diagram and ignores ordinary code', () => {
        const source = [
            '# Title',
            '',
            '```mermaid',
            'graph TD;',
            '  A-->B;',
            '```',
            '',
            '```ts',
            'const x = 1;',
            '```',
            '',
        ].join('\n');

        const blocks = findDiagramBlocks(source);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('mermaid');
        expect(blocks[0].code).toBe('graph TD;\n  A-->B;');
        expect(source.slice(blocks[0].start, blocks[0].end)).toBe('```mermaid\ngraph TD;\n  A-->B;\n```');
    });

    it('leaves a diagram quoted inside a longer fence as source', () => {
        const source = [
            'How to write one:',
            '',
            '````markdown',
            '```mermaid',
            'graph TD;',
            '```',
            '````',
            '',
            '```archdia',
            'component A',
            '```',
        ].join('\n');

        const blocks = findDiagramBlocks(source);
        expect(blocks.map(b => b.language)).toEqual(['archdia']);
    });

    it('reads every diagram language, tildes included', () => {
        const source = [
            '~~~graph',
            '{}',
            '~~~',
            '',
            '```plantuml',
            '@startuml',
            '@enduml',
            '```',
            '',
            '```svg',
            '<svg></svg>',
            '```',
        ].join('\n');

        expect(findDiagramBlocks(source).map(b => b.language)).toEqual(['graph', 'plantuml', 'svg']);
    });

    it('strips the opening fence indent from an indented block', () => {
        const source = [
            '- item:',
            '',
            '  ```mermaid',
            '  graph TD;',
            '  ```',
        ].join('\n');

        const blocks = findDiagramBlocks(source);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].code).toBe('graph TD;');
    });

    it('is not opened by an inline code span on a line of prose', () => {
        expect(findDiagramBlocks('Use ```mermaid``` for graphs.')).toHaveLength(0);
    });

    it('runs an unclosed fence to the end of the document, as the preview does', () => {
        const source = '```mermaid\ngraph TD;\n  A-->B;';
        const blocks = findDiagramBlocks(source);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].code).toBe('graph TD;\n  A-->B;');
        expect(blocks[0].end).toBe(source.length);
    });

    it('steps over a kiao:diagram block whole, leaving its carried fence alone', () => {
        const source = [
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '```',
            '-->',
            '![Mermaid diagram 1](Doc.assets/01-mermaid.svg)',
            '',
            '```mermaid',
            'graph TD;',
            '```',
        ].join('\n');

        const blocks = findDiagramBlocks(source);
        expect(blocks).toHaveLength(1);
        expect(source.slice(blocks[0].start, blocks[0].end)).toBe('```mermaid\ngraph TD;\n```');
    });
});

describe('replaceBlocks', () => {
    it('splices replacements in and leaves a null block untouched', () => {
        const source = '```svg\n<svg/>\n```\n\ntext\n\n```mermaid\ngraph TD;\n```\n';
        const blocks = findDiagramBlocks(source);

        expect(replaceBlocks(source, blocks, ['![one](a.svg)', null]))
            .toBe('![one](a.svg)\n\ntext\n\n```mermaid\ngraph TD;\n```\n');
    });
});

describe('generateStaticMarkdown', () => {
    it('replaces a diagram with a link to a picture it hands back', async () => {
        const source = '# Doc\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>\n```\n\nAfter.\n';

        const result = await generateStaticMarkdown(source, { assetFolder: 'doc.assets' });

        expect(result.failures).toEqual([]);
        expect(result.assets.map(a => a.name)).toEqual(['01-svg.svg']);
        expect(result.assets[0].svg).toContain('<rect');
        expect(result.markdown).toBe('# Doc\n\n![SVG image 1](doc.assets/01-svg.svg)\n\nAfter.\n');
    });

    it('numbers the pictures in document order', async () => {
        const source = ['```svg', '<svg/>', '```', '', '```svg', '<svg/>', '```'].join('\n');

        const result = await generateStaticMarkdown(source, { assetFolder: 'a' });

        expect(result.assets.map(a => a.name)).toEqual(['01-svg.svg', '02-svg.svg']);
        expect(result.markdown).toBe('![SVG image 1](a/01-svg.svg)\n\n![SVG image 2](a/02-svg.svg)');
    });

    it('percent-encodes an asset folder that would otherwise end the link early', async () => {
        const result = await generateStaticMarkdown('```svg\n<svg/>\n```', {
            assetFolder: 'Design (v2).assets',
        });

        expect(result.markdown).toBe('![SVG image 1](Design%20%28v2%29.assets/01-svg.svg)');
    });

    it('keeps the source of a diagram it cannot draw, and reports it', async () => {
        // No PlantUML server answers in a test environment, so the fetch fails.
        const source = '```plantuml\n@startuml\n@enduml\n```';

        const result = await generateStaticMarkdown(source, {
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

        const result = await generateStaticMarkdown(source, { assetFolder: 'a' });

        expect(result).toMatchObject({ markdown: source, assets: [], failures: [] });
    });
});

/**
 * A picture referenced from markdown is asked how big it is by an `<img>`, and mermaid answers
 * `100%` — which in that context means nothing, and leaves the diagram stretched to whatever width
 * the viewer offers at ten times the intended text size.
 */
describe('withIntrinsicSize', () => {
    it('sizes a mermaid SVG from its viewBox', () => {
        const sized = withIntrinsicSize(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 114px;" viewBox="0 0 114 168"></svg>',
        );

        expect(sized).toContain('width="114"');
        expect(sized).toContain('height="168"');
    });

    it('leaves an SVG that already states its size alone', () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 130" width="500" height="130"></svg>';
        expect(withIntrinsicSize(source)).toBe(source);
    });

    it('leaves an SVG with nothing to derive a size from alone', () => {
        const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
        expect(withIntrinsicSize(source)).toBe(source);
    });

    it('gives every generated picture a size an img can use', async () => {
        const result = await generateStaticMarkdown(
            '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 80 40"/>\n```',
            { assetFolder: 'a' },
        );

        expect(result.assets[0].svg).toContain('width="80"');
        expect(result.assets[0].svg).toContain('height="40"');
    });
});
