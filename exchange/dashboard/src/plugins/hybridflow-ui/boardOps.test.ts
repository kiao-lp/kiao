import { describe, it, expect } from 'vitest';
import {
    archiveFlowNode, archiveFlowNodes, chainFlowNode, chainFlowNodeClass, cloneFlowNode, cloneFlowNodeClass, editClassVersion,
    editFlowNode, editWorkflow, editWorkflowClass, findFlowNode, findWorkflow, findWorkflowClass,
    groupFlowNodeClasses, groupFlowNodes,
    insertClassVersion, insertFlowNodes, liveFlowNodes, moveSpots, placeFlowNodes,
    removeClassVersion, removeFlowNode, removeFlowNodeClasses, removeFlowNodes,
    removeWorkflowClasses, removeWorkflows, unarchiveFlowNodes,
    successorOf, flowNodesOnChat, flowNodesNamed,
} from './boardOps';
import { FlowNodeClass, newClassVersion, newFlowNodeClass } from './flowNodeClass';
import { newFlowNode, BoardContent, FlowNode } from './boardContent';
import { FlowNodeSettings } from './flowNodeSettings';
import { TransitionMode } from './flowNodeSuccess';
import { boardNamed as board } from './test/fixtures';

const flowNode = (title: string): FlowNode => newFlowNode(title);

/**
 * What the board holds — what every assertion here is about.
 */
const shape = (content: BoardContent): string[] => content.flowNodes.map(entry => entry.title);

/** The card of that title. */
const card = (content: BoardContent, title: string): FlowNode =>
    content.flowNodes.find(entry => entry.title === title)!;

describe('a flow node’s own life', () => {
    it('is found wherever it sits', () => {
        const content = board('One', 'Two');
        const at = findFlowNode(content, card(content, 'Two').id)!;
        expect(at.flowNode.title).toBe('Two');
        expect(at.index).toBe(1);
    });

    it('is filed at the end of the board, in the order the cards are given', () => {
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
        const id = card(before, 'One').id;
        const after = editFlowNode(before, id, { title: 'Renamed', settings: { model: 'opus' } })!;
        expect(findFlowNode(after, id)!.flowNode).toMatchObject({ id, title: 'Renamed', settings: { model: 'opus' } });
    });

    it('is removed by id', () => {
        const before = board('One', 'Two');
        expect(shape(removeFlowNode(before, card(before, 'One').id)!)).toEqual(['Two']);
        expect(removeFlowNode(before, 'nowhere')).toBeNull();
    });

    it('names the cards picked out in board order, each once', () => {
        const before = board('One', 'Two', 'Three');
        const ids = [card(before, 'Three').id, card(before, 'One').id, 'nowhere', card(before, 'One').id];
        expect(flowNodesNamed(before, ids).map(entry => entry.title)).toEqual(['One', 'Three']);
    });
});

