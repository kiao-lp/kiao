/**
 * Shared by delete and cut.
 * Ask once per orphaned conversation, only when all cards referencing it leave this board.
 */

import { useCallback, useRef } from 'react';
import { message, Modal } from 'antd';
import { useWorkerClient } from '@kiao-dashboard-core';
import { findFlowNode, FlowNodeAt, flowNodesOnChat } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface FlowNodeRemoval {

    cards: FlowNodeAt[];

    remove: () => void;
}

/** Resolves against the current board; returns null if no requested ids remain. */
export const useFlowNodeRemoval = (): ((flowNodeIds: string[]) => FlowNodeRemoval | null) => {
    const { content, removeFlowNodes } = useHybridflow();
    const client = useWorkerClient();

    const held = useRef(content);
    held.current = content;

    const askChats = useCallback((chats: string[]) => {
        const one = chats.length === 1;
        Modal.confirm({
            title: one ? 'Delete its chat too?' : `Delete their ${chats.length} chats too?`,
            content: one
                ? 'No other node on this board is played in that conversation. Deleting it takes'
                    + ' the transcript with it.'
                : 'No node left on this board is played in those conversations. Deleting them takes'
                    + ' the transcripts with them.',
            okText: 'Yes',
            okButtonProps: { danger: true },
            cancelText: 'No',
            onOk: () => Promise.all(chats.map(chat => client.deleteHarnessConversation(chat)))
                .then(() => undefined)
                .catch(error => message.error(
                    `${one ? 'The chat' : 'The chats'} could not be deleted: ${errorText(error)}`,
                )),
        });
    }, [client]);

    return useCallback((flowNodeIds: string[]) => {
        const board = held.current;
        if (!board) return null;
        const cards = flowNodeIds
            .map(flowNodeId => findFlowNode(board, flowNodeId))
            .filter((at): at is FlowNodeAt => at !== null);
        if (cards.length === 0) return null;

        const going = new Set(cards.map(at => at.flowNode.id));
        const chats = [...new Set(cards.map(at => at.flowNode.chat).filter(Boolean))];
        const orphaned = chats.filter(chat => flowNodesOnChat(board, chat).every(flowNode => going.has(flowNode.id)));

        return {
            cards,
            remove: () => {
                removeFlowNodes([...going]);
                if (orphaned.length > 0) askChats(orphaned);
            },
        };
    }, [askChats, removeFlowNodes]);
};
