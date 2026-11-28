import { describe, it, expect } from 'vitest';
import { mergeBoardContent } from './boardMerge';
import { noSuccess } from './flowNodeSuccess';
import { READY } from './flowNodeStatus';
import { BoardContent, FlowNode } from './boardContent';

/** The rule the board is edited during a run by: what the service grew and what was typed here both. */

const flowNode = (id: string, over: Partial<FlowNode> = {}): FlowNode =>
    ({
        id, title: id, type: 'human', note: '', value: {}, valueType: '', tags: [], body: '', multiPartTemplate: false,
        criteria: [], complexity: null,
        settings: {}, at: '', spot: null, size: null, status: READY, archived: false, chat: '', onSuccess: noSuccess(),
        workflow: '', ...over,
    });

/** The board those nodes make. */
const board = (...flowNodes: FlowNode[]): BoardContent => (
    ({ flowNodes, workflows: [] }));

/** The board as a shape a test can read: the nodes, by id. */
const shape = (content: BoardContent) => content.flowNodes.map(entry => entry.id);

const find = (content: BoardContent, id: string): FlowNode | undefined =>
    content.flowNodes.find(entry => entry.id === id);

describe('mergeBoardContent – a run writing while a board is being written', () => {
    it('shows the store countdown when a limiter is played after a maximum edit', () => {
        const base = board(flowNode('gate', { type: 'limiter', maxPasses: 3, remainingPasses: 0 }));
        const ours = board(flowNode('gate', { type: 'limiter', title: 'Renamed', maxPasses: 2, remainingPasses: 2 }));
        const theirs = board(flowNode('gate', { type: 'limiter', maxPasses: 2, remainingPasses: 1, status: 'done' }));

        expect(find(mergeBoardContent(base, ours, theirs), 'gate')).toMatchObject({
            title: 'Renamed', maxPasses: 2, remainingPasses: 1, status: 'done',
        });
    });

    it('receives structured output while retaining a description edit', () => {
        const base = board(flowNode('a', { type: 'ai', body: 'Write', outputType: 'schema' }));
        const ours = board(flowNode('a', { type: 'ai', body: 'Write more', outputType: 'schema' }));
        const theirs = board(flowNode('a', {
            type: 'ai', body: 'Write', outputType: 'schema', status: 'done', output: { message: 'hello' },
        }));
        expect(find(mergeBoardContent(base, ours, theirs), 'a')).toMatchObject({
            body: 'Write more', outputType: 'schema', status: 'done', output: { message: 'hello' },
        });
    });
    it('keeps a mark made by the run and a ticket typed here at the same time', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('a'), flowNode('b', { title: 'Written while it ran' }));
        const theirs = board(
            flowNode('a', { status: 'done', chat: 'chat-1' }),
            flowNode('b'),
        );

        const merged = mergeBoardContent(base, ours, theirs);

        expect(find(merged, 'a')).toMatchObject({
            status: 'done', chat: 'chat-1',
        });
        expect(find(merged, 'b')!.title).toBe('Written while it ran');
    });

    // The description is only ever written here: a description typed while the turn ran is kept, which is the node.
    it('keeps a description written here while the play was sending the last one', () => {
        const base = board(flowNode('a', { body: 'Do the thing.' }));
        const ours = board(flowNode('a', { body: 'And then the other thing.' }));
        const theirs = board(flowNode('a', { status: 'done' }));

        const merged = mergeBoardContent(base, ours, theirs);

        expect(find(merged, 'a')!.body).toBe('And then the other thing.');
        expect(find(merged, 'a')!.status).toBe('done');
    });

    it('takes every field the board has not touched from the service', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a'));
        const theirs = board(flowNode('a', {
            title: 'Renamed by a turn', body: 'Written by a turn', multiPartTemplate: true, status: 'error',
        }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')).toMatchObject({
            title: 'Renamed by a turn', body: 'Written by a turn', multiPartTemplate: true, status: 'error',
        });
    });

    it('keeps what was said here when both ends said something about one field', () => {
        const base = board(flowNode('a', { status: READY }));
        const ours = board(flowNode('a', { status: 'draft' }));
        const theirs = board(flowNode('a', { status: 'running' }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')!.status).toBe('draft');
    });
});

describe('mergeBoardContent – the tags a node is filed under', () => {
    // A field the run never touches, like the title: whoever changed it is whoever meant to.
    it('keeps the words typed here while the run was marking the node', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a', { tags: ['bug'] }));
        const theirs = board(flowNode('a', { status: 'done', body: 'Answered.' }));

        const merged = mergeBoardContent(base, ours, theirs);

        expect(find(merged, 'a')).toMatchObject({ tags: ['bug'], status: 'done', body: 'Answered.' });
    });

    it('takes the words the service grew where nothing was said here', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a'));
        const theirs = board(flowNode('a', { tags: ['ui'] }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')!.tags).toEqual(['ui']);
    });
});

