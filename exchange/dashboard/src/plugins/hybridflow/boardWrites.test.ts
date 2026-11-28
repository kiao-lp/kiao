import { describe, it, expect } from 'vitest';
import {
    writeCreate, writeCreateWorkflow,
    writeDeleteEmptiedWorkflows,
    writeSpots, patchOf, newFlowNodeDto,
} from './boardWrites';
import { groupFlowNodes, insertFlowNodes, removeFlowNodes } from './boardOps';
import { newFlowNode, BoardContent, FlowNode } from './boardContent';
import { HybridflowClient, HybridflowError, NewFlowNodeDto } from './service';

const HANDLE = 'board';

/** A board holding named nodes. */
const board = (...titles: string[]): BoardContent => ({
    flowNodes: titles.map(title => newFlowNode(title)),
    workflows: [],
});

/** The node of that title, wherever it sits. */
const node = (content: BoardContent, title: string): FlowNode =>
    content.flowNodes.find(flowNode => flowNode.title === title)!;

/** What a create sent, given the board as the local operation left it. */
const created = async (after: BoardContent, flowNodes: FlowNode[]): Promise<NewFlowNodeDto[]> => {
    let sent: NewFlowNodeDto[] = [];
    const client = {
        createFlowNodes: async (_handle: string, dtos: NewFlowNodeDto[]) => { sent = dtos; return []; },
    } as unknown as HybridflowClient;
    await writeCreate(flowNodes)(client, HANDLE, after, after);
    return sent;
};

/** A paste of several nodes is one call — which is the whole of what the service accepts for a block. */
describe('creating nodes', () => {
    it('sends a pasted block in one call, in order', async () => {
        const before = board('Sitting there', 'And there');
        const coming = [newFlowNode('Pasted one'), newFlowNode('Pasted two'), newFlowNode('Pasted three')];
        const after = insertFlowNodes(before, coming)!;

        const sent = await created(after, coming);

        expect(sent.map(dto => dto.title)).toEqual(['Pasted one', 'Pasted two', 'Pasted three']);
        expect(sent.map(dto => dto.id)).toEqual(coming.map(flowNode => flowNode.id));
    });

    it('sends the node as the service is asked to create it', async () => {
        const flowNode = {
            ...newFlowNode('Pasted', 'Do it.', { agent: 'agent-1', effort: 'high' }),
            spot: { x: 100, y: 200 },
        };
        const dto = newFlowNodeDto(flowNode);
        expect(dto).toMatchObject({
            id: flowNode.id,
            title: 'Pasted',
            body: 'Do it.',
            settings: { agent: 'agent-1', effort: 'high' },
            spot: { x: 100, y: 200 },
            status: 'ready',
        });
    });
});

describe('writing spots', () => {
    it('patches every node that moved, and no other', async () => {
        const patched: [string, unknown][] = [];
        const client = {
            patchFlowNode: async (_handle: string, id: string, patch: unknown) => {
                patched.push([id, patch]);
                return undefined;
            },
        } as unknown as HybridflowClient;
        const before = board('One', 'Two');
        const after = insertFlowNodes(before, []) ?? before;

        await writeSpots([node(after, 'One').id, 'gone'])(client, HANDLE, before, {
            ...after,
            flowNodes: after.flowNodes.map(flowNode =>
                (flowNode.title === 'One' ? { ...flowNode, spot: { x: 10, y: 20 } } : flowNode)),
        });

        expect(patched).toEqual([[node(after, 'One').id, { spot: { x: 10, y: 20 } }]]);
    });

    it('clears the spot of a node taken off the board', async () => {
        const patched: [string, unknown][] = [];
        const client = {
            patchFlowNode: async (_handle: string, id: string, patch: unknown) => {
                patched.push([id, patch]);
                return undefined;
            },
        } as unknown as HybridflowClient;
        const after = board('One');

        await writeSpots([node(after, 'One').id])(client, HANDLE, after, after);

        expect(patched).toEqual([[node(after, 'One').id, { clearSpot: true }]]);
    });
});

