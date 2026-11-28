import { describe, it, expect } from 'vitest';
import {
    archiveFlowNode, archiveFlowNodes, chainFlowNode, cloneFlowNode,
    editFlowNode, editWorkflow, findFlowNode, findWorkflow,
    groupFlowNodes,
    insertFlowNodes, liveFlowNodes, moveSpots, placeFlowNodes,
    removeFlowNode, removeFlowNodes,
    removeWorkflows, unarchiveFlowNodes,
    successorOf, flowNodesOnChat, flowNodesNamed,
} from './boardOps';
import { newFlowNode, BoardContent, FlowNode } from './boardContent';
import { FlowNodeSettings } from './flowNodeSettings';
import { TransitionMode } from './flowNodeSuccess';
import { boardNamed as board } from './test/fixtures';

const flowNode = (title: string): FlowNode => newFlowNode(title);

/** What the board holds — what every assertion here is about. */
const shape = (content: BoardContent): string[] => content.flowNodes.map(entry => entry.title);

/** The node of that title. */
const node = (content: BoardContent, title: string): FlowNode =>
    content.flowNodes.find(entry => entry.title === title)!;

describe('a flow node’s own life', () => {
    it('is found wherever it sits', () => {
        const content = board('One', 'Two');
        const at = findFlowNode(content, node(content, 'Two').id)!;
        expect(at.flowNode.title).toBe('Two');
        expect(at.index).toBe(1);
    });

    it('is filed at the end of the board, in the order the nodes are given', () => {
        const before = board('One', 'Two');
        const after = insertFlowNodes(before, [flowNode('A'), flowNode('B')])!;
        expect(shape(after)).toEqual(['One', 'Two', 'A', 'B']);
    });

    it('files none where none is given', () => {
        const before = board('One');
        expect(insertFlowNodes(before, [])).toBeNull();
    });

    it('is edited field by field, and keeps its id', () => {
        const before = board('One');
        const id = node(before, 'One').id;
        const after = editFlowNode(before, id, { title: 'Renamed', settings: { model: 'opus' } })!;
        expect(findFlowNode(after, id)!.flowNode).toMatchObject({ id, title: 'Renamed', settings: { model: 'opus' } });
    });

    it('is removed by id', () => {
        const before = board('One', 'Two');
        expect(shape(removeFlowNode(before, node(before, 'One').id)!)).toEqual(['Two']);
        expect(removeFlowNode(before, 'nowhere')).toBeNull();
    });

    it('names the nodes picked out in board order, each once', () => {
        const before = board('One', 'Two', 'Three');
        const ids = [node(before, 'Three').id, node(before, 'One').id, 'nowhere', node(before, 'One').id];
        expect(flowNodesNamed(before, ids).map(entry => entry.title)).toEqual(['One', 'Three']);
    });
});

describe('cloning a flow node', () => {

    const chained = (): BoardContent => {
        const content = board('One', 'Two', 'Elsewhere');
        const [one, two] = content.flowNodes;
        return editFlowNode(content, one.id, {
            chat: 'chat-1',
            tags: ['bug'],
            onSuccess: { flowNode: two.id, flowNodes: [], mode: 'continue', compact: false },
        })!;
    };

    it('files the copy directly under the node it was made from', () => {
        const before = chained();
        const done = cloneFlowNode(before, node(before, 'One').id)!;
        expect(shape(done.content)).toEqual(['One', 'One', 'Two', 'Elsewhere']);
        expect(done.content.flowNodes[1].id).toBe(done.flowNode.id);
    });

    it('gives the copy an id of its own, and no chat', () => {
        const before = chained();
        const original = node(before, 'One');
        const { flowNode: copy } = cloneFlowNode(before, original.id)!;
        expect(copy.id).not.toBe(original.id);
        expect(copy.chat).toBe('');
    });

    it('carries the text, tags and settings', () => {
        const before = chained();
        const original = node(before, 'One');
        const { flowNode: copy } = cloneFlowNode(before, original.id)!;
        expect(copy).toMatchObject({
            title: original.title,
            body: original.body,
            tags: ['bug'],
            settings: original.settings,
        });
    });

    it.each([
        ['ai', 'draft'],
        ['human', 'draft'],
        ['scheduler', 'blocked'],
    ] as const)('clones a blocked %s node with status %s', (type, status) => {
        const content = board('One');
        const original = node(content, 'One');
        const before = editFlowNode(content, original.id, { type, status: 'blocked' })!;
        const { content: after, flowNode: copy } = cloneFlowNode(before, original.id)!;

        expect(copy.status).toBe(status);
        expect(findFlowNode(after, original.id)?.flowNode.status).toBe('blocked');
    });

    it('leaves a copied task unlinked to preserve the successor’s single predecessor', () => {
        const before = chained();
        const original = node(before, 'One');
        const { flowNode: copy } = cloneFlowNode(before, original.id)!;
        expect(copy.onSuccess)
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: false });
    });

    it('leaves the board it was given alone, and is nothing on a node that has gone', () => {
        const before = board('One');
        cloneFlowNode(before, node(before, 'One').id);
        expect(shape(before)).toEqual(['One']);
        expect(cloneFlowNode(before, 'nowhere')).toBeNull();
    });
});

