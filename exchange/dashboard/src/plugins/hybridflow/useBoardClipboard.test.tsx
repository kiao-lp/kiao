import React from 'react';
import { act, render, screen, fireEvent, waitFor } from 'src/test/render';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The cut: the nodes on the clipboard, and then off the board. */

const board = vi.hoisted(() => ({
    content: null as any,
    handle: 'board',
    removeFlowNodes: vi.fn(),
    insertFlowNodes: vi.fn(),
    pasteWorkflow: vi.fn().mockResolvedValue(true),
}));
const clipboard = vi.hoisted(() => ({
    setClipboard: vi.fn().mockResolvedValue(undefined),
    getClipboardText: vi.fn().mockResolvedValue(''),
}));
const client = vi.hoisted(() => ({ deleteHarnessConversation: vi.fn().mockResolvedValue(undefined) }));
/** The agents this store keeps, as the paste asks for them: read, rather than rendered. */
const agents = vi.hoisted(() => ({ loaded: vi.fn() }));
const stack = vi.hoisted(() => ({ push: vi.fn(), close: vi.fn() }));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('./Agents-ctx', () => ({ useAgents: () => agents }));
vi.mock('@kiao-dashboard-core', async () => ({
    useConfirmation: (await import('src/core/ui-foundation/forms/ConfirmationDialog')).useConfirmation,
    Clipboard: clipboard, useWorkerClient: () => client,
    useCentralStack: () => stack,
}));

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

/** Points the board at flow nodes — the nodes are looked for across the whole of it. */
const showing = (left: FlowNode[], right: FlowNode[] = []) => {
    board.content = { flowNodes: [...left, ...right] };
};

/** What was put on the clipboard, read back as the JSON it is. */
const written = (): any => JSON.parse(clipboard.setClipboard.mock.calls[0][0]);

/** Whether a dialog on screen is asking this. */
const asking = (title: string): boolean =>
    screen.queryByRole('dialog', { name: title }) !== null;

beforeEach(() => {
    vi.clearAllMocks();
    clipboard.setClipboard.mockResolvedValue(undefined);
    board.handle = 'board';
    agents.loaded.mockResolvedValue([]);
    document.body.innerHTML = '';
});

