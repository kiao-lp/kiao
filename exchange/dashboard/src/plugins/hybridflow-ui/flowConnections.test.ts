import { describe, expect, it } from 'vitest';
import { newFlowNode, BoardContent, FlowNode } from './boardContent';
import { canConnect, canRetype, chainConnectionIssue } from './flowConnections';
import { chainFlowNode, editFlowNode } from './boardOps';

const node = (id: string, type: FlowNode['type'] = 'human', next = ''): FlowNode => ({
    ...newFlowNode(id), id, type,
    onSuccess: { flowNode: type === 'gateway' ? '' : next, flowNodes: type === 'gateway' && next ? [next] : [], mode: 'end', compact: false },
});
const board = (flowNodes: FlowNode[]): BoardContent => ({ flowNodes, flowNodeClasses: [], workflows: [], workflowClasses: [] });

describe('connection cardinality', () => {
    it.each(['ai', 'human', 'scheduler', 'shutdown'] as const)('refuses a second predecessor on %s, including gateway branches', type => {
        const nodes = [node('first', 'human', 'target'), node('second', 'gateway'), node('target', type)];
        expect(canConnect(nodes, 'second', 'target')).toBe(false);
        expect(chainFlowNode(board(nodes), 'second', 'target')).toBeNull();
        expect(editFlowNode(board(nodes), 'second', { onSuccess: { ...nodes[1].onSuccess, flowNodes: ['target'] } })).toBeNull();
        expect(canConnect(nodes, 'first', 'target')).toBe(true);
    });

    it('allows several predecessors and successors on gateways', () => {
        const nodes = [node('first', 'human', 'join'), node('second'), node('join', 'gateway'), node('after')];
        expect(canConnect(nodes, 'second', 'join')).toBe(true);
        const linked = chainFlowNode(board(nodes), 'second', 'join')!;
        const forked = chainFlowNode(linked, 'join', 'after')!;
        expect(forked.flowNodes[2].onSuccess.flowNodes).toEqual(['after']);
        expect(chainConnectionIssue(forked.flowNodes, 'first')).toBeNull();
        expect(canRetype(forked.flowNodes, 'join', 'human')).toBe(false);
    });

    it('retargets a single successor and rejects shutdown outputs and display targets', () => {
        const nodes = [node('first', 'human', 'old'), node('old'), node('new'), node('off', 'shutdown'), node('note', 'note')];
        expect(chainFlowNode(board(nodes), 'first', 'new')?.flowNodes[0].onSuccess.flowNode).toBe('new');
        expect(canConnect(nodes, 'off', 'new')).toBe(false);
        expect(canConnect(nodes, 'first', 'note')).toBe(false);
    });

    it('finds a legacy join before play while allowing an independent chain', () => {
        const nodes = [node('first', 'human', 'target'), node('second', 'gateway', 'target'), node('target'), node('elsewhere')];
        expect(chainConnectionIssue(nodes, 'first')).toContain('target');
        expect(chainConnectionIssue(nodes, 'elsewhere')).toBeNull();
        expect(chainConnectionIssue(nodes.map(n => n.id === 'second' ? { ...n, archived: true } : n), 'first')).toBeNull();
    });

    it('reserves the predecessor of an archived card until its link is removed', () => {
        const nodes = [node('first', 'human', 'target'), node('second'), node('target')];
        nodes[0].archived = true;
        expect(canConnect(nodes, 'second', 'target')).toBe(false);
    });
});
