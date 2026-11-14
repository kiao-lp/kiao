import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from 'src/test/render';
import { CentralStackProvider } from '@kiao-dashboard-core';
import { parseHumanOutput, successorToTodo, successorToPlay, workPanelId } from './WorkOnTask';

const editFlowNode = vi.hoisted(() => vi.fn());
const setWorking = vi.hoisted(() => vi.fn());
const playback = vi.hoisted(() => ({ play: vi.fn(), runOn: vi.fn(() => null as unknown) }));
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
vi.mock('../usePlayFlowNode', () => ({ usePlayFlowNode: () => playback }));
vi.mock('../useChatAvailable', () => ({ useChatAvailable: () => true }));
vi.mock('@kiao-dashboard-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@kiao-dashboard-core')>()),
    ConfiguredMarkdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const { WorkOnTask } = await import('./WorkOnTask');
const original = structuredClone(content);

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(content, structuredClone(original));
    editFlowNode.mockResolvedValue(true);
    playback.runOn.mockReturnValue(null);
});

const readyAi = (): typeof content.flowNodes[number] => Object.assign(content.flowNodes[1], {
    type: 'ai', title: 'Continue', body: 'Use {{input}}',
    settings: { agent: 'agent-1', effort: 'high', permission: 'bypassPermissions', folder: '/' },
});

const showTask = () => render(<CentralStackProvider><WorkOnTask flowNodeId="human-1" /></CentralStackProvider>);

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

    it.each(['draft', 'blocked', 'done', 'running', 'error'])('does not play a successor that is %s', status => {
        Object.assign(readyAi(), { status });
        expect(successorToPlay(content, content.flowNodes[0])).toBeNull();
    });

    it('requires a live, configured successor with a prompt', () => {
        const next = readyAi();
        expect(successorToPlay(content, content.flowNodes[0])).toBe(next.id);
        next.archived = true;
        expect(successorToPlay(content, content.flowNodes[0])).toBeNull();
        next.archived = false;
        next.settings = {};
        expect(successorToPlay(content, content.flowNodes[0])).toBeNull();
        readyAi();
        next.body = '';
        next.title = '';
        expect(successorToPlay(content, content.flowNodes[0])).toBeNull();
    });
});

describe('WorkOnTask panel', () => {
    it('shows description and criteria and submits raw text as done', async () => {
        showTask();
        expect(screen.getByText('Check the result.')).toBeTruthy();
        expect(screen.getByText('Result checked')).toBeTruthy();
        fireEvent.change(screen.getByTestId('work-on-task-output'), { target: { value: 'Looks good' } });
        fireEvent.click(screen.getByTestId('work-on-task-submit'));
        expect(editFlowNode).toHaveBeenCalledWith('human-1', { output: 'Looks good', status: 'done' });
        await waitFor(() => expect(editFlowNode).toHaveBeenCalledWith('human-2', { status: 'todo' }));
        await waitFor(() => expect(setWorking).toHaveBeenCalledWith(null));
        expect(playback.play).not.toHaveBeenCalled();
    });

    it('starts a ready AI successor after the human output is saved', async () => {
        readyAi();
        let finish!: (saved: boolean) => void;
        editFlowNode.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        showTask();
        fireEvent.change(screen.getByTestId('work-on-task-output'), { target: { value: 'Approved' } });
        fireEvent.click(screen.getByTestId('work-on-task-submit'));
        expect(editFlowNode).toHaveBeenCalledWith('human-1', { output: 'Approved', status: 'done' });
        expect(playback.play).not.toHaveBeenCalled();
        expect(setWorking).not.toHaveBeenCalled();

        await act(async () => finish(true));

        expect(playback.play).toHaveBeenCalledWith('human-2', expect.stringMatching(/^Started /));
        expect(setWorking).toHaveBeenCalledWith(null);
    });

    it('keeps the output available for retry when saving fails', async () => {
        readyAi();
        editFlowNode.mockResolvedValue(false);
        showTask();
        fireEvent.change(screen.getByTestId('work-on-task-output'), { target: { value: 'My draft' } });
        fireEvent.click(screen.getByTestId('work-on-task-submit'));

        expect(await screen.findByRole('alert')).toHaveTextContent('The task could not be saved');
        expect(screen.getByTestId('work-on-task-output')).toHaveValue('My draft');
        expect(playback.play).not.toHaveBeenCalled();
        expect(setWorking).not.toHaveBeenCalled();
    });

    it('leaves a successor already held by a run alone', async () => {
        readyAi();
        playback.runOn.mockReturnValue({ id: 'run-1' });
        showTask();
        fireEvent.click(screen.getByTestId('work-on-task-submit'));

        await waitFor(() => expect(setWorking).toHaveBeenCalledWith(null));
        expect(playback.play).not.toHaveBeenCalled();
    });
});
