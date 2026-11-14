import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readMarkdownMetadata } from './markdownMetadata';

describe('Markdown metadata', () => {
    it('reads status, role and a multiline provenance description', () => {
        const metadata = readMarkdownMetadata('---\ndocument:\n  status: APPROVED\n  role: DERIVED\n  provenance: |\n    Based on the source.\n    Reviewed by the author.\n---\n\n# Document\n');
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
        expect(metadata.update({ status: 'DRAFT' })).toBe(`---\ndocument:\n  status: DRAFT\n---\n\n${source}`);
        expect(readMarkdownMetadata('').update({ role: 'PRIMARY_SOURCE' }))
            .toBe('---\ndocument:\n  role: PRIMARY_SOURCE\n---\n\n');
    });

    it('keeps the body, other keys and YAML comments when changing metadata', () => {
        const body = '\n# Document\n\n---\n\nA horizontal rule and `status: DRAFT`.\n';
        const source = '---\n# Publication status\ndocument:\n  status: DRAFT # awaiting review\n  role: DERIVED\n  provenance: "Original: report"\ncustom:\n  tags: [one, two]\n---\n' + body;
        const updated = readMarkdownMetadata(source).update({ status: 'APPROVED' });
        expect(updated).toContain('# Publication status');
        expect(updated).toContain('status: APPROVED # awaiting review');
        expect(parse(updated.split('---')[1]).custom).toEqual({ tags: ['one', 'two'] });
        expect(updated).toContain('provenance: "Original: report"');
        expect(updated.endsWith(body)).toBe(true);
    });

    it.each([undefined, 'DRAFT'])('keeps decision metadata independent from document status %s', status => {
        const body = '\n# Decision\n\n## Context and Problem Statement\n\nA decision needs a record.\n\n## Considered Options\n\n* Keep the record.\n\n## Decision Outcome\n\nChosen option: "Keep the record", because its metadata can be reviewed.\n';
        const documentLines = status
            ? `document:\n  status: ${status}\n  role: PRIMARY_SOURCE\n`
            : 'document:\n  role: PRIMARY_SOURCE\n';
        const source = `---
status: "superseded by ADR-00002"
date: 2026-11-07
tags: [metadata, docs]
triggers: [document status, readMarkdownMetadata]
supersedes: []
superseded_by: ["00002"]
${documentLines}---
` + body;
        const metadata = readMarkdownMetadata(source);
        expect(metadata.status).toBe(status);
        expect(metadata.role).toBe('PRIMARY_SOURCE');
        expect(metadata.error).toBeUndefined();

        const updated = metadata.update({ status: 'APPROVED', role: 'DERIVED', provenance: 'Reviewed decision.' });
        expect(parse(updated.split('---')[1])).toEqual({
            ...parse(source.split('---')[1]),
            document: {
                status: 'APPROVED',
                role: 'DERIVED',
                provenance: 'Reviewed decision.',
            },
        });
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
        const source = '\uFEFF---\r\ndocument:\r\n  status: DRAFT\r\n---\r\n\r\n# Document\r\n';
        expect(readMarkdownMetadata(source).update({ status: 'APPROVED' }))
            .toBe(source.replace('DRAFT', 'APPROVED'));
        expect(readMarkdownMetadata('\uFEFF# Document\r\n').update({ status: 'DRAFT' }))
            .toBe('\uFEFF---\r\ndocument:\r\n  status: DRAFT\r\n---\r\n\r\n# Document\r\n');
        expect(readMarkdownMetadata('---\ndocument:\n  status: DRAFT\n---').update({ status: 'APPROVED' }))
            .toBe('---\ndocument:\n  status: APPROVED\n---');
    });

    it('does not treat later rules or fenced examples as the document header', () => {
        for (const source of [
            '# Body\n\n---\ndocument:\n  status: APPROVED\n---\n',
            '```yaml\n---\ndocument:\n  status: APPROVED\n---\n```\n',
            '---\n\n# Body without a closing fence\n',
        ]) {
            expect(readMarkdownMetadata(source).status).toBeUndefined();
            expect(readMarkdownMetadata(source).update({ status: 'DRAFT' }).endsWith(source)).toBe(true);
        }
    });

    it.each([
        'document:\n  status: [unfinished',
        'document:\n  status: DRAFT\n  status: APPROVED',
        '- DRAFT\n- DERIVED',
        'scalar header',
        'custom: *missing',
        'document: scalar',
    ])('refuses to rewrite an invalid or non-mapping header: %s', header => {
        const metadata = readMarkdownMetadata(`---\n${header}\n---\n\n# Body\n`);
        expect(metadata.error).toBeTruthy();
        expect(() => metadata.update({ status: 'DRAFT' })).toThrow();
    });
});
