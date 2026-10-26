/**
 * Deleting an element, and with it whatever its removal would leave dangling.
 *
 * A relation end is drawn from an attach point computed on the bounds of the note it targets, so
 * an end left pointing at a deleted note has nothing to compute: it used to throw on the next
 * render, taking the whole editor down and leaving a file that could no longer be opened. A
 * relation joins exactly two notes, so deleting either of them leaves nothing to relate, and the
 * relation goes with the note.
 */

import { Mindmap, MindmapElement, MindmapRelation, instanceOfMindmapRelation } from '../model';

const relatesAny = (element: MindmapElement, ids: Set<string>): boolean =>
    instanceOfMindmapRelation(element) && (element as MindmapRelation).ends.some(end => ids.has(end.target));

/**
 * The mindmap without those elements, and without what only existed to reach them. Taken in one
 * pass rather than one call per element: a relation between two notes both being deleted would
 * otherwise be looked for a second time, in a map it had already gone from.
 */
export const deleteElements = (mindmap: Mindmap, ids: string[]): Mindmap => {
    const deleted = new Set(ids);
    return {
        ...mindmap,
        elements: Object.fromEntries(
            Object.entries(mindmap.elements).map(([category, elements]) => [
                category,
                elements.filter(element => !deleted.has(element.id) && !relatesAny(element, deleted))
            ])
        )
    };
};

/** The mindmap without the element of that id, and without what only existed to reach it. */
export const deleteElement = (mindmap: Mindmap, id: string): Mindmap => deleteElements(mindmap, [id]);
