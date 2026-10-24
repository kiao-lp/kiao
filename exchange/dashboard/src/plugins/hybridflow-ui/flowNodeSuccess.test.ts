import { describe, it, expect } from 'vitest';
import {
    brokenTransition, carriesChat, hasSuccess, noSuccess, readSuccess, saysSuccess, successFor,
    writeSuccess, withoutSuccessor,
} from './flowNodeSuccess';

const RUNNABLE = { agent: 'claude', model: 'opus', effort: 'high', permission: 'manual', folder: '/' };

describe('reading what follows a flow node', () => {
    it('reads the flow node it names, the transition mode and the compaction', () => {
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 'end' })).toEqual({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false });
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 'continue' }))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false });
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true }))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true });
    });

    // The box is the flow node's own answer about its own chat: it says something with nothing named
    // after it, and it says it beside the mode that hands the conversation to nobody.
    it('reads the compaction said with the conversation ended', () => {
        expect(readSuccess({ mode: 'end', compact: true })).toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: true });
    });

    // Both are said with nothing after them: what becomes of the chat is a thing to say at the end
    // of a chain as much as in the middle of one.
    it('reads what is said with no flow node after it', () => {
        expect(readSuccess({ mode: 'continue' })).toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: false });
    });

    // `compact` was one word for two answers — shorten it *and* hand it on — so a document still
    // saying the word says both, and neither half has to be picked again.
    it('reads the mode that split into a mode and a box', () => {
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 'compact' }))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true });
        expect(readSuccess({ mode: 'compact' })).toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });

    // `chat` is what the field was called while it only spoke about the conversation.
    it('reads the chat field documents were written with', () => {
        expect(readSuccess({ flowNode: 't2', chat: 'compact' }))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true });
        expect(readSuccess({ flowNode: 't2', chat: 'end' })).toEqual({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false });
    });

    // Carrying the chat on was the default while the field was `chat`, and this end now writes the
    // mode on every chain it writes: an unsaid one beside a named flow node can only have come from then.
    it('reads a chain that says nothing of the mode as carrying the chat on', () => {
        expect(readSuccess({ flowNode: 't2' })).toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false });
    });

    // A document may have been hand-written or produced by a turn: a bare id is what it says.
    it('reads a bare id as the flow node it names', () => {
        expect(readSuccess(' t2 ')).toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false });
    });

    // The two-valued field this build has taken the name back off. Its true was "compact and
    // continue", which is what the two fields now say between them.
    it('reads the compact flag documents were written with', () => {
        expect(readSuccess({ flowNode: 't2', compact: true }))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true });
        expect(readSuccess({ flowNode: 't2', compact: false }))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false });
    });

    // The retired field only ever meant anything beside a chain, so it is only read beside one: a
    // document saying `{ "chat": "compact" }` with nothing after it was as good as silent.
    it('ignores the retired chat field where no flow node is named', () => {
        expect(readSuccess({ chat: 'compact' })).toEqual(noSuccess());
    });

    it('reads nothing at all as nothing', () => {
        expect(readSuccess({ flowNode: '  ' })).toEqual(noSuccess());
        expect(readSuccess('   ')).toEqual(noSuccess());
        expect(readSuccess(undefined)).toEqual(noSuccess());
        expect(readSuccess(['t2'])).toEqual(noSuccess());
        expect(readSuccess(42)).toEqual(noSuccess());
    });

    // A word said in the field itself is somebody answering the question, so an answer this build
    // has no meaning for is read as the one that claims nothing — never as the legacy default, which
    // is what an *unanswered* chain meant. `shutdown`, which was a mode before it was a card, is the
    // word this is for: a board that ended the play there did not mean to carry a conversation on.
    it('reads a word it has no meaning for as the mode that claims nothing', () => {
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 'shutdown' }).mode).toBe('end');
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 'shorten' }).mode).toBe('end');
    });

    // Anything that is not a word at all was never an answer: the chain reads as one written before
    // the field existed.
    it('reads an unreadable mode as a chain that said nothing', () => {
        expect(readSuccess({ flowNode: 't2', flowNodes: [], mode: 3 }).mode).toBe('continue');
    });
});

describe('what a flow node says by saying nothing', () => {
    it('is no flow node after it, the mode that assumes nothing, and no compaction', () => {
        expect(noSuccess()).toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: false });
        expect(hasSuccess(noSuccess())).toBe(false);
        expect(hasSuccess({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false })).toBe(true);
    });

    it('is not written to the document at all', () => {
        expect(saysSuccess(noSuccess())).toBe(false);
        expect(saysSuccess({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false })).toBe(true);
        expect(saysSuccess({ flowNode: '', flowNodes: [], mode: 'continue', compact: false })).toBe(true);
        expect(saysSuccess({ flowNode: '', flowNodes: [], mode: 'end', compact: true })).toBe(true);
    });
});

describe('whether the chat is carried on by the next flow node', () => {
    // It is the mode's answer alone: the compaction says what this flow node leaves its chat as, never
    // who gets it.
    it('is so for the mode that continues, and not for the one that ends it', () => {
        expect(carriesChat({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false })).toBe(true);
        expect(carriesChat({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true })).toBe(true);
        expect(carriesChat({ flowNode: 't2', flowNodes: [], mode: 'end', compact: true })).toBe(false);
    });
});

