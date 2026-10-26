import { describe, it, expect } from 'vitest';
import {
    hasPrompt, isRunnable, newFlowNode,
    readBoardContent, flowNodePrompt, BoardContent, writeBoardContent,
} from './boardContent';
import { noSuccess } from './flowNodeSuccess';

/** A written document's content, for the assertions that look inside it. */
type Written = { flowNodes: Record<string, unknown>[] };

describe('what a flow node says comes after it', () => {
    it('is read off the document and written back', () => {
        const content = readBoardContent({
            flowNodes: [
                {
                    id: 't1', title: 'Plan', settings: { model: 'opus' },
                    onSuccess: { flowNode: 't2', flowNodes: [], mode: 'continue', compact: true },
                },
                { id: 't2', title: 'Do' },
            ],
        });
        expect(content.flowNodes[0].onSuccess).toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true });
        expect(content.flowNodes[1].onSuccess).toEqual(noSuccess());
    });

    // A file mostly made of `"onSuccess": {"flowNode": ""}` is one nobody reads.
    it('is left out of the document by a flow node that says nothing', () => {
        const written = writeBoardContent({
            flowNodes: [newFlowNode('Alone')], flowNodeClasses: [],
            workflows: [], workflowClasses: [],
        }) as Written;
        expect(written.flowNodes[0]).not.toHaveProperty('onSuccess');
    });
});

describe('the tags a card is filed under', () => {
    // The document holds the **words**, so what a hand-written one says is worth reading loosely:
    // whitespace is a typo rather than a second tag, and a card cannot carry one word twice.
    it('reads the words, trimmed, once each, and drops what is not one', () => {
        const flowNodes = [
            { title: 'Tagged', tags: ['bug', ' needs   review '] },
            { title: 'Said it twice', tags: ['bug', 'BUG', 'bug'] },
            { title: 'Nothing of the sort', tags: ['ok', 3, null, '  ', { label: 'ui' }] },
            { title: 'Not a list', tags: 'bug' },
            { title: 'Said nothing' },
        ];
        const read = readBoardContent({ flowNodes }).flowNodes;
        expect(read.map(flowNode => flowNode.tags)).toEqual([
            ['bug', 'needs review'], ['bug'], ['ok'], [], [],
        ]);
    });

    it('is written only where the card wears one, and before the body', () => {
        const written = writeBoardContent({
            flowNodes: [{ ...newFlowNode('Filed', 'Text'), tags: ['bug'] }, newFlowNode('Bare')],
            flowNodeClasses: [], workflows: [], workflowClasses: [],
        }) as Written;
        expect(written.flowNodes[0]).toMatchObject({ tags: ['bug'] });
        expect(Object.keys(written.flowNodes[0])).toEqual(['id', 'title', 'tags', 'body']);
        expect(written.flowNodes[1]).not.toHaveProperty('tags');
    });
});

/**
 * A board written with a filing the board no longer holds: a `columns` list beside the cards, or
 * cards held inside those columns. Left behind, forgivingly — the board is its cards.
 */
describe('a board written with columns', () => {
    it('leaves the columns behind and keeps the cards', () => {
        const content = readBoardContent({
            columns: [{ id: 'c1', title: 'Todo' }, { id: 'c2', title: 'Done' }],
            flowNodes: [{ id: 't1', column: 'c2', title: 'Shipped' }, { id: 't2', title: 'Some day' }],
        });
        expect(content.flowNodes.map(flowNode => flowNode.title)).toEqual(['Shipped', 'Some day']);
    });

    it('leaves cards held inside columns behind with them', () => {
        const content = readBoardContent({
            columns: [
                { id: 'c1', title: 'Todo', flowNodes: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }] },
            ],
        });
        expect(content.flowNodes).toEqual([]);
    });
});

