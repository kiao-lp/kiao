/**
 * Archiving is a boolean flip: the card stays stored with `archived` set, hidden everywhere
 * with the links to and from it, and never deleted. No file is written.
 *
 * It is the gesture a finished card wants. Delete throws the card away; archiving puts it away.
 * What it then asks about is the conversation: one no live card still names is one the user is
 * asked about — behind Yes and No — rather than one the board decides for. A chat already gone
 * is no failure: it is simply not deleted again.
 *
 * **One card or several.** An Archive aimed at a card marked with others takes the lot, in one
 * edit to the document, behind one question — the same rule the drag, the Delete and the menu
 * follow. The question names a lone card by title and a selection by count, because these cards
 * are about to leave the shown board.
 */

import { useCallback } from 'react';
import { message, Modal } from 'antd';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient } from '@cms-core';
import { findFlowNode, FlowNodeAt, flowNodesOnChat, isLiveFlowNode } from './boardOps';
import { useHybridflow } from './Hybridflow-ctx';

/** How many titles the question spells out before it starts counting instead. */
const NAMED_AT_MOST = 6;

/** The cards being archived, named — the last thing said about them before they leave. */
const naming = (cards: FlowNodeAt[]): string => {
    const titles = cards.slice(0, NAMED_AT_MOST).map(at => `“${at.flowNode.title || 'Untitled'}”`);
    const rest = cards.length - titles.length;
    return rest > 0 ? `${titles.join(', ')} and ${rest} more` : titles.join(', ');
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const useFlowNodeArchive = (): ((flowNodeIds: string[]) => void) => {
    const { content, archiveFlowNodes } = useHybridflow();
    const client = useWorkerClient();

    const askChats = useCallback((chats: string[]) => {
        const one = chats.length === 1;
        Modal.confirm({
            title: one ? 'Delete its chat too?' : `Delete their ${chats.length} chats too?`,
            content: one
                ? 'No live node left on the board is played in that conversation. Deleting it takes'
                    + ' the transcript with it.'
                : 'No live node left on the board is played in those conversations. Deleting them takes'
                    + ' the transcripts with them.',
            okText: 'Yes',
            okButtonProps: { danger: true },
            cancelText: 'No',
            onOk: () => Promise.all(chats.map(chat =>
                client.deleteAgentConversation(chat).catch(error => {
                    if (error instanceof WorkerError && error.response.status === 404) return;
                    throw error;
                }),
            ))
                .then(() => undefined)
                .catch(error => message.error(
                    `${one ? 'The chat' : 'The chats'} could not be deleted: ${errorText(error)}`,
                )),
        });
    }, [client]);

    return useCallback((flowNodeIds: string[]) => {
        if (!content) return;
        const going = flowNodeIds
            .map(flowNodeId => findFlowNode(content, flowNodeId))
            .filter((at): at is FlowNodeAt => at !== null && !at.flowNode.archived);
        if (going.length === 0) return;
        // Chats no live card still names once these leave the shown board. A chat shared with a
        // card staying live is not asked about; an archived card hiding it already does not keep
        // it, since it is hidden with its links.
        const leaving = new Set(going.map(at => at.flowNode.id));
        const chats = [...new Set(going.map(at => at.flowNode.chat).filter(Boolean))];
        const orphaned = chats.filter(chat => flowNodesOnChat(content, chat)
            .filter(isLiveFlowNode)
            .every(flowNode => leaving.has(flowNode.id)));
        const archive = () => {
            archiveFlowNodes(going.map(at => at.flowNode.id));
            if (orphaned.length > 0) askChats(orphaned);
        };
        if (going.length === 1) {
            const [one] = going;
            Modal.confirm({
                title: `Archive “${one.flowNode.title || 'Untitled'}”?`,
                content: 'It leaves the board but stays stored, hidden everywhere with its links.',
                okText: 'Archive',
                cancelText: 'Cancel',
                onOk: archive,
            });
            return;
        }
        Modal.confirm({
            title: `Archive ${going.length} nodes?`,
            content: `${naming(going)} leave the board but stay stored, hidden everywhere with their links.`,
            okText: 'Archive',
            cancelText: 'Cancel',
            onOk: archive,
        });
    }, [content, archiveFlowNodes, askChats]);
};
