/**
 * Cross-instance transfer uses system-clipboard JSON; see boardClip for the format.
 * Cut removes cards only after a successful write, then offers orphan-chat deletion:
 * conversations do not travel with the cards.
 */

import { useCallback } from 'react';
import { message } from 'antd';
import { Clipboard } from '@cms-core';
import { useAgents } from './Agents-ctx';
import { useRunners } from './Runners-ctx';
import { KnownAgents, KnownRunners, readFlowNodesClip, flowNodesClipText } from './boardClip';
import { flowNodesNamed } from './boardOps';
import { pasteSpots } from './boardSpots';
import { FlowNodeSpot } from './flowNodeSpot';
import { useHybridflow } from './Hybridflow-ctx';
import { useFlowNodeRemoval } from './useFlowNodeRemoval';
import { FlowNode } from './boardContent';

export interface BoardClipboard {
    copyFlowNodes: (flowNodeIds: string[]) => void;
    /** Copy, then remove only after a successful clipboard write. */
    cutFlowNodes: (flowNodeIds: string[]) => void;
    /** Paste chains at spot, or leave unplaced for layout below existing cards. */
    pasteFlowNodes: (spot?: FlowNodeSpot, workflow?: string) => void;
}

const NO_CLIPBOARD = 'The clipboard could not be read. The browser may be asking for permission.';

const naming = (cards: FlowNode[]): string =>
    (cards.length === 1 ? `“${cards[0].title || 'Untitled'}”` : `${cards.length} nodes`);

export const useBoardClipboard = (): BoardClipboard => {
    const { content, insertFlowNodes } = useHybridflow();
    const { loaded: loadedAgents } = useAgents();
    const { loaded: loadedRunners } = useRunners();
    const removal = useFlowNodeRemoval();

    /**
     * Load destination identities at paste time to avoid losing assignments while lists load.
     * Read the clipboard first to retain the browser's user-activation permission.
     * boardClip preserves known destination ids and drops unknown source-instance ids.
     */
    const knownAgents = useCallback(async (): Promise<KnownAgents> =>
        new Set((await loadedAgents()).map(agent => agent.id)), [loadedAgents]);

    // Await runners too, so a still-loading list cannot discard a valid pin.
    const knownRunners = useCallback(async (): Promise<KnownRunners> =>
        new Set((await loadedRunners()).map(runner => runner.id)), [loadedRunners]);

    const write = useCallback(async (text: string, what: string, verb: 'copied' | 'cut'): Promise<boolean> => {
        try {
            await Clipboard.setClipboard(text);
            message.success(`${what} ${verb} as JSON.`);
            return true;
        } catch {
            message.error('The clipboard could not be written to.');
            return false;
        }
    }, []);

    const copyFlowNodes = useCallback((flowNodeIds: string[]) => {
        const cards = content ? flowNodesNamed(content, flowNodeIds) : [];
        if (cards.length === 0) return;
        void write(flowNodesClipText(cards), naming(cards), 'copied');
    }, [content, write]);

    const cutFlowNodes = useCallback((flowNodeIds: string[]) => {
        const going = removal(flowNodeIds);
        if (!going) return;
        const cards = going.cards.map(at => at.flowNode);
        void (async () => {
            if (await write(flowNodesClipText(cards), naming(cards), 'cut')) going.remove();
        })();
    }, [removal, write]);

    const pasteFlowNodes = useCallback((spot?: FlowNodeSpot, workflow = '') => {
        void (async () => {
            let text: string;
            try {
                text = await Clipboard.getClipboardText();
            } catch {
                message.error(NO_CLIPBOARD);
                return;
            }
            const flowNodes = readFlowNodesClip(text, await knownAgents(), await knownRunners());
            if (flowNodes.length === 0) {
                message.error('The clipboard does not hold a node.');
                return;
            }
            // Grouping comes from the paste target; the clipboard carries none.
            const grouped = workflow
                ? flowNodes.map(flowNode => ({ ...flowNode, workflow }))
                : flowNodes;
            if (spot) {
                const spots = pasteSpots(grouped, spot);
                insertFlowNodes(grouped.map(flowNode => ({ ...flowNode, spot: spots.get(flowNode.id) ?? null })));
            } else {
                insertFlowNodes(grouped);
            }
            if (flowNodes.length > 1) message.success(`${flowNodes.length} nodes pasted.`);
        })();
    }, [insertFlowNodes, knownAgents, knownRunners]);

    return { copyFlowNodes, cutFlowNodes, pasteFlowNodes };
};