describe('reading a board', () => {
    it('reads flow nodes, settings and all', () => {
        const content = readBoardContent({
            flowNodes: [{
                id: 't1',
                title: 'Write the plan',
                body: 'Introduction.',
                settings: { model: 'opus', effort: 'high', permission: 'manual', folder: '/' },
            }],
        });

        expect(content.flowNodes[0]).toMatchObject({
            id: 't1',
            title: 'Write the plan',
            body: 'Introduction.',
            settings: { model: 'opus', effort: 'high', permission: 'manual', folder: '/' },
        });
    });

    it('reads where a flow node stands and which chat it was played in', () => {
        const content = readBoardContent({
            flowNodes: [
                { id: 't1', title: 'Played', status: 'done', chat: ' chat-1 ' },
                { id: 't2', title: 'Failed', status: 'error' },
                { id: 't3', title: 'Waiting' },
            ],
        });
        expect(content.flowNodes.map(flowNode => flowNode.status)).toEqual(['done', 'error', 'ready']);
        expect(content.flowNodes.map(flowNode => flowNode.chat)).toEqual(['chat-1', '', '']);
    });

    // A document may have been written by hand or by a turn: what it leaves out is not an error.
    it('gives an id to a flow node written without one', () => {
        const content = readBoardContent({ flowNodes: [{ title: 'Nameless' }] });
        expect(content.flowNodes[0].id).toBeTruthy();
        expect(content.flowNodes[0].body).toBe('');
        expect(content.flowNodes[0].settings).toEqual({});
        expect(content.flowNodes[0].status).toBe('ready');
        expect(content.flowNodes[0].chat).toBe('');
    });

    it('drops what it cannot read rather than refusing the document', () => {
        const content = readBoardContent({ flowNodes: [42, { title: 'Kept' }] });
        expect(content.flowNodes.map(flowNode => flowNode.title)).toEqual(['Kept']);
    });

    it('reads nothing out of nothing', () => {
        const empty = { flowNodes: [], flowNodeClasses: [], workflows: [], workflowClasses: [] };
        expect(readBoardContent(null)).toEqual(empty);
        expect(readBoardContent({})).toEqual(empty);
        expect(readBoardContent([])).toEqual(empty);
    });

    // An empty value says what no key says, and is not written back as a value of its own.
    it('ignores settings that say nothing', () => {
        const content = readBoardContent({
            flowNodes: [{ title: 'A', settings: { model: '  ', effort: 'high', junk: 'x' } }],
        });
        expect(content.flowNodes[0].settings).toEqual({ effort: 'high' });
    });

    // The type is a field, and a document that says none is read the way boards were read before it
    // existed: a named model is AI, and nothing at all is Human.
    it('reads the type a document says, and the settings where it says none', () => {
        const flowNodes = [
            { title: 'Said', type: 'shutdown' },
            { title: 'Waits', type: 'scheduler', at: '2026-09-03T22:00' },
            { title: 'Older AI', settings: { model: 'opus' } },
            { title: 'Older Human' },
            { title: 'A word it has no meaning for', type: 'robot', settings: { model: 'opus' } },
        ];
        const read = readBoardContent({ flowNodes }).flowNodes;
        expect(read.map(flowNode => flowNode.type)).toEqual(['shutdown', 'scheduler', 'ai', 'human', 'ai']);
        expect(read.map(flowNode => flowNode.at)).toEqual(['', '2026-09-03T22:00', '', '', '']);
    });

    // What becomes of the chat is asked of an AI card alone, so every other type is read as
    // claiming nothing — whatever the document says. An answer nothing draws and nothing can reach
    // would sit in the file marking the card as broken with no control on screen to fix it with.
    it('reads a card that is not AI as claiming nothing about a conversation', () => {
        const flowNodes = [
            { title: 'Human', onSuccess: { flowNode: 't2', flowNodes: [], mode: 'continue', compact: true } },
            { title: 'Waits', type: 'scheduler', onSuccess: { flowNode: 't2', flowNodes: [], mode: 'continue' } },
            { title: 'Human, said end', onSuccess: { flowNode: 't2', flowNodes: [], mode: 'end', compact: true } },
            { title: 'AI', settings: { model: 'opus' }, onSuccess: { flowNode: 't2', flowNodes: [], mode: 'continue', compact: true } },
        ];
        const read = readBoardContent({ flowNodes }).flowNodes;
        expect(read.map(flowNode => flowNode.onSuccess.mode)).toEqual(['end', 'end', 'end', 'continue']);
        expect(read.map(flowNode => flowNode.onSuccess.compact)).toEqual([false, false, false, true]);
        // The chain itself is untouched: an order somebody wrote down holds whoever plays the cards.
        expect(read.map(flowNode => flowNode.onSuccess.flowNode)).toEqual(['t2', 't2', 't2', 't2']);
    });

    // Nothing is ever played once the machine is off, so a chain written on a Shutdown is one the
    // document should not go on claiming.
    it('reads a Shutdown as naming nothing after it', () => {
        const read = readBoardContent({
            flowNodes: [{ title: 'Off', type: 'shutdown', onSuccess: { flowNode: 't2', flowNodes: [], mode: 'continue' } }],
        }).flowNodes[0];
        expect(read.onSuccess).toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: false });
    });

    // `shutdown` was a transition mode before it was a card. A word the field has no meaning for is
    // read as the mode that claims nothing — never as the legacy default, which is what an unsaid
    // mode beside a chain meant.
    it('reads the retired shutdown mode as claiming nothing', () => {
        const read = readBoardContent({
            flowNodes: [{ title: 'A', settings: { model: 'opus' }, onSuccess: { flowNode: 't2', flowNodes: [], mode: 'shutdown' } }],
        }).flowNodes[0];
        expect(read.onSuccess).toEqual({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false });
    });

    // The shutdown box was a fifth setting once, and the mode after that. It means nothing here
    // either way, so it leaves the document at the next save like any other field this build has no
    // meaning for.
    it('drops the retired shutdown box a document may still carry', () => {
        const read = readBoardContent({
            flowNodes: [{ title: 'A', settings: { model: 'opus', shutdown: true } }],
        }).flowNodes[0];
        expect(read.settings).toEqual({ model: 'opus' });
        expect(read.onSuccess).toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: false });
    });
});

