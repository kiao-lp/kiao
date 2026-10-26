import { describe, it, expect } from 'vitest';
import { readFlowNodesClip, flowNodeClipText, flowNodesClipText } from './boardClip';
import { newFlowNode, FlowNode } from './boardContent';

const FLOW_NODE = newFlowNode('Write the plan', 'Introduction.', { model: 'opus', effort: 'high' });

/** The one flow node a text holds, which is what most of these are about, or null where it holds others. */
const oneFlowNode = (text: string): FlowNode | null => {
    const flowNodes = readFlowNodesClip(text);
    return flowNodes.length === 1 ? flowNodes[0] : null;
};

describe('copying', () => {
    it('writes a flow node that says what it is', () => {
        const parsed = JSON.parse(flowNodeClipText(FLOW_NODE));
        expect(parsed.kind).toBe('kiao-flow-node');
        expect(parsed.flowNode).toMatchObject({
            title: 'Write the plan',
            body: 'Introduction.',
            settings: { model: 'opus', effort: 'high' },
        });
    });

});

describe('pasting', () => {
    // The copy is of what a flow node is, never of which flow node it is: a clipboard pastes twice.
    it('gives a pasted flow node an id of its own', () => {
        const pasted = oneFlowNode(flowNodeClipText(FLOW_NODE))!;
        expect(pasted.id).not.toBe(FLOW_NODE.id);
        expect(pasted).toMatchObject({ title: 'Write the plan', body: 'Introduction.' });
    });

    // A turn asked for "a flow node" writes the bare thing, and that is worth accepting.
    it('takes a bare flow node object', () => {
        expect(oneFlowNode('{"title":"Hand written","body":"b"}'))
            .toMatchObject({ title: 'Hand written', body: 'b' });
    });

    // A column an old copy wrote is not a flow node: reading its header as one would paste a card
    // for the title and drop every card it carried.
    it('reads nothing out of a column an old copy wrote', () => {
        expect(readFlowNodesClip('{"title":"Ideas","flowNodes":[{"title":"One"}]}')).toEqual([]);
        expect(readFlowNodesClip(JSON.stringify({
            kind: 'kiao-workflow-column',
            version: 1,
            column: { title: 'Ideas', flowNodes: [{ title: 'One' }] },
        }))).toEqual([]);
    });

    it('reads nothing out of anything else', () => {
        expect(readFlowNodesClip('the shopping list')).toEqual([]);
        expect(readFlowNodesClip('[1, 2, 3]')).toEqual([]);
        expect(readFlowNodesClip('{"kind":"something-else","flowNode":{"title":"x"}}')).toEqual([]);
    });
});

// ── The cards picked out, copied together ────────────────────────────────────
//
// A copy aimed at one of several marked cards is a copy of the lot: one clipboard text, one paste.

describe('several flow nodes on the clipboard', () => {
    const FIRST = newFlowNode('First');
    const SECOND = newFlowNode('Second');

    it('writes them under one wrapper that says what they are', () => {
        const parsed = JSON.parse(flowNodesClipText([FIRST, SECOND]));
        expect(parsed.kind).toBe('kiao-flow-nodes');
        expect(parsed.flowNodes.map((flowNode: { title: string }) => flowNode.title)).toEqual(['First', 'Second']);
    });

    // So that a card copied here is a card any instance can paste, whatever it was built before.
    it('writes one card as a single card was always written', () => {
        expect(flowNodesClipText([FIRST])).toBe(flowNodeClipText(FIRST));
    });

    it('comes back in the order it was copied, each with an id of its own', () => {
        const pasted = readFlowNodesClip(flowNodesClipText([FIRST, SECOND]));
        expect(pasted.map(flowNode => flowNode.title)).toEqual(['First', 'Second']);
        expect(pasted.map(flowNode => flowNode.id)).not.toContain(FIRST.id);
        expect(new Set(pasted.map(flowNode => flowNode.id)).size).toBe(2);
    });

    it('takes a bare list of flow node objects, as a turn asked for them would write it', () => {
        expect(readFlowNodesClip('[{"title":"One"},{"title":"Two"}]').map(flowNode => flowNode.title))
            .toEqual(['One', 'Two']);
    });
});

// ── Chains across the clipboard ──────────────────────────────────────────────
//
// A chain names a flow node by id, and a paste mints new ids. Cards copied together carry both
// ends of the chains among them, so those are renamed with the flow nodes they name; a flow node
// carries neither the other end nor any way of finding it, so it arrives with nothing after it.

