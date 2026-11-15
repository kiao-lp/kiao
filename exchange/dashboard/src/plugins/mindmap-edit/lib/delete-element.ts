/** Deleting an element, and with it whatever its removal would leave dangling. */

import { Mindmap, MindmapElement, MindmapRelation, instanceOfMindmapRelation } from '../model';

const relatesAny = (element: MindmapElement, ids: Set<string>): boolean =>
    instanceOfMindmapRelation(element) && (element as MindmapRelation).ends.some(end => ids.has(end.target));

/** The mindmap without those elements, and without what only existed to reach them. */
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
