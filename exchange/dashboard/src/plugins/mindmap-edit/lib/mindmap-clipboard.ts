/**
 * Copying a piece of one map and pasting it into another.
 *
 * What goes on the clipboard is a mindmap — the same shape a `.mmap.json` holds — so a piece cut
 * out of one map pastes into any other, in another tab or another window, through the system
 * clipboard and nothing else.
 *
 * A copy is not a move: what is pasted is *new*, and is named anew. Keeping the names along would
 * make a paste into the map the copy came from a map holding each id twice — one selection naming
 * two notes, one delete taking both — so every note, every relation, every relation end and every
 * group is renamed on the way in.
 *
 * What is pasted is also sanitised against the map it lands in, since the clipboard may hold
 * anything at all: text that is not a map, a relation that lost the note it reached, a note filed
 * where a relation should be. A relation is kept when both its ends still reach something — a note
 * that came with it, or a note already on the map it lands in — and dropped when either does not,
 * a relation reaching nothing being what took the editor down before it could be drawn.
 */

import {
    ElementMap, Mindmap, MindmapElement, MindmapRect, MindmapRelation, MindmapRelationEnd, RelationEnds
} from '../model';
import { NOTES, RELATIONS, elementsByShape } from './well-formed';

/** How a new name is asked for: the kind of element it is for, as the prefix ids are built from. */
export type NewId = (prefix: string) => string;

/**
 * What copying puts on the clipboard: the notes picked out, and the relations that go with them.
 *
 * A relation comes along when it was picked out itself, and also when both the notes it joins
 * were. A box drawn round a piece of the map takes the notes alone — relations are not rectangles
 * and a box never touches one — so a copy that took only what was named would hand back a piece
 * with every line between its notes rubbed out, which is not a copy of that piece.
 */
export const copiedMindmap = (mindmap: Mindmap, selection: string[]): Mindmap => {
    const picked = new Set(selection);
    const { notes, relations } = elementsByShape(mindmap.elements);

    const takenNotes = notes.filter(note => picked.has(note.id));
    const takenIds = new Set(takenNotes.map(note => note.id));

    return {
        elements: {
            [NOTES]: takenNotes,
            [RELATIONS]: relations.filter(relation =>
                picked.has(relation.id) || relation.ends.every(end => takenIds.has(end.target)))
        }
    };
};

/** Every element of a map, notes and relations alike — what a copy or a paste amounts to. */
export const elementsOf = (elements: ElementMap): MindmapElement[] => {
    const { notes, relations } = elementsByShape(elements);
    return [...notes, ...relations];
};

/**
 * The map that clipboard text holds, or nothing at all: the clipboard is shared with every other
 * program, so what is on it is far more often a line of prose than a mindmap, and being handed one
 * is the normal case rather than an error to report.
 */
export const clipboardMindmap = (text: string): Mindmap | null => {
    try {
        const parsed = JSON.parse(text) as Partial<Mindmap>;
        return parsed && typeof parsed === 'object'
            && !!parsed.elements && typeof parsed.elements === 'object'
            ? parsed as Mindmap
            : null;
    } catch {
        return null;
    }
};

/** The end reaching that note under its new name, or nothing when there is no longer one to reach. */
const endReaching = (
    end: MindmapRelationEnd, target: string | undefined, newId: NewId
): MindmapRelationEnd | undefined =>
    target ? { ...end, id: newId('END-'), target } : undefined;

/**
 * What pasting that clipboard into that map adds to it: the notes it holds under new names, and
 * of its relations the ones that still join two notes once the paste has landed.
 */
export const pastedElements = (clipboard: Mindmap, target: Mindmap, newId: NewId): ElementMap => {
    const { notes, relations } = elementsByShape(clipboard.elements);

    /** What each copied note is called once pasted, every one of them being a new note. */
    const renamed = new Map(notes.map(note => [note.id, newId('NOTE-')]));

    /**
     * And what each group among them is called: a group is what a click on one of its notes
     * selects, so copies keeping the group of the notes they were copied from would be welded to
     * those notes — one click taking the copy and the original together, ever after.
     */
    const regrouped = new Map(
        notes.map(note => (note as MindmapRect).group)
            .filter((group): group is string => !!group)
            .map(group => [group, newId('GROUP-')])
    );

    const onTarget = new Set(elementsByShape(target.elements).notes.map(note => note.id));

    /**
     * Where an end reaches, once pasted: the copy of the note it reached when that note came
     * along, the note itself when it did not but is on the map being pasted into — a piece pasted
     * back into the map it came from keeps its lines to the rest of it — and nowhere otherwise.
     */
    const reached = (end: MindmapRelationEnd): string | undefined =>
        renamed.get(end.target) ?? (onTarget.has(end.target) ? end.target : undefined);

    const pastedRelations = relations.flatMap((relation): MindmapRelation[] => {
        const ends = relation.ends.map(end => endReaching(end, reached(end), newId));
        return ends.every(Boolean)
            ? [{ ...relation, id: newId('REL-'), ends: ends as RelationEnds }]
            : [];
    });

    return {
        [NOTES]: notes.map(note => {
            const group = (note as MindmapRect).group;
            return {
                ...note,
                id: renamed.get(note.id) as string,
                ...(group && { group: regrouped.get(group) })
            };
        }),
        [RELATIONS]: pastedRelations
    };
};