// A card copied where it stands, which is the menu's Clone. What it carries is the question: the
// card's own text, yes; the id and the conversation, never; the chain, because the card it names is
// on this very board.
describe('cloning a flow node', () => {
    /** A board of two chained cards, the first played in a chat. */
    const chained = (): BoardContent => {
        const content = board('One', 'Two', 'Elsewhere');
        const [one, two] = content.flowNodes;
        return editFlowNode(content, one.id, {
            chat: 'chat-1',
            tags: ['bug'],
            onSuccess: { flowNode: two.id, flowNodes: [], mode: 'continue', compact: false },
        })!;
    };

    it('files the copy directly under the card it was made from', () => {
        const before = chained();
        const done = cloneFlowNode(before, card(before, 'One').id)!;
        expect(shape(done.content)).toEqual(['One', 'One', 'Two', 'Elsewhere']);
        expect(done.content.flowNodes[1].id).toBe(done.flowNode.id);
    });

    it('gives the copy an id of its own, and no chat', () => {
        const before = chained();
        const original = card(before, 'One');
        const { flowNode: copy } = cloneFlowNode(before, original.id)!;
        expect(copy.id).not.toBe(original.id);
        expect(copy.chat).toBe('');
    });

    // Everything the card says about itself, which is what a copy of it is.
    it('carries the text, the tags and where it stands', () => {
        const before = chained();
        const original = card(before, 'One');
        const { flowNode: copy } = cloneFlowNode(before, original.id)!;
        expect(copy).toMatchObject({
            title: original.title,
            body: original.body,
            tags: ['bug'],
            status: original.status,
            settings: original.settings,
        });
    });

    // Unlike a flow node pasted on its own: what that one named is not in the clipboard, and what this
    // one names is right there on the board.
    it('hands on to what the card it was made from hands on to', () => {
        const before = chained();
        const original = card(before, 'One');
        const { flowNode: copy } = cloneFlowNode(before, original.id)!;
        expect(copy.onSuccess)
            .toEqual({ flowNode: original.onSuccess.flowNode, flowNodes: [], mode: 'continue', compact: false });
    });

    it('leaves the board it was given alone, and is nothing on a card that has gone', () => {
        const before = board('One');
        cloneFlowNode(before, card(before, 'One').id);
        expect(shape(before)).toEqual(['One']);
        expect(cloneFlowNode(before, 'nowhere')).toBeNull();
    });
});

