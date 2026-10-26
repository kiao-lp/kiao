import { describe, it, expect } from 'vitest';

import { clipboardMindmap, copiedMindmap, elementsOf, pastedElements } from './mindmap-clipboard';
import { Mindmap, MindmapRect, MindmapRelation, Note } from '../model';

const note = (id: string, group?: string): Note => ({
    id,
    userBounds: [0, 0, null, null],
    bounds: [0, 0, 40, 20],
    content: id,
    ...(group && { group })
});

const relation = (id: string, from: string, to: string): MindmapRelation => ({
    id,
    ends: [{ id: `END-${id}-a`, target: from }, { id: `END-${id}-b`, target: to }]
});

const mindmapOf = (notes: unknown[], relations: unknown[]): Mindmap =>
    ({ elements: { notes, relations } } as Mindmap);

/** Names counted out rather than drawn, so that what a paste produces can be spelled out. */
const counting = () => {
    let n = 0;
    return (prefix: string) => `${prefix}${++n}`;
};

const notesOf = (elements: Mindmap['elements']) => elements.notes as Note[];
const relationsOf = (elements: Mindmap['elements']) => elements.relations as MindmapRelation[];

describe('copiedMindmap', () => {
    it('takes the notes picked out and no others', () => {
        const map = mindmapOf([note('NOTE-a'), note('NOTE-b'), note('NOTE-c')], []);

        const copied = copiedMindmap(map, ['NOTE-a', 'NOTE-c']);

        expect(notesOf(copied.elements).map(n => n.id)).toEqual(['NOTE-a', 'NOTE-c']);
    });

    // A box drawn round a piece of the map names its notes and never a relation, so a copy taking
    // only what was named would hand back that piece with every line between its notes rubbed out.
    it('takes a relation whose two notes were both picked out, though it was not named', () => {
        const map = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const copied = copiedMindmap(map, ['NOTE-a', 'NOTE-b']);

        expect(relationsOf(copied.elements).map(r => r.id)).toEqual(['REL-1']);
    });

    it('leaves a relation reaching a note that was not picked out', () => {
        const map = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const copied = copiedMindmap(map, ['NOTE-a']);

        expect(relationsOf(copied.elements)).toEqual([]);
    });

    it('takes a relation that was picked out itself', () => {
        const map = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const copied = copiedMindmap(map, ['REL-1']);

        expect(notesOf(copied.elements)).toEqual([]);
        expect(relationsOf(copied.elements).map(r => r.id)).toEqual(['REL-1']);
    });

    // What used to be written: every element under `notes`, whatever it was. Sorting by shape is
    // what keeps a relation from being pasted where a note is drawn.
    it('files each of them under the category its shape says', () => {
        const map = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const copied = copiedMindmap(map, ['NOTE-a', 'NOTE-b', 'REL-1']);

        expect(Object.keys(copied.elements).sort()).toEqual(['notes', 'relations']);
    });
});

describe('clipboardMindmap', () => {
    it('reads back what a copy wrote', () => {
        const copied = copiedMindmap(mindmapOf([note('NOTE-a')], []), ['NOTE-a']);

        expect(clipboardMindmap(JSON.stringify(copied))).toEqual(copied);
    });

    it('makes nothing of a clipboard holding prose', () => {
        expect(clipboardMindmap('a line someone copied from a page')).toBeNull();
    });

    it('makes nothing of JSON that is not a map', () => {
        expect(clipboardMindmap('{"docType":"QuickMindmap"}')).toBeNull();
        expect(clipboardMindmap('[1, 2, 3]')).toBeNull();
        expect(clipboardMindmap('null')).toBeNull();
    });
});

