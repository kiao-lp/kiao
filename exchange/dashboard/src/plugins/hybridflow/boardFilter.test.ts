import { describe, it, expect } from 'vitest';
import {
    boardTags, filterFlowNodes, keptTags, showsFlowNode, toggleTag,
} from './boardFilter';
import { newFlowNode, FlowNode } from './boardContent';

/** A node wearing the words it is filed under. */
const node = (title: string, ...tags: string[]): FlowNode => ({ ...newFlowNode(title), tags });

const titles = (flowNodes: FlowNode[]) => flowNodes.map(flowNode => flowNode.title);

describe('the words a board offers to filter on', () => {
    it('gathers the words its nodes wear, each once and alphabetically', () => {
        const flowNodes = [node('One', 'ui', 'bug'), node('Two', 'bug'), node('Three', 'agent'), node('Four')];
        expect(boardTags(flowNodes)).toEqual(['agent', 'bug', 'ui']);
    });

    it('reads a word written in two cases as one word', () => {
        expect(boardTags([node('One', 'Bug'), node('Two', 'bug')])).toEqual(['Bug']);
    });

    it('has nothing to offer for a board of untagged nodes', () => {
        expect(boardTags([node('One'), node('Two')])).toEqual([]);
    });
});

describe('what a filter leaves on screen', () => {
    it('shows every node while nothing is asked for', () => {
        const flowNodes = [node('One', 'bug'), node('Two')];
        expect(filterFlowNodes(flowNodes, [])).toBe(flowNodes);
    });

    it('shows a node carrying any of the words asked for', () => {
        const flowNodes = [node('Bugged', 'bug'), node('Both', 'bug', 'ui'), node('Other', 'doc'), node('Bare')];
        expect(titles(filterFlowNodes(flowNodes, ['bug', 'ui']))).toEqual(['Bugged', 'Both']);
    });

    it('matches whatever case the word was written in', () => {
        expect(showsFlowNode(node('One', 'Bug'), ['bug'])).toBe(true);
    });

    it('keeps the nodes it shows in the order they come in', () => {
        const flowNodes = [node('Last', 'bug'), node('Other'), node('First', 'bug')];
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

// A word untagged from its last node — here, or by a run rewriting the board underneath — would otherwise.
describe('a filter the board has outlived', () => {
    it('drops the words the board no longer wears', () => {
        expect(keptTags(['bug', 'ui'], ['ui', 'doc'])).toEqual(['ui']);
    });
});
