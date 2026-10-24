import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { message } from 'antd';
import { WorkerError } from 'kiao-worker';

/**
 * Archiving a card — or the several a Ctrl-click picked out — behind one question, and the
 * conversation behind a second one: a chat no live card still names is one the user is asked
 * about rather than one the board decides for.
 */

const board = vi.hoisted(() => ({ content: null as any, archiveFlowNodes: vi.fn() }));
const client = vi.hoisted(() => ({ deleteAgentConversation: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./Hybridflow-ctx', () => ({ useHybridflow: () => board }));
vi.mock('@cms-core', () => ({ useWorkerClient: () => client }));

import { useFlowNodeArchive } from './useFlowNodeArchive';
import { newFlowNode, FlowNode } from './boardContent';

const Probe: React.FC<{ flowNodeIds: string[] }> = ({ flowNodeIds }) => {
    const archive = useFlowNodeArchive();
    return <button data-testid="archive" onClick={() => archive(flowNodeIds)}>archive</button>;
};

/** Points the board at flow nodes. */
const showing = (flowNodes: FlowNode[]) => {
    board.content = { flowNodes };
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

const chatFailure = vi.spyOn(message, 'error').mockImplementation(() => undefined as never);

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
});

describe('archiving a flow node', () => {
    it('asks first, and does nothing when the answer is no', async () => {
        const flowNode = newFlowNode('Mine');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await waitFor(() => expect(asking('Archive “Mine”?')).toBe(true));
        await answer('Cancel');

        expect(board.archiveFlowNodes).not.toHaveBeenCalled();
    });

    it('archives the flow node once it is confirmed', async () => {
        const flowNode = newFlowNode('Mine');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');

        await waitFor(() => expect(board.archiveFlowNodes).toHaveBeenCalledWith([flowNode.id]));
    });

    // A flow node nobody ever played names no conversation, so there is nothing to ask about.
    it('asks nothing about a chat for a flow node that has none', async () => {
        const flowNode = newFlowNode('Never played');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');

        await waitFor(() => expect(board.archiveFlowNodes).toHaveBeenCalled());
        expect(asking('Delete its chat too?')).toBe(false);
    });

    it('asks nothing where the card is already archived', async () => {
        const flowNode = { ...newFlowNode('Gone'), archived: true };
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));

        await waitFor(() => expect(dialogs().length).toBe(0));
        expect(board.archiveFlowNodes).not.toHaveBeenCalled();
    });
});

describe('the chat of an archived card', () => {
    it('is deleted when the user says so, after the card is archived', async () => {
        const flowNode = played('Played', 'chat-1');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(board.archiveFlowNodes).toHaveBeenCalledWith([flowNode.id]));
        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1'));
    });

    // A conversation is a record of work done; the card leaving the shown board is not a reason
    // to lose it without being asked.
    it('is left where it is when the user says no, and the card goes either way', async () => {
        const flowNode = played('Played', 'chat-1');
        showing([flowNode]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('No');

        await waitFor(() => expect(board.archiveFlowNodes).toHaveBeenCalledWith([flowNode.id]));
        expect(client.deleteAgentConversation).not.toHaveBeenCalled();
    });

    // A chain shares one conversation, so archiving one step of it while another stays live takes
    // nothing with it — and the question would be the wrong one to ask.
    it('is not asked about while another live card is still played in it', async () => {
        const flowNode = played('First', 'chat-1');
        showing([flowNode, played('Second', 'chat-1')]);
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');

        await waitFor(() => expect(board.archiveFlowNodes).toHaveBeenCalled());
        expect(asking('Delete its chat too?')).toBe(false);
        expect(client.deleteAgentConversation).not.toHaveBeenCalled();
    });

    // Gone between the question and the answer — deleted from the chat list, or with a card
    // archived twice over — is already the state the user asked for.
    it('is no failure when the conversation is already gone', async () => {
        const flowNode = played('Played', 'chat-1');
        showing([flowNode]);
        client.deleteAgentConversation.mockRejectedValueOnce(
            new WorkerError('Delete agent conversation failed: Not Found', 404, 'Not Found'));
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1'));
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(chatFailure).not.toHaveBeenCalled();
    });

    it('is reported when the conversation could not be deleted', async () => {
        const flowNode = played('Played', 'chat-1');
        showing([flowNode]);
        client.deleteAgentConversation.mockRejectedValueOnce(new Error('boom'));
        render(<Probe flowNodeIds={[flowNode.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(chatFailure)
            .toHaveBeenCalledWith('The chat could not be deleted: boom'));
    });
});

describe('archiving several marked cards', () => {
    it('asks once, naming them, and archives them in one edit', async () => {
        const first = newFlowNode('One');
        const second = newFlowNode('Two');
        const third = newFlowNode('Three');
        showing([first, second, third]);
        render(<Probe flowNodeIds={[first.id, second.id, third.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await waitFor(() => expect(asking('Archive 3 nodes?')).toBe(true));
        expect(dialogs().pop()!.textContent).toContain('“One”, “Two”, “Three”');
        await answer('Archive');

        await waitFor(() => expect(board.archiveFlowNodes)
            .toHaveBeenCalledWith([first.id, second.id, third.id]));
        expect(board.archiveFlowNodes).toHaveBeenCalledTimes(1);
    });

    it('leaves the board alone when the answer is no', async () => {
        const first = newFlowNode('One');
        const second = newFlowNode('Two');
        showing([first, second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await waitFor(() => expect(asking('Archive 2 nodes?')).toBe(true));
        await answer('Cancel');

        expect(board.archiveFlowNodes).not.toHaveBeenCalled();
    });

    // Two cards of two different chains: both conversations are left with no live card naming
    // them, and one question covers the pair rather than two boxes to click through.
    it('asks once about every conversation no live card still names', async () => {
        const first = played('One', 'chat-1');
        const second = played('Two', 'chat-2');
        showing([first, second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');
        await waitFor(() => expect(asking('Delete their 2 chats too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledTimes(2));
        expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1');
        expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-2');
    });

    // A chain played in one conversation, archived whole: the chat is orphaned by the pair, and
    // the question is asked once for it and not once per card.
    it('asks once about the one chat a whole chain shared', async () => {
        const first = played('One', 'chat-1');
        const second = played('Two', 'chat-1');
        showing([first, second]);
        render(<Probe flowNodeIds={[first.id, second.id]} />);

        fireEvent.click(screen.getByTestId('archive'));
        await answer('Archive');
        await waitFor(() => expect(asking('Delete its chat too?')).toBe(true));
        await answer('Yes');

        await waitFor(() => expect(client.deleteAgentConversation).toHaveBeenCalledTimes(1));
        expect(client.deleteAgentConversation).toHaveBeenCalledWith('chat-1');
    });
});
