/**
 * Cross-instance transfer uses system-clipboard JSON; see boardClip for the format.
 * Cut removes flow nodes after the clipboard write succeeds and offers to delete orphaned conversations.
 */

import { useCallback, useEffect, useRef } from 'react';
import { message } from 'antd';
import { Clipboard } from '@kiao-dashboard-core';
import { useAgents } from './Agents-ctx';
import { useRunners } from './Runners-ctx';
import {
    KnownAgents, KnownRunners, readFlowNodesClip, flowNodesClipText, readWorkflowClip, workflowClipText,
} from './boardClip';
import { flowNodesNamed } from './boardOps';
import { pasteSpots } from './boardSpots';
import { FlowNodeSpot } from './flowNodeSpot';
import { useHybridflow } from './Hybridflow-ctx';
import { useFlowNodeRemoval } from './useFlowNodeRemoval';
import { useInstantiateClipboard } from './useInstantiateClipboard';
import { FlowNode } from './boardContent';
import { DRAFT } from './flowNodeStatus';
import { isTask } from './flowNodeType';

export interface BoardClipboard {
    copyFlowNodes: (flowNodeIds: string[]) => void;
    /** Copy, then remove only after a successful clipboard write. */
    cutFlowNodes: (flowNodeIds: string[]) => void;
    copyWorkflow: (id: string) => void;

    paste: (spot?: FlowNodeSpot, workflow?: string) => void;
    instantiateHere: (spot: FlowNodeSpot, workflow?: string) => void;
}

const NO_CLIPBOARD = 'The clipboard could not be read. The browser may be asking for permission.';

const naming = (nodes: FlowNode[]): string =>
    (nodes.length === 1 ? `“${nodes[0].title || 'Untitled'}”` : `${nodes.length} nodes`);

export const useBoardClipboard = (): BoardClipboard => {
    const { content, handle, insertFlowNodes, pasteWorkflow } = useHybridflow();
    const { loaded: loadedAgents } = useAgents();
    const { loaded: loadedRunners } = useRunners();
    const removal = useFlowNodeRemoval();
    const fillTemplates = useInstantiateClipboard(handle);
    const currentBoard = useRef<symbol | null>(null);

    useEffect(() => {
        currentBoard.current = Symbol();
        return () => { currentBoard.current = null; };
    }, [handle]);

    const knownAgents = useCallback(async (): Promise<KnownAgents> =>
        new Set((await loadedAgents()).map(agent => agent.id)), [loadedAgents]);

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
        const nodes = content ? flowNodesNamed(content, flowNodeIds) : [];
        if (nodes.length === 0) return;
        const copies = nodes.map(node => isTask(node.type) ? { ...node, status: DRAFT } : node);
        void write(flowNodesClipText(copies), naming(nodes), 'copied');
    }, [content, write]);

    const cutFlowNodes = useCallback((flowNodeIds: string[]) => {
        const going = removal(flowNodeIds);
        if (!going) return;
        const nodes = going.nodes.map(at => at.flowNode);
        void (async () => {
            if (await write(flowNodesClipText(nodes), naming(nodes), 'cut')) going.remove();
        })();
    }, [removal, write]);

    const copyWorkflow = useCallback((id: string) => {
        const workflow = content?.workflows.find(group => group.id === id);
        if (!content || !workflow) return;
        void write(workflowClipText(workflow, content.flowNodes), `“${workflow.name || 'Untitled'}”`, 'copied');
    }, [content, write]);

    const pasteFromClipboard = useCallback((spot?: FlowNodeSpot, workflow = '', instantiate = false) => {
        const board = currentBoard.current;
        if (!board) return;

        void (async () => {
            let text: string;
            try {
                text = await Clipboard.getClipboardText();
            } catch {
                message.error(NO_CLIPBOARD);
                return;
            }
            if (currentBoard.current !== board) return;
            const workflowClip = readWorkflowClip(text);
            if (workflowClip) {
                const pasteGroup = async (clip: Record<string, unknown>) => {
                    if (currentBoard.current !== board) return;
                    if (await pasteWorkflow(clip, spot)) message.success('Workflow pasted.');
                };
                if (instantiate && Array.isArray(workflowClip.flowNodes)) {
                    fillTemplates(workflowClip.flowNodes, flowNodes => {
                        void pasteGroup({ ...workflowClip, flowNodes });
                    });
                } else {
                    await pasteGroup(workflowClip);
                }
                return;
            }

            const [agents, runners] = await Promise.all([knownAgents(), knownRunners()]);
            if (currentBoard.current !== board) return;
            const flowNodes = readFlowNodesClip(text, agents, runners);
            if (flowNodes.length === 0) {
                message.error('The clipboard does not hold a node or workflow.');
                return;
            }

            const pasteNodes = (nodes: FlowNode[]) => {
                if (currentBoard.current !== board) return;
                const grouped = workflow ? nodes.map(node => ({ ...node, workflow })) : nodes;
                if (spot) {
                    const spots = pasteSpots(grouped, spot);
                    insertFlowNodes(grouped.map(node => ({ ...node, spot: spots.get(node.id) ?? null })));
                } else {
                    insertFlowNodes(grouped);
                }
                if (nodes.length > 1) message.success(`${nodes.length} nodes pasted.`);
            };
            if (instantiate) fillTemplates(flowNodes, pasteNodes);
            else pasteNodes(flowNodes);
        })();
    }, [fillTemplates, insertFlowNodes, knownAgents, knownRunners, pasteWorkflow]);

    return {
        copyFlowNodes, cutFlowNodes, copyWorkflow, paste: (spot, workflow) => pasteFromClipboard(spot, workflow),
        instantiateHere: (spot, workflow) => pasteFromClipboard(spot, workflow, true),
    };
};
