import { describe, it, expect } from 'vitest';
import { workflowRectOf, WORKFLOW_PAD_BOTTOM, WORKFLOW_PAD_SIDE, WORKFLOW_PAD_TOP } from './workflowBounds';
import { CardBox } from './boardSpots';

const box = (x: number, y: number, w: number, h: number): CardBox => ({ x, y, w, h });

describe('workflowRectOf', () => {
    it('fits its members with a padding, roomier on top for the label', () => {
        const rect = workflowRectOf([box(100, 100, 232, 120), box(400, 200, 232, 160)]);
        expect(rect).toEqual({
            x: 100 - WORKFLOW_PAD_SIDE,
            y: 100 - WORKFLOW_PAD_TOP,
            w: (632 - 100) + WORKFLOW_PAD_SIDE * 2,
            h: (360 - 100) + WORKFLOW_PAD_TOP + WORKFLOW_PAD_BOTTOM,
        });
    });

    it('draws round a single member', () => {
        const rect = workflowRectOf([box(100, 100, 232, 120)]);
        expect(rect).toEqual({
            x: 100 - WORKFLOW_PAD_SIDE,
            y: 100 - WORKFLOW_PAD_TOP,
            w: 232 + WORKFLOW_PAD_SIDE * 2,
            h: 120 + WORKFLOW_PAD_TOP + WORKFLOW_PAD_BOTTOM,
        });
    });

    it('draws nothing with no members', () => {
        expect(workflowRectOf([])).toBeNull();
    });
});
