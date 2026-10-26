import { describe, expect, it } from 'vitest';
import { decodeMindmap, encodeMindmap } from './mindmapDocument';
import { Mindmap } from './model';

const IDENTITY = { docId: 'minted-uuid', createdAt: '2026-01-01T00:00:00.000Z' };

const note = (id: string, content = '') => ({ id, userBounds: [0, 0, null, null], content });

const map = (mindmap: Mindmap) => JSON.stringify({
    content: mindmap,
    docType: 'QuickMindmap',
    docId: 'existing-uuid',
    docTypeVersion: 1,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-02T00:00:00.000Z',
}, null, 2);

describe('decodeMindmap', () => {
    it('reads the map out of the document and keeps the envelope', () => {
        const document = decodeMindmap(map({ elements: { notes: [note('NOTE-1')], relations: [] } }));

        expect(document.mindmap.elements.notes).toHaveLength(1);
        expect(document.envelope.docId).toBe('existing-uuid');
    });

    it('accepts the bare content of a document — a map written by hand or pasted in', () => {
        const document = decodeMindmap(JSON.stringify({ elements: { notes: [note('NOTE-1')], relations: [] } }));

        expect(document.mindmap.elements.notes).toHaveLength(1);
        expect(document.envelope).toEqual({});
    });

    it('puts a map right on the way in, rather than at the first render', () => {
        // A relation filed among the notes, and one reaching a note that is gone: what used to
        // throw on the first render and could then never be opened again.
        const document = decodeMindmap(map({
            elements: {
                notes: [note('NOTE-1'), { id: 'REL-stray', ends: [{ target: 'NOTE-1' }, { target: 'NOTE-gone' }] }],
                relations: [],
            },
        } as unknown as Mindmap));

        expect(document.mindmap.elements.notes.map(element => element.id)).toEqual(['NOTE-1']);
        expect(document.mindmap.elements.relations).toEqual([]);
    });

    it('reads a file holding no map at all as an empty one', () => {
        expect(decodeMindmap('[]').mindmap.elements).toEqual({ notes: [], relations: [] });
    });

    it('throws on a file that is not JSON — a file to leave alone', () => {
        expect(() => decodeMindmap('not json')).toThrow();
    });
});

describe('encodeMindmap', () => {
    it('carries the identity the file had through untouched', () => {
        const document = decodeMindmap(map({ elements: { notes: [], relations: [] } }));

        const written = JSON.parse(encodeMindmap(document, IDENTITY));

        expect(written.docId).toBe('existing-uuid');
        expect(written.createdAt).toBe('2025-06-01T00:00:00.000Z');
        expect(written.docType).toBe('QuickMindmap');
        expect(written.docTypeVersion).toBe(1);
        // The stamp moves when the editor saves, not when it serializes: writing the same
        // document twice must write the same text twice.
        expect(written.updatedAt).toBe('2025-06-02T00:00:00.000Z');
    });

    it('writes the same text twice for a document that did not move', () => {
        const document = decodeMindmap(map({ elements: { notes: [note('NOTE-1')], relations: [] } }));

        expect(encodeMindmap(document, IDENTITY)).toBe(encodeMindmap(document, IDENTITY));
    });

    it('gives a document written without one an identity', () => {
        const document = decodeMindmap(JSON.stringify({ elements: { notes: [], relations: [] } }));

        const written = JSON.parse(encodeMindmap(document, IDENTITY));

        expect(written.docId).toBe('minted-uuid');
        expect(written.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('keeps a field this build has never heard of', () => {
        const source = JSON.parse(map({ elements: { notes: [], relations: [] } }));
        source.tags = ['réunion'];

        const written = JSON.parse(encodeMindmap(decodeMindmap(JSON.stringify(source)), IDENTITY));

        expect(written.tags).toEqual(['réunion']);
    });

    it('writes the fields in the order the store already holds them', () => {
        const document = decodeMindmap(map({ elements: { notes: [], relations: [] } }));

        expect(Object.keys(JSON.parse(encodeMindmap(document, IDENTITY))))
            .toEqual(['content', 'docType', 'docId', 'docTypeVersion', 'createdAt', 'updatedAt']);
    });

    it('re-reads what it writes', () => {
        const document = decodeMindmap(map({ elements: { notes: [note('NOTE-1', '[a](/docs/plan.md)')], relations: [] } }));

        expect(decodeMindmap(encodeMindmap(document, IDENTITY)).mindmap).toEqual(document.mindmap);
    });
});
