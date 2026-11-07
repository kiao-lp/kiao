import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readMarkdownMetadata } from './markdownMetadata';

describe('Markdown metadata', () => {
    it('reads status, role and a multiline provenance description', () => {
        const metadata = readMarkdownMetadata('---\nstatus: APPROVED\nrole: DERIVED\nprovenance: |\n  Based on the source.\n  Reviewed by the author.\n---\n\n# Document\n');
        expect(metadata.status).toBe('APPROVED');
        expect(metadata.role).toBe('DERIVED');
        expect(metadata.provenance).toBe('Based on the source.\nReviewed by the author.\n');
        expect(metadata.error).toBeUndefined();
    });

    it('adds only the chosen metadata to a document without a header', () => {
        const source = '# Document\n\nBody with no trailing newline.';
        const metadata = readMarkdownMetadata(source);
        expect(metadata.status).toBeUndefined();
        expect(metadata.role).toBeUndefined();
        expect(metadata.update({ status: 'DRAFT' })).toBe(`---\nstatus: DRAFT\n---\n\n${source}`);
        expect(readMarkdownMetadata('').update({ role: 'PRIMARY_SOURCE' }))
            .toBe('---\nrole: PRIMARY_SOURCE\n---\n\n');
    });

    it('keeps the body, other keys and YAML comments when changing metadata', () => {
        const body = '\n# Document\n\n---\n\nA horizontal rule and `status: DRAFT`.\n';
        const source = '---\n# Publication status\nstatus: DRAFT # awaiting review\nrole: DERIVED\nprovenance: "Original: report"\ncustom:\n  tags: [one, two]\n---\n' + body;
        const updated = readMarkdownMetadata(source).update({ status: 'APPROVED' });
        expect(updated).toContain('# Publication status');
        expect(updated).toContain('status: APPROVED # awaiting review');
        expect(parse(updated.split('---')[1]).custom).toEqual({ tags: ['one', 'two'] });
        expect(updated).toContain('provenance: "Original: report"');
        expect(updated.endsWith(body)).toBe(true);
    });

    it('round-trips YAML punctuation, Unicode, line breaks and an empty description', () => {
        const description = 'Sources: "report" #1\nRésumé — https://example.com/source\n---\n';
        const updated = readMarkdownMetadata('# Document').update({ role: 'DERIVED', provenance: description });
        expect(readMarkdownMetadata(updated).provenance).toBe(description);
        const cleared = readMarkdownMetadata(updated).update({ provenance: '' });
        expect(readMarkdownMetadata(cleared).provenance).toBe('');
        expect(readMarkdownMetadata(cleared).role).toBe('DERIVED');
    });

    it('preserves a BOM, CRLFs and a closing fence without a trailing newline', () => {
        const source = '\uFEFF---\r\nstatus: DRAFT\r\n---\r\n\r\n# Document\r\n';
        expect(readMarkdownMetadata(source).update({ status: 'APPROVED' }))
            .toBe(source.replace('DRAFT', 'APPROVED'));
        expect(readMarkdownMetadata('\uFEFF# Document\r\n').update({ status: 'DRAFT' }))
            .toBe('\uFEFF---\r\nstatus: DRAFT\r\n---\r\n\r\n# Document\r\n');
        expect(readMarkdownMetadata('---\nstatus: DRAFT\n---').update({ status: 'APPROVED' }))
            .toBe('---\nstatus: APPROVED\n---');
    });

    it('does not treat later rules or fenced examples as the document header', () => {
        for (const source of [
            '# Body\n\n---\nstatus: APPROVED\n---\n',
            '```yaml\n---\nstatus: APPROVED\n---\n```\n',
            '---\n\n# Body without a closing fence\n',
        ]) {
            expect(readMarkdownMetadata(source).status).toBeUndefined();
            expect(readMarkdownMetadata(source).update({ status: 'DRAFT' }).endsWith(source)).toBe(true);
        }
    });

    it.each([
        'status: [unfinished',
        'status: DRAFT\nstatus: APPROVED',
        '- DRAFT\n- DERIVED',
        'scalar header',
        'custom: *missing',
    ])('refuses to rewrite an invalid or non-mapping header: %s', header => {
        const metadata = readMarkdownMetadata(`---\n${header}\n---\n\n# Body\n`);
        expect(metadata.error).toBeTruthy();
        expect(() => metadata.update({ status: 'DRAFT' })).toThrow();
    });
});
