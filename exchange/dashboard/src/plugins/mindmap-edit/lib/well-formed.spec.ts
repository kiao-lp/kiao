import { describe, it, expect } from 'vitest';

import { elementsByShape, wellFormedMindmap } from './well-formed';
import { Mindmap, MindmapRelation, Note } from '../model';

const note = (id: string): Note => ({
    id,
    userBounds: [0, 0, null, null],
    bounds: [0, 0, 40, 20],
    content: id
});

const relation = (id: string, from: string, to: string): MindmapRelation => ({
    id,
    ends: [{ id: `END-${id}-${from}`, target: from }, { id: `END-${id}-${to}`, target: to }]
});

const mindmapOf = (notes: unknown[], relations: unknown[]): Mindmap =>
    ({ elements: { notes, relations } } as Mindmap);

const idsOf = (mindmap: Mindmap | null, category: string) =>
    (mindmap?.elements[category] ?? []).map(element => element.id);

describe('elementsByShape', () => {
    it('sorts an element by what it is, not by the category it was filed under', () => {
        const misfiled = mindmapOf([note('NOTE-a'), relation('REL-1', 'NOTE-a', 'NOTE-b')], []);

        const { notes, relations } = elementsByShape(misfiled.elements);

        expect(notes.map(n => n.id)).toEqual(['NOTE-a']);
        expect(relations.map(r => r.id)).toEqual(['REL-1']);
    });

    it('leaves what is neither a note nor a relation', () => {
        const { notes, relations } = elementsByShape({ notes: [{ id: 'NOTE-x' }], relations: [] });

        expect(notes).toEqual([]);
        expect(relations).toEqual([]);
    });

    it('takes a relation only when it has the two ends one is drawn from', () => {
        const oneEnded = { id: 'REL-1', ends: [{ id: 'END-1', target: 'NOTE-a' }] };
        const threeEnded = {
            id: 'REL-2',
            ends: [
                { id: 'END-2', target: 'NOTE-a' },
                { id: 'END-3', target: 'NOTE-b' },
                { id: 'END-4', target: 'NOTE-c' }
            ]
        };

        const { relations } = elementsByShape({ notes: [], relations: [oneEnded, threeEnded] });

        expect(relations).toEqual([]);
    });
});

describe('wellFormedMindmap', () => {
    it('hands back the very map it was given when there is nothing to put right', () => {
        const sound = mindmapOf([note('NOTE-a'), note('NOTE-b')], [relation('REL-1', 'NOTE-a', 'NOTE-b')]);

        expect(wellFormedMindmap(sound)).toBe(sound);
    });

    it('has nothing to say about no map at all', () => {
        expect(wellFormedMindmap(null)).toBeNull();
    });

    // The file the broken copy wrote: a relation filed among the notes, where the component
    // drawing a note destructures bounds it has not got and throws on the first render.
    it('files a relation found among the notes under the relations', () => {
        const broken = mindmapOf(
            [note('NOTE-a'), note('NOTE-b'), relation('REL-1', 'NOTE-a', 'NOTE-b')],
            []
        );

        const put = wellFormedMindmap(broken);

        expect(idsOf(put, 'notes')).toEqual(['NOTE-a', 'NOTE-b']);
        expect(idsOf(put, 'relations')).toEqual(['REL-1']);
    });

    it('drops a relation reaching a note that is not there', () => {
        const dangling = mindmapOf([note('NOTE-a')], [relation('REL-1', 'NOTE-a', 'NOTE-gone')]);

        expect(idsOf(wellFormedMindmap(dangling), 'relations')).toEqual([]);
    });

    it('gives a map both categories, whichever of them the file had', () => {
        const put = wellFormedMindmap({ elements: { notes: [note('NOTE-a')] } } as Mindmap);

        expect(put?.elements.notes.map(n => n.id)).toEqual(['NOTE-a']);
        expect(put?.elements.relations).toEqual([]);
    });

    it('keeps what a map says besides its elements', () => {
        const titled = { title: 'A map', elements: { notes: [note('NOTE-a')] } } as Mindmap;

        expect(wellFormedMindmap(titled)?.title).toBe('A map');
    });

    // What the repair being written back over the file rests on: putting a map right twice is
    // putting it right once, so the second pass cannot ask for a third.
    it('has nothing left to do to a map it has already put right', () => {
        const put = wellFormedMindmap(mindmapOf(
            [note('NOTE-a'), relation('REL-1', 'NOTE-a', 'NOTE-gone')], []
        ));

        expect(wellFormedMindmap(put)).toBe(put);
    });
});
