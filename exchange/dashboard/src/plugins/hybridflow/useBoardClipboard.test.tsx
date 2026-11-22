import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The cut: the cards on the clipboard, and then off the board. */

const board = vi.hoisted(() => ({
    content: null as any,
    removeFlowNodes: vi.fn(),
    insertFlowNodes: vi.fn(),
}));
const clipboard = vi.hoisted(() => ({
    setClipboard: vi.fn().mockResolvedValue(undefined),
    getClipboardText: vi.fn().mockResolvedValue(''),
}));
const client = vi.hoisted(() => ({ deleteHarnessConversation: vi.fn().mockResolvedValue(undefined) }));
/** The agents this store keeps, as the paste asks for them: read, rather than rendered. */
const agents = vi.hoisted(() => ({ loaded: vi.fn() }));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('./Agents-ctx', () => ({ useAgents: () => agents }));
vi.mock('@kiao-dashboard-core', () => ({ Clipboard: clipboard, useWorkerClient: () => client }));

import { useBoardClipboard } from './useBoardClipboard';
import { CHAIN_STEP } from './boardSpots';
import { FlowNodeSpot } from './flowNodeSpot';
import { newFlowNode, FlowNode } from './boardContent';

const Probe: React.FC<{ flowNodeIds: string[] }> = ({ flowNodeIds }) => {
    const { copyFlowNodes, cutFlowNodes } = useBoardClipboard();
    return (
        <>
            <button data-testid="cut" onClick={() => cutFlowNodes(flowNodeIds)}>cut</button>
            <button data-testid="copy" onClick={() => copyFlowNodes(flowNodeIds)}>copy</button>
        </>
    );
};

/** Points the board at flow nodes — the cards are looked for across the whole of it. */
const showing = (left: FlowNode[], right: FlowNode[] = []) => {
    board.content = { flowNodes: [...left, ...right] };
};

/** What was put on the clipboard, read back as the JSON it is. */
const written = (): any => JSON.parse(clipboard.setClipboard.mock.calls[0][0]);

/** Whether a dialog on screen is asking this. */
const asking = (title: string): boolean =>
    [...document.querySelectorAll('.ant-modal-confirm-title')].some(node => node.textContent === title);

beforeEach(() => {
    vi.clearAllMocks();
    clipboard.setClipboard.mockResolvedValue(undefined);
    agents.loaded.mockResolvedValue([]);
    document.body.innerHTML = '';
});

