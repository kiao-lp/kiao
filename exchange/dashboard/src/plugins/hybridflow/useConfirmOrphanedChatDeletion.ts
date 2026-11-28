import { useCallback } from 'react';
import { message } from 'antd';
import { WorkerError } from 'kiao-worker';
import { useConfirmation, useWorkerClient } from '@kiao-dashboard-core';
import type { BoardContent } from './boardContent';
import { type FlowNodeAt, flowNodesOnChat } from './boardOps';

export const useConfirmOrphanedChatDeletion = (after: 'archive' | 'remove') => {
    const client = useWorkerClient();
    const confirm = useConfirmation();
    const afterArchive = after === 'archive';

    return useCallback((board: BoardContent, nodes: FlowNodeAt[]) => {
        const leaving = new Set(nodes.map(({ flowNode }) => flowNode.id));
        const conversations = new Set(nodes.map(({ flowNode }) => flowNode.chat).filter(Boolean));
        const chats = [...conversations].filter(chat => flowNodesOnChat(board, chat)
            .every(node => leaving.has(node.id) || (afterArchive && node.archived)));
        if (chats.length === 0) return;

        const one = chats.length === 1;
        const node = afterArchive ? 'live node' : 'remaining node';
        confirm({
            title: one ? 'Delete its chat too?' : `Delete their ${chats.length} chats too?`,
            description: `No ${node} on this board uses ${one ? 'this conversation' : 'these conversations'}. `
                + `Deletion also removes ${one ? 'its transcript' : 'their transcripts'}.`,
            confirmText: 'Yes',
            cancelText: 'No',
            onConfirm: async () => {
                try {
                    await Promise.all(chats.map(chat => client.deleteHarnessConversation(chat).catch(error => {
                        if (afterArchive && error instanceof WorkerError && error.response.status === 404) return;
                        throw error;
                    })));
                } catch (error) {
                    message.error(`${one ? 'The chat' : 'The chats'} could not be deleted: ${error instanceof Error ? error.message : error}`);
                }
            },
        });
    }, [afterArchive, client, confirm]);
};
