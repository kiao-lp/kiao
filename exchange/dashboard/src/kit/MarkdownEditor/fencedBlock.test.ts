import { describe, it, expect } from 'vitest';
import { buildFencedBlockEdit, FencedBlockRange } from './fencedBlock';

/** Locate a fence the way the renderer does, so the tests use real ranges. */
const rangeOf = (source: string, fenced: string): FencedBlockRange => {
    const start = source.indexOf(fenced);
    expect(start).toBeGreaterThanOrEqual(0);
    return { start, end: start + fenced.length };
};

const apply = (
    source: string,
    range: FencedBlockRange,
    language: string,
    body: string,
    newLanguage?: string,
): string | null => {
    const edit = buildFencedBlockEdit(source, range, language, body, newLanguage);
    return edit && source.slice(0, edit.from) + edit.text + source.slice(edit.to);
};

describe('buildFencedBlockEdit', () => {
    it('replaces the body and keeps the surrounding document', () => {
        const block = '```archdia\nold\n```';
        const source = `# Title\n\n${block}\n\nAfter.\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'new')).toBe(
            '# Title\n\n```archdia\nnew\n```\n\nAfter.\n',
        );
    });

    it('keeps a four-backtick fence at four backticks', () => {
        const block = '````archdia\nold\n````';
        const source = `${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'a\nb')).toBe('````archdia\na\nb\n````\n');
    });

    it('widens the fence when the new body carries one of its own', () => {
        // The archdia serializer always wraps its sections in ``` fences, so a
        // three-backtick block has to grow or it would terminate early.
        const block = '```archdia\nold\n```';
        const source = `${block}\n`;
        const body = '---\ntype: PLANTUML\n---\n```plantuml\n@startuml\n@enduml\n```';
        expect(apply(source, rangeOf(source, block), 'archdia', body)).toBe(
            '````archdia\n---\ntype: PLANTUML\n---\n```plantuml\n@startuml\n@enduml\n```\n````\n',
        );
    });

    it('widens past the longest run, not just past three', () => {
        const block = '```archdia\nold\n```';
        const source = `${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'a\n`````\nb')).toBe(
            '``````archdia\na\n`````\nb\n``````\n',
        );
    });

    it('keeps tilde fences as tildes', () => {
        const block = '~~~archdia\nold\n~~~';
        const source = `${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', '```json\n{}\n```')).toBe(
            '~~~archdia\n```json\n{}\n```\n~~~\n',
        );
    });

    it('strips the trailing newline the serializers add', () => {
        const block = '```archdia\nold\n```';
        const source = `${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'body\n')).toBe('```archdia\nbody\n```\n');
    });

    it('re-indents a fence nested in a list item', () => {
        const block = '```archdia\n  old\n  ```';
        const source = `- item\n  ${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'a\nb')).toBe(
            '- item\n  ```archdia\n  a\n  b\n  ```\n',
        );
    });

    it('re-applies a blockquote prefix', () => {
        const block = '```archdia\n> old\n> ```';
        const source = `> ${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'a\nb')).toBe(
            '> ```archdia\n> a\n> b\n> ```\n',
        );
    });

    it('keeps CRLF documents on CRLF', () => {
        const block = '```archdia\r\nold\r\n```';
        const source = `# Title\r\n\r\n${block}\r\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', 'a\nb')).toBe(
            '# Title\r\n\r\n```archdia\r\na\r\nb\r\n```\r\n',
        );
    });

    it('targets the range it was given, not the first matching block', () => {
        const block = '```archdia\nsame\n```';
        const source = `${block}\n\n${block}\n`;
        const second = source.lastIndexOf(block);
        const edited = apply(source, { start: second, end: second + block.length }, 'archdia', 'changed');
        expect(edited).toBe('```archdia\nsame\n```\n\n```archdia\nchanged\n```\n');
    });

    it('refuses a range that no longer starts a fence', () => {
        const source = 'Some prose that replaced the diagram.\n';
        expect(buildFencedBlockEdit(source, { start: 0, end: 20 }, 'archdia', 'new')).toBeNull();
    });

    it('refuses a range holding a fence of another language', () => {
        const block = '```mermaid\ngraph TD;\n```';
        const source = `${block}\n`;
        expect(buildFencedBlockEdit(source, rangeOf(source, block), 'archdia', 'new')).toBeNull();
    });

    it('refuses ranges outside the source', () => {
        const source = '```archdia\nold\n```\n';
        expect(buildFencedBlockEdit(source, { start: 0, end: source.length + 10 }, 'archdia', 'new')).toBeNull();
        expect(buildFencedBlockEdit(source, { start: 5, end: 5 }, 'archdia', 'new')).toBeNull();
        expect(buildFencedBlockEdit(source, { start: -1, end: 4 }, 'archdia', 'new')).toBeNull();
    });

    it('does not mistake a longer info string for the language', () => {
        const block = '```archdiagram\nold\n```';
        const source = `${block}\n`;
        expect(buildFencedBlockEdit(source, rangeOf(source, block), 'archdia', 'new')).toBeNull();
    });

    it('retags the fence when the body changed language', () => {
        const block = '```mermaid\nflowchart LR\n  A --> B\n```';
        const source = `Intro\n\n${block}\n\nOutro\n`;
        const body = '---\ntype: PLANTUML\n---\n```plantuml\n@startuml\n@enduml\n```';
        expect(apply(source, rangeOf(source, block), 'mermaid', body, 'archdia')).toBe(
            'Intro\n\n````archdia\n---\ntype: PLANTUML\n---\n```plantuml\n@startuml\n@enduml\n```\n````\n\nOutro\n',
        );
    });

    it('tightens an over-long fence when the block is retagged', () => {
        // An archdia block needs four backticks to hold its own; the plantuml
        // extracted out of it does not, and should not keep them.
        const block = '````archdia\n---\ntype: PLANTUML\n---\n```plantuml\n@startuml\n@enduml\n```\n````';
        const source = `${block}\n`;
        expect(apply(source, rangeOf(source, block), 'archdia', '@startuml\n@enduml', 'plantuml')).toBe(
            '```plantuml\n@startuml\n@enduml\n```\n',
        );
    });

    it('still verifies the fence against the language it was read as', () => {
        const block = '```plantuml\n@startuml\n@enduml\n```';
        const source = `${block}\n`;
        // The block is plantuml; asking for it as mermaid must not retag it
        expect(buildFencedBlockEdit(source, rangeOf(source, block), 'mermaid', 'new', 'archdia')).toBeNull();
    });
});