describe('a thing said about the chat that the flow node cannot honour', () => {
    // Both claim the flow node is Claude's: one a conversation to hand on, the other one to shorten.
    it('is either answer claiming a played turn, where nothing would play it', () => {
        expect(brokenTransition({ flowNode: '', flowNodes: [], mode: 'continue', compact: false }, {})).toBe(true);
        expect(brokenTransition({ flowNode: '', flowNodes: [], mode: 'end', compact: true }, {})).toBe(true);
    });

    it('is not the mode that claims nothing with the box unticked', () => {
        expect(brokenTransition({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false }, {})).toBe(false);
    });

    // Half the settings is no more a played turn than none of them.
    it('is a flow node whose settings are only half given', () => {
        expect(brokenTransition({ flowNode: '', flowNodes: [], mode: 'continue', compact: true }, { model: 'opus' })).toBe(true);
        expect(brokenTransition({ flowNode: '', flowNodes: [], mode: 'continue', compact: true }, RUNNABLE)).toBe(false);
    });
});

describe('taking the chain off', () => {
    // What becomes of the chat is the flow node's own: it says how this flow node ends, not what the line to
    // another card did.
    it('leaves what was said about the chat exactly where it was', () => {
        expect(withoutSuccessor({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true }))
            .toEqual({ flowNode: '', flowNodes: [], mode: 'continue', compact: true });
    });
});

describe('writing what follows a flow node', () => {
    // Unsaid is the one thing the mode cannot mean: a chain written before it existed meant
    // "carry the chat on", and a chain meaning to end it would read the same way.
    it('says the mode on every chain it writes', () => {
        expect(writeSuccess({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false }))
            .toEqual({ flowNode: 't2', mode: 'continue' });
        expect(writeSuccess({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false })).toEqual({ flowNode: 't2', mode: 'end' });
    });

    // The box is the other way round: unticked is what every document that has never heard of it
    // says, so it goes in only when it is ticked.
    it('writes the compaction only where it is asked for', () => {
        expect(writeSuccess({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true }))
            .toEqual({ flowNode: 't2', mode: 'continue', compact: true });
    });

    it('writes what is said with no flow node after it', () => {
        expect(writeSuccess({ flowNode: '', flowNodes: [], mode: 'end', compact: true })).toEqual({ mode: 'end', compact: true });
    });
});

/**
 * What becomes of the chat is asked of an AI card and of no other, and the chain of every card but a
 * Shutdown — so whatever a document, a clipboard or an older build wrote on one is read against its
 * type. A field nothing draws and nothing can reach would mark the card as broken with no control on
 * screen to fix it with.
 */
describe('what a flow node of this type can hold', () => {
    it('leaves an AI card exactly what it said', () => {
        expect(successFor({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true }, 'ai'))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true });
    });

    // The chain is untouched: an order somebody wrote down holds whoever plays the cards.
    it('reads every other type as claiming nothing, and keeps what it names after it', () => {
        expect(successFor({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true }, 'human'))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false });
        expect(successFor({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: false }, 'scheduler'))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false });
    });

    // Nothing is ever played once the machine is off, so a chain written there is one the document
    // should not go on claiming.
    it('takes the chain off a Shutdown', () => {
        expect(successFor({ flowNode: 't2', flowNodes: [], mode: 'continue', compact: true }, 'shutdown'))
            .toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: false });
    });

    it('hands back the same object where there is nothing to settle', () => {
        const said = { flowNode: 't2', flowNodes: [], mode: 'end' as const, compact: false };
        expect(successFor(said, 'human')).toBe(said);
    });
});

describe("a gateway's branches", () => {
    it('reads the list beside the single card, cleaned', () => {
        expect(readSuccess({ flowNodes: [' b ', '', 'b', 'a', 42, null] }))
            .toEqual({ flowNode: '', flowNodes: ['b', 'a'], mode: 'end', compact: false });
    });

    it('reads anything else as no branches', () => {
        expect(readSuccess({ flowNodes: 't2' }).flowNodes).toEqual([]);
        expect(readSuccess({}).flowNodes).toEqual([]);
    });

    it('keeps the branches on a gateway and takes the single card off it', () => {
        expect(successFor({ flowNode: 't2', flowNodes: ['b', 'a'], mode: 'continue', compact: true }, 'gateway'))
            .toEqual({ flowNode: '', flowNodes: ['b', 'a'], mode: 'end', compact: false });
    });

    it('takes the branches off every other kind', () => {
        expect(successFor({ flowNode: 't2', flowNodes: ['b'], mode: 'end', compact: false }, 'ai'))
            .toEqual({ flowNode: 't2', flowNodes: [], mode: 'end', compact: false });
        expect(successFor({ flowNode: '', flowNodes: ['b'], mode: 'end', compact: false }, 'scheduler'))
            .toEqual({ flowNode: '', flowNodes: [], mode: 'end', compact: false });
    });

    it('says something follows where branches do, and writes them beside the single card', () => {
        expect(hasSuccess({ flowNode: '', flowNodes: ['b'], mode: 'end', compact: false })).toBe(true);
        expect(writeSuccess({ flowNode: '', flowNodes: ['b', 'a'], mode: 'end', compact: false }))
            .toEqual({ flowNodes: ['b', 'a'], mode: 'end' });
    });
});
