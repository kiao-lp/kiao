import { describe, it, expect } from 'vitest';
import {
    writeCreate, writeCreateWorkflow, writeCreateWorkflowClass,
    writeDeleteEmptiedWorkflowClasses, writeDeleteEmptiedWorkflows,
    writeSpots, patchOf, patchOfClass, patchOfVersion, newFlowNodeDto,
    newFlowNodeClassDto,
} from './boardWrites';
import { groupFlowNodes, groupFlowNodeClasses, insertFlowNodes, removeFlowNodes } from './boardOps';
import { newClassVersion, newFlowNodeClass } from './flowNodeClass';
import { newFlowNode, BoardContent, FlowNode } from './boardContent';
import { HybridflowClient, HybridflowError, NewFlowNodeDto } from './service';

const HANDLE = 'board';

/** A board holding named cards. */
const board = (...titles: string[]): BoardContent => ({
    flowNodes: titles.map(title => newFlowNode(title)), flowNodeClasses: [],
    workflows: [], workflowClasses: [],
});

/** The card of that title, wherever it sits. */
const card = (content: BoardContent, title: string): FlowNode =>
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

/**
 * A paste of several cards is **one** call — which is the whole of what the service accepts for a
 * block. A refused write is a block of cards drawn on the board and never written: they are there
 * until the board is read again, and gone after. That is the bug these tests are here to keep away.
 */
