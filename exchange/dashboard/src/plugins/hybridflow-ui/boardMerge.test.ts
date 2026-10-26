import { describe, it, expect } from 'vitest';
import { mergeBoardContent } from './boardMerge';
import { FlowNodeClass, FlowNodeClassVersion, newFlowNodeClass } from './flowNodeClass';
import { noSuccess } from './flowNodeSuccess';
import { READY } from './flowNodeStatus';
import { BoardContent, FlowNode } from './boardContent';

/**
 * The rule the board is edited during a run by: what the service grew and what was typed here both
 * survive, because the two ends write different fields of it.
 *
 * `base` is the board both started from, `ours` what is on screen, `theirs` what the service holds.
 */

const flowNode = (id: string, over: Partial<FlowNode> = {}): FlowNode =>
    ({
        id, title: id, type: 'human', note: '', value: {}, tags: [], body: '', criteria: [], complexity: null,
        settings: {}, at: '', spot: null, status: READY, archived: false, chat: '', onSuccess: noSuccess(),
        classVersion: null, workflow: '', ...over,
    });

/** The board those cards make. */
const board = (...flowNodes: FlowNode[]): BoardContent => (
    ({ flowNodes, flowNodeClasses: [], workflows: [], workflowClasses: [] }));

/** The board as a shape a test can read: the cards, by id. */
const shape = (content: BoardContent) => content.flowNodes.map(entry => entry.id);

const find = (content: BoardContent, id: string): FlowNode | undefined =>
    content.flowNodes.find(entry => entry.id === id);