describe('chaining a flow node to another', () => {
    it('draws one that was not there, leaving what the node said about its chat', () => {
        const before = board('First', 'Second');
        const from = node(before, 'First').id;
        const to = node(before, 'Second').id;

        const after = chainFlowNode(before, from, to)!;
        expect(findFlowNode(after, from)!.flowNode.onSuccess).toEqual({ flowNode: to, flowNodes: [], mode: 'end', compact: false });
    });

    it('keeps what an existing chain carries when it is pulled to another node', () => {
        const before = board('First', 'Second', 'Third');
        const [from, second, third] = before.flowNodes.map(entry => entry.id);
        const held = { flowNode: second, flowNodes: [], mode: 'continue' as const, compact: true };
        const chained = editFlowNode(before, from, { onSuccess: held })!;

        const after = chainFlowNode(chained, from, third)!;
        expect(findFlowNode(after, from)!.flowNode.onSuccess)
            .toEqual({ flowNode: third, flowNodes: [], mode: 'continue', compact: true });
    });

    it('takes the chain off when it is dropped on nothing, and only the chain', () => {
        const before = board('First', 'Second');
        const [from, second] = before.flowNodes.map(entry => entry.id);
        const held = { flowNode: second, flowNodes: [], mode: 'continue' as const, compact: true };
        const chained = editFlowNode(before, from, { onSuccess: held })!;

        const after = chainFlowNode(chained, from, null)!;
        expect(findFlowNode(after, from)!.flowNode.onSuccess)
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });

    it('takes the chain off when it is dropped back on the node it started from', () => {
        const before = board('First', 'Second');
        const [from, second] = before.flowNodes.map(entry => entry.id);
        const chained = editFlowNode(before, from, { onSuccess: { flowNode: second, flowNodes: [], mode: 'end', compact: false } })!;

        expect(findFlowNode(chainFlowNode(chained, from, from)!, from)!.flowNode.onSuccess.flowNode).toBe('');
    });

    it('is nothing when there is nothing to do', () => {
        const before = board('First', 'Second');
        const [from, second] = before.flowNodes.map(entry => entry.id);
        const chained = editFlowNode(before, from, { onSuccess: { flowNode: second, flowNodes: [], mode: 'end', compact: false } })!;

        expect(chainFlowNode(before, from, null)).toBeNull();
        expect(chainFlowNode(chained, from, second)).toBeNull();
        expect(chainFlowNode(before, 'nowhere', second)).toBeNull();
        expect(chainFlowNode(before, from, 'nowhere')).toBeNull();
    });

    it('leaves the board it was given alone', () => {
        const before = board('First', 'Second');
        const [from, second] = before.flowNodes.map(entry => entry.id);
        chainFlowNode(before, from, second);
        expect(findFlowNode(before, from)!.flowNode.onSuccess.flowNode).toBe('');
    });
});

describe('the chat a flow node is played in', () => {
    it('is a field of the flow node, and is taken off with an empty one', () => {
        const before = board('Played');
        const id = node(before, 'Played').id;
        const linked = editFlowNode(before, id, { chat: 'chat-1' })!;
        expect(findFlowNode(linked, id)!.flowNode.chat).toBe('chat-1');
        expect(findFlowNode(editFlowNode(linked, id, { chat: '' })!, id)!.flowNode.chat).toBe('');
    });

    it('says which flow nodes are played in it, across the whole board', () => {
        const before = board('One', 'Two', 'Three');
        const [one, two, three] = before.flowNodes;
        const shared = editFlowNode(editFlowNode(before, one.id, { chat: 'chat-1' })!, three.id, { chat: 'chat-1' })!;

        expect(flowNodesOnChat(shared, 'chat-1').map(entry => entry.title)).toEqual(['One', 'Three']);
        expect(flowNodesOnChat(shared, two.chat)).toEqual([]);
    });
});