describe('an edit from the panel', () => {
    it('writes exactly the fields it names', () => {
        expect(patchOf({ title: 'Renamed', tags: ['bug'] }))
            .toEqual({ title: 'Renamed', tags: ['bug'] });
    });

    it('says a spot taken off with the flag an absent field cannot say', () => {
        expect(patchOf({ spot: null })).toEqual({ clearSpot: true });
        expect(patchOf({ spot: { x: 1, y: 2 } })).toEqual({ spot: { x: 1, y: 2 } });
        expect(patchOf({})).toEqual({});
    });

    it('writes a grouping as the workflow named, and an ungrouping as the empty string', () => {
        expect(patchOf({ workflow: 'w1' })).toEqual({ workflow: 'w1' });
        expect(patchOf({ workflow: '' })).toEqual({ workflow: '' });
    });

    it('creates a node inside a rectangle grouped in it', () => {
        const inside = { ...newFlowNode('Inside'), workflow: 'w1' };
        expect(newFlowNodeDto(inside)).toMatchObject({ workflow: 'w1' });
        expect(newFlowNodeDto(newFlowNode('Outside')).workflow).toBeUndefined();
    });
});

describe('filing and emptying workflows', () => {
    it('files a workflow with the nodes it groups', async () => {
        const sent: unknown[] = [];
        const client = {
            createWorkflow: async (_handle: string, dto: unknown) => { sent.push(dto); return {}; },
        } as unknown as HybridflowClient;
        const before = board('One', 'Two');
        const after = groupFlowNodes(
            before, { id: 'w1', name: 'Sprint' },
            [node(before, 'One').id, node(before, 'Two').id])!;

        await writeCreateWorkflow({ id: 'w1', name: 'Sprint' }, [node(before, 'One').id, node(before, 'Two').id])(
            client, HANDLE, before, after);

        expect(sent).toEqual([{ id: 'w1', name: 'Sprint', flowNodes: [node(before, 'One').id, node(before, 'Two').id] }]);
    });

    // A delete that empties a rectangle takes it off the service too — read off the before-and-after, because the gesture.
    it('takes off the workflows a delete emptied, and nothing otherwise', async () => {
        const deleted: string[][] = [];
        const client = {
            deleteWorkflows: async (_handle: string, ids: string[]) => { deleted.push(ids); },
        } as unknown as HybridflowClient;
        const bare = board('One', 'Two');
        const before = groupFlowNodes(
            bare, { id: 'w1', name: 'Sprint' }, [node(bare, 'One').id])!;
        const emptied = removeFlowNodes(before, [before.flowNodes[0].id])!;
        await writeDeleteEmptiedWorkflows()(client, HANDLE, before, emptied);
        expect(deleted).toEqual([['w1']]);

        await writeDeleteEmptiedWorkflows()(client, HANDLE, before, before);
        expect(deleted).toHaveLength(1);
    });

    it('treats a workflow the service already took off as taken off', async () => {
        const client = {
            deleteWorkflows: async () => { throw new HybridflowError(404, 'none of those workflows'); },
        } as unknown as HybridflowClient;
        const bare = board('One');
        const before = groupFlowNodes(
            bare, { id: 'w1', name: 'Sprint' }, [node(bare, 'One').id])!;
        const emptied = removeFlowNodes(before, [before.flowNodes[0].id])!;
        await writeDeleteEmptiedWorkflows()(client, HANDLE, before, emptied);
    });

});

describe("a gateway's branches on the wire", () => {
    it('sends the list beside the single node, and nothing where there are none', () => {
        const join = {
            ...newFlowNode('Join'), type: 'gateway' as const,
            onSuccess: { flowNode: '', flowNodes: ['b', 'a'], mode: 'end' as const, compact: false },
        };
        expect(newFlowNodeDto(join).onSuccess).toEqual({ flowNodes: ['b', 'a'], mode: 'end' });
        expect(patchOf({ onSuccess: join.onSuccess }).onSuccess)
            .toEqual({ flowNodes: ['b', 'a'], mode: 'end' });

        const bare = {
            ...newFlowNode('Join'), type: 'gateway' as const,
            onSuccess: { flowNode: '', flowNodes: [], mode: 'end' as const, compact: false },
        };
        expect(newFlowNodeDto(bare).onSuccess).toBeUndefined();
    });
});