describe('mergeBoardContent – a run writing while a board is being written', () => {
    // The whole point. A run marks the flow node it took and writes down the chat; the person who
    // started it carries on writing the next ticket. Neither is worth losing.
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

    // The description is only ever written here: a description typed while the turn ran is kept,
    // which is the card being written for its next play.
    it('keeps a description written here while the play was sending the last one', () => {
        const base = board(flowNode('a', { body: 'Do the thing.' }));
        const ours = board(flowNode('a', { body: 'And then the other thing.' }));
        const theirs = board(flowNode('a', { status: 'done' }));

        const merged = mergeBoardContent(base, ours, theirs);

        expect(find(merged, 'a')!.body).toBe('And then the other thing.');
        expect(find(merged, 'a')!.status).toBe('done');
    });

    // A field nobody here has touched is the service's, whatever it says — that is how a mark and a
    // chat id arrive at all.
    it('takes every field the board has not touched from the service', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a'));
        const theirs = board(flowNode('a', {
            title: 'Renamed by a turn', body: 'Written by a turn', status: 'error',
        }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')).toMatchObject({
            title: 'Renamed by a turn', body: 'Written by a turn', status: 'error',
        });
    });

    // Where both said something about one field, the person at the keyboard said it last.
    it('keeps what was said here when both ends said something about one field', () => {
        const base = board(flowNode('a', { status: READY }));
        const ours = board(flowNode('a', { status: 'draft' }));
        const theirs = board(flowNode('a', { status: 'running' }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')!.status).toBe('draft');
    });
});

describe('mergeBoardContent – the tags a card is filed under', () => {
    // A field the run never touches, like the title: whoever changed it is whoever meant to.
    it('keeps the words typed here while the run was marking the card', () => {
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

describe('mergeBoardContent – cards arriving and leaving', () => {
    // Each end added a card, and each card lands at the place the end that made it put it at.
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

    // A card somebody is typing into is not one to take out from under them.
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

describe('mergeBoardContent – where the cards sit', () => {
    // No run moves a card, so a spot written here is the spot.
    it('keeps a card placed here against the service holding it unplaced', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a', { spot: { x: 100, y: 100 } }));
        const theirs = board(flowNode('a', { status: 'done' }));

        const merged = mergeBoardContent(base, ours, theirs);
        expect(find(merged, 'a')!.spot).toEqual({ x: 100, y: 100 });
        expect(find(merged, 'a')!.status).toBe('done');
    });

    // A spot is a field of the card like any other: a place written in a second tab
    // reaches a board that has not moved it.
    it('takes a card placed elsewhere where nothing placed it here', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('a'));
        const theirs = board(flowNode('a', { spot: { x: 100, y: 100 } }));

        expect(find(mergeBoardContent(base, ours, theirs), 'a')!.spot).toEqual({ x: 100, y: 100 });
    });

    // Nothing has been rearranged here, so a rearrangement made elsewhere reaches the board.
    it('takes an arrangement made elsewhere when nothing has been moved here', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('a'), flowNode('b'));
        const theirs = board(flowNode('b'), flowNode('a'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['b', 'a']);
    });

    // A card added elsewhere during a drag is not a card to drop.
    it('takes a card added elsewhere onto a board that is being rearranged', () => {
        const base = board(flowNode('a'));
        const ours = board(flowNode('mine'), flowNode('a'));
        const theirs = board(flowNode('a'), flowNode('new'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['mine', 'a', 'new']);
    });

    // And one added elsewhere goes in after the card it follows there, wherever this board has put
    // that card since.
    it('puts a card added elsewhere after the card it follows there', () => {
        const base = board(flowNode('a'), flowNode('b'));
        const ours = board(flowNode('b'), flowNode('a'));
        const theirs = board(flowNode('a'), flowNode('new'), flowNode('b'));

        expect(shape(mergeBoardContent(base, ours, theirs))).toEqual(['b', 'a', 'new']);
    });
});

describe('mergeBoardContent – a fresh class and its versions', () => {
    const version = (
        id: string, number: number, status: FlowNodeClassVersion['status'] = 'draft',
    ): FlowNodeClassVersion => ({ id, number, body: '', criteria: [], template: false, agent: '', status });

    const classOf = (id: string, over: Partial<FlowNodeClass> = {}): FlowNodeClass => ({
        ...newFlowNodeClass('human'), id, title: id, ...over,
    });

    /** The board those classes make. */
    const classes = (...flowNodeClasses: FlowNodeClass[]): BoardContent =>
        ({ flowNodes: [], flowNodeClasses, workflows: [], workflowClasses: [] });

    const versionsOf = (content: BoardContent, id: string): string[] =>
        content.flowNodeClasses.find(one => one.id === id)?.versions.map(one => one.id) ?? [];

    const titleOf = (content: BoardContent, id: string): string | undefined =>
        content.flowNodeClasses.find(one => one.id === id)?.title;

    // A class made here carries no versions — their ids are the service's to mint — so the first
    // re-read takes the succession from there, while what was typed here since is kept.
    it('takes the service versions of a class added here, keeping the title typed since', () => {
        const base = classes();
        const ours = classes(classOf('c1', { title: 'Typed', versions: [] }));
        const theirs = classes(classOf('c1', { title: '', versions: [version('v1', 1)] }));

        const merged = mergeBoardContent(base, ours, theirs);
        expect(versionsOf(merged, 'c1')).toEqual(['v1']);
        expect(titleOf(merged, 'c1')).toBe('Typed');
    });

    // The re-read after that one: the versions taken then are still the versions now, because this
    // board has not said otherwise since.
    it('keeps the versions taken at the first re-read on the ones after', () => {
        const first = classes(classOf('c1', { title: 'Typed', versions: [version('v1', 1)] }));
        const merged = mergeBoardContent(first, first, first);

        expect(versionsOf(merged, 'c1')).toEqual(['v1']);
    });

    // A new version filed from here changes nothing on screen until it lands — so when it does,
    // it arrives.
    it('takes a version the service grew where the succession was untouched here', () => {
        const v1 = version('v1', 1, 'published');
        const base = classes(classOf('c1', { versions: [v1] }));
        const ours = classes(classOf('c1', { versions: [v1] }));
        const theirs = classes(classOf('c1', { versions: [v1, version('v2', 2)] }));

        expect(versionsOf(mergeBoardContent(base, ours, theirs), 'c1')).toEqual(['v1', 'v2']);
    });

    // And a version taken off here stays taken off: the succession this board holds is the one it
    // meant.
    it('leaves a version deleted here deleted', () => {
        const v1 = version('v1', 1, 'published');
        const v2 = version('v2', 2);
        const base = classes(classOf('c1', { versions: [v1, v2] }));
        const ours = classes(classOf('c1', { versions: [v1] }));
        const theirs = classes(classOf('c1', { versions: [v1, v2] }));

        expect(versionsOf(mergeBoardContent(base, ours, theirs), 'c1')).toEqual(['v1']);
    });

    // The note is the class's own field like the title: the side that wrote it is the side that
    // meant to.
    it('takes the note written on either side', () => {
        const noteOf = (content: BoardContent, id: string): string | undefined =>
            content.flowNodeClasses.find(one => one.id === id)?.note;
        const base = classes(classOf('c1', { note: '' }));
        const ours = classes(classOf('c1', { note: 'Typed here.' }));
        const writtenHere = classes(classOf('c1', { note: '' }));

        expect(noteOf(mergeBoardContent(base, ours, writtenHere), 'c1')).toBe('Typed here.');
        expect(noteOf(mergeBoardContent(base, writtenHere, ours), 'c1')).toBe('Typed here.');
    });
});

describe('workflows', () => {
    const grouped = (...members: [string, string][]): BoardContent => ({
        flowNodes: members.map(([id, workflow]) => flowNode(id, { workflow })),
        flowNodeClasses: [],
        workflows: [{ id: 'w1', name: 'Sprint' }],
        workflowClasses: [],
    });

    // A rectangle filed elsewhere arrives with the re-read, and one renamed here keeps the name
    // written here: the name is the only thing a workflow has, and only ever written here.
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

    // The membership is the card's field like the title: the side that grouped it is the side
    // that meant to.
    it('takes the grouping written on either side', () => {
        const memberOf = (content: BoardContent, id: string): string | undefined =>
            content.flowNodes.find(flowNode => flowNode.id === id)?.workflow;
        const base = grouped(['t1', '']);
        const ours = grouped(['t1', 'w1']);

        expect(memberOf(mergeBoardContent(base, ours, base), 't1')).toBe('w1');
        expect(memberOf(mergeBoardContent(base, base, ours), 't1')).toBe('w1');
    });

    // Taking a rectangle off on one side takes it off the merge — and the ungrouping travels
    // on the cards themselves, so each half is read where it was written.
    it('takes a rectangle off where either side took it off', () => {
        const base = grouped(['t1', 'w1'], ['t2', 'w1']);
        const ungrouped = grouped(['t1', ''], ['t2', '']);
        const without = { ...ungrouped, workflows: [] as { id: string; name: string }[] };

        expect(mergeBoardContent(base, without, base).workflows).toEqual([]);
        expect(mergeBoardContent(base, base, without).workflows).toEqual([]);
    });
});