/** Everything a flow node needs to be one of the ones a play reaches. */
const RUNNABLE: FlowNodeSettings = {
    agent: 'claude', model: 'opus', effort: 'high', permission: 'manualLive', folder: '/',
};

/** Two playable flow nodes, the first of which names the second after it. */
const chained = (mode: TransitionMode = 'continue', compact = false) => {
    const second = newFlowNode('Second', '', RUNNABLE);
    const first = newFlowNode('First', '', RUNNABLE, { flowNode: second.id, flowNodes: [], mode, compact });
    const content: BoardContent = {
            flowNodes: [first, second],
            workflows: [],
        };
    return { content, first, second };
};

describe('the flow node played after a played one', () => {
    it('is the one it names', () => {
        const { content, first, second } = chained();
        expect(successorOf(content, first)!.id).toBe(second.id);
    });

    it('is nobody where the flow node names none', () => {
        const { content, second } = chained();
        expect(successorOf(content, second)).toBeNull();
    });

    it('is nobody where the flow node it names is not on the board', () => {
        const first = newFlowNode('First', '', RUNNABLE, { flowNode: 'never-existed', flowNodes: [], mode: 'continue', compact: false });
        const content: BoardContent = {
                flowNodes: [first],
                workflows: [],
            };
        expect(successorOf(content, first)).toBeNull();
    });

    it('is nobody where the flow node it names is not playable', () => {
        const { content, first, second } = chained();
        const unplayable = editFlowNode(content, second.id, { settings: {} })!;
        expect(successorOf(unplayable, first)).toBeNull();
    });
});

describe('removing a flow node', () => {
    // Only the id goes: what the surviving node says about its chat is its own, and says nothing about.
    it('takes the chains that named it with it, and leaves the rest', () => {
        const { content, first, second } = chained('continue', true);
        const without = removeFlowNode(content, second.id)!;
        expect(findFlowNode(without, first.id)!.flowNode.onSuccess)
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });

    it('leaves a chain that named somebody else alone', () => {
        const { content, first, second } = chained('continue', true);
        const third = newFlowNode('Third', '', RUNNABLE);
        const wider = insertFlowNodes(content, [third])!;
        const without = removeFlowNode(wider, third.id)!;
        expect(findFlowNode(without, first.id)!.flowNode.onSuccess)
            .toEqual({ flowNode: second.id, flowNodes: [], mode: 'continue', compact: true });
    });
});

describe('removing several flow nodes', () => {
    it('takes them all off, wherever on the board they sit', () => {
        const before = board('One', 'Two', 'Three');
        const ids = [node(before, 'One').id, node(before, 'Three').id];
        expect(shape(removeFlowNodes(before, ids)!)).toEqual(['Two']);
    });

    it('takes the chains that named any of them with them', () => {
        const { content, first, second } = chained('continue', true);
        const without = removeFlowNodes(content, [second.id])!;
        expect(findFlowNode(without, first.id)!.flowNode.onSuccess)
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });

    it('passes over an id naming no node, and takes the rest', () => {
        const before = board('One', 'Two');
        const kept = removeFlowNodes(before, [node(before, 'One').id, 'nowhere'])!;
        expect(shape(kept)).toEqual(['Two']);
    });

    it('is nothing when no id names a node', () => {
        const before = board('One');
        expect(removeFlowNodes(before, ['nowhere'])).toBeNull();
        expect(removeFlowNodes(before, [])).toBeNull();
    });
});

