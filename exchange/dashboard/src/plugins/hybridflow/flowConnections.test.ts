import { describe, expect, it } from 'vitest';
import { newFlowNode, BoardContent, FlowNode } from './boardContent';
import { canConnect, canRetype, chainConnectionIssue } from './flowConnections';
import { chainFlowNode, cloneFlowNode, editFlowNode } from './boardOps';

const node = (id: string, type: FlowNode['type'] = 'human', next = ''): FlowNode => ({
    ...newFlowNode(id), id, type,
    onSuccess: { flowNode: type === 'gateway' ? '' : next, flowNodes: type === 'gateway' && next ? [next] : [], mode: 'end', compact: false },
});
const board = (flowNodes: FlowNode[]): BoardContent => ({ flowNodes, workflows: [] });

describe('connection cardinality', () => {
    it('allows an outgoing link from Start and refuses any predecessor', () => {
        const nodes = [node('start', 'start'), node('task'), node('fork', 'gateway')];
        expect(canConnect(nodes, 'task', 'start')).toBe(false);
        expect(canConnect(nodes, 'fork', 'start')).toBe(false);
        const linked = chainFlowNode(board(nodes), 'start', 'task')!;
        expect(linked.flowNodes[0].onSuccess.flowNode).toBe('task');
        expect(canRetype(linked.flowNodes, 'task', 'start')).toBe(false);
        expect(chainConnectionIssue([node('task', 'human', 'start'), nodes[0]], 'task'))
            .toBe('“start” cannot have a predecessor.');
    });

    it.each(['ai', 'human', 'scheduler', 'shutdown'] as const)('refuses a second predecessor on %s, including gateway branches', type => {
        const nodes = [node('first', 'human', 'target'), node('second', 'gateway'), node('target', type)];
        expect(canConnect(nodes, 'second', 'target')).toBe(false);
        expect(chainFlowNode(board(nodes), 'second', 'target')).toBeNull();
        expect(editFlowNode(board(nodes), 'second', { onSuccess: { ...nodes[1].onSuccess, flowNodes: ['target'] } })).toBeNull();
        expect(canConnect(nodes, 'first', 'target')).toBe(true);
    });

    it.each(['gateway', 'exclusive-gateway'] as const)('allows several predecessors and successors on %s', type => {
        const nodes = [node('first', 'human', 'join'), node('second'), node('join', type), node('after')];
        expect(canConnect(nodes, 'second', 'join')).toBe(true);
        const linked = chainFlowNode(board(nodes), 'second', 'join')!;
        const forked = chainFlowNode(linked, 'join', 'after')!;
        expect(forked.flowNodes[2].onSuccess.flowNodes).toEqual(['after']);
        expect(chainConnectionIssue(forked.flowNodes, 'first')).toBeNull();
        expect(canRetype(forked.flowNodes, 'join', 'exclusive-gateway')).toBe(true);
        expect(canRetype(forked.flowNodes, 'join', 'human')).toBe(false);
        const clone = cloneFlowNode(forked, 'first')!;
        expect(clone.flowNode.onSuccess.flowNode).toBe('join');
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

    it('reserves the predecessor of an archived node until its link is removed', () => {
        const nodes = [node('first', 'human', 'target'), node('second'), node('target')];
        nodes[0].archived = true;
        expect(canConnect(nodes, 'second', 'target')).toBe(false);
    });
});
