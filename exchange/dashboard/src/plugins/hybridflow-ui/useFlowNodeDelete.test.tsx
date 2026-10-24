import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Deleting a card — or the several a Ctrl-click picked out — and the question that sometimes goes
 * with it: a conversation nothing on the board would name any more is one the user is asked about
 * rather than one the board decides for.
 */

const board = vi.hoisted(() => ({ content: null as any, removeFlowNodes: vi.fn() }));
const client = vi.hoisted(() => ({ deleteAgentConversation: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('@cms-core', () => ({ useWorkerClient: () => client }));

import { useFlowNodeDelete } from './useFlowNodeDelete';
import { newFlowNode, FlowNode } from './boardContent';

const Probe: React.FC<{ flowNodeIds: string[] }> = ({ flowNodeIds }) => {
    const remove = useFlowNodeDelete();
    return <button data-testid="delete" onClick={() => remove(flowNodeIds)}>delete</button>;
};

/** Points the board at flow nodes — a chat is looked for across the whole of it. */
const showing = (left: FlowNode[], right: FlowNode[] = []) => {
    board.content = { flowNodes: [...left, ...right] };
};

const played = (title: string, chat: string): FlowNode => ({ ...newFlowNode(title), chat });

/** The dialog being asked: the last one opened, an answered one lingering while it fades out. */
const dialogs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.ant-modal-confirm')];

/** Whether a dialog on screen is asking this. */
const asking = (title: string): boolean =>
    [...document.querySelectorAll('.ant-modal-confirm-title')].some(node => node.textContent === title);

/** Answers the dialog on screen by the label of one of its two buttons. */
const answer = async (label: string) => {
    await waitFor(() => expect(dialogs().length).toBeGreaterThan(0));
    const buttons = [...dialogs().pop()!.querySelectorAll('button')];
    fireEvent.click(buttons.find(button => button.textContent === label)!);
};

beforeEach(() => {
    vi.clearAllMocks();
    // antd's static dialogs mount into containers of their own on the body, and a closed one
    // lingers there until its fade-out ends — which is after the test that opened it.
    document.body.innerHTML = '';
});

describe('deleting a flow node', () => {
    it('asks first, and does nothing when the answer is no', async () => {
        const flowNode = newFlowNode('Mine');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await waitFor(() => expect(asking('Delete “Mine”?')).toBe(true));
        await answer('Cancel');

        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    it('takes the flow node off the board once it is confirmed', async () => {
        const flowNode = newFlowNode('Mine');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalledWith([flowNode.id]));
    });

    // A flow node nobody ever played names no conversation, so there is nothing to ask about.
    it('asks nothing about a chat for a flow node that has none', async () => {
        const flowNode = newFlowNode('Never played');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalled());
        expect(asking('Delete its chat too?')).toBe(false);
    });
});

describe('the chat of the last flow node naming it', () => {
    it('is deleted when the user says so', async () => {
        const flowNode = played('Played', 'chat-1');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1'));
    });

    // A conversation is a record of work done; the flow node going is not a reason to lose it.
    it('is left where it is when the user says no, and the flow node goes either way', async () => {
        const flowNode = played('Played', 'chat-1');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');
        await answer('No');

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalledWith([flowNode.id]));
        expect(client.deleteAgentConversation).not.toHaveBeenCalled();
    });

    // A chain shares one conversation, so a card taken out of the middle of one takes nothing
    // with it — and the question would be the wrong one to ask.
    it('is not asked about while another flow node is still played in it', async () => {
        const flowNode = played('First', 'chat-1');
        showing([flowNode], [played('Second', 'chat-1')]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalled());
        expect(asking('Delete its chat too?')).toBe(false);
        expect(client.deleteAgentConversation).not.toHaveBeenCalled();
    });
});

/**
 * The cards marked with Ctrl-click, deleted together: one question, one edit to the document, and
 * the titles said out loud — a count is not something a hand can check itself against.
 */
describe('deleting several marked cards', () => {
    it('asks once, naming them, and takes them off in one edit', async () => {
        const first = newFlowNode('One');
        const second = newFlowNode('Two');
        const third = newFlowNode('Three');
        showing([first, second], [third]);
        render(<Probe flowNodeIds={[first.id, second.id, third.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await waitFor(() => expect(asking('Delete these 3 nodes?')).toBe(true));
        expect(dialogs().pop()!.textContent).toContain('“One”, “Two”, “Three”');
        await answer('Delete');

        await waitFor(() => expect(board.removeFlowNodes)
            .toHaveBeenCalledWith([first.id, second.id, third.id]));
        expect(board.removeFlowNodes).toHaveBeenCalledTimes(1);
    });

    it('leaves the board alone when the answer is no', async () => {
        const first = newFlowNode('One');
        const second = newFlowNode('Two');
        showing([first, second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await waitFor(() => expect(asking('Delete these 2 nodes?')).toBe(true));
        await answer('Cancel');

        expect(board.removeFlowNodes).not.toHaveBeenCalled();
    });

    // Two cards of two different chains: both conversations are left with nothing naming them, and
    // one question covers the pair rather than two boxes to click through.
    it('asks once about every conversation the pair leaves orphaned', async () => {
        const first = played('One', 'chat-1');
        const second = played('Two', 'chat-2');
        showing([first, second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');
        await waitFor(() => expect(asking('Delete their 2 chats too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledTimes(2));
        expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1');
        expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-2');
    });

    // A chain played in one conversation, deleted whole: the chat is orphaned by the pair, and the
    // question is asked once for it and not once per card.
    it('asks once about the one chat a whole chain shared', async () => {
        const first = played('One', 'chat-1');
        const second = played('Two', 'chat-1');
        showing([first, second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledTimes(1));
        expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1');
    });

    // The other half of that: a card left behind still names it, so nothing is asked at all.
    it('says nothing about a chat one of the cards left behind still names', async () => {
        const first = played('One', 'chat-1');
        showing([first, newFlowNode('Plain')], [played('Kept', 'chat-1')]);
        render(<Probe flowNodeIds={[first.id]} />);

        fireEvent.click(screen.getByTestId('delete'));
        await answer('Delete');

        await waitFor(() => expect(board.removeFlowNodes).toHaveBeenCalled());
        expect(asking('Delete its chat too?')).toBe(false);
        expect(client.deleteAgentConversation).not.toHaveBeenCalled();
    });
});