describe('writing a board', () => {
    it('leaves out everything that says nothing', () => {
        const content: BoardContent = {
            flowNodes: [newFlowNode('Bare')], flowNodeClasses: [],
            workflows: [], workflowClasses: [],
        };
        expect(writeBoardContent(content)).toEqual({
            flowNodes: [{ id: expect.any(String), title: 'Bare' }],
            flowNodeClasses: [],
        });
    });

    it('round-trips a document it wrote', () => {
        const content: BoardContent = {
            flowNodes: [{
                id: 't1', title: 'A', type: 'ai', note: '', value: {}, tags: ['bug', 'ui'],
                body: '# Heading\n\nText',
                criteria: [{ id: 'c1', text: 'It holds' }], complexity: 5,
                at: '', spot: { x: 320, y: 160 },
                status: 'done', archived: false, chat: 'chat-1', settings: { model: 'opus' },
                onSuccess: { flowNode: 't2', flowNodes: [], mode: 'continue', compact: true },
                classVersion: null, workflow: '',
            }, {
                id: 't2', title: 'B', type: 'scheduler', note: '', value: {}, tags: [], body: '',
                criteria: [], complexity: null,
                settings: {}, at: '2026-09-03T22:00', spot: null, status: 'ready',
                archived: false, chat: '', onSuccess: noSuccess(), classVersion: null, workflow: '',
            }],
            flowNodeClasses: [], workflows: [], workflowClasses: [],
        };
        expect(readBoardContent(writeBoardContent(content))).toEqual(content);
    });
});

describe('a flow node as a prompt', () => {
    it('is its description, and nothing else', () => {
        expect(flowNodePrompt(newFlowNode('Write the plan', 'Introduction.'))).toBe('Introduction.');
    });

    // The title is the card's name — read on the board, named by a chain — and not a sentence of
    // the prompt beside a description. It used to be its first line, so a flow node played twice
    // sent it twice.
    it('leaves the title out where there is a description', () => {
        expect(flowNodePrompt(newFlowNode('Write the plan', 'Introduction.'))).not.toContain('Write the plan');
    });

    // ... but a card with an empty box is still asked: the title stands in for the missing
    // description, so a titled card with nothing written in it is played on its name.
    it('sends the title where there is no description', () => {
        expect(flowNodePrompt(newFlowNode('Write the plan'))).toBe('Write the plan');
        expect(hasPrompt(newFlowNode('Write the plan'))).toBe(true);
        expect(hasPrompt(newFlowNode('Write the plan', '   \n  '))).toBe(true);
    });

    // The settings say how the flow node is run, not what it is about.
    it('says nothing about the settings', () => {
        expect(flowNodePrompt(newFlowNode('T', 'B', { model: 'opus' }))).not.toContain('opus');
    });

    // A task is valid with a title, a description or a success criterion — and with none of them
    // it has nothing to send.
    it('is nothing at all for a flow node with none of the three', () => {
        expect(flowNodePrompt(newFlowNode('  '))).toBe('');
        expect(hasPrompt(newFlowNode('  '))).toBe(false);
        expect(hasPrompt(newFlowNode('', 'Introduction.'))).toBe(true);
    });

    it('sends the criteria whenever present, and nothing but them beside the base', () => {
        const titled = newFlowNode('Write the plan', '', {}, noSuccess(), [{ id: 'c1', text: 'It holds' }]);
        expect(flowNodePrompt(titled)).toBe('Write the plan\n\nSuccess criteria:\n- It holds');
        const described = newFlowNode('Write the plan', 'Introduction.', {}, noSuccess(), [
            { id: 'c1', text: 'It holds' }, { id: 'c2', text: 'It reads well' },
        ]);
        expect(flowNodePrompt(described)).toBe(
            'Introduction.\n\nSuccess criteria:\n- It holds\n- It reads well');
        expect(flowNodePrompt(described)).not.toContain('Write the plan');
        const bare = newFlowNode('', '', {}, noSuccess(), [{ id: 'c1', text: 'It holds' }]);
        expect(flowNodePrompt(bare)).toBe('Success criteria:\n- It holds');
        expect(hasPrompt(bare)).toBe(true);
    });
});

