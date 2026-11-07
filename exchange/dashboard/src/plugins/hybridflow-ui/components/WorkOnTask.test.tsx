import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from 'src/test/render';
import { CentralStackProvider } from '@cms-core';
import { parseHumanOutput, successorToTodo, workPanelId } from './WorkOnTask';

const editFlowNode = vi.hoisted(() => vi.fn());
const setWorking = vi.hoisted(() => vi.fn());
const content = await vi.hoisted(async () => {
    const { readBoardContent: read } = await import('../boardContent');
    return read({
        flowNodes: [
            {
                id: 'human-1', title: 'Review', type: 'human', status: 'running', body: 'Check the result.',
                criteria: [{ id: 'c1', text: 'Result checked' }],
                onSuccess: { flowNode: 'human-2', mode: 'end' },
            },
            { id: 'human-2', title: 'Approve', type: 'human', status: 'ready' },
        ],
    });
});

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => ({ content, editFlowNode, setWorking }),
}));
vi.mock('../service/HybridflowClient-ctx', () => ({
    useHybridflowClient: () => ({ schemaValues: async () => [] }),
}));
vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    ConfiguredMarkdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const { WorkOnTask } = await import('./WorkOnTask');

describe('human output', () => {
    it('keeps raw text without an output type', () => {
        expect(parseHumanOutput('Done by hand', '')).toEqual({ value: 'Done by hand' });
    });

    it('parses JSON with an output type', () => {
        expect(parseHumanOutput('{"message":"hi"}', 'schema-1')).toEqual({ value: { message: 'hi' } });
        expect(parseHumanOutput('nope', 'schema-1')).toEqual({ error: 'Invalid JSON' });
    });

    it('marks a human successor and names the panel per task', () => {
        expect(successorToTodo(content, content.flowNodes[0])).toBe('human-2');
        expect(workPanelId('human-2')).toBe('work-on-task-human-2');
    });
});

describe('WorkOnTask panel', () => {
    it('shows description and criteria and submits raw text as done', () => {
        render(
            <CentralStackProvider>
                <WorkOnTask flowNodeId="human-1" />
            </CentralStackProvider>,
        );
        expect(screen.getByText('Check the result.')).toBeTruthy();
        expect(screen.getByText('Result checked')).toBeTruthy();
        fireEvent.change(screen.getByTestId('work-on-task-output'), { target: { value: 'Looks good' } });
        fireEvent.click(screen.getByTestId('work-on-task-submit'));
        expect(editFlowNode).toHaveBeenCalledWith('human-1', { output: 'Looks good', status: 'done' });
        expect(editFlowNode).toHaveBeenCalledWith('human-2', { status: 'todo' });
        expect(setWorking).toHaveBeenCalledWith(null);
    });
});
