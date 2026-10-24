import { describe, it, expect } from 'vitest';

import { deleteElement, deleteElements } from './delete-element';
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

const mindmapOf = (notes: Note[], relations: MindmapRelation[]): Mindmap => ({
    elements: { notes, relations }
});

const relationsOf = (mindmap: Mindmap) => mindmap.elements.relations as MindmapRelation[];
const idsOf = (mindmap: Mindmap, category: string) => mindmap.elements[category].map(element => element.id);

describe('deleteElement', () => {
    it('removes the element from its category', () => {
        const mindmap = mindmapOf([note('NOTE-a'), note('NOTE-b')], []);

        expect(idsOf(deleteElement(mindmap, 'NOTE-a'), 'notes')).toEqual(['NOTE-b']);
    });

    it('leaves the map alone when the id is not in it', () => {
        const mindmap = mindmapOf([note('NOTE-a')], [relation('REL-1', 'NOTE-a', 'NOTE-b')]);

        expect(deleteElement(mindmap, 'NOTE-z')).toEqual(mindmap);
    });

    it('takes away the relation a deleted note was the first end of', () => {
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const after = deleteElement(mindmap, 'NOTE-a');

        expect(idsOf(after, 'notes')).toEqual(['NOTE-b']);
        expect(relationsOf(after)).toEqual([]);
    });

    // Either end will do: a relation joins exactly two notes, so losing one leaves nothing
    // to relate whichever it was.
    it('takes away the relation a deleted note was the second end of', () => {
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const after = deleteElement(mindmap, 'NOTE-b');

        expect(idsOf(after, 'notes')).toEqual(['NOTE-a']);
        expect(relationsOf(after)).toEqual([]);
    });

    it('prunes every relation the note took part in', () => {
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b'), note('NOTE-c')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b'), relation('REL-2', 'NOTE-a', 'NOTE-c')]
        );

        expect(relationsOf(deleteElement(mindmap, 'NOTE-a'))).toEqual([]);
    });

    it('deletes a relation without touching the notes it related', () => {
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const after = deleteElement(mindmap, 'REL-1');

        expect(idsOf(after, 'notes')).toEqual(['NOTE-a', 'NOTE-b']);
        expect(relationsOf(after)).toEqual([]);
    });

    it('keeps the identity of the relations it did not touch, which React.memo reads', () => {
        const untouched = relation('REL-2', 'NOTE-b', 'NOTE-c');
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b'), note('NOTE-c')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b'), untouched]
        );

        expect(relationsOf(deleteElement(mindmap, 'NOTE-a'))[0]).toBe(untouched);
    });

    it('keeps the categories of an empty map', () => {
        const mindmap = mindmapOf([], []);

        expect(deleteElement(mindmap, 'NOTE-a')).toEqual(mindmap);
    });
});

/** What the Delete key takes: a whole selection, of notes and relations together. */
describe('deleteElements', () => {
    it('removes every element named', () => {
        const mindmap = mindmapOf([note('NOTE-a'), note('NOTE-b'), note('NOTE-c')], []);

        expect(idsOf(deleteElements(mindmap, ['NOTE-a', 'NOTE-c']), 'notes')).toEqual(['NOTE-b']);
    });

    it('takes away the relations the deleted notes took part in, whichever end they were', () => {
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b'), note('NOTE-c')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b'), relation('REL-2', 'NOTE-b', 'NOTE-c')]
        );

        const after = deleteElements(mindmap, ['NOTE-a', 'NOTE-c']);

        expect(idsOf(after, 'notes')).toEqual(['NOTE-b']);
        expect(relationsOf(after)).toEqual([]);
    });

    // Both a note and a relation of its own can be selected together — the relation is then
    // named twice over, by itself and by the note it hangs from, and goes once.
    it('deletes notes and relations named in one selection', () => {
        const mindmap = mindmapOf(
            [note('NOTE-a'), note('NOTE-b'), note('NOTE-c')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b'), relation('REL-2', 'NOTE-b', 'NOTE-c')]
        );

        const after = deleteElements(mindmap, ['NOTE-a', 'REL-1']);

        expect(idsOf(after, 'notes')).toEqual(['NOTE-b', 'NOTE-c']);
        expect(idsOf(after, 'relations')).toEqual(['REL-2']);
    });

    it('leaves the map alone when nothing is named', () => {
        const mindmap = mindmapOf([note('NOTE-a')], [relation('REL-1', 'NOTE-a', 'NOTE-b')]);

        expect(deleteElements(mindmap, [])).toEqual(mindmap);
    });
});