// What a chain drawn from card to card writes. The gesture says which flow node comes next and nothing
// else, so what it can say it writes and what it cannot it leaves alone.
describe('chaining a flow node to another', () => {
    it('draws one that was not there, leaving what the card said about its chat', () => {
        const before = board('First', 'Second');
        const from = card(before, 'First').id;
        const to = card(before, 'Second').id;

        const after = chainFlowNode(before, from, to)!;
        expect(findFlowNode(after, from)!.flowNode.onSuccess).toEqual({ flowNode: to, flowNodes: [], mode: 'end', compact: false });
    });

    // Pulling the line somewhere else changes which flow node comes next, and nothing else: what the
    // card says about its chat says how *this* flow node ends, and a drag between two cards has no
    // opinion about that.
    it('keeps what an existing chain carries when it is pulled to another card', () => {
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

    // A flow node after itself would be a play with no end, so dropping the line back where it started
    // is the plainest way of saying "nothing comes after this".
    it('takes the chain off when it is dropped back on the card it started from', () => {
        const before = board('First', 'Second');
        const [from, second] = before.flowNodes.map(entry => entry.id);
        const chained = editFlowNode(before, from, { onSuccess: { flowNode: second, flowNodes: [], mode: 'end', compact: false } })!;

        expect(findFlowNode(chainFlowNode(chained, from, from)!, from)!.flowNode.onSuccess.flowNode).toBe('');
    });

    it('is nothing when there is nothing to do', () => {
        const before = board('First', 'Second');
        const [from, second] = before.flowNodes.map(entry => entry.id);
        const chained = editFlowNode(before, from, { onSuccess: { flowNode: second, flowNodes: [], mode: 'end', compact: false } })!;

        // A card that already ends there, dropped on nothing.
        expect(chainFlowNode(before, from, null)).toBeNull();
        // The chain already reads that way.
        expect(chainFlowNode(chained, from, second)).toBeNull();
        // Neither end is on the board.
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
    // The run writes it — it is worker that makes the conversation — and it comes back here as
    // a field of the flow node like any other. What the panel does with it is take it off.
    it('is a field of the flow node, and is taken off with an empty one', () => {
        const before = board('Played');
        const id = card(before, 'Played').id;
        const linked = editFlowNode(before, id, { chat: 'chat-1' })!;
        expect(findFlowNode(linked, id)!.flowNode.chat).toBe('chat-1');
        expect(findFlowNode(editFlowNode(linked, id, { chat: '' })!, id)!.flowNode.chat).toBe('');
    });

    // What the delete asks about: whether this card is the last thing naming the conversation.
    it('says which flow nodes are played in it, across the whole board', () => {
        const before = board('One', 'Two', 'Three');
        const [one, two, three] = before.flowNodes;
        const shared = editFlowNode(editFlowNode(before, one.id, { chat: 'chat-1' })!, three.id, { chat: 'chat-1' })!;

        expect(flowNodesOnChat(shared, 'chat-1').map(entry => entry.title)).toEqual(['One', 'Three']);
        expect(flowNodesOnChat(shared, two.chat)).toEqual([]);
    });
});

// ── What a flow node says comes after it ──────────────────────────────────────────

/** Everything a flow node needs to be one of the ones a play reaches. */
const RUNNABLE: FlowNodeSettings = {
    agent: 'claude', model: 'opus', effort: 'high', permission: 'manualLive', folder: '/',
};

/** Two playable flow nodes, the first of which names the second after it. */
const chained = (mode: TransitionMode = 'continue', compact = false) => {
    const second = newFlowNode('Second', '', RUNNABLE);
    const first = newFlowNode('First', '', RUNNABLE, { flowNode: second.id, flowNodes: [], mode, compact });
    const content: BoardContent = {
            flowNodes: [first, second], flowNodeClasses: [],
            workflows: [], workflowClasses: [],
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

    // A document may name a flow node that is gone — one deleted, or an id somebody
    // wrote by hand. Reading is forgiving here as everywhere: nothing follows it.
    it('is nobody where the flow node it names is not on the board', () => {
        const first = newFlowNode('First', '', RUNNABLE, { flowNode: 'never-existed', flowNodes: [], mode: 'continue', compact: false });
        const content: BoardContent = {
                flowNodes: [first], flowNodeClasses: [],
                workflows: [], workflowClasses: [],
            };
        expect(successorOf(content, first)).toBeNull();
    });

    // A chain is a list of turns, and a flow node naming no model is not one.
    it('is nobody where the flow node it names is not playable', () => {
        const { content, first, second } = chained();
        const unplayable = editFlowNode(content, second.id, { settings: {} })!;
        expect(successorOf(unplayable, first)).toBeNull();
    });
});

describe('removing a flow node', () => {
    // Only the id goes: what the surviving card says about its chat is its own, and says nothing
    // about the card that has left the board.
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

// Several cards deleted together — what a Delete aimed at one of the marked cards does. One edit
// to the document, so what the file holds is never a half-done deletion.
describe('removing several flow nodes', () => {
    it('takes them all off, wherever on the board they sit', () => {
        const before = board('One', 'Two', 'Three');
        const ids = [card(before, 'One').id, card(before, 'Three').id];
        expect(shape(removeFlowNodes(before, ids)!)).toEqual(['Two']);
    });

    it('takes the chains that named any of them with them', () => {
        const { content, first, second } = chained('continue', true);
        const without = removeFlowNodes(content, [second.id])!;
        expect(findFlowNode(without, first.id)!.flowNode.onSuccess)
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });

    it('passes over an id naming no card, and takes the rest', () => {
        const before = board('One', 'Two');
        const kept = removeFlowNodes(before, [card(before, 'One').id, 'nowhere'])!;
        expect(shape(kept)).toEqual(['Two']);
    });

    it('is nothing when no id names a card', () => {
        const before = board('One');
        expect(removeFlowNodes(before, ['nowhere'])).toBeNull();
        expect(removeFlowNodes(before, [])).toBeNull();
    });
});

/**
 * Where the cards sit on the board — the field a card dragged across the canvas writes.
 */
describe('placing cards on the board', () => {
    const placed = (content: BoardContent, title: string) =>
        card(content, title)?.spot ?? null;

    it('writes the places of however many cards are named, in one edit', () => {
        const before = board('One', 'Two');
        const after = placeFlowNodes(before, new Map([
            [card(before, 'One').id, { x: 10, y: 20 }],
            [card(before, 'Two').id, { x: 30, y: 40 }],
        ]))!;
        expect(placed(after, 'One')).toEqual({ x: 10, y: 20 });
        expect(placed(after, 'Two')).toEqual({ x: 30, y: 40 });
    });

    // What keeps the view's own placing from being a save on every render.
    it('is nothing where every card already sits where it is being put', () => {
        const before = board('One');
        const one = card(before, 'One');
        const after = placeFlowNodes(before, new Map([[one.id, { x: 10, y: 20 }]]))!;
        expect(placeFlowNodes(after, new Map([[one.id, { x: 10, y: 20 }]]))).toBeNull();
    });

    it('passes over an id naming no card', () => {
        const before = board('One');
        expect(placeFlowNodes(before, new Map([['gone', { x: 1, y: 1 }]]))).toBeNull();
    });
});

describe('moving cards across the board', () => {
    /** A board of placed cards, each at the point its title names. */
    const laid = (spots: Record<string, [number, number]>): BoardContent => {
        const before = board(...Object.keys(spots));
        return placeFlowNodes(before, new Map(before.flowNodes.map(held =>
            [held.id, { x: spots[held.title][0], y: spots[held.title][1] }])))!;
    };
    const at = (content: BoardContent, title: string) =>
        card(content, title)?.spot ?? null;
    const idOf = (content: BoardContent, title: string) => card(content, title).id;

    it('moves one card by the distance the gesture travelled', () => {
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

    // The distance is clipped once, against whichever card of the set would otherwise be pushed off
    // the top or the left: five cards dragged into the corner arrive as five cards.
    it('clips the distance against the set rather than against each card', () => {
        const before = laid({ One: [20, 100], Two: [220, 100] });
        const after = moveSpots(before, [idOf(before, 'One'), idOf(before, 'Two')], -200, 0)!;
        expect(at(after, 'One')).toEqual({ x: 0, y: 100 });
        expect(at(after, 'Two')).toEqual({ x: 200, y: 100 });
    });

    it('passes over a card that has never been placed', () => {
        const before = board('One');
        expect(moveSpots(before, [card(before, 'One').id], 10, 10)).toBeNull();
    });
});

describe('a cloned card on the board', () => {
    it('is set clear of the card it was made from rather than under it', () => {
        const before = board('One');
        const one = card(before, 'One');
        const placedBoard = placeFlowNodes(before, new Map([[one.id, { x: 100, y: 100 }]]))!;
        const done = cloneFlowNode(placedBoard, one.id)!;
        expect(done.flowNode.spot).not.toBeNull();
        expect(done.flowNode.spot!.x).toBeGreaterThan(100);
        expect(done.flowNode.spot!.y).toBeGreaterThan(100);
    });

    it('has no place where the card it was made from has none', () => {
        const before = board('One');
        expect(cloneFlowNode(before, card(before, 'One').id)!.flowNode.spot).toBeNull();
    });
});

// The classes the board is showing: the same gestures as the cards — place one, chain one to
// another, take one off — on the classes' own list, because the two kinds chain among
// themselves and never across.
describe('boardOps — node classes', () => {
    const classOf = (id: string, over: Partial<FlowNodeClass> = {}): FlowNodeClass => ({
        ...newFlowNodeClass('ai'), id, title: id, ...over,
    });

    it('chains a class to another, and refuses a chain onto a flow node', () => {
        const first = classOf('c1');
        const second = classOf('c2');
        const card = { ...flowNode('Card'), id: 'n1' };
        const content: BoardContent = {
            flowNodes: [card],
            flowNodeClasses: [first, second],
            workflows: [], workflowClasses: [],
        };
        const chained = chainFlowNodeClass(content, 'c1', 'c2');
        expect(chained?.flowNodeClasses[0].onSuccess.flowNode).toBe('c2');
        // A chain naming a simple flow node is refused: the two kinds chain among themselves.
        expect(chainFlowNodeClass(content, 'c1', 'n1')).toBeNull();
        // And chaining a flow node onto a class is refused the same way.
        expect(chainFlowNode(content, 'n1', 'c1')).toBeNull();
    });

    it('takes a chain off with a null target', () => {
        const first = classOf('c1', { onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'end', compact: false } });
        const content: BoardContent = {
            flowNodes: [], flowNodeClasses: [first, classOf('c2')],
            workflows: [], workflowClasses: [],
        };
        const unchained = chainFlowNodeClass(content, 'c1', null);
        expect(unchained?.flowNodeClasses[0].onSuccess.flowNode).toBe('');
    });

    it('removes classes with the chains that named them', () => {
        const first = classOf('c1', { onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'end', compact: false } });
        const content: BoardContent = {
            flowNodes: [], flowNodeClasses: [first, classOf('c2')],
            workflows: [], workflowClasses: [],
        };
        const removed = removeFlowNodeClasses(content, ['c2']);
        expect(removed?.flowNodeClasses.map(one => one.id)).toEqual(['c1']);
        expect(removed?.flowNodeClasses[0].onSuccess.flowNode).toBe('');
    });

    it('files and edits versions under their class', () => {
        const content: BoardContent = {
            flowNodes: [], flowNodeClasses: [classOf('c1')],
            workflows: [], workflowClasses: [],
        };
        const version = newClassVersion([]);
        const filed = insertClassVersion(content, 'c1', { ...version, body: 'Read it.' });
        expect(filed?.flowNodeClasses[0].versions).toHaveLength(1);
        const edited = editClassVersion(filed as BoardContent, 'c1', version.id, { status: 'published' });
        expect(edited?.flowNodeClasses[0].versions[0].status).toBe('published');
    });

    it('takes a version off its class, and only that one', () => {
        const first = { ...newClassVersion([]), id: 'v1', number: 1 };
        const second = { ...newClassVersion([]), id: 'v2', number: 2 };
        const content: BoardContent = {
            flowNodes: [],
            flowNodeClasses: [classOf('c1', { versions: [first, second] })],
            workflows: [], workflowClasses: [],
        };
        const removed = removeClassVersion(content, 'c1', 'v2');
        expect(removed?.flowNodeClasses[0].versions.map(version => version.id)).toEqual(['v1']);
        expect(removeClassVersion(content, 'c1', 'v9')).toBeNull();
        expect(removeClassVersion(content, 'c9', 'v1')).toBeNull();
    });
});

// A class copied where it stands, which is the class menu's Clone. What it carries is the
// question: the class's own answers, yes; a single version — the latest — as a draft, never the
// whole succession; the chain, because the class it names is on this very board.
describe('cloning a node class', () => {
    const classOf = (id: string, over: Partial<FlowNodeClass> = {}): FlowNodeClass => ({
        ...newFlowNodeClass('ai'), id, title: id, ...over,
    });

    /** A board of two classes, the first holding a published version and a newer draft. */
    const boardWithClasses = (): BoardContent => ({
        flowNodes: [],
        flowNodeClasses: [
            classOf('c1', {
                title: 'Review',
                tags: ['bug'],
                permission: 'manualLive',
                runner: 'r1',
                note: 'When the diff is ready.',
                spot: { x: 100, y: 100 },
                onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'continue', compact: true },
                versions: [
                    {
                        id: 'v1', number: 1, body: 'First words.',
                        criteria: [{ id: 'k1', text: 'Done' }], template: false, agent: 'a1', status: 'published',
                    },
                    {
                        id: 'v2', number: 2, body: 'Newer words.',
                        criteria: [{ id: 'k2', text: 'Held' }], template: true, agent: 'a1', status: 'draft',
                    },
                ],
            }),
            classOf('c2', { title: 'Next' }),
        ],
        workflows: [], workflowClasses: [],
    });

    it('files the copy directly under the class it was made from', () => {
        const before = boardWithClasses();
        const done = cloneFlowNodeClass(before, 'c1')!;
        expect(done.content.flowNodeClasses.map(one => one.title))
            .toEqual(['Review', 'Review', 'Next']);
        expect(done.content.flowNodeClasses[1].id).toBe(done.flowNodeClass.id);
    });

    it('gives the copy an id of its own, set clear of the class it was made from', () => {
        const before = boardWithClasses();
        const { flowNodeClass: copy } = cloneFlowNodeClass(before, 'c1')!;
        expect(copy.id).not.toBe('c1');
        expect(copy.spot).toEqual({ x: 128, y: 128 });
    });

    it('carries the class answers, and hands on to what the original hands on to', () => {
        const before = boardWithClasses();
        const { flowNodeClass: copy } = cloneFlowNodeClass(before, 'c1')!;
        expect(copy).toMatchObject({
            title: 'Review',
            type: 'ai',
            tags: ['bug'],
            permission: 'manualLive',
            runner: 'r1',
            note: 'When the diff is ready.',
            onSuccess: { flowNode: 'c2', flowNodes: [], mode: 'continue', compact: true },
        });
    });

    it('holds only the latest version, copied as a draft', () => {
        const before = boardWithClasses();
        const { flowNodeClass: copy } = cloneFlowNodeClass(before, 'c1')!;
        expect(copy.versions).toHaveLength(1);
        const [version] = copy.versions;
        expect(version.id).not.toBe('v2');
        expect(version).toMatchObject({
            number: 1,
            body: 'Newer words.',
            criteria: [{ id: 'k2', text: 'Held' }],
            template: true,
            agent: 'a1',
            status: 'draft',
        });
    });

    it('holds the latest version as a draft where even that one is published', () => {
        const before = boardWithClasses();
        before.flowNodeClasses[0].versions = [
            {
                id: 'v1', number: 1, body: 'Frozen words.',
                criteria: [], template: false, agent: '', status: 'published',
            },
        ];
        const { flowNodeClass: copy } = cloneFlowNodeClass(before, 'c1')!;
        expect(copy.versions).toHaveLength(1);
        expect(copy.versions[0]).toMatchObject({
            number: 1, body: 'Frozen words.', status: 'draft',
        });
        expect(copy.versions[0].id).not.toBe('v1');
    });

    it('holds no version where the class it was made from holds none', () => {
        const content: BoardContent = {
            flowNodes: [], flowNodeClasses: [classOf('c1')],
            workflows: [], workflowClasses: [],
        };
        const { flowNodeClass: copy } = cloneFlowNodeClass(content, 'c1')!;
        expect(copy.versions).toEqual([]);
    });

    it('leaves the board it was given alone, and is nothing on a class that has gone', () => {
        const before = boardWithClasses();
        cloneFlowNodeClass(before, 'c1');
        expect(before.flowNodeClasses).toHaveLength(2);
        expect(before.flowNodeClasses[0].versions).toHaveLength(2);
        expect(cloneFlowNodeClass(before, 'nowhere')).toBeNull();
    });
});

describe('workflows', () => {
    const grouped = (): BoardContent => {
        const content = board('One', 'Two', 'Three');
        const [one, two] = content.flowNodes;
        return groupFlowNodes(content, { id: 'w1', name: 'Sprint' }, [one.id, two.id])!;
    };

    const classOf = (id: string, over: Partial<FlowNodeClass> = {}): FlowNodeClass => ({
        ...newFlowNodeClass('ai'), id, title: id, ...over,
    });

    /** A board of two classes. */
    const boardWithClasses = (): BoardContent => ({
        flowNodes: [],
        flowNodeClasses: [classOf('c1', { title: 'One' }), classOf('c2', { title: 'Two' })],
        workflows: [], workflowClasses: [],
    });

    // Filing a workflow: the rectangle at the board's end, and each member naming it.
    it('files a workflow round the cards it names', () => {
        const after = grouped();
        expect(after.workflows).toEqual([{ id: 'w1', name: 'Sprint' }]);
        expect(after.flowNodes.map(card => card.workflow)).toEqual(['w1', 'w1', '']);
    });

    // A card already grouped is moved: the rectangle filed round it takes it out of the first,
    // a card being in at most one workflow.
    it('moves a card already grouped into the new workflow', () => {
        const before = grouped();
        const [one, , three] = before.flowNodes;
        const after = groupFlowNodes(before, { id: 'w2', name: 'Next' }, [one.id, three.id])!;
        expect(after.flowNodes.map(card => card.workflow)).toEqual(['w2', 'w1', 'w2']);
    });

    // Ids naming no card are passed over — and where none names one, there is no rectangle.
    it('passes over ids naming no card, and files nothing for none', () => {
        const before = board('One', 'Two');
        const after = groupFlowNodes(before, { id: 'w1', name: 'Sprint' }, [before.flowNodes[0].id, 'nowhere'])!;
        expect(after.workflows).toHaveLength(1);
        expect(after.flowNodes.map(card => card.workflow)).toEqual(['w1', '']);
        expect(groupFlowNodes(before, { id: 'w2', name: 'Empty' }, ['nowhere'])).toBeNull();
    });

    // Renaming touches the name alone: the members keep naming the rectangle they are in.
    it('renames a workflow and leaves its members naming it', () => {
        const after = editWorkflow(grouped(), 'w1', 'Release')!;
        expect(findWorkflow(after, 'w1')?.name).toBe('Release');
        expect(after.flowNodes.map(card => card.workflow)).toEqual(['w1', 'w1', '']);
        expect(editWorkflow(grouped(), 'nowhere', 'Release')).toBeNull();
    });

    // Taking a workflow off ungroups its cards, which stay where they are: the rectangle goes,
    // the cards stay.
    it('ungroups the members of a workflow taken off', () => {
        const after = removeWorkflows(grouped(), ['w1', 'nowhere'])!;
        expect(after.workflows).toEqual([]);
        expect(after.flowNodes.map(card => card.title)).toEqual(['One', 'Two', 'Three']);
        expect(after.flowNodes.map(card => card.workflow)).toEqual(['', '', '']);
        expect(removeWorkflows(grouped(), ['nowhere'])).toBeNull();
    });

    // Deleting the last member takes the rectangle with it: a rectangle with nothing in it is
    // a shape nobody can pick up again, so the board does not keep it.
    it('takes a workflow emptied by a delete with its cards', () => {
        const before = grouped();
        const [one, two] = before.flowNodes;
        const emptied = removeFlowNodes(before, [one.id, two.id])!;
        expect(emptied.workflows).toEqual([]);
        const halved = removeFlowNodes(before, [one.id])!;
        expect(halved.workflows).toEqual([{ id: 'w1', name: 'Sprint' }]);
        expect(halved.flowNodes.map(card => card.workflow)).toEqual(['w1', '']);
    });

    // The workflow classes mirror the workflows: filed with their classes, taken off into
    // ungrouped ones.
    it('files and removes workflow classes round the classes they name', () => {
        const before = boardWithClasses();
        const [first, second] = before.flowNodeClasses;
        const after = groupFlowNodeClasses(before, { id: 'wc1', name: 'Shapes' }, [first.id, second.id])!;
        expect(after.workflowClasses).toEqual([{ id: 'wc1', name: 'Shapes' }]);
        expect(after.flowNodeClasses.map(one => one.workflowClass)).toEqual(['wc1', 'wc1']);
        expect(findWorkflowClass(after, 'wc1')?.name).toBe('Shapes');
        expect(findWorkflowClass(after, 'nowhere')).toBeNull();
        expect(findWorkflow(after, 'nowhere')).toBeNull();
        const renamed = editWorkflowClass(after, 'wc1', 'Forms')!;
        expect(renamed.workflowClasses).toEqual([{ id: 'wc1', name: 'Forms' }]);
        const ungrouped = removeWorkflowClasses(renamed, ['wc1'])!;
        expect(ungrouped.workflowClasses).toEqual([]);
        expect(ungrouped.flowNodeClasses.map(one => one.workflowClass)).toEqual(['', '']);
        const emptied = removeFlowNodeClasses(after, [first.id, second.id])!;
        expect(emptied.workflowClasses).toEqual([]);
    });
});

describe("chaining a gateway's branches", () => {
    const gatewayBoard = (): BoardContent => ({
        flowNodes: [
            { ...newFlowNode('Join'), type: 'gateway' },
            newFlowNode('Left'),
            newFlowNode('Right'),
        ],
        flowNodeClasses: [], workflows: [], workflowClasses: [],
    });

    // A line drawn on the board is one more branch, not a branch redrawn: each drag adds its
    // target to the list, in the order drawn.
    it('adds each target to the branches, in order', () => {
        const before = gatewayBoard();
        const [join, left, right] = before.flowNodes.map(entry => entry.id);

        const once = chainFlowNode(before, join, left)!;
        expect(findFlowNode(once, join)!.flowNode.onSuccess.flowNodes).toEqual([left]);
        const twice = chainFlowNode(once, join, right)!;
        expect(findFlowNode(twice, join)!.flowNode.onSuccess.flowNodes).toEqual([left, right]);
    });

    it('is nothing where the branch is already held, the card itself, or nothing at all', () => {
        const before = gatewayBoard();
        const [join, left] = before.flowNodes.map(entry => entry.id);
        const once = chainFlowNode(before, join, left)!;

        // Held already.
        expect(chainFlowNode(once, join, left)).toBeNull();
        // A branch after itself would be a play with no end.
        expect(chainFlowNode(once, join, join)).toBeNull();
        // Dropped on empty board: the gesture named no branch, and taking them all off is not
        // what it says. Branches are taken off in the panel.
        expect(chainFlowNode(once, join, null)).toBeNull();
        // No branch there to begin with, either.
        expect(chainFlowNode(before, join, null)).toBeNull();
        // Neither end is on the board.
        expect(chainFlowNode(before, 'nowhere', left)).toBeNull();
        expect(chainFlowNode(before, join, 'nowhere')).toBeNull();
    });
});

describe('archiving a flow node', () => {
    it('hides the card without deleting it, with its links', () => {
        const { content, first, second } = chained();
        const archived = archiveFlowNode(content, second.id)!;
        // Stored, not gone — and hidden from what the board draws.
        expect(findFlowNode(archived, second.id)!.flowNode.archived).toBe(true);
        expect(liveFlowNodes(archived).map(entry => entry.id)).toEqual([first.id]);
        // The stored link stays, but nothing follows it: the chain ends where the hidden card was.
        expect(successorOf(archived, first)).toBeNull();
        expect(successorOf(archived, second)).toBeNull();
    });

    it('refuses a chain to or from an archived card, without breaking', () => {
        const { content, first, second } = chained();
        const archived = archiveFlowNodes(content, [second.id])!;
        expect(chainFlowNode(archived, first.id, second.id)).toBeNull();
        expect(chainFlowNode(archived, second.id, first.id)).toBeNull();
    });

    it('brings the card back on unarchive', () => {
        const { content, first, second } = chained();
        const archived = archiveFlowNode(content, second.id)!;
        const back = unarchiveFlowNodes(archived, [second.id])!;
        expect(liveFlowNodes(back).map(entry => entry.id)).toEqual([first.id, second.id]);
        expect(successorOf(back, first)!.id).toBe(second.id);
    });
});