describe('a chain on the clipboard', () => {
    const FIRST = newFlowNode('First', '', { model: 'opus' });
    const SECOND = newFlowNode('Second');

    it('goes with a flow node pasted on its own, which named one that is not in the clipboard', () => {
        const alone = {
            ...FIRST, onSuccess: { flowNode: SECOND.id, flowNodes: [], mode: 'continue' as const, compact: true },
        };
        expect(oneFlowNode(flowNodeClipText(alone))!.onSuccess)
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });

    // The cards picked out carry both ends of it — which is the point of
    // copying them together rather than one after another.
    it('is rewritten where both its ends were copied together', () => {
        const linked = {
            ...FIRST, onSuccess: { flowNode: SECOND.id, flowNodes: [], mode: 'continue' as const, compact: true },
        };
        const pasted = readFlowNodesClip(flowNodesClipText([linked, SECOND]));
        expect(pasted[0].onSuccess).toEqual({ flowNode: pasted[1].id, flowNodes: [], mode: 'continue', compact: true });
    });

    it('goes where only the card that starts it was picked out', () => {
        const linked = {
            ...FIRST, onSuccess: { flowNode: SECOND.id, flowNodes: [], mode: 'continue' as const, compact: true },
        };
        const pasted = readFlowNodesClip(flowNodesClipText([linked, newFlowNode('Unrelated')]));
        expect(pasted[0].onSuccess).toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });
});

// ── What a paste makes of the card's type ────────────────────────────────────

describe('the type of a flow node on the clipboard', () => {
    it('travels, and brings a Scheduler’s datetime with it', () => {
        const waits = { ...newFlowNode('Overnight'), type: 'scheduler' as const, at: '2026-09-03T22:00' };
        const pasted = oneFlowNode(flowNodeClipText(waits))!;
        expect(pasted.type).toBe('scheduler');
        expect(pasted.at).toBe('2026-09-03T22:00');
    });

    // A card copied out of a build with no type on it, or out of a board written by hand: the same
    // rule a document is read by.
    it('is read off the settings where the clipboard says none', () => {
        const older = JSON.stringify({ id: 'x', title: 'Ship it', settings: { model: 'opus' } });
        expect(oneFlowNode(older)!.type).toBe('ai');
        expect(oneFlowNode(JSON.stringify({ id: 'x', title: 'Ship it' }))!.type).toBe('human');
    });
});

// ── What a paste does with a played flow node ─────────────────────────────────────

describe('a tagged flow node on the clipboard', () => {
    // The difference between a tag and a chat, and the reason the format holds words rather than
    // ids: `bug` still means bug in the store this is pasted into, where the colour is that
    // store's own business.
    it('carries its words into whatever store it is pasted in', () => {
        const filed = { ...newFlowNode('Filed'), tags: ['bug', 'ui'] };
        expect(oneFlowNode(flowNodeClipText(filed))!.tags).toEqual(['bug', 'ui']);
    });

    it('reads the words of a bare flow node somebody wrote by hand', () => {
        const pasted = oneFlowNode('{ "title": "Asked for", "tags": ["bug", " bug ", 7] }')!;
        expect(pasted.tags).toEqual(['bug']);
    });
});

describe('a played flow node on the clipboard', () => {
    it('keeps where it stands and leaves its chat behind', () => {
        const played = { ...newFlowNode('Played', 'Asked.\n\n---\n\nAnswered.'), status: 'done' as const, chat: 'chat-1' };
        const pasted = oneFlowNode(flowNodeClipText(played))!;
        expect(pasted.status).toBe('done');
        // The id names a conversation of this instance, and two cards on one chat because one was
        // copied from the other is not what either of them says.
        expect(pasted.chat).toBe('');
    });
});

describe('a managed agent on the clipboard', () => {
    const AGENT = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const played = () =>
        newFlowNode('Played', 'Do it.', { agent: AGENT, effort: 'high', folder: '/' });

    // The card is the same card on the next board along: the id names the agent this store keeps,
    // and a flow node cut from one board and pasted onto another is still that agent's to play.
    it('keeps a managed agent this store keeps', () => {
        const pasted = readFlowNodesClip(flowNodeClipText(played()), new Set([AGENT]))[0];
        expect(pasted.settings).toEqual({ agent: AGENT, effort: 'high', folder: '/' });
    });

    // An id from another instance names nothing here: the pasted card arrives with none, to be
    // picked from the agents the receiving store keeps. The rest of the settings travel.
    it('leaves behind an agent this store does not keep', () => {
        const elsewhere = readFlowNodesClip(flowNodeClipText(played()), new Set(['another-store-agent']))[0];
        expect(elsewhere.settings).toEqual({ effort: 'high', folder: '/' });
        // A reader that was told nothing about the store's agents keeps none of them: it has no way
        // of telling the agent a card names from an id that names nothing here.
        expect(oneFlowNode(flowNodeClipText(played()))!.settings).toEqual({ effort: 'high', folder: '/' });
    });

    // An engine is a word rather than a reference, so a card written before managed agents keeps
    // what it said about who plays it.
    it('keeps the engine of a card written before managed agents', () => {
        const played = newFlowNode('Played', 'Do it.', { agent: 'claude', model: 'opus', effort: 'high' });
        const pasted = oneFlowNode(flowNodeClipText(played))!;
        expect(pasted.settings).toEqual({ agent: 'claude', model: 'opus', effort: 'high' });
    });
});

