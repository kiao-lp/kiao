/** Copying a piece of one map and pasting it into another. */

import {
    ElementMap, Mindmap, MindmapElement, MindmapRect, MindmapRelation, MindmapRelationEnd, RelationEnds
} from '../model';
import { NOTES, RELATIONS, elementsByShape } from './well-formed';

/** How a new name is asked for: the kind of element it is for, as the prefix ids are built from. */
export type NewId = (prefix: string) => string;

/** What copying puts on the clipboard: the notes picked out, and the relations that go with them. */
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

/** The map that clipboard text holds, or nothing at all: the clipboard is shared with every other. */
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

const endReaching = (
    end: MindmapRelationEnd, target: string | undefined, newId: NewId
): MindmapRelationEnd | undefined =>
    target ? { ...end, id: newId('END-'), target } : undefined;

/** What pasting that clipboard into that map adds to it: the notes it holds under new names, and of. */
export const pastedElements = (clipboard: Mindmap, target: Mindmap, newId: NewId): ElementMap => {
    const { notes, relations } = elementsByShape(clipboard.elements);


    const renamed = new Map(notes.map(note => [note.id, newId('NOTE-')]));


    const regrouped = new Map(
        notes.map(note => (note as MindmapRect).group)
            .filter((group): group is string => !!group)
            .map(group => [group, newId('GROUP-')])
    );

    const onTarget = new Set(elementsByShape(target.elements).notes.map(note => note.id));


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