describe('creating cards', () => {
    it('sends a pasted block in one call, in order', async () => {
        const before = board('Sitting there', 'And there');
        const coming = [newFlowNode('Pasted one'), newFlowNode('Pasted two'), newFlowNode('Pasted three')];
        const after = insertFlowNodes(before, coming)!;

        const sent = await created(after, coming);

        expect(sent.map(dto => dto.title)).toEqual(['Pasted one', 'Pasted two', 'Pasted three']);
        expect(sent.map(dto => dto.id)).toEqual(coming.map(flowNode => flowNode.id));
    });

    it('sends the card as the service is asked to create it', async () => {
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
    it('patches every card that moved, and no other', async () => {
        const patched: [string, unknown][] = [];
        const client = {
            patchFlowNode: async (_handle: string, id: string, patch: unknown) => {
                patched.push([id, patch]);
                return undefined;
            },
        } as unknown as HybridflowClient;
        const before = board('One', 'Two');
        const after = insertFlowNodes(before, []) ?? before;

        await writeSpots([card(after, 'One').id, 'gone'])(client, HANDLE, before, {
            ...after,
            flowNodes: after.flowNodes.map(flowNode =>
                (flowNode.title === 'One' ? { ...flowNode, spot: { x: 10, y: 20 } } : flowNode)),
        });

        expect(patched).toEqual([[card(after, 'One').id, { spot: { x: 10, y: 20 } }]]);
    });

    it('clears the spot of a card taken off the board', async () => {
        const patched: [string, unknown][] = [];
        const client = {
            patchFlowNode: async (_handle: string, id: string, patch: unknown) => {
                patched.push([id, patch]);
                return undefined;
            },
        } as unknown as HybridflowClient;
        const after = board('One');

        await writeSpots([card(after, 'One').id])(client, HANDLE, after, after);

        expect(patched).toEqual([[card(after, 'One').id, { clearSpot: true }]]);
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

    it('writes a version edit as exactly the fields it names', () => {
        expect(patchOfVersion({ body: 'Read it.', template: true }))
            .toEqual({ body: 'Read it.', template: true });
        expect(patchOfVersion({ template: false })).toEqual({ template: false });
        expect(patchOfVersion({ agent: 'a1' })).toEqual({ agent: 'a1' });
        expect(patchOfVersion({})).toEqual({});
    });

    it('writes a class edit as exactly the fields it names', () => {
        expect(patchOfClass({ title: 'Renamed', note: 'When ready.' }))
            .toEqual({ title: 'Renamed', note: 'When ready.' });
        expect(patchOfClass({})).toEqual({});
    });

    it('creates a class with its note and its first version default agent beside it', () => {
        const one = newFlowNodeClass('ai');
        one.id = 'c1';
        one.note = 'When the diff is ready.';
        one.versions = [{ ...newClassVersion([], 'Read it.'), agent: 'a1' }];
        expect(newFlowNodeClassDto(one)).toMatchObject({ note: 'When the diff is ready.', agent: 'a1' });
        const bare = newFlowNodeClass('ai');
        const written = newFlowNodeClassDto(bare);
        expect(written.note).toBeUndefined();
        expect(written.agent).toBeUndefined();
    });

    // Grouping is a field like the title: set where the card is grouped, and the empty string
    // where it is taken out again.
    it('writes a grouping as the workflow named, and an ungrouping as the empty string', () => {
        expect(patchOf({ workflow: 'w1' })).toEqual({ workflow: 'w1' });
        expect(patchOf({ workflow: '' })).toEqual({ workflow: '' });
        expect(patchOfClass({ workflowClass: 'wc1' })).toEqual({ workflowClass: 'wc1' });
        expect(patchOfClass({ workflowClass: '' })).toEqual({ workflowClass: '' });
    });

    it('writes the instantiable tick both ways, and only where ticked at creation', () => {
        expect(patchOfClass({ instantiable: true })).toEqual({ instantiable: true });
        expect(patchOfClass({ instantiable: false })).toEqual({ instantiable: false });
        const one = { ...newFlowNodeClass('ai'), instantiable: true };
        expect(newFlowNodeClassDto(one)).toMatchObject({ instantiable: true });
        expect(newFlowNodeClassDto(newFlowNodeClass('ai')).instantiable).toBeUndefined();
    });

    // A card made inside a rectangle says so at creation — and a card made on the open canvas
    // says nothing, the way every absent field does.
    it('creates a card inside a rectangle grouped in it', () => {
        const inside = { ...newFlowNode('Inside'), workflow: 'w1' };
        expect(newFlowNodeDto(inside)).toMatchObject({ workflow: 'w1' });
        expect(newFlowNodeDto(newFlowNode('Outside')).workflow).toBeUndefined();
        const one = { ...newFlowNodeClass('ai'), workflowClass: 'wc1' };
        expect(newFlowNodeClassDto(one)).toMatchObject({ workflowClass: 'wc1' });
        expect(newFlowNodeClassDto(newFlowNodeClass('ai')).workflowClass).toBeUndefined();
    });
});

describe('filing and emptying workflows', () => {
    // Filing a workflow: one call, the id the editor minted and the cards it groups — the
    // rectangle the editor drew, written as drawn.
    it('files a workflow with the cards it groups', async () => {
        const sent: unknown[] = [];
        const client = {
            createWorkflow: async (_handle: string, dto: unknown) => { sent.push(dto); return {}; },
        } as unknown as HybridflowClient;
        const before = board('One', 'Two');
        const after = groupFlowNodes(
            before, { id: 'w1', name: 'Sprint' },
            [card(before, 'One').id, card(before, 'Two').id])!;

        await writeCreateWorkflow({ id: 'w1', name: 'Sprint' }, [card(before, 'One').id, card(before, 'Two').id])(
            client, HANDLE, before, after);

        expect(sent).toEqual([{ id: 'w1', name: 'Sprint', flowNodes: [card(before, 'One').id, card(before, 'Two').id] }]);
    });

    it('files a workflow class with the classes it groups', async () => {
        const sent: unknown[] = [];
        const client = {
            createWorkflowClass: async (_handle: string, dto: unknown) => { sent.push(dto); return {}; },
        } as unknown as HybridflowClient;
        const before: BoardContent = {
            flowNodes: [], flowNodeClasses: [newFlowNodeClass('ai')],
            workflows: [], workflowClasses: [],
        };
        const after = groupFlowNodeClasses(before, { id: 'wc1', name: 'Shapes' }, [before.flowNodeClasses[0].id])!;

        await writeCreateWorkflowClass({ id: 'wc1', name: 'Shapes' }, [before.flowNodeClasses[0].id])(
            client, HANDLE, before, after);

        expect(sent).toEqual([{ id: 'wc1', name: 'Shapes', classes: [before.flowNodeClasses[0].id] }]);
    });

    // A delete that empties a rectangle takes it off the service too — read off the
    // before-and-after, because the gesture removed cards and the rectangle went with them.
    // A delete that empties nothing writes nothing further.
    it('takes off the workflows a delete emptied, and nothing otherwise', async () => {
        const deleted: string[][] = [];
        const client = {
            deleteWorkflows: async (_handle: string, ids: string[]) => { deleted.push(ids); },
        } as unknown as HybridflowClient;
        const bare = board('One', 'Two');
        const before = groupFlowNodes(
            bare, { id: 'w1', name: 'Sprint' }, [card(bare, 'One').id])!;
        const emptied = removeFlowNodes(before, [before.flowNodes[0].id])!;
        await writeDeleteEmptiedWorkflows()(client, HANDLE, before, emptied);
        expect(deleted).toEqual([['w1']]);

        await writeDeleteEmptiedWorkflows()(client, HANDLE, before, before);
        expect(deleted).toHaveLength(1);
    });

    // The service deletes an emptied rectangle with its last card: a 404 on the
    // follow-up delete is that delete having landed first, not a failure.
    it('treats a workflow the service already took off as taken off', async () => {
        const client = {
            deleteWorkflows: async () => { throw new HybridflowError(404, 'none of those workflows'); },
        } as unknown as HybridflowClient;
        const bare = board('One');
        const before = groupFlowNodes(
            bare, { id: 'w1', name: 'Sprint' }, [card(bare, 'One').id])!;
        const emptied = removeFlowNodes(before, [before.flowNodes[0].id])!;
        await writeDeleteEmptiedWorkflows()(client, HANDLE, before, emptied);
    });

    it('takes off the workflow classes a delete emptied', async () => {
        const deleted: string[][] = [];
        const client = {
            deleteWorkflowClasses: async (_handle: string, ids: string[]) => { deleted.push(ids); },
        } as unknown as HybridflowClient;
        const before: BoardContent = {
            flowNodes: [], flowNodeClasses: [newFlowNodeClass('ai')],
            workflows: [], workflowClasses: [],
        };
        const after = groupFlowNodeClasses(before, { id: 'wc1', name: 'Shapes' }, [before.flowNodeClasses[0].id])!;
        await writeDeleteEmptiedWorkflowClasses()(client, HANDLE, after, before);
        expect(deleted).toEqual([['wc1']]);
    });
});

describe("a gateway's branches on the wire", () => {
    it('sends the list beside the single card, and nothing where there are none', () => {
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
