import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The cut: the cards on the clipboard, and then off the board. What is asked here is the order of
 * those two — the clipboard first, and the cards only if it took them — because a cut that removed
 * the cards and wrote nothing is the one way this feature loses work. The browser refusing to write
 * is not a hypothetical: it is a permission, and permissions are refused.
 *
 * What goes on the clipboard is [`boardClip`](./boardClip.ts)'s and tested there. This is about the
 * board it was taken from.
 */

const board = vi.hoisted(() => ({
    content: null as any,
    removeFlowNodes: vi.fn(),
    insertFlowNodes: vi.fn(),
}));
const clipboard = vi.hoisted(() => ({
    setClipboard: vi.fn().mockResolvedValue(undefined),
    getClipboardText: vi.fn().mockResolvedValue(''),
}));
const client = vi.hoisted(() => ({ deleteAgentConversation: vi.fn().mockResolvedValue(undefined) }));
/** The agents this store keeps, as the paste asks for them: read, rather than rendered. */
const agents = vi.hoisted(() => ({ loaded: vi.fn() }));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('./Agents-ctx', () => ({ useAgents: () => agents }));
vi.mock('@cms-core', () => ({ Clipboard: clipboard, useWorkerClient: () => client }));

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
    // antd's static dialogs mount into containers of their own on the body, and a closed one
    // lingers there until its fade-out ends — which is after the test that opened it.
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

    // The whole of the order this file is about: the cards leave *because* the clipboard took them,
    // and a browser that refuses the write leaves the board as it was.
    it('leaves the cards where they are when the clipboard refuses the write', async () => {
        clipboard.setClipboard.mockRejectedValue(new Error('denied'));
        const flowNode = newFlowNode('Staying');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(clipboard.setClipboard).toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    // The cards picked out travel together, like the copy's: one clipboard text, one edit to the
    // document, one paste at the other end.
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

    // A chat does not travel: the card pasted at the other end names that conversation no more than
    // the board does, so a cut orphans it exactly as a delete would, and asks the same question.
    it('asks about a conversation the board is left with nothing naming', async () => {
        const flowNode = { ...newFlowNode('Played'), chat: 'chat-1' };
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        expect(board.removeFlowNodes).toHaveBeenCalledWith([flowNode.id]);
    });

    // And asks it only of the last card naming the conversation: a card cut out of the middle of a
    // chain leaves the rest of the chain on that chat, so nothing is orphaned and nothing is asked.
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
    // A paste onto the canvas is aimed somewhere: the cards land where the right-click was, laid
    // out from there.
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
        // New ids throughout, and the chain among them rewritten with those ids.
        expect(flowNodes.map(flowNode => flowNode.id)).not.toContain('old-1');
        expect(flowNodes[0].onSuccess.flowNode).toBe(flowNodes[1].id);
        // The block's own chain laid out from the aim: along the row, then a row of its own.
        expect(flowNodes[0].spot).toEqual({ x: 100, y: 200 });
        expect(flowNodes[1].spot).toEqual({ x: 100 + CHAIN_STEP, y: 200 });
    });

    // The keyboard's paste names no point: the cards arrive unplaced, and the view lays them out
    // under everything already placed, as it lays out every card that has never been placed.
    it('files the clipboard’s flow nodes unplaced where the paste names no point', async () => {
        // Wrapped the old way on purpose: a copy outlives the build that wrote it.
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

    /**
     * The agent a pasted card names. It is an id of the store the card was copied from, so it means
     * something here exactly where this store is that store — a card cut from one board and pasted
     * onto another — and nothing where it is not.
     *
     * The list is **read** at the paste rather than taken off the render: a board opened a moment
     * ago is still reading its agents, and a card pasted into that moment would lose the one it was
     * assigned for no reason but the timing.
     */
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
        // Wrapped the old way on purpose: a copy outlives the build that wrote it.
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
