/** Pure BoardContent transforms keyed by id. */

import { CLONE_STEP } from './boardSpots';
import { sameSpot, spotAt, FlowNodeSpot } from './flowNodeSpot';
import { DRAFT, FlowNodeStatus } from './flowNodeStatus';
import { isPassCount, readLimiter } from './flowNodeLimiter';
import { hasSuccess, withoutSuccessor } from './flowNodeSuccess';
import { chains, isTask, joins, splits } from './flowNodeType';
import { canAppendSuccessor, canConnect, canRetype, successorIds } from './flowConnections';
import {
    isRunnable, newId, BoardContent, FlowNode, Workflow,
} from './boardContent';

export interface FlowNodeAt {
    flowNode: FlowNode;
    index: number;
}

export const findFlowNode = (content: BoardContent, flowNodeId: string): FlowNodeAt | null => {
    const index = content.flowNodes.findIndex(flowNode => flowNode.id === flowNodeId);
    if (index < 0) return null;
    return { flowNode: content.flowNodes[index], index };
};

export const flowNodesOnChat = (content: BoardContent, chat: string): FlowNode[] =>
    (chat ? content.flowNodes.filter(flowNode => flowNode.chat === chat) : []);

export const isLiveFlowNode = (flowNode: FlowNode): boolean => !flowNode.archived;

export const liveFlowNodes = (content: BoardContent): FlowNode[] =>
    content.flowNodes.filter(isLiveFlowNode);

export const archivedFlowNodes = (content: BoardContent): FlowNode[] =>
    content.flowNodes.filter(flowNode => flowNode.archived);

const withFlowNodes = (content: BoardContent, flowNodes: FlowNode[]): BoardContent => ({ ...content, flowNodes });

export const flowNodesNamed = (content: BoardContent, flowNodeIds: string[]): FlowNode[] => {
    const named = new Set(flowNodeIds);
    return content.flowNodes.filter(flowNode => named.has(flowNode.id));
};

/** Appends in given order. Returns null when empty or a successor cannot connect. */
export const insertFlowNodes = (
    content: BoardContent,
    coming: FlowNode[],
): BoardContent | null => {
    if (coming.length === 0) return null;
    const nodes = [...content.flowNodes, ...coming];
    if (coming.some(node => successorIds(node).some(target => !canConnect(nodes, node.id, target)))) return null;
    return withFlowNodes(content, nodes);
};

/**
 * Clones directly after the original with a new id and no chat.
 * Retains successors only toward Gateways.
 */
export const cloneFlowNode = (
    content: BoardContent,
    flowNodeId: string,
): { content: BoardContent; flowNode: FlowNode } | null => {
    const at = findFlowNode(content, flowNodeId);
    if (!at) return null;
    const spot = at.flowNode.spot ? spotAt(at.flowNode.spot.x + CLONE_STEP, at.flowNode.spot.y + CLONE_STEP) : null;
    const copy: FlowNode = {
        ...at.flowNode, id: newId(), chat: '', spot, archived: false, output: undefined,
        status: isTask(at.flowNode.type) ? DRAFT : at.flowNode.status,
        criteria: at.flowNode.criteria.map(criterion => ({ ...criterion })),
    };
    if (copy.type === 'limiter') copy.remainingPasses = readLimiter(copy).maxPasses;
    if (copy.type === 'role') copy.roleId = '';
    const joinTargets = new Set(content.flowNodes.filter(node => joins(node.type)).map(node => node.id));
    copy.onSuccess = {
        ...copy.onSuccess,
        flowNode: joinTargets.has(copy.onSuccess.flowNode) ? copy.onSuccess.flowNode : '',
        flowNodes: copy.onSuccess.flowNodes.filter(id => joinTargets.has(id)),
    };
    if (copy.routes) copy.routes = copy.routes.filter(route => copy.onSuccess.flowNodes.includes(route.flowNode));
    const flowNodes = [...content.flowNodes];
    flowNodes.splice(at.index + 1, 0, copy);
    return { content: withFlowNodes(content, flowNodes), flowNode: copy };
};

/** Removes nodes and clears successors naming them; transition mode is kept. */
export const removeFlowNodes = (content: BoardContent, flowNodeIds: string[]): BoardContent | null => {
    const going = new Set(flowNodesNamed(content, flowNodeIds).map(flowNode => flowNode.id));
    if (going.size === 0) return null;
    const kept = content.flowNodes
        .filter(flowNode => !going.has(flowNode.id))
        .map(flowNode => {
            let next = flowNode;
            if (going.has(flowNode.onSuccess.flowNode)) {
                next = { ...next, onSuccess: withoutSuccessor(flowNode.onSuccess) };
            }
            if (next.onSuccess.flowNodes.some(id => going.has(id))) {
                next = { ...next, onSuccess: { ...next.onSuccess, flowNodes: next.onSuccess.flowNodes.filter(id => !going.has(id)) } };
                if (next.routes) next.routes = next.routes.filter(route => !going.has(route.flowNode));
            }
            if (going.has(flowNode.valueType)) next = { ...next, valueType: '' };
            return next;
        });
    const held = new Set(kept.map(flowNode => flowNode.workflow).filter(id => id !== ''));
    const workflows = (content.workflows ?? []).filter(workflow => held.has(workflow.id));
    if (workflows.length === (content.workflows ?? []).length) return withFlowNodes(content, kept);
    return { ...content, flowNodes: kept, workflows };
};

