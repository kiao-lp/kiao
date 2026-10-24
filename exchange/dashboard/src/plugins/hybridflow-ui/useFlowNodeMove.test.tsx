import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Moving cards to another board: created there first, taken off here after. What is asked here
 * is the order of those two — the receiving board first, and this one only once it holds them —
 * because a move that removed the cards and created nothing is the one way this feature loses
 * work.
 */

const board = vi.hoisted(() => ({
    content: null as any,
    handle: 'here',
    removeFlowNodes: vi.fn(),
}));
const store = vi.hoisted(() => ({
    createFlowNodes: vi.fn().mockResolvedValue([]),
}));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('./service', async importOriginal => ({
    ...(await importOriginal<typeof import('./service')>()),
    useHybridflowClient: () => store,
}));

import { useFlowNodeMove } from './useFlowNodeMove';
import { NewFlowNodeDto } from './service';
import { newFlowNode } from './boardContent';

const Probe: React.FC<{ flowNodeIds: string[]; slug?: string }> = ({ flowNodeIds, slug = 'there' }) => {
    const move = useFlowNodeMove();
    return (
        <button
            data-testid="move"
            onClick={() => void move(flowNodeIds, { slug, name: 'There' })}
        >
            move
        </button>
    );
};

const showing = (...titles: string[]) => {
    board.content = { flowNodes: titles.map(title => newFlowNode(title)) };
};

const cardsOf = () => board.content.flowNodes;

const sent = (): NewFlowNodeDto[] => store.createFlowNodes.mock.calls[0][1] as NewFlowNodeDto[];

beforeEach(() => {
    vi.clearAllMocks();
    store.createFlowNodes.mockResolvedValue([]);
});

describe('moving flow nodes to another board', () => {
    it('files the cards on the other board and takes them off this one', async () => {
        showing('First', 'Second');
        const [first, second] = cardsOf();
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodes).toHaveBeenCalledTimes(1));
        expect(store.createFlowNodes.mock.calls[0][0]).toBe('there');
        expect(sent().map(dto => dto.title)).toEqual(['First', 'Second']);
        // New ids throughout: two boards briefly hold the same work under different ids
        // rather than one id twice.
        expect(sent().map(dto => dto.id)).not.toContain(first.id);
        expect(sent().map(dto => dto.id)).not.toContain(second.id);
        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalledWith([first.id, second.id]));
    });

    it('creates on the other board before taking anything off this one', async () => {
        showing('Only');
        const [only] = cardsOf();
        let removedBeforeCreated = false;
        board.removeFlowNodes.mockImplementationOnce(() => {
            removedBeforeCreated = store.createFlowNodes.mock.calls.length === 0;
        });
        render(<Probe flowNodeIds={[only.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalled());
        expect(removedBeforeCreated).toBe(false);
    });

    it('keeps the chains among the moved cards, and takes off the ones left behind', async () => {
        showing('First', 'Second');
        const [first, second] = cardsOf();
        first.onSuccess = { flowNode: second.id, flowNodes: [], mode: 'continue', compact: false };
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodes).toHaveBeenCalled());
        const [one, two] = sent();
        expect(one.onSuccess?.flowNode).toBe(two.id);

        vi.clearAllMocks();
        render(<Probe flowNodeIds={[first.id]} />);

        fireEvent.click(screen.getAllByTestId('move')[1]);

        await waitFor(() => expect(store.createFlowNodes).toHaveBeenCalled());
        expect(sent()[0].onSuccess?.flowNode).toBeUndefined();
    });

    it('leaves the cards where they are when the other board refuses them', async () => {
        store.createFlowNodes.mockRejectedValue(new Error('refused'));
        showing('Staying');
        const [staying] = cardsOf();
        render(<Probe flowNodeIds={[staying.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodes).toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    it('does nothing at all where no id names a card, or the board is its own', async () => {
        showing('Mine');
        render(<Probe flowNodeIds={['gone']} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodes).not.toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();

        vi.clearAllMocks();
        const [mine] = cardsOf();
        render(<Probe flowNodeIds={[mine.id]} slug="here" />);

        fireEvent.click(screen.getAllByTestId('move')[1]);

        await waitFor(() => expect(store.createFlowNodes).not.toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });
});