describe('cutting flow nodes', () => {
    it('writes the node to the clipboard and takes it off the board', async () => {
        const flowNode = { ...newFlowNode('Travelling'), status: 'blocked' as const };
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalledWith([flowNode.id]));
        expect(written()).toMatchObject({ kind: 'kiao-flow-node', flowNode: { title: 'Travelling', status: 'blocked' } });
    });

    // The whole of the order this file is about: the nodes leave because the clipboard took them, and a browser.
    it('leaves the nodes where they are when the clipboard refuses the write', async () => {
        clipboard.setClipboard.mockRejectedValue(new Error('denied'));
        const flowNode = newFlowNode('Staying');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('cut'));

        await waitFor(() => expect(clipboard.setClipboard).toHaveBeenCalled());
        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    it('takes every node it was named, in one text and one edit', async () => {
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

    it('does nothing at all where no id names a node', async () => {
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

    // And asks it only of the last node naming the conversation: a node cut out of the middle of.
    it('asks nothing where another node on the board is still on that chat', async () => {
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
    const { paste } = useBoardClipboard();
    return <button data-testid="paste-at" onClick={() => paste(spot)}>paste-at</button>;
};

/** The keyboard's paste: aimed at no point, so it names none. */
const KeyboardPasteProbe: React.FC = () => {
    const { paste } = useBoardClipboard();
    return <button data-testid="paste" onClick={() => paste()}>paste</button>;
};

it('copies workflow values and every member and pastes a new group even inside a rectangle', async () => {
    const workflow = { id: 'workflow', name: 'Review chain', values: { checks: [false, null] } };
    const wait = {
        ...newFlowNode('Wait'), type: 'scheduler', workflow: workflow.id,
        duration: '15m', spot: { x: 10, y: 20 },
    } satisfies FlowNode;
    const archived = {
        ...newFlowNode('Archived value'), type: 'value', workflow: workflow.id,
        archived: true, value: null,
    } satisfies FlowNode;
    board.content = { workflows: [workflow], flowNodes: [wait, archived, newFlowNode('Outside')] };
    const spot = { x: 40, y: 70 };
    const WorkflowProbe = () => {
        const { copyWorkflow, paste } = useBoardClipboard();
        return (
            <>
                <button onClick={() => copyWorkflow(workflow.id)}>Copy workflow</button>
                <button onClick={() => paste(spot, workflow.id)}>Paste workflow</button>
            </>
        );
    };
    render(<WorkflowProbe />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy workflow' }));
    const clip = written();
    expect(clip).toEqual({
        kind: 'kiao-workflow', version: 1, workflow: { name: workflow.name, values: workflow.values },
        flowNodes: [
            { id: wait.id, type: 'scheduler', title: 'Wait', duration: '15m', spot: wait.spot, status: 'ready' },
            { id: archived.id, type: 'value', title: 'Archived value', value: null, archived: true, status: 'ready' },
        ],
    });
    clipboard.getClipboardText.mockResolvedValue(JSON.stringify(clip));
    fireEvent.click(screen.getByRole('button', { name: 'Paste workflow' }));
    await waitFor(() => expect(board.pasteWorkflow).toHaveBeenCalledWith(clip, spot));
    expect(board.insertFlowNodes).not.toHaveBeenCalled();
});

it('keeps a pending clipboard read from pasting onto a different board', async () => {
    let finishReading!: (text: string) => void;
    clipboard.getClipboardText.mockImplementationOnce(() =>
        new Promise<string>(resolve => { finishReading = resolve; }));
    const { rerender } = render(<KeyboardPasteProbe />);
    fireEvent.click(screen.getByTestId('paste'));

    board.handle = 'other';
    rerender(<KeyboardPasteProbe />);
    await act(async () => finishReading(JSON.stringify({
        kind: 'kiao-workflow', version: 1, workflow: { name: 'Review' }, flowNodes: [],
    })));
    expect(board.pasteWorkflow).not.toHaveBeenCalled();
});

it('fills the templates of a copied workflow before creating it', async () => {
    const first = { id: 'one', title: 'Plan', type: 'human', body: 'Plan ${subject}.', onSuccess: { flowNode: 'two' } };
    const second = { id: 'two', title: 'Review', type: 'human', body: 'Review the plan.', multiPartTemplate: true };
    const clip = { kind: 'kiao-workflow', version: 1, workflow: { name: 'Planning' }, flowNodes: [first, second] };
    const spot = { x: 90, y: 80 };
    clipboard.getClipboardText.mockResolvedValue(JSON.stringify(clip));
    const InstantiateProbe = () => {
        const { instantiateHere } = useBoardClipboard();
        return <button onClick={() => instantiateHere(spot)}>Instantiate here</button>;
    };
    render(<InstantiateProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Instantiate here' }));
    await waitFor(() => expect(stack.push).toHaveBeenCalledTimes(1));
    expect(board.pasteWorkflow).not.toHaveBeenCalled();

    const [firstPanel] = stack.push.mock.calls[0];
    act(() => firstPanel.content.props.onInstantiate('Plan the launch.'));
    expect(stack.push).toHaveBeenCalledTimes(2);
    expect(board.pasteWorkflow).not.toHaveBeenCalled();

    const [secondPanel] = stack.push.mock.calls[1];
    await act(async () => secondPanel.content.props.onInstantiate('Review the plan.'));
    expect(board.pasteWorkflow).toHaveBeenCalledExactlyOnceWith({
        ...clip,
        flowNodes: [
            { ...first, body: 'Plan the launch.', multiPartTemplate: false },
            { ...second, multiPartTemplate: false },
        ],
    }, spot);
});

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

    it('keeps the agent a node names where this store keeps it', async () => {
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
    it('copies and pastes a task as Draft while leaving the source task alone', async () => {
        const flowNode = { ...newFlowNode('Travelling'), multiPartTemplate: true, status: 'done' as const };
        showing([flowNode]);
        render(
            <>
                <Probe flowNodeIds={[flowNode.id]} />
                <KeyboardPasteProbe />
            </>,
        );

        fireEvent.click(screen.getByTestId('copy'));

        await waitFor(() => expect(clipboard.setClipboard).toHaveBeenCalled());
        expect(written()).toMatchObject({
            kind: 'kiao-flow-node', flowNode: { title: 'Travelling', status: 'draft', multiPartTemplate: true },
        });
        expect(flowNode.status).toBe('done');
        expect(board.removeFlowNodes).not.toHaveBeenCalled();

        clipboard.getClipboardText.mockResolvedValue(clipboard.setClipboard.mock.calls[0][0]);
        fireEvent.click(screen.getByTestId('paste'));

        await waitFor(() => expect(board.insertFlowNodes).toHaveBeenCalledWith([
            expect.objectContaining({ title: 'Travelling', status: 'draft', multiPartTemplate: true }),
        ]));
        expect(stack.push).not.toHaveBeenCalled();
    });

    it('copies each task in a selection as Draft and keeps other node statuses', async () => {
        const nodes: FlowNode[] = [
            { ...newFlowNode('Plan'), type: 'ai', status: 'running' },
            { ...newFlowNode('Review'), type: 'human', status: 'todo' },
            { ...newFlowNode('Wait'), type: 'scheduler', status: 'blocked' },
        ];
        showing(nodes);
        render(<Probe flowNodeIds={nodes.map(node => node.id)} />);

        fireEvent.click(screen.getByTestId('copy'));

        await waitFor(() => expect(clipboard.setClipboard).toHaveBeenCalled());
        expect(written()).toMatchObject({
            kind: 'kiao-flow-nodes',
            flowNodes: [
                { title: 'Plan', status: 'draft' },
                { title: 'Review', status: 'draft' },
                { title: 'Wait', status: 'blocked' },
            ],
        });
    });
});