describe('the task’s own two', () => {
    it('reads the criteria in order, trimmed, and drops what is not one', () => {
        const read = readBoardContent({
            flowNodes: [{
                id: 't1', title: 'A',
                criteria: [
                    { id: ' c1 ', text: ' It holds ' },
                    { id: 'c2', text: '   ' },
                    { id: 'c3' },
                    42,
                    { id: 'c4', text: 'It reads well' },
                ],
                complexity: 5,
            }],
        }).flowNodes[0];
        expect(read.criteria).toEqual([
            { id: 'c1', text: 'It holds' }, { id: 'c4', text: 'It reads well' },
        ]);
        expect(read.complexity).toBe(5);
    });

    it('reads no criteria and no complexity on a card that is no task', () => {
        const read = readBoardContent({
            flowNodes: [{ id: 't1', title: 'Off', type: 'shutdown', criteria: [{ id: 'c1', text: 'x' }], complexity: 5 }],
        }).flowNodes[0];
        expect(read.criteria).toEqual([]);
        expect(read.complexity).toBeNull();
    });

    it('reads an outside complexity as none', () => {
        const read = readBoardContent({
            flowNodes: [{ id: 't1', title: 'A', complexity: 7 }],
        }).flowNodes[0];
        expect(read.complexity).toBeNull();
    });

    it('writes the two only where the task holds them', () => {
        const written = writeBoardContent({
            flowNodes: [newFlowNode('Held', 'Text', {}, noSuccess(), [{ id: 'c1', text: 'It holds' }], 3),
                newFlowNode('Bare')],
            flowNodeClasses: [], workflows: [], workflowClasses: [],
        }) as Written;
        expect(written.flowNodes[0]).toMatchObject({
            criteria: [{ id: 'c1', text: 'It holds' }], complexity: 3,
        });
        expect(written.flowNodes[1]).not.toHaveProperty('criteria');
        expect(written.flowNodes[1]).not.toHaveProperty('complexity');
    });
});

/**
 * Where a card sits on the board. Absent means never placed — so no document needs rewriting to be
 * read.
 */
describe('where a card sits', () => {
    const first = (raw: unknown) => readBoardContent(raw).flowNodes[0];

    it('is the point the document names', () => {
        expect(first({ flowNodes: [{ id: 't', spot: { x: 320, y: 160 } }] }).spot)
            .toEqual({ x: 320, y: 160 });
    });

    it('is rounded to whole pixels, a document of 412.39999 being one nobody reads', () => {
        expect(first({ flowNodes: [{ id: 't', spot: { x: 412.4, y: 9.5 } }] }).spot)
            .toEqual({ x: 412, y: 10 });
    });

    // Read as forgivingly as everything else here: a point that is not two numbers is no point at
    // all, rather than a card drawn at NaN.
    it.each([
        ['nothing said', {}],
        ['a point of one number', { spot: { x: 1 } }],
        ['a point of words', { spot: { x: 'far', y: 'down' } }],
        ['not a point', { spot: 12 }],
        ['a point that is not finite', { spot: { x: Infinity, y: 0 } }],
    ])('is none where the document says %s', (_what, said) => {
        expect(first({ flowNodes: [{ id: 't', ...said }] }).spot).toBeNull();
    });

    it('is left out of the document for a card nobody has placed', () => {
        const written = writeBoardContent({
            flowNodes: [newFlowNode('A')], flowNodeClasses: [],
            workflows: [], workflowClasses: [],
        });
        expect(JSON.stringify(written)).not.toContain('spot');
    });
});

describe('notes and values', () => {
    it('reads a note as markdown alone, with no title or tags', () => {
        const content = readBoardContent({
            flowNodes: [{ id: 'n1', type: 'note', title: 'Ignored', tags: ['x'], note: '# Hi\n\n[doc](/a.md)' }],
        });
        expect(content.flowNodes[0]).toMatchObject({ type: 'note', title: '', tags: [], note: '# Hi\n\n[doc](/a.md)' });
        expect(JSON.stringify(writeBoardContent(content))).toContain('[doc](/a.md)');
    });

    it('reads and writes a value as title plus JSON', () => {
        const content = readBoardContent({
            flowNodes: [{ id: 'v1', type: 'value', title: 'Config', tags: ['x'], value: { a: 1 } }],
        });
        expect(content.flowNodes[0]).toMatchObject({ type: 'value', title: 'Config', tags: [], value: { a: 1 } });
        expect(writeBoardContent(content)).toMatchObject({
            flowNodes: [{ id: 'v1', title: 'Config', type: 'value', value: { a: 1 } }],
        });
    });

    it('never runs a note or a value', () => {
        const content = readBoardContent({
            flowNodes: [
                { id: 'n1', type: 'note', note: 'text' },
                { id: 'v1', type: 'value', title: 'Cfg', value: {} },
            ],
        });
        expect(content.flowNodes.map(node => isRunnable(node))).toEqual([false, false]);
    });
});
