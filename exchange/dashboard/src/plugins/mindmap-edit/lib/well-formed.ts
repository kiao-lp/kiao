/**
 * A map put right: every element under the category its shape says, and no relation left reaching
 * for a note that is not there.
 *
 * The two components a map is drawn with each need something the other has not — a note is drawn
 * from its `userBounds`, a relation from its `ends` — so an element filed under the wrong category
 * is handed to a component that cannot draw it. A relation among the notes threw on the very first
 * render, the bounds being destructured out of nothing ("e is not iterable"), and took the whole
 * editor down with it; the file then could no longer be opened, the crash coming back on each
 * attempt. Copying used to file every element it took under `notes` whatever it was, so files in
 * that state exist, and this is what lets one be opened again.
 *
 * Sorting is by shape rather than by category on purpose: what a thing is, is what it can be drawn
 * as, and that is the only question a map has to answer before rendering.
 */

import {
    ElementMap, Mindmap, MindmapElement, MindmapRect, MindmapRelation,
    instanceOfMindmapRect, instanceOfMindmapRelation
} from '../model';

/** The two categories a map is made of. Anything filed elsewhere is sorted into one of them. */
export const NOTES = 'notes';
export const RELATIONS = 'relations';

/** Named, and an object: what is neither can be nothing on the map, and is not looked at further. */
const isElement = (value: unknown): value is MindmapElement =>
    !!value && typeof value === 'object' && typeof (value as MindmapElement).id === 'string';

/**
 * A relation is what joins two notes: exactly two ends, which is what everything drawing one
 * assumes — a third end would belong to a second relation, and a single end to no relation at all.
 */
export const isRelation = (value: unknown): value is MindmapRelation =>
    isElement(value) && instanceOfMindmapRelation(value)
    && Array.isArray(value.ends) && value.ends.length === 2
    && value.ends.every(end => !!end && typeof end.target === 'string');

/** A note is what holds a place on the map, which is what drawing one asks of it. */
export const isNote = (value: unknown): value is MindmapRect =>
    isElement(value) && !isRelation(value)
    && instanceOfMindmapRect(value) && Array.isArray(value.userBounds);

/** Every element of a map, whatever category it was filed under. */
const allElements = (elements: ElementMap | undefined): MindmapElement[] =>
    Object.values(elements ?? {}).flatMap(category => Array.isArray(category) ? category : []);

/** The elements of a map sorted by what they are. What is neither a note nor a relation is left. */
export const elementsByShape = (elements: ElementMap | undefined) => {
    const all = allElements(elements);
    return { notes: all.filter(isNote), relations: all.filter(isRelation) };
};

/** Of those relations, the ones both of whose ends reach a note that is among these. */
export const relationsBetween = (relations: MindmapRelation[], noteIds: Set<string>): MindmapRelation[] =>
    relations.filter(relation => relation.ends.every(end => noteIds.has(end.target)));

/** Element for element, the same list — so that a map with nothing to put right is left alone. */
const sameElements = (was: MindmapElement[] | undefined, now: MindmapElement[]): boolean =>
    Array.isArray(was) && was.length === now.length && was.every((element, at) => element === now[at]);

/**
 * That map, or — when something about it could not be drawn — the map it should have been.
 *
 * A map with nothing to put right is handed back as it was given, the very same object: a sound
 * file is then read as itself, no render is repeated for it and nothing is written back over it.
 */
export const wellFormedMindmap = (mindmap: Mindmap | null): Mindmap | null => {
    if (!mindmap) return mindmap;

    const { notes, relations } = elementsByShape(mindmap.elements);
    const kept = relationsBetween(relations, new Set(notes.map(note => note.id)));

    const unchanged = Object.keys(mindmap.elements ?? {}).length === 2
        && sameElements(mindmap.elements?.[NOTES], notes)
        && sameElements(mindmap.elements?.[RELATIONS], kept);

    return unchanged ? mindmap : { ...mindmap, elements: { [NOTES]: notes, [RELATIONS]: kept } };
};