describe('cutting flow nodes', () => {
    it('writes the card to the clipboard and takes it off the board', async () => {
        const flowNode = newFlowNode('Travelling');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalledWith([flowNode.id]));
        expect(written()).toMatchObject({ kind: 'kiao-flow-node', flowNode: { title: 'Travelling' } });
    });

    // The whole of the order this file is about: the cards leave because the clipboard took them, and a browser.
    it('leaves the cards where they are when the clipboard refuses the write', async () => {
        clipboard.setClipboard.mockRejectedValue(new Error('denied'));
        const flowNode = newFlowNode('Staying');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(clipboard.setClipboard).toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    it('takes every card it was named, in one text and one edit', async () => {
        const first = newFlowNode('First');
        const second = newFlowNode('Second');
        const stays = newFlowNode('Stays behind');
        showing([first, stays], [second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalledWith([first.id, second.id]));
        expect(board.removeFlowNodes).toHaveBeenCalledTimes(1);
        expect(written().flowNodes.map((flowNode: any) => flowNode.title)).toEqual(['First', 'Second']);
    });

    it('does nothing at all where no id names a card', async () => {
        showing([newFlowNode('Mine')]);
        render(<Probe flowNodeIds={['gone']} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(clipboard.setClipboard).not.toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    it('asks about a conversation the board is left with nothing naming', async () => {
        const flowNode = { ...newFlowNode('Played'), chat: 'chat-1' };
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        expect(board.removeFlowNodes).toHaveBeenCalledWith([flowNode.id]);
    });

    // And asks it only of the last card naming the conversation: a card cut out of the middle of.
    it('asks nothing where another card on the board is still on that chat', async () => {
        const flowNode = { ...newFlowNode('Played'), chat: 'chat-1' };
        const kept = { ...newFlowNode('Also played'), chat: 'chat-1' };
        showing([flowNode], [kept]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalled());
        expect(asking('Delete its chat too?')).toBe(false);
    });
});

const PasteProbe: React.FC<{ spot: FlowNodeSpot }> = ({ spot }) => {
    const { pasteFlowNodes } = useBoardClipboard();
    return <button data-testid="paste-at" onClick={() => pasteFlowNodes(spot)}>paste-at</button>;
};

/** The keyboard's paste: aimed at no point, so it names none. */
const KeyboardPasteProbe: React.FC = () => {
    const { pasteFlowNodes } = useBoardClipboard();
    return <button data-testid="paste" onClick={() => pasteFlowNodes()}>paste</button>;
};

describe('pasting flow nodes onto the canvas', () => {
    it('files the clipboard’s flow nodes on the board, laid out from where the paste was aimed', async () => {
        clipboard.getClipboardText.mockResolvedValue(JSON.stringify({
            kind: 'kiao-flow-nodes',
            version: 1,
            flowNodes: [
                {
                    id: 'old-1',
                    title: 'First',
                    onSuccess: { flowNode: 'old-2', flowNodes: [], mode: 'end', compact: false },
                },
                { id: 'old-2', title: 'Second' },
            ],
        }));
        render(<PasteProbe spot={{ x: 100, y: 200 }} />);

        fireEvent.click(screen.getByTestId('paste-at'));

        await waitFor(() => expect(board.insertFlowNodes).toHaveBeenCalledTimes(1));
        const [flowNodes] = board.insertFlowNodes.mock.calls[0] as [FlowNode[]];
        expect(flowNodes.map(flowNode => flowNode.title)).toEqual(['First', 'Second']);
        expect(flowNodes.map(flowNode => flowNode.id)).not.toContain('old-1');
        expect(flowNodes[0].onSuccess.flowNode).toBe(flowNodes[1].id);
        expect(flowNodes[0].spot).toEqual({ x: 100, y: 200 });
        expect(flowNodes[1].spot).toEqual({ x: 100 + CHAIN_STEP, y: 200 });
    });

    it('files the clipboard’s flow nodes unplaced where the paste names no point', async () => {
        clipboard.getClipboardText.mockResolvedValue(JSON.stringify({
            kind: 'kiao-workflow-flow-nodes',
            version: 1,
            flowNodes: [
                { id: 'old-1', title: 'First' },
                { id: 'old-2', title: 'Second' },
            ],
        }));
        render(<KeyboardPasteProbe />);

        fireEvent.click(screen.getByTestId('paste'));

        await waitFor(() => expect(board.insertFlowNodes).toHaveBeenCalledTimes(1));
        const [flowNodes] = board.insertFlowNodes.mock.calls[0] as [FlowNode[]];
        expect(flowNodes.map(flowNode => flowNode.title)).toEqual(['First', 'Second']);
        expect(flowNodes.map(flowNode => flowNode.spot)).toEqual([null, null]);
    });

    it('keeps the agent a card names where this store keeps it', async () => {
        const agent = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
        agents.loaded.mockResolvedValue([{ id: agent, name: 'Reviewer' }]);
        clipboard.getClipboardText.mockResolvedValue(JSON.stringify({
            kind: 'kiao-flow-node',
            version: 1,
            flowNode: { id: 'old-1', title: 'Assigned', settings: { agent, effort: 'high', folder: '/' } },
        }));
        render(<PasteProbe spot={{ x: 0, y: 0 }} />);

        fireEvent.click(screen.getByTestId('paste-at'));

        await waitFor(() => expect(board.insertFlowNodes).toHaveBeenCalled());
        const [flowNodes] = board.insertFlowNodes.mock.calls[0] as [FlowNode[]];
        expect(flowNodes[0].settings).toEqual({ agent, effort: 'high', folder: '/' });
    });

    it('leaves behind an agent this store does not keep', async () => {
        agents.loaded.mockResolvedValue([{ id: 'ours', name: 'Reviewer' }]);
        clipboard.getClipboardText.mockResolvedValue(JSON.stringify({
            kind: 'kiao-workflow-flow-node',
            version: 1,
            flowNode: {
                id: 'old-1',
                title: 'Assigned elsewhere',
                settings: { agent: '3fa85f64-5717-4562-b3fc-2c963f66afa6', effort: 'high' },
            },
        }));
        render(<PasteProbe spot={{ x: 0, y: 0 }} />);

        fireEvent.click(screen.getByTestId('paste-at'));

        await waitFor(() => expect(board.insertFlowNodes).toHaveBeenCalled());
        const [flowNodes] = board.insertFlowNodes.mock.calls[0] as [FlowNode[]];
        expect(flowNodes[0].settings).toEqual({ effort: 'high' });
    });

    it('does nothing where the clipboard holds no flow node', async () => {
        clipboard.getClipboardText.mockResolvedValue('a shopping list');
        render(<PasteProbe spot={{ x: 0, y: 0 }} />);

        fireEvent.click(screen.getByTestId('paste-at'));

        await waitFor(() => expect(clipboard.getClipboardText).toHaveBeenCalled());
        expect(board.insertFlowNodes).not.toHaveBeenCalled();
    });
});

describe('copying flow nodes', () => {
    // The difference between the two gestures, and the only one: the board is left as it was.
    it('writes the same text and takes nothing off the board', async () => {
        const flowNode = newFlowNode('Travelling');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('copy'));

        await waitFor(() => expect(clipboard.setClipboard).toHaveBeenCalled());
        expect(written()).toMatchObject({ kind: 'kiao-flow-node', flowNode: { title: 'Travelling' } });
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });
});
