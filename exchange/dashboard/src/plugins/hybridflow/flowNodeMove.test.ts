import { describe, it, expect } from 'vitest';
import { prepareMovedFlowNodes } from './flowNodeMove';
import { newFlowNode } from './boardContent';

/** Taking nodes to another board: the same work, with ids of its own, no place, and only the chains. */
describe('preparing flow nodes for a move', () => {
    it('mints new ids and keeps the order', () => {
        const first = newFlowNode('First');
        const second = newFlowNode('Second');
        const moved = prepareMovedFlowNodes([first, second]);

        expect(moved.map(node => node.title)).toEqual(['First', 'Second']);
        expect(moved.map(node => node.id)).toHaveLength(2);
        expect(moved.map(node => node.id)).not.toContain(first.id);
        expect(moved.map(node => node.id)).not.toContain(second.id);
        expect(new Set(moved.map(node => node.id)).size).toBe(2);
    });

    it('keeps the chains among the moved set, rewritten with the new ids', () => {
        const first = {
            ...newFlowNode('First'),
            onSuccess: { flowNode: 'second-id', flowNodes: [], mode: 'continue' as const, compact: false },
        };
        const second = { ...newFlowNode('Second'), id: 'second-id' };
        const moved = prepareMovedFlowNodes([first, second]);

        expect(moved[0].onSuccess.flowNode).toBe(moved[1].id);
        expect(moved[0].onSuccess.mode).toBe('continue');
    });

    it('takes off a chain naming a node left behind, and keeps how the node ends', () => {
        const moving = {
            ...newFlowNode('Moving'),
            onSuccess: { flowNode: 'stays-behind', flowNodes: [], mode: 'continue' as const, compact: true },
        };
        const [moved] = prepareMovedFlowNodes([moving]);

        expect(moved.onSuccess.flowNode).toBe('');
        expect(moved.onSuccess.mode).toBe('continue');
        expect(moved.onSuccess.compact).toBe(true);
    });

    it('leaves the nodes unplaced, and keeps the chat, the agent and where they stand', () => {
        const node = {
            ...newFlowNode('Played', 'Do it.', { agent: 'agent-1', effort: 'high', folder: '/' }),
            spot: { x: 100, y: 200 },
            status: 'done' as const,
            chat: 'chat-1',
        };
        const [moved] = prepareMovedFlowNodes([node]);

        expect(moved.spot).toBeNull();
        expect(moved.chat).toBe('chat-1');
        expect(moved.settings).toMatchObject({ agent: 'agent-1' });
        expect(moved.status).toBe('done');
        expect(moved.body).toBe('Do it.');
    });

    it('moves nothing where there is nothing to move', () => {
        expect(prepareMovedFlowNodes([])).toEqual([]);
    });
});

describe("a gateway's branches on a move", () => {
    it('keeps the branches among the moved set, rewritten with the new ids', () => {
        const join = {
            ...newFlowNode('Join'), type: 'gateway' as const,
            onSuccess: { flowNode: '', flowNodes: ['left-id', 'right-id'], mode: 'end' as const, compact: false },
        };
        const left = { ...newFlowNode('Left'), id: 'left-id' };
        const right = { ...newFlowNode('Right'), id: 'right-id' };
        const moved = prepareMovedFlowNodes([join, left, right]);

        expect(moved[0].onSuccess.flowNodes).toEqual([moved[1].id, moved[2].id]);
    });

    it('takes off the branches naming nodes left behind', () => {
        const join = {
            ...newFlowNode('Join'), type: 'gateway' as const,
            onSuccess: { flowNode: '', flowNodes: ['left-id', 'stays-behind'], mode: 'end' as const, compact: false },
        };
        const left = { ...newFlowNode('Left'), id: 'left-id' };
        const moved = prepareMovedFlowNodes([join, left]);

        expect(moved[0].onSuccess.flowNodes).toEqual([moved[1].id]);
    });
});
