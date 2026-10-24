import { describe, it, expect } from 'vitest';
import { workflowRectOf, WORKFLOW_PAD_BOTTOM, WORKFLOW_PAD_SIDE, WORKFLOW_PAD_TOP } from './workflowBounds';
import { CardBox } from './boardSpots';

const box = (x: number, y: number, w: number, h: number): CardBox => ({ x, y, w, h });

describe('workflowRectOf', () => {
    // The rectangle fits its members with a small padding: air at the sides and below, and room
    // on top for the label — the archdia container's own margins.
    it('fits its members with a padding, roomier on top for the label', () => {
        const rect = workflowRectOf([box(100, 100, 232, 120), box(400, 200, 232, 160)]);
        expect(rect).toEqual({
            x: 100 - WORKFLOW_PAD_SIDE,
            y: 100 - WORKFLOW_PAD_TOP,
            w: (632 - 100) + WORKFLOW_PAD_SIDE * 2,
            h: (360 - 100) + WORKFLOW_PAD_TOP + WORKFLOW_PAD_BOTTOM,
        });
    });

    // One card grouped still draws: the rectangle is filed round the marked set, and the set
    // may have shrunk to one since.
    it('draws round a single member', () => {
        const rect = workflowRectOf([box(100, 100, 232, 120)]);
        expect(rect).toEqual({
            x: 100 - WORKFLOW_PAD_SIDE,
            y: 100 - WORKFLOW_PAD_TOP,
            w: 232 + WORKFLOW_PAD_SIDE * 2,
            h: 120 + WORKFLOW_PAD_TOP + WORKFLOW_PAD_BOTTOM,
        });
    });

    // A group with nothing on screen — held back by the filter, or its cards gone — draws
    // nothing: a rectangle with nothing in it answers no question.
    it('draws nothing with no members', () => {
        expect(workflowRectOf([])).toBeNull();
    });
});