/** Where the nodes sit on the board — the field a node dragged across the canvas writes. */
describe('placing nodes on the board', () => {
    const placed = (content: BoardContent, title: string) =>
        node(content, title)?.spot ?? null;

    it('writes the places of however many nodes are named, in one edit', () => {
        const before = board('One', 'Two');
        const after = placeFlowNodes(before, new Map([
            [node(before, 'One').id, { x: 10, y: 20 }],
            [node(before, 'Two').id, { x: 30, y: 40 }],
        ]))!;
        expect(placed(after, 'One')).toEqual({ x: 10, y: 20 });
        expect(placed(after, 'Two')).toEqual({ x: 30, y: 40 });
    });

    it('is nothing where every node already sits where it is being put', () => {
        const before = board('One');
        const one = node(before, 'One');
        const after = placeFlowNodes(before, new Map([[one.id, { x: 10, y: 20 }]]))!;
        expect(placeFlowNodes(after, new Map([[one.id, { x: 10, y: 20 }]]))).toBeNull();
    });

    it('passes over an id naming no node', () => {
        const before = board('One');
        expect(placeFlowNodes(before, new Map([['gone', { x: 1, y: 1 }]]))).toBeNull();
    });
});

describe('moving nodes across the board', () => {

    const laid = (spots: Record<string, [number, number]>): BoardContent => {
        const before = board(...Object.keys(spots));
        return placeFlowNodes(before, new Map(before.flowNodes.map(held =>
            [held.id, { x: spots[held.title][0], y: spots[held.title][1] }])))!;
    };
    const at = (content: BoardContent, title: string) =>
        node(content, title)?.spot ?? null;
    const idOf = (content: BoardContent, title: string) => node(content, title).id;

    it('moves one node by the distance the gesture travelled', () => {
        const before = laid({ One: [100, 100] });
        const after = moveSpots(before, [idOf(before, 'One')], 40, -30)!;
        expect(at(after, 'One')).toEqual({ x: 140, y: 70 });
    });

    it('moves a whole set by one distance, so it arrives in the shape it left in', () => {
        const before = laid({ One: [100, 100], Two: [300, 220] });
        const after = moveSpots(before, [idOf(before, 'One'), idOf(before, 'Two')], 50, 50)!;
        expect(at(after, 'One')).toEqual({ x: 150, y: 150 });
        expect(at(after, 'Two')).toEqual({ x: 350, y: 270 });
    });

    // The distance is clipped once, against whichever node of the set would otherwise be pushed off the top.
    it('clips the distance against the set rather than against each node', () => {
        const before = laid({ One: [20, 100], Two: [220, 100] });
        const after = moveSpots(before, [idOf(before, 'One'), idOf(before, 'Two')], -200, 0)!;
        expect(at(after, 'One')).toEqual({ x: 0, y: 100 });
        expect(at(after, 'Two')).toEqual({ x: 200, y: 100 });
    });

    it('passes over a node that has never been placed', () => {
        const before = board('One');
        expect(moveSpots(before, [node(before, 'One').id], 10, 10)).toBeNull();
    });
});

describe('a cloned node on the board', () => {
    it('is set clear of the node it was made from rather than under it', () => {
        const before = board('One');
        const one = node(before, 'One');
        const placedBoard = placeFlowNodes(before, new Map([[one.id, { x: 100, y: 100 }]]))!;
        const done = cloneFlowNode(placedBoard, one.id)!;
        expect(done.flowNode.spot).not.toBeNull();
        expect(done.flowNode.spot!.x).toBeGreaterThan(100);
        expect(done.flowNode.spot!.y).toBeGreaterThan(100);
    });

    it('has no place where the node it was made from has none', () => {
        const before = board('One');
        expect(cloneFlowNode(before, node(before, 'One').id)!.flowNode.spot).toBeNull();
    });
});

