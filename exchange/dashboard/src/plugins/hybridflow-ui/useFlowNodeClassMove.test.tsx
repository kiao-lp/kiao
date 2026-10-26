import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Moving classes to another board: created there first, taken off here after. What is asked here
 * is the order of those two — the receiving board first, and this one only once it holds them —
 * because a move that removed the classes and created nothing is the one way this feature loses
 * work.
 */

const board = vi.hoisted(() => ({
    content: null as any,
    handle: 'here',
    removeFlowNodeClasses: vi.fn(),
}));
const store = vi.hoisted(() => ({
    createFlowNodeClass: vi.fn(),
    createClassVersion: vi.fn(),
    patchClassVersion: vi.fn(),
    chainFlowNodeClass: vi.fn().mockResolvedValue({}),
}));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('./service', async importOriginal => ({
    ...(await importOriginal<typeof import('./service')>()),
    useHybridflowClient: () => store,
}));

import { useFlowNodeClassMove } from './useFlowNodeClassMove';
import { NewFlowNodeClassDto } from './service';
import { FlowNodeClass, newClassVersion, newFlowNodeClass } from './flowNodeClass';

const Probe: React.FC<{ classIds: string[]; slug?: string }> = ({ classIds, slug = 'there' }) => {
    const move = useFlowNodeClassMove();
    return (
        <button
            data-testid="move"
            onClick={() => void move(classIds, { slug, name: 'There' })}
        >
            move
        </button>
    );
};

const classOf = (title: string): FlowNodeClass => ({ ...newFlowNodeClass('ai'), title });

const showing = (...classes: FlowNodeClass[]) => {
    board.content = { flowNodes: [], flowNodeClasses: classes };
};

const sent = (): NewFlowNodeClassDto[] =>
    store.createFlowNodeClass.mock.calls.map((call: any[]) => call[1] as NewFlowNodeClassDto);

beforeEach(() => {
    vi.clearAllMocks();
    // The service files the class under the id the editor minted, and each version under one of
    // its own: the move chains and files beneath the ids it sent.
    store.createFlowNodeClass.mockImplementation(
        async (_handle: string, dto: NewFlowNodeClassDto) => ({ id: dto.id, versions: [{ id: 'v1' }] }));
    store.createClassVersion.mockImplementation(async () => ({ id: `version-${store.createClassVersion.mock.calls.length}` }));
    store.patchClassVersion.mockResolvedValue({});
    store.chainFlowNodeClass.mockResolvedValue({});
});

describe('moving flow node classes to another board', () => {
    it('files the classes on the other board and takes them off this one', async () => {
        const first = classOf('First');
        const second = classOf('Second');
        showing(first, second);
        render(<Probe classIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodeClass).toHaveBeenCalledTimes(2));
        expect(store.createFlowNodeClass.mock.calls[0][0]).toBe('there');
        expect(sent().map(dto => dto.title)).toEqual(['First', 'Second']);
        // New ids throughout: two boards briefly hold the same work under different ids
        // rather than one id twice.
        expect(sent().map(dto => dto.id)).not.toContain(first.id);
        expect(sent().map(dto => dto.id)).not.toContain(second.id);
        // And no place: they arrive unplaced, and the receiving board lays them out.
        expect(sent().every(dto => dto.spot === undefined)).toBe(true);
        await waitFor(() => expect(board.removeFlowNodeClasses).toHaveBeenCalledWith([first.id, second.id]));
    });

    it('creates on the other board before taking anything off this one', async () => {
        const only = classOf('Only');
        showing(only);
        let removedBeforeCreated = false;
        board.removeFlowNodeClasses.mockImplementationOnce(() => {
            removedBeforeCreated = store.createFlowNodeClass.mock.calls.length === 0;
        });
        render(<Probe classIds={[only.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(board.removeFlowNodeClasses).toHaveBeenCalled());
        expect(removedBeforeCreated).toBe(false);
    });

    it('files every version beneath, frozen where the source was', async () => {
        const one = {
            ...classOf('Versioned'),
            versions: [
                { ...newClassVersion([]), body: 'First words.', status: 'published' as const },
                { ...newClassVersion([]), body: 'Second words.', status: 'published' as const },
                { ...newClassVersion([]), body: 'Third words.', status: 'draft' as const },
            ],
        };
        showing(one);
        render(<Probe classIds={[one.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodeClass).toHaveBeenCalledTimes(1));
        // The first version's words go beside the create, frozen at creation.
        expect(sent()[0].body).toBe('First words.');
        expect(sent()[0].published).toBe(true);
        // The rest are filed beneath in succession order, each published straight after
        // where the source was.
        await waitFor(() => expect(store.createClassVersion).toHaveBeenCalledTimes(2));
        expect(store.createClassVersion.mock.calls[0][2]).toMatchObject({ body: 'Second words.' });
        expect(store.createClassVersion.mock.calls[1][2]).toMatchObject({ body: 'Third words.' });
        await waitFor(() => expect(store.patchClassVersion).toHaveBeenCalledTimes(1));
        expect(store.patchClassVersion.mock.calls[0][3]).toEqual({ status: 'published' });
        await waitFor(() => expect(board.removeFlowNodeClasses).toHaveBeenCalledWith([one.id]));
    });

    it('draws the chains among the moved classes once all are filed', async () => {
        const first = classOf('First');
        const second = classOf('Second');
        first.onSuccess = { flowNode: second.id, flowNodes: [], mode: 'continue', compact: false };
        showing(first, second);
        render(<Probe classIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodeClass).toHaveBeenCalledTimes(2));
        // A create names no chain: the class after it may not be filed yet.
        expect(sent().every(dto => dto.onSuccess?.flowNode === undefined)).toBe(true);
        // The mode travels on the create all the same.
        expect(sent()[0].onSuccess?.mode).toBe('continue');
        const [one, two] = sent();
        await waitFor(() => expect(store.chainFlowNodeClass).toHaveBeenCalledWith('there', one.id, two.id));

        vi.clearAllMocks();
        render(<Probe classIds={[first.id]} />);

        fireEvent.click(screen.getAllByTestId('move')[1]);

        // A chain naming a class left behind is taken off rather than drawn.
        await waitFor(() => expect(store.createFlowNodeClass).toHaveBeenCalled());
        expect(store.chainFlowNodeClass).not.toHaveBeenCalled();
    });

    it('leaves the classes where they are when the other board refuses them', async () => {
        store.createFlowNodeClass.mockRejectedValue(new Error('refused'));
        const staying = classOf('Staying');
        showing(staying);
        render(<Probe classIds={[staying.id]} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodeClass).toHaveBeenCalled());
        expect(board.removeFlowNodeClasses).not.toHaveBeenCalled();
    });

    it('does nothing at all where no id names a class, or the board is its own', async () => {
        showing(classOf('Mine'));
        render(<Probe classIds={['gone']} />);

        fireEvent.click(screen.getByTestId('move'));

        await waitFor(() => expect(store.createFlowNodeClass).not.toHaveBeenCalled());
        expect(board.removeFlowNodeClasses).not.toHaveBeenCalled();

        vi.clearAllMocks();
        const [mine] = board.content.flowNodeClasses;
        render(<Probe classIds={[mine.id]} slug="here" />);

        fireEvent.click(screen.getAllByTestId('move')[1]);

        await waitFor(() => expect(store.createFlowNodeClass).not.toHaveBeenCalled());
        expect(board.removeFlowNodeClasses).not.toHaveBeenCalled();
    });
});