export const removeFlowNode = (content: BoardContent, flowNodeId: string): BoardContent | null =>
    removeFlowNodes(content, [flowNodeId]);

/** Sets archived. */
export const archiveFlowNodes = (content: BoardContent, flowNodeIds: string[]): BoardContent | null => {
    const going = new Set(flowNodesNamed(content, flowNodeIds).filter(flowNode => !flowNode.archived).map(flowNode => flowNode.id));
    if (going.size === 0) return null;
    return withFlowNodes(content, content.flowNodes.map(flowNode =>
        (going.has(flowNode.id) ? { ...flowNode, archived: true } : flowNode)));
};

export const archiveFlowNode = (content: BoardContent, flowNodeId: string): BoardContent | null =>
    archiveFlowNodes(content, [flowNodeId]);

/** Clears archived. */
export const unarchiveFlowNodes = (content: BoardContent, flowNodeIds: string[]): BoardContent | null => {
    const going = new Set(flowNodesNamed(content, flowNodeIds).filter(flowNode => flowNode.archived).map(flowNode => flowNode.id));
    if (going.size === 0) return null;
    return withFlowNodes(content, content.flowNodes.map(flowNode =>
        (going.has(flowNode.id) ? { ...flowNode, archived: false } : flowNode)));
};

export type FlowNodeEdit =
    Partial<Pick<FlowNode,
        'title' | 'note' | 'value' | 'valueType' | 'roleId' | 'roleKind' | 'people' | 'description'
        | 'outputType' | 'output' | 'type' | 'tags' | 'body' | 'multiPartTemplate' | 'criteria' | 'complexity' | 'settings' | 'at' | 'duration'
        | 'pullRequestId' | 'pullRequestStatus' | 'commitId' | 'commitStatus' | 'maxPasses'
        | 'spot' | 'size' | 'status' | 'archived' | 'chat' | 'onSuccess' | 'routes' | 'workflow'>>
    & { resetPasses?: boolean };

export const editFlowNode = (content: BoardContent, flowNodeId: string, edit: FlowNodeEdit): BoardContent | null => {
    const at = findFlowNode(content, flowNodeId);
    if (!at) return null;
    if (edit.type && !canRetype(content.flowNodes, flowNodeId, edit.type)) return null;
    const { resetPasses, ...fields } = edit;
    const changed = { ...at.flowNode, ...fields };
    if (!isTask(changed.type)) changed.multiPartTemplate = false;
    if (changed.type !== 'bitbucket-pr-status') {
        delete changed.pullRequestId;
        delete changed.pullRequestStatus;
    }
    if (changed.type !== 'bitbucket-commit-status') {
        delete changed.commitId;
        delete changed.commitStatus;
    }
    if (changed.type !== 'role') {
        delete changed.roleId;
        delete changed.roleKind;
        delete changed.people;
        delete changed.description;
    }
    if (changed.type === 'limiter') {
        if (changed.onSuccess.flowNodes.length > 2 || (edit.maxPasses !== undefined && !isPassCount(edit.maxPasses))) return null;
        const counts = readLimiter(changed);
        changed.maxPasses = counts.maxPasses;
        changed.remainingPasses = resetPasses || counts.maxPasses !== at.flowNode.maxPasses
            ? counts.maxPasses : counts.remainingPasses;
    } else {
        delete changed.maxPasses;
        delete changed.remainingPasses;
    }
    if (edit.onSuccess) {
        const held = successorIds(at.flowNode);
        const nodes = content.flowNodes.map(node => node.id === flowNodeId ? changed : node);
        if (successorIds(changed).some(id => !held.includes(id) && !canConnect(nodes, flowNodeId, id))) return null;
    }
    if (changed.type !== 'exclusive-gateway') delete changed.routes;
    else if (edit.onSuccess && changed.routes) {
        changed.routes = changed.routes.filter(route => changed.onSuccess.flowNodes.includes(route.flowNode));
    }
    return withFlowNodes(content, content.flowNodes.map(flowNode => (flowNode.id === flowNodeId ? changed : flowNode)));
};

export const setFlowNodeStatus = (content: BoardContent, flowNodeId: string, status: FlowNodeStatus): BoardContent | null =>
    editFlowNode(content, flowNodeId, { status });

