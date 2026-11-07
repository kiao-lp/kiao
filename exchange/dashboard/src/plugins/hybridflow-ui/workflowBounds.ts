/** The geometry of the workflows: the rectangle drawn round each group of cards. */

import { CardBox } from './boardSpots';

/** One rectangle on the canvas: origin and size in canvas pixels. */
export interface WorkflowRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The room left round the members inside a workflow: a card's width of air at the sides and below. */
export const WORKFLOW_PAD_TOP = 32;
export const WORKFLOW_PAD_SIDE = 16;
export const WORKFLOW_PAD_BOTTOM = 16;

/** The rectangle round these member boxes — or null where there are no members to draw round. */
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
