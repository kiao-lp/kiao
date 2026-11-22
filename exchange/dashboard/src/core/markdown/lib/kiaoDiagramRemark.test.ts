import { describe, it, expect } from 'vitest';
import {
    parseKiaoDiagramHtml,
    remarkKiaoDiagramRestore,
    remarkKiaoDiagramHideCompanion,
    escapeKiaoDiagramCode,
    unescapeKiaoDiagramCode,
} from './kiaoDiagramRemark';

describe('parseKiaoDiagramHtml', () => {
    it('reads the fence carried in a kiao:diagram comment', () => {
        const html = [
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '  A-->B;',
            '```',
            '-->',
        ].join('\n');

        const parsed = parseKiaoDiagramHtml(html);
        expect(parsed).not.toBeNull();
        expect(parsed?.language).toBe('mermaid');
        expect(parsed?.code).toBe('graph TD;\n  A-->B;');
        expect(html.slice(parsed!.startInHtml, parsed!.endInHtml))
            .toBe('```mermaid\ngraph TD;\n  A-->B;\n```');
    });

    it('reads a four-backtick fence carrying inner fences', () => {
        const html = [
            '<!-- kiao:diagram',
            '````archdia',
            '```plantuml',
            'component A',
            '```',
            '````',
            '-->',
        ].join('\n');

        const parsed = parseKiaoDiagramHtml(html);
        expect(parsed?.language).toBe('archdia');
        expect(parsed?.code).toBe('```plantuml\ncomponent A\n```');
    });

    it('ignores an ordinary comment', () => {
        expect(parseKiaoDiagramHtml('<!-- just a note -->')).toBeNull();
        expect(parseKiaoDiagramHtml('<!-- kiao:diagram -->')).toBeNull();
    });

    it('ignores a marker whose fence never closes', () => {
        const html = ['<!-- kiao:diagram', '```mermaid', 'graph TD;', '-->'].join('\n');
        expect(parseKiaoDiagramHtml(html)).toBeNull();
    });

    it('unescapes the carried source back to what was written', () => {
        const html = [
            '<!-- kiao:diagram',
            '```mermaid',
            'graph TD;',
            '  A--&gt;B;',
            '  C &amp; D;',
            '```',
            '-->',
        ].join('\n');

        expect(parseKiaoDiagramHtml(html)?.code).toBe('graph TD;\n  A-->B;\n  C & D;');
    });
});

describe('escapeKiaoDiagramCode', () => {
    it('escapes the closing sequence and survives the round trip', () => {
        for (const code of ['A-->B', 'A & B', 'A--&gt;B', 'x &amp; y --> z']) {
            expect(unescapeKiaoDiagramCode(escapeKiaoDiagramCode(code))).toBe(code);
        }
        expect(escapeKiaoDiagramCode('A-->B')).not.toContain('-->');
    });
});

describe('remarkKiaoDiagramRestore', () => {
    const run = (children: any[]) => {
        const tree: any = { type: 'root', children };
        (remarkKiaoDiagramRestore() as any)(tree);
        return tree.children;
    };

    it('reinjects the carried fence as a tagged code node', () => {
        const html = '<!-- kiao:diagram\n```plantuml\n@startuml\n@enduml\n```\n-->';
        const children = run([{
            type: 'html',
            value: html,
            position: { start: { line: 1, column: 1, offset: 0 } },
        }]);

        expect(children).toHaveLength(1);
        expect(children[0]).toMatchObject({
            type: 'code',
            lang: 'plantuml',
            value: '@startuml\n@enduml',
            data: { kiaoDiagram: true },
        });
        // The range points at the inner fence, so an edit replaces the fence alone.
        const { start, end } = children[0].position;
        expect(html.slice(start.offset, end.offset)).toBe('```plantuml\n@startuml\n@enduml\n```');
    });

    it('leaves a comment carrying no diagram language alone', () => {
        const node = { type: 'html', value: '<!-- kiao:diagram\n```ts\nconst x = 1;\n```\n-->' };
        const children = run([node]);
        expect(children[0].type).toBe('html');
    });

    it('leaves an ordinary comment alone', () => {
        const node = { type: 'html', value: '<!-- a note -->' };
        expect(run([node])[0].type).toBe('html');
    });
});

describe('remarkKiaoDiagramHideCompanion', () => {
    const run = (children: any[]) => {
        const tree: any = { type: 'root', children };
        (remarkKiaoDiagramHideCompanion() as any)(tree);
        return tree.children;
    };

    const restored = (lang: string) => ({ type: 'code', lang, value: 'x', data: { kiaoDiagram: true } });
    const imagePara = (url: string) => ({
        type: 'paragraph',
        children: [{ type: 'image', url, alt: 'diagram' }],
    });

    it('drops the picture standing right after a restored diagram', () => {
        const children = run([restored('mermaid'), imagePara('Doc.assets/01-mermaid.svg'), { type: 'paragraph', children: [{ type: 'text', value: 'after' }] }]);
        expect(children).toHaveLength(2);
        expect(children[0].lang).toBe('mermaid');
        expect(children[1].children[0].value).toBe('after');
    });

    it('keeps a picture after a plain fence', () => {
        const plain = { type: 'code', lang: 'mermaid', value: 'x' };
        const children = run([plain, imagePara('shot.png')]);
        expect(children).toHaveLength(2);
    });

    it('keeps a picture that shares its paragraph with prose', () => {
        const mixed = {
            type: 'paragraph',
            children: [{ type: 'image', url: 'a.svg', alt: '' }, { type: 'text', value: 'caption' }],
        };
        expect(run([restored('mermaid'), mixed])).toHaveLength(2);
    });
});
