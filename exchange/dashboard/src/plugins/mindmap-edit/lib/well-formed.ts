/** A map put right: every element under the category its shape says, and no relation left reaching for. */

import {
    ElementMap, Mindmap, MindmapElement, MindmapRect, MindmapRelation,
    instanceOfMindmapRect, instanceOfMindmapRelation
} from '../model';

/** The two categories a map is made of. */
export const NOTES = 'notes';
export const RELATIONS = 'relations';

/** Named, and an object: what is neither can be nothing on the map, and is not looked at further. */
const isElement = (value: unknown): value is MindmapElement =>
    !!value && typeof value === 'object' && typeof (value as MindmapElement).id === 'string';

/** A relation is what joins two notes: exactly two ends, which is what everything drawing one assumes. */
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

/** The elements of a map sorted by what they are. */
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

/** That map, or — when something about it could not be drawn — the map it should have been. */
export const wellFormedMindmap = (mindmap: Mindmap | null): Mindmap | null => {
    if (!mindmap) return mindmap;

    const { notes, relations } = elementsByShape(mindmap.elements);
    const kept = relationsBetween(relations, new Set(notes.map(note => note.id)));

    const unchanged = Object.keys(mindmap.elements ?? {}).length === 2
        && sameElements(mindmap.elements?.[NOTES], notes)
        && sameElements(mindmap.elements?.[RELATIONS], kept);

    return unchanged ? mindmap : { ...mindmap, elements: { [NOTES]: notes, [RELATIONS]: kept } };
};
