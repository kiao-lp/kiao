import { describe, it, expect } from 'vitest';
import {
    boardTags, filterFlowNodes, keptTags, showsFlowNode, toggleTag,
} from './boardFilter';
import { newFlowNode, FlowNode } from './boardContent';

/** A card wearing the words it is filed under. */
const card = (title: string, ...tags: string[]): FlowNode => ({ ...newFlowNode(title), tags });

const titles = (flowNodes: FlowNode[]) => flowNodes.map(flowNode => flowNode.title);

describe('the words a board offers to filter on', () => {
    // The board's own, not the store's: a filter listing tags no card here wears is a row of words
    // that all hide everything.
    it('gathers the words its cards wear, each once and alphabetically', () => {
        const flowNodes = [card('One', 'ui', 'bug'), card('Two', 'bug'), card('Three', 'agent'), card('Four')];
        expect(boardTags(flowNodes)).toEqual(['agent', 'bug', 'ui']);
    });

    it('reads a word written in two cases as one word', () => {
        expect(boardTags([card('One', 'Bug'), card('Two', 'bug')])).toEqual(['Bug']);
    });

    it('has nothing to offer for a board of untagged cards', () => {
        expect(boardTags([card('One'), card('Two')])).toEqual([]);
    });
});

describe('what a filter leaves on screen', () => {
    it('shows every card while nothing is asked for', () => {
        const flowNodes = [card('One', 'bug'), card('Two')];
        expect(filterFlowNodes(flowNodes, [])).toBe(flowNodes);
    });

    // Several words are the wider question, not the narrower one: a row of chips reads as "these".
    it('shows a card carrying any of the words asked for', () => {
        const flowNodes = [card('Bugged', 'bug'), card('Both', 'bug', 'ui'), card('Other', 'doc'), card('Bare')];
        expect(titles(filterFlowNodes(flowNodes, ['bug', 'ui']))).toEqual(['Bugged', 'Both']);
    });

    it('matches whatever case the word was written in', () => {
        expect(showsFlowNode(card('One', 'Bug'), ['bug'])).toBe(true);
    });

    // A filter hides cards; it does not reorder the ones it leaves.
    it('keeps the cards it shows in the order they come in', () => {
        const flowNodes = [card('Last', 'bug'), card('Other'), card('First', 'bug')];
        expect(titles(filterFlowNodes(flowNodes, ['bug']))).toEqual(['Last', 'First']);
    });
});

describe('pressing a chip', () => {
    it('takes a word on and off', () => {
        expect(toggleTag([], 'bug')).toEqual(['bug']);
        expect(toggleTag(['bug', 'ui'], 'bug')).toEqual(['ui']);
    });

    it('takes off the word it was pressed with, in whatever case', () => {
        expect(toggleTag(['Bug'], 'bug')).toEqual([]);
    });
});

// A word untagged from its last card — here, or by a run rewriting the board underneath — would
// otherwise stay in force with no chip left to turn it off.
describe('a filter the board has outlived', () => {
    it('drops the words the board no longer wears', () => {
        expect(keptTags(['bug', 'ui'], ['ui', 'doc'])).toEqual(['ui']);
    });
});
