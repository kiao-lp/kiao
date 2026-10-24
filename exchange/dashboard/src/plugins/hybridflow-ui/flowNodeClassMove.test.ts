import { describe, it, expect } from 'vitest';
import { prepareMovedFlowNodeClasses } from './flowNodeClassMove';
import { FlowNodeClass, newClassVersion, newFlowNodeClass } from './flowNodeClass';

/**
 * Taking classes to another board: the same work, with ids of its own, no place, and only the
 * chains among the moved set — and every version beneath them.
 */
describe('preparing flow node classes for a move', () => {
    const classOf = (title: string): FlowNodeClass => ({ ...newFlowNodeClass('ai'), title });

    it('mints new ids and keeps the order', () => {
        const first = classOf('First');
        const second = classOf('Second');
        const moved = prepareMovedFlowNodeClasses([first, second]);

        expect(moved.map(one => one.title)).toEqual(['First', 'Second']);
        expect(moved.map(one => one.id)).toHaveLength(2);
        expect(moved.map(one => one.id)).not.toContain(first.id);
        expect(moved.map(one => one.id)).not.toContain(second.id);
        expect(new Set(moved.map(one => one.id)).size).toBe(2);
    });

    it('keeps the chains among the moved set, rewritten with the new ids', () => {
        const first = classOf('First');
        const second = classOf('Second');
        first.onSuccess = { flowNode: second.id, flowNodes: [], mode: 'continue', compact: false };
        const moved = prepareMovedFlowNodeClasses([first, second]);

        expect(moved[0].onSuccess.flowNode).toBe(moved[1].id);
        expect(moved[0].onSuccess.mode).toBe('continue');
    });

    it('takes off a chain naming a class left behind, and keeps how the class ends', () => {
        const moving = classOf('Moving');
        moving.onSuccess = { flowNode: 'stays-behind', flowNodes: [], mode: 'continue', compact: true };
        const [moved] = prepareMovedFlowNodeClasses([moving]);

        expect(moved.onSuccess.flowNode).toBe('');
        expect(moved.onSuccess.mode).toBe('continue');
        expect(moved.onSuccess.compact).toBe(true);
    });

    it('leaves the classes unplaced, and keeps the versions, the answers and the preset', () => {
        const one = {
            ...classOf('Review'),
            spot: { x: 100, y: 200 },
            permission: 'manualLive',
            runner: 'runner-1',
            tags: ['bug'],
            versions: [
                { ...newClassVersion([]), body: 'First words.', status: 'published' as const },
                { ...newClassVersion([]), body: 'Second words.', status: 'draft' as const },
            ],
        };
        const [moved] = prepareMovedFlowNodeClasses([one]);

        expect(moved.spot).toBeNull();
        expect(moved.permission).toBe('manualLive');
        expect(moved.runner).toBe('runner-1');
        expect(moved.tags).toEqual(['bug']);
        expect(moved.versions.map(version => version.body)).toEqual(['First words.', 'Second words.']);
        expect(moved.versions.map(version => version.status)).toEqual(['published', 'draft']);
    });

    it('moves nothing where there is nothing to move', () => {
        expect(prepareMovedFlowNodeClasses([])).toEqual([]);
    });
});