describe('a runner pin on the clipboard', () => {
    const AGENT = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const RUNNER = 'c9f5e2a1-7b3d-4e6a-9e1c-2d4b6a8c0e12';
    const played = () =>
        newFlowNode('Played', 'Do it.', { agent: AGENT, effort: 'high', folder: '/', runner: RUNNER });

    // The card is the same card on the next board along: pinned to the runner this store keeps, it
    // is still that machine's to play.
    it('keeps a pin to a runner this store keeps', () => {
        const pasted = readFlowNodesClip(flowNodeClipText(played()), new Set([AGENT]), new Set([RUNNER]))[0];
        expect(pasted.settings).toEqual({ agent: AGENT, effort: 'high', folder: '/', runner: RUNNER });
    });

    // An id from another instance names nothing here: the pasted card arrives unpinned rather than
    // unplayable, and the rest of the settings travel.
    it('leaves behind a pin to a runner this store does not keep', () => {
        const elsewhere = readFlowNodesClip(flowNodeClipText(played()),
            new Set([AGENT]), new Set(['another-store-runner']))[0];
        expect(elsewhere.settings).toEqual({ agent: AGENT, effort: 'high', folder: '/' });
        expect(oneFlowNode(flowNodeClipText(played()))!.settings).toEqual({ effort: 'high', folder: '/' });
    });
});

// What becomes of the chat is read against the card's type on the way in, as it is in a document: a
// pasted card naming no model claims nothing about a conversation it has no way of having.
describe('a pasted flow node and what it claims happens after it', () => {
    it('settles what a Human flow node said about the chat and leaves an AI one alone', () => {
        const human = oneFlowNode(JSON.stringify({
            id: 'x', title: 'By hand', onSuccess: { flowNode: 'elsewhere', flowNodes: [], mode: 'continue', compact: true },
        }))!;
        expect(human.onSuccess.mode).toBe('end');
        expect(human.onSuccess.compact).toBe(false);

        const ai = oneFlowNode(JSON.stringify({
            id: 'y', title: 'Claude’s', settings: { model: 'opus' },
            onSuccess: { flowNode: 'elsewhere', flowNodes: [], mode: 'continue', compact: true },
        }))!;
        expect(ai.onSuccess.mode).toBe('continue');
        expect(ai.onSuccess.compact).toBe(true);
    });
});

/**
 * Where a card sat on the board canvas of the board it came from. A place is a place on *that*
 * canvas, among *those* cards, so it does not travel: carrying it over would drop a pasted card
 * exactly on top of whatever the receiving board keeps there — including, pasting into the board it
 * was copied from, on top of the card it is a copy of.
 */
describe('a placed flow node on the clipboard', () => {
    it('arrives unplaced, whatever the clipboard said', () => {
        const [pasted] = readFlowNodesClip(JSON.stringify({
            kind: 'kiao-flow-node',
            version: 1,
            flowNode: { id: 't', title: 'Placed', spot: { x: 320, y: 160 } },
        }));
        expect(pasted.spot).toBeNull();
    });
});

// ── The rename ────────────────────────────────────────────────────────────────
//
// What a copy wrote before the rename pastes as it always did: a clipboard text is a thing
// that outlives the build that wrote it.

describe('a copy written before the rename', () => {
    it('pastes one card wrapped the old way', () => {
        const [pasted] = readFlowNodesClip(JSON.stringify({
            kind: 'kiao-workflow-flow-node',
            version: 1,
            flowNode: { id: 't', title: 'Old copy' },
        }));
        expect(pasted.title).toBe('Old copy');
    });

    it('pastes several cards wrapped the old way', () => {
        const pasted = readFlowNodesClip(JSON.stringify({
            kind: 'kiao-workflow-flow-nodes',
            version: 1,
            flowNodes: [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }],
        }));
        expect(pasted.map(flowNode => flowNode.title)).toEqual(['One', 'Two']);
    });
});

describe("a gateway's branches on the clipboard", () => {
    const JOIN = { ...newFlowNode('Join'), type: 'gateway' as const };
    const LEFT = newFlowNode('Left');
    const RIGHT = newFlowNode('Right');

    it('travels with the cards copied together, rewritten with the new ids', () => {
        const join = {
            ...JOIN, onSuccess: { flowNode: '', flowNodes: [LEFT.id, RIGHT.id], mode: 'end' as const, compact: false },
        };
        const pasted = readFlowNodesClip(flowNodesClipText([join, LEFT, RIGHT]));
        expect(pasted[0].onSuccess.flowNodes).toEqual([pasted[1].id, pasted[2].id]);
    });

    it('leaves behind the branches that were not copied with it', () => {
        const join = {
            ...JOIN, onSuccess: { flowNode: '', flowNodes: [LEFT.id, RIGHT.id], mode: 'end' as const, compact: false },
        };
        const pasted = readFlowNodesClip(flowNodesClipText([join, LEFT]));
        expect(pasted[0].onSuccess.flowNodes).toEqual([pasted[1].id]);
    });
});