describe('mergeBoardContent – role nodes', () => {
    it('merges independent changes to role fields', () => {
        const role = flowNode('role', { type: 'role', roleId: 'reviewers', people: ['Alex Rivera'] });
        const base = board(role);
        const ours = board({ ...role, roleId: 'release-reviewers', roleKind: 'agent', description: 'Review each release.' });
        const theirs = board({ ...role, people: ['Sam Lee'] });
        const expected = { roleId: 'release-reviewers', roleKind: 'agent', people: ['Sam Lee'], description: 'Review each release.' };

        expect(find(mergeBoardContent(base, ours, theirs), role.id)).toMatchObject(expected);
        expect(find(mergeBoardContent(base, theirs, ours), role.id)).toMatchObject(expected);
    });

    it('refreshes empty fields on a role created locally', () => {
        const role = flowNode('role', { type: 'role' });
        const base = board({ ...role, roleId: '', people: [], description: '' });
        const saved = { roleId: 'reviewers', people: ['Alex Rivera'], description: 'Review each release.' };

        expect(find(mergeBoardContent(base, board(role), board({ ...role, ...saved })), role.id)).toMatchObject(saved);
    });
});

describe('mergeBoardContent – nodes arriving and leaving', () => {
    it('takes a flow node the service has that this board has never seen', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a'), flowNode('mine'));
        const theirs = board(flowNode('a'), flowNode('theirs'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['a', 'theirs', 'mine']);
    });

    it('lets go of a flow node deleted at the other end', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('a', { title: 'Typed' }), flowNode('b'));
        const theirs = board(flowNode('a'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['a']);
    });

    it('keeps a flow node deleted at the other end that has been written here since', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('a'), flowNode('b', { body: 'Half a ticket' }));
        const theirs = board(flowNode('a'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['a', 'b']);
    });

    it('leaves a flow node deleted here deleted', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('a'));
        const theirs = board(flowNode('a'), flowNode('b'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['a']);
    });
});

describe('mergeBoardContent – where the nodes sit', () => {
    it('keeps a node placed here against the service holding it unplaced', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a', { spot: { x: 100, y: 100 } }));
        const theirs = board(flowNode('a', { status: 'done' }));

        const merged = mergeBoardContent(base, ours, theirs);
        expect(find(merged, 'a')!.spot).toEqual({ x: 100, y: 100 });
        expect(find(merged, 'a')!.status).toBe('done');
    });

    it('takes a node placed elsewhere where nothing placed it here', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a'));
        const theirs = board(flowNode('a', { spot: { x: 100, y: 100 } }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')!.spot).toEqual({ x: 100, y: 100 });
    });

    it('takes an arrangement made elsewhere when nothing has been moved here', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('a'), flowNode('b'));
        const theirs = board(flowNode('b'), flowNode('a'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['b', 'a']);
    });

    it('takes a node added elsewhere onto a board that is being rearranged', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('mine'), flowNode('a'));
        const theirs = board(flowNode('a'), flowNode('new'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['mine', 'a', 'new']);
    });

    it('puts a node added elsewhere after the node it follows there', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('b'), flowNode('a'));
        const theirs = board(flowNode('a'), flowNode('new'), flowNode('b'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['b', 'a', 'new']);
    });
});

describe('workflows', () => {
    const grouped = (...members: [string, string][]): BoardContent => ({
        flowNodes: members.map(([id, workflow]) => flowNode(id, { workflow })),
        workflows: [{ id: 'w1', name: 'Sprint' }],
    });

    it('takes the name written on either side, and keeps a rectangle filed on either', () => {
        const base = grouped(['t1', 'w1']);
        const renamed = {
            ...grouped(['t1', 'w1']),
            workflows: [{ id: 'w1', name: 'Release' }],
        };
        const filedElsewhere = {
            ...grouped(['t1', 'w1']),
            workflows: [{ id: 'w1', name: 'Sprint' }, { id: 'w2', name: 'Next' }],
        };

        expect(mergeBoardContent(base, renamed, base).workflows)
            .toEqual([{ id: 'w1', name: 'Release' }]);
        expect(mergeBoardContent(base, base, filedElsewhere).workflows)
            .toEqual([{ id: 'w1', name: 'Sprint' }, { id: 'w2', name: 'Next' }]);
    });

    it('takes the grouping written on either side', () => {
        const memberOf = (content: BoardContent, id: string): string | undefined =>
            content.flowNodes.find(flowNode => flowNode.id === id)?.workflow;
        const base = grouped(['t1', '']);
        const ours = grouped(['t1', 'w1']);

        expect(memberOf(mergeBoardContent(base, ours, base), 't1')).toBe('w1');
        expect(memberOf(mergeBoardContent(base, base, ours), 't1')).toBe('w1');
    });

    it('takes a rectangle off where either side took it off', () => {
        const base = grouped(['t1', 'w1'], ['t2', 'w1']);
        const ungrouped = grouped(['t1', ''], ['t2', '']);
        const without = { ...ungrouped, workflows: [] as { id: string; name: string }[] };

        expect(mergeBoardContent(base, without, base).workflows).toEqual([]);
        expect(mergeBoardContent(base, base, without).workflows).toEqual([]);
    });
});