/** Returns the named successor when it exists, is live, and is runnable; otherwise null. */
export const successorOf = (content: BoardContent, flowNode: FlowNode): FlowNode | null => {
    if (flowNode.archived || !flowNode.onSuccess.flowNode) return null;
    const at = findFlowNode(content, flowNode.onSuccess.flowNode);
    if (!at || at.flowNode.archived || !isRunnable(at.flowNode, content)) return null;
    return at.flowNode;
};

/** Chains fromId to toId; null or self clears, except Gateways keep branches on null. */
export const chainFlowNode = (content: BoardContent, fromId: string, toId: string | null): BoardContent | null => {
    const at = findFlowNode(content, fromId);
    if (!at || at.flowNode.archived) return null;
    const held = at.flowNode.onSuccess;
    if (toId && !chains(at.flowNode.type)) return null;
    if (toId && toId !== fromId && !canAppendSuccessor(content.flowNodes, fromId, toId)) return null;

    if (splits(at.flowNode.type)) {
        if (!toId || toId === fromId || held.flowNodes.includes(toId)) return null;
        const target = findFlowNode(content, toId);
        if (!target || target.flowNode.archived) return null;
        return editFlowNode(content, fromId, {
            onSuccess: { ...held, flowNodes: [...held.flowNodes, toId] },
        });
    }
    if (!toId || toId === fromId) {
        return hasSuccess(held) ? editFlowNode(content, fromId, { onSuccess: withoutSuccessor(held) }) : null;
    }
    const target = findFlowNode(content, toId);
    if (!target || target.flowNode.archived || held.flowNode === toId) return null;
    return editFlowNode(content, fromId, { onSuccess: { ...held, flowNode: toId } });
};

/** Places nodes in one edit. */
export const placeFlowNodes = (content: BoardContent, spots: Map<string, FlowNodeSpot>): BoardContent | null => {
    const wanted = new Map([...spots].filter(([id, spot]) => {
        const at = findFlowNode(content, id);
        return !!at && !sameSpot(at.flowNode.spot, spot);
    }));
    if (wanted.size === 0) return null;
    return withFlowNodes(content, content.flowNodes.map(flowNode => {
        const spot = wanted.get(flowNode.id);
        return spot ? { ...flowNode, spot } : flowNode;
    }));
};

/** Moves placed nodes as a group. */
export const moveSpots = (
    content: BoardContent,
    flowNodeIds: string[],
    dx: number,
    dy: number,
): BoardContent | null => {
    const going = flowNodesNamed(content, flowNodeIds).filter(flowNode => flowNode.spot);
    if (going.length === 0) return null;
    const held = (flowNode: FlowNode) => flowNode.spot as FlowNodeSpot;
    const step = {
        x: Math.max(dx, -Math.min(...going.map(flowNode => held(flowNode).x))),
        y: Math.max(dy, -Math.min(...going.map(flowNode => held(flowNode).y))),
    };
    return placeFlowNodes(content, new Map(going.map(flowNode =>
        [flowNode.id, spotAt(held(flowNode).x + step.x, held(flowNode).y + step.y)])));
};

export const findWorkflow = (content: BoardContent, workflowId: string): Workflow | null =>
    (content.workflows ?? []).find(workflow => workflow.id === workflowId) ?? null;

/** Groups named nodes into workflow. */
export const groupFlowNodes = (
    content: BoardContent, workflow: Workflow, flowNodeIds: string[],
): BoardContent | null => {
    const members = new Set(flowNodesNamed(content, flowNodeIds).map(flowNode => flowNode.id));
    if (members.size === 0) return null;
    return {
        ...content,
        workflows: [...(content.workflows ?? []), workflow],
        flowNodes: content.flowNodes.map(flowNode =>
            (members.has(flowNode.id) ? { ...flowNode, workflow: workflow.id } : flowNode)),
    };
};

export const editWorkflow = (
    content: BoardContent, workflowId: string, name: string,
): BoardContent | null => {
    if (!findWorkflow(content, workflowId)) return null;
    return {
        ...content,
        workflows: (content.workflows ?? []).map(workflow =>
            (workflow.id === workflowId ? { ...workflow, name } : workflow)),
    };
};

/** Removes workflows and ungroups their nodes. */
export const removeWorkflows = (content: BoardContent, workflowIds: string[]): BoardContent | null => {
    const going = new Set(workflowIds.filter(id => findWorkflow(content, id)));
    if (going.size === 0) return null;
    return {
        ...content,
        workflows: (content.workflows ?? []).filter(workflow => !going.has(workflow.id)),
        flowNodes: content.flowNodes.map(flowNode =>
            (going.has(flowNode.workflow) ? { ...flowNode, workflow: '' } : flowNode)),
    };
};