describe('pastedElements', () => {
    const empty = mindmapOf([], []);

    it('gives every pasted note a new name', () => {
        const clipboard = mindmapOf([note('NOTE-a'), note('NOTE-b')], []);

        const pasted = pastedElements(clipboard, empty, counting());

        expect(notesOf(pasted).map(n => n.id)).toEqual(['NOTE-1', 'NOTE-2']);
    });

    it('keeps everything else a note says', () => {
        const clipboard = mindmapOf([{ ...note('NOTE-a'), background: 'teal', zIndex: 7 }], []);

        const [pasted] = notesOf(pastedElements(clipboard, empty, counting()));

        expect(pasted.content).toBe('NOTE-a');
        expect(pasted.background).toBe('teal');
        expect(pasted.zIndex).toBe(7);
        expect(pasted.userBounds).toEqual([0, 0, null, null]);
    });

    it('has a pasted relation reach the copies of the notes it joined', () => {
        const clipboard = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const pasted = pastedElements(clipboard, empty, counting());
        const [pastedRelation] = relationsOf(pasted);

        expect(pastedRelation.ends.map(end => end.target))
            .toEqual(notesOf(pasted).map(n => n.id));
    });

    it('names the ends of a pasted relation anew as well', () => {
        const clipboard = mindmapOf(
            [note('NOTE-a'), note('NOTE-b')],
            [relation('REL-1', 'NOTE-a', 'NOTE-b')]
        );

        const [pastedRelation] = relationsOf(pastedElements(clipboard, empty, counting()));

        expect(pastedRelation.id).not.toBe('REL-1');
        expect(pastedRelation.ends.map(end => end.id)).toEqual(['END-3', 'END-4']);
    });

    it('keeps how a pasted relation is drawn', () => {
        const bent: MindmapRelation = {
            ...relation('REL-1', 'NOTE-a', 'NOTE-b'), color: 'violet', bend: [12, -4]
        };
        const clipboard = mindmapOf([note('NOTE-a'), note('NOTE-b')], [bent]);

        const [pastedRelation] = relationsOf(pastedElements(clipboard, empty, counting()));

        expect(pastedRelation.color).toBe('violet');
        expect(pastedRelation.bend).toEqual([12, -4]);
    });

    // The whole point of sanitising: a relation with an end reaching nothing is what the note
    // component cannot draw and what took the editor down.
    it('drops a relation whose note came along neither on the clipboard nor on the map', () => {
        const clipboard = mindmapOf([note('NOTE-a')], [relation('REL-1', 'NOTE-a', 'NOTE-gone')]);

        expect(relationsOf(pastedElements(clipboard, empty, counting()))).toEqual([]);
        expect(notesOf(pastedElements(clipboard, empty, counting())).length).toBe(1);
    });

    // A piece pasted back into the map it was cut out of: the note it reaches is still there,
    // under the name the relation knows it by, so that line still means something.
    it('keeps a relation reaching a note already on the map being pasted into', () => {
        const clipboard = mindmapOf([note('NOTE-a')], [relation('REL-1', 'NOTE-a', 'NOTE-b')]);
        const target = mindmapOf([note('NOTE-b')], []);

        const pasted = pastedElements(clipboard, target, counting());
        const [pastedRelation] = relationsOf(pasted);

        expect(pastedRelation.ends.map(end => end.target)).toEqual([notesOf(pasted)[0].id, 'NOTE-b']);
    });

    it('makes nothing of a clipboard holding a relation and neither of its notes', () => {
        const clipboard = mindmapOf([], [relation('REL-1', 'NOTE-a', 'NOTE-b')]);

        expect(elementsOf(pastedElements(clipboard, empty, counting()))).toEqual([]);
    });

    // A group is what a click on one of its notes selects, so copies keeping the group they were
    // copied from would be welded to the originals — one click taking both, ever after.
    it('puts pasted notes in a group of their own', () => {
        const clipboard = mindmapOf([note('NOTE-a', 'GROUP-x'), note('NOTE-b', 'GROUP-x')], []);
        const target = mindmapOf([note('NOTE-a', 'GROUP-x'), note('NOTE-b', 'GROUP-x')], []);

        const [first, second] = notesOf(pastedElements(clipboard, target, counting())) as MindmapRect[];

        expect(first.group).toBe(second.group);
        expect(first.group).not.toBe('GROUP-x');
    });

    it('leaves an ungrouped note ungrouped', () => {
        const [pasted] = notesOf(pastedElements(mindmapOf([note('NOTE-a')], []), empty, counting()));

        expect('group' in pasted).toBe(false);
    });

    // A clipboard written by the copy that filed everything under `notes`: still readable, and
    // read for what its elements are rather than for where they were put.
    it('sorts a clipboard whose relation was filed among the notes', () => {
        const clipboard = mindmapOf(
            [note('NOTE-a'), note('NOTE-b'), relation('REL-1', 'NOTE-a', 'NOTE-b')],
            []
        );

        const pasted = pastedElements(clipboard, empty, counting());

        expect(notesOf(pasted).length).toBe(2);
        expect(relationsOf(pasted).length).toBe(1);
    });
});