describe('workflows', () => {
    const grouped = (): BoardContent => {
        const content = board('One', 'Two', 'Three');
        const [one, two] = content.flowNodes;
        return groupFlowNodes(content, { id: 'w1', name: 'Sprint' }, [one.id, two.id])!;
    };

    it('files a workflow round the nodes it names', () => {
        const after = grouped();
        expect(after.workflows).toEqual([{ id: 'w1', name: 'Sprint' }]);
        expect(after.flowNodes.map(node => node.workflow)).toEqual(['w1', 'w1', '']);
    });

    it('moves a node already grouped into the new workflow', () => {
        const before = grouped();
        const [one, , three] = before.flowNodes;
        const after = groupFlowNodes(before, { id: 'w2', name: 'Next' }, [one.id, three.id])!;
        expect(after.flowNodes.map(node => node.workflow)).toEqual(['w2', 'w1', 'w2']);
    });

    it('passes over ids naming no node, and files nothing for none', () => {
        const before = board('One', 'Two');
        const after = groupFlowNodes(before, { id: 'w1', name: 'Sprint' }, [before.flowNodes[0].id, 'nowhere'])!;
        expect(after.workflows).toHaveLength(1);
        expect(after.flowNodes.map(node => node.workflow)).toEqual(['w1', '']);
        expect(groupFlowNodes(before, { id: 'w2', name: 'Empty' }, ['nowhere'])).toBeNull();
    });

    it('renames a workflow and leaves its members naming it', () => {
        const after = editWorkflow(grouped(), 'w1', 'Release')!;
        expect(findWorkflow(after, 'w1')?.name).toBe('Release');
        expect(after.flowNodes.map(node => node.workflow)).toEqual(['w1', 'w1', '']);
        expect(editWorkflow(grouped(), 'nowhere', 'Release')).toBeNull();
    });

    it('ungroups the members of a workflow taken off', () => {
        const after = removeWorkflows(grouped(), ['w1', 'nowhere'])!;
        expect(after.workflows).toEqual([]);
        expect(after.flowNodes.map(node => node.title)).toEqual(['One', 'Two', 'Three']);
        expect(after.flowNodes.map(node => node.workflow)).toEqual(['', '', '']);
        expect(removeWorkflows(grouped(), ['nowhere'])).toBeNull();
    });

    it('takes a workflow emptied by a delete with its nodes', () => {
        const before = grouped();
        const [one, two] = before.flowNodes;
        const emptied = removeFlowNodes(before, [one.id, two.id])!;
        expect(emptied.workflows).toEqual([]);
        const halved = removeFlowNodes(before, [one.id])!;
        expect(halved.workflows).toEqual([{ id: 'w1', name: 'Sprint' }]);
        expect(halved.flowNodes.map(node => node.workflow)).toEqual(['w1', '']);
    });

});

describe("chaining a gateway's branches", () => {
    const gatewayBoard = (): BoardContent => ({
        flowNodes: [
            { ...newFlowNode('Join'), type: 'gateway' },
            newFlowNode('Left'),
            newFlowNode('Right'),
        ],
        workflows: [],
    });

    it('adds each target to the branches, in order', () => {
        const before = gatewayBoard();
        const [join, left, right] = before.flowNodes.map(entry => entry.id);

        const once = chainFlowNode(before, join, left)!;
        expect(findFlowNode(once, join)!.flowNode.onSuccess.flowNodes).toEqual([left]);
        const twice = chainFlowNode(once, join, right)!;
        expect(findFlowNode(twice, join)!.flowNode.onSuccess.flowNodes).toEqual([left, right]);
    });

    it('is nothing where the branch is already held, the node itself, or nothing at all', () => {
        const before = gatewayBoard();
        const [join, left] = before.flowNodes.map(entry => entry.id);
        const once = chainFlowNode(before, join, left)!;

        expect(chainFlowNode(once, join, left)).toBeNull();
        expect(chainFlowNode(once, join, join)).toBeNull();
        expect(chainFlowNode(once, join, null)).toBeNull();
        expect(chainFlowNode(before, join, null)).toBeNull();
        expect(chainFlowNode(before, 'nowhere', left)).toBeNull();
        expect(chainFlowNode(before, join, 'nowhere')).toBeNull();
    });
});

describe('archiving a flow node', () => {
    it('hides the node without deleting it, with its links', () => {
        const { content, first, second } = chained();
        const archived = archiveFlowNode(content, second.id)!;
        expect(findFlowNode(archived, second.id)!.flowNode.archived).toBe(true);
        expect(liveFlowNodes(archived).map(entry => entry.id)).toEqual([first.id]);
        expect(successorOf(archived, first)).toBeNull();
        expect(successorOf(archived, second)).toBeNull();
    });

    it('refuses a chain to or from an archived node, without breaking', () => {
        const { content, first, second } = chained();
        const archived = archiveFlowNodes(content, [second.id])!;
        expect(chainFlowNode(archived, first.id, second.id)).toBeNull();
        expect(chainFlowNode(archived, second.id, first.id)).toBeNull();
    });

    it('brings the node back on unarchive', () => {
        const { content, first, second } = chained();
        const archived = archiveFlowNode(content, second.id)!;
        const back = unarchiveFlowNodes(archived, [second.id])!;
        expect(liveFlowNodes(back).map(entry => entry.id)).toEqual([first.id, second.id]);
        expect(successorOf(back, first)!.id).toBe(second.id);
    });
});
