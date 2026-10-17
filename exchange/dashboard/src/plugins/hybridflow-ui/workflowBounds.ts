/**
 * The geometry of the workflows: the rectangle drawn round each group of cards.
 *
 * A workflow holds a name and nothing else — no spot of its own — so its bounds are computed
 * from the cards that name it, the way a container in archdia is: the bounding box of its
 * members, with a small padding round it and extra room on top for the label. Dragging a card
 * redraws the rectangle; dragging the rectangle moves the cards.
 */

import { CardBox } from './boardSpots';

/** One rectangle on the canvas: origin and size in canvas pixels. */
export interface WorkflowRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * The room left round the members inside a workflow: a card's width of air at the sides and
 * below, and twice that on top, where the label sits. The archdia container's own margins,
 * which is what the board mimics.
 */
export const WORKFLOW_PAD_TOP = 32;
export const WORKFLOW_PAD_SIDE = 16;
export const WORKFLOW_PAD_BOTTOM = 16;

/**
 * The rectangle round these member boxes — or null where there are no members to draw round.
 * A group whose cards are all held back by the filter, or all deleted, draws nothing: a
 * rectangle with nothing in it is a shape on the canvas that answers no question.
 */
export const workflowRectOf = (boxes: CardBox[]): WorkflowRect | null => {
    if (boxes.length === 0) return null;
    const minX = Math.min(...boxes.map(box => box.x));
    const minY = Math.min(...boxes.map(box => box.y));
    const maxX = Math.max(...boxes.map(box => box.x + box.w));
    const maxY = Math.max(...boxes.map(box => box.y + box.h));
    return {
        x: minX - WORKFLOW_PAD_SIDE,
        y: minY - WORKFLOW_PAD_TOP,
        w: (maxX - minX) + WORKFLOW_PAD_SIDE * 2,
        h: (maxY - minY) + WORKFLOW_PAD_TOP + WORKFLOW_PAD_BOTTOM,
    };
};
