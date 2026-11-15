/** Pure BoardContent transforms keyed by id. */

import { CLONE_STEP } from './boardSpots';
import { FlowNodeClass, FlowNodeClassVersion } from './flowNodeClass';
import { sameSpot, spotAt, FlowNodeSpot } from './flowNodeSpot';
import { FlowNodeStatus } from './flowNodeStatus';
import { hasSuccess, withoutSuccessor } from './flowNodeSuccess';
import { chains } from './flowNodeType';
import { canConnect, canRetype, successorIds } from './flowConnections';
import {
    isRunnable, newId, BoardContent, FlowNode, Workflow, WorkflowClass,
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

export interface FlowNodeClassAt {
    flowNodeClass: FlowNodeClass;
    index: number;
}

export const findFlowNodeClass = (content: BoardContent, classId: string): FlowNodeClassAt | null => {
    const index = content.flowNodeClasses.findIndex(flowNodeClass => flowNodeClass.id === classId);
    if (index < 0) return null;
    return { flowNodeClass: content.flowNodeClasses[index], index };
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
        criteria: at.flowNode.criteria.map(criterion => ({ ...criterion })),
    };
    copy.onSuccess = {
        ...copy.onSuccess,
        flowNode: content.flowNodes.some(node => node.id === copy.onSuccess.flowNode && node.type === 'gateway')
            ? copy.onSuccess.flowNode : '',
        flowNodes: copy.onSuccess.flowNodes.filter(id => content.flowNodes.some(node => node.id === id && node.type === 'gateway')),
    };
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
        'title' | 'note' | 'value' | 'valueType' | 'outputType' | 'output' | 'type' | 'tags' | 'body' | 'criteria' | 'complexity' | 'settings' | 'at' | 'duration'
        | 'spot' | 'status' | 'archived' | 'chat' | 'onSuccess' | 'classVersion' | 'workflow'>>;

export const editFlowNode = (content: BoardContent, flowNodeId: string, edit: FlowNodeEdit): BoardContent | null => {
    const at = findFlowNode(content, flowNodeId);
    if (!at) return null;
    if (edit.type && !canRetype(content.flowNodes, flowNodeId, edit.type)) return null;
    if (edit.onSuccess) {
        const held = successorIds(at.flowNode);
        const changed = { ...at.flowNode, ...edit };
        const nodes = content.flowNodes.map(node => node.id === flowNodeId ? changed : node);
        if (successorIds(changed).some(id => !held.includes(id) && !canConnect(nodes, flowNodeId, id))) return null;
    }
    return withFlowNodes(content, content.flowNodes.map(flowNode => (flowNode.id === flowNodeId ? { ...flowNode, ...edit } : flowNode)));
};

export const setFlowNodeStatus = (content: BoardContent, flowNodeId: string, status: FlowNodeStatus): BoardContent | null =>
    editFlowNode(content, flowNodeId, { status });

/** Returns the named successor when it exists, is live, and is runnable; otherwise null. */
export const successorOf = (content: BoardContent, flowNode: FlowNode): FlowNode | null => {
    if (flowNode.archived || !flowNode.onSuccess.flowNode) return null;
    const at = findFlowNode(content, flowNode.onSuccess.flowNode);
    if (!at || at.flowNode.archived || !isRunnable(at.flowNode)) return null;
    return at.flowNode;
};

/** Chains fromId to toId; null or self clears, except Gateways keep branches on null. */
export const chainFlowNode = (content: BoardContent, fromId: string, toId: string | null): BoardContent | null => {
    const at = findFlowNode(content, fromId);
    if (!at || at.flowNode.archived) return null;
    const held = at.flowNode.onSuccess;
    if (toId && !chains(at.flowNode.type)) return null;
    if (toId && toId !== fromId && !canConnect(content.flowNodes, fromId, toId)) return null;

    if (at.flowNode.type === 'gateway') {
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

/** Places cards in one edit. */
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

/** Moves placed cards as a group. */
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

const withFlowNodeClasses = (content: BoardContent, flowNodeClasses: FlowNodeClass[]): BoardContent => ({
    ...content, flowNodeClasses,
});

export const flowNodeClassesNamed = (content: BoardContent, classIds: string[]): FlowNodeClass[] => {
    const named = new Set(classIds);
    return content.flowNodeClasses.filter(flowNodeClass => named.has(flowNodeClass.id));
};

export const insertFlowNodeClasses = (
    content: BoardContent,
    coming: FlowNodeClass[],
): BoardContent | null => {
    if (coming.length === 0) return null;
    return withFlowNodeClasses(content, [...content.flowNodeClasses, ...coming]);
};

/**
 * Clones directly after the original.
 * Copy holds only the latest version as draft number 1 and keeps the successor.
 */
export const cloneFlowNodeClass = (
    content: BoardContent,
    classId: string,
): { content: BoardContent; flowNodeClass: FlowNodeClass } | null => {
    const at = findFlowNodeClass(content, classId);
    if (!at) return null;
    const spot = at.flowNodeClass.spot
        ? spotAt(at.flowNodeClass.spot.x + CLONE_STEP, at.flowNodeClass.spot.y + CLONE_STEP)
        : null;
    const latest = at.flowNodeClass.versions.reduce<FlowNodeClassVersion | null>(
        (held, version) => (!held || version.number > held.number ? version : held), null);
    const versions: FlowNodeClassVersion[] = latest ? [{
        ...latest,
        id: newId(),
        number: 1,
        criteria: latest.criteria.map(criterion => ({ ...criterion })),
        status: 'draft',
    }] : [];
    const copy: FlowNodeClass = {
        ...at.flowNodeClass,
        id: newId(),
        tags: [...at.flowNodeClass.tags],
        spot,
        onSuccess: { ...at.flowNodeClass.onSuccess },
        versions,
    };
    const flowNodeClasses = [...content.flowNodeClasses];
    flowNodeClasses.splice(at.index + 1, 0, copy);
    return { content: withFlowNodeClasses(content, flowNodeClasses), flowNodeClass: copy };
};

/** Removes classes and clears successors naming them. */
export const removeFlowNodeClasses = (content: BoardContent, classIds: string[]): BoardContent | null => {
    const going = new Set(flowNodeClassesNamed(content, classIds).map(one => one.id));
    if (going.size === 0) return null;
    const kept = content.flowNodeClasses
        .filter(one => !going.has(one.id))
        .map(one => (going.has(one.onSuccess.flowNode)
            ? { ...one, onSuccess: withoutSuccessor(one.onSuccess) }
            : one));
    const held = new Set(kept.map(one => one.workflowClass).filter(id => id !== ''));
    const workflowClasses = (content.workflowClasses ?? [])
        .filter(workflow => held.has(workflow.id));
    if (workflowClasses.length === (content.workflowClasses ?? []).length) {
        return withFlowNodeClasses(content, kept);
    }
    return { ...content, flowNodeClasses: kept, workflowClasses };
};

export type FlowNodeClassEdit =
    Partial<Pick<FlowNodeClass,
        'title' | 'instantiable' | 'type' | 'tags' | 'at' | 'duration' | 'spot' | 'onSuccess' | 'permission'
        | 'runner' | 'note' | 'workflowClass'>>;

export const editFlowNodeClass = (
    content: BoardContent, classId: string, edit: FlowNodeClassEdit,
): BoardContent | null => {
    if (!findFlowNodeClass(content, classId)) return null;
    return withFlowNodeClasses(content, content.flowNodeClasses.map(one =>
        (one.id === classId ? { ...one, ...edit } : one)));
};

/** Chains a class to a class or clears it. Classes chain only to classes. */
export const chainFlowNodeClass = (
    content: BoardContent, fromId: string, toId: string | null,
): BoardContent | null => {
    const at = findFlowNodeClass(content, fromId);
    if (!at) return null;
    const held = at.flowNodeClass.onSuccess;
    if (toId && !chains(at.flowNodeClass.type)) return null;

    if (!toId || toId === fromId) {
        return hasSuccess(held)
            ? editFlowNodeClass(content, fromId, { onSuccess: withoutSuccessor(held) })
            : null;
    }
    if (!findFlowNodeClass(content, toId) || held.flowNode === toId) return null;
    return editFlowNodeClass(content, fromId, { onSuccess: { ...held, flowNode: toId } });
};

export const placeFlowNodeClasses = (
    content: BoardContent, spots: Map<string, FlowNodeSpot>,
): BoardContent | null => {
    const wanted = new Map([...spots].filter(([id, spot]) => {
        const at = findFlowNodeClass(content, id);
        return !!at && !sameSpot(at.flowNodeClass.spot, spot);
    }));
    if (wanted.size === 0) return null;
    return withFlowNodeClasses(content, content.flowNodeClasses.map(one => {
        const spot = wanted.get(one.id);
        return spot ? { ...one, spot } : one;
    }));
};

export const moveClassSpots = (
    content: BoardContent,
    classIds: string[],
    dx: number,
    dy: number,
): BoardContent | null => {
    const going = flowNodeClassesNamed(content, classIds).filter(one => one.spot);
    if (going.length === 0) return null;
    const held = (one: FlowNodeClass) => one.spot as FlowNodeSpot;
    const step = {
        x: Math.max(dx, -Math.min(...going.map(one => held(one).x))),
        y: Math.max(dy, -Math.min(...going.map(one => held(one).y))),
    };
    return placeFlowNodeClasses(content, new Map(going.map(one =>
        [one.id, spotAt(held(one).x + step.x, held(one).y + step.y)])));
};

export const insertClassVersion = (
    content: BoardContent, classId: string, version: FlowNodeClassVersion,
): BoardContent | null => {
    const at = findFlowNodeClass(content, classId);
    if (!at) return null;
    return withFlowNodeClasses(content, content.flowNodeClasses.map(one =>
        (one.id === classId ? { ...one, versions: [...one.versions, version] } : one)));
};

export type ClassVersionEdit = Partial<Pick<FlowNodeClassVersion, 'body' | 'criteria' | 'template' | 'agent' | 'status'>>;

export const editClassVersion = (
    content: BoardContent, classId: string, versionId: string, edit: ClassVersionEdit,
): BoardContent | null => {
    const at = findFlowNodeClass(content, classId);
    if (!at || !at.flowNodeClass.versions.some(version => version.id === versionId)) return null;
    return withFlowNodeClasses(content, content.flowNodeClasses.map(one =>
        (one.id !== classId ? one : {
            ...one,
            versions: one.versions.map(version =>
                (version.id === versionId ? { ...version, ...edit } : version)),
        })));
};

export const removeClassVersion = (
    content: BoardContent, classId: string, versionId: string,
): BoardContent | null => {
    const at = findFlowNodeClass(content, classId);
    if (!at || !at.flowNodeClass.versions.some(version => version.id === versionId)) return null;
    return withFlowNodeClasses(content, content.flowNodeClasses.map(one =>
        (one.id !== classId ? one : {
            ...one,
            versions: one.versions.filter(version => version.id !== versionId),
        })));
};

export const findWorkflow = (content: BoardContent, workflowId: string): Workflow | null =>
    (content.workflows ?? []).find(workflow => workflow.id === workflowId) ?? null;

export const findWorkflowClass = (content: BoardContent, workflowId: string): WorkflowClass | null =>
    (content.workflowClasses ?? []).find(workflow => workflow.id === workflowId) ?? null;

/** Groups named cards into workflow. */
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

/** Groups named classes into workflow. */
export const groupFlowNodeClasses = (
    content: BoardContent, workflow: WorkflowClass, classIds: string[],
): BoardContent | null => {
    const members = new Set(flowNodeClassesNamed(content, classIds).map(one => one.id));
    if (members.size === 0) return null;
    return {
        ...content,
        workflowClasses: [...(content.workflowClasses ?? []), workflow],
        flowNodeClasses: content.flowNodeClasses.map(one =>
            (members.has(one.id) ? { ...one, workflowClass: workflow.id } : one)),
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

export const editWorkflowClass = (
    content: BoardContent, workflowId: string, name: string,
): BoardContent | null => {
    if (!findWorkflowClass(content, workflowId)) return null;
    return {
        ...content,
        workflowClasses: (content.workflowClasses ?? []).map(workflow =>
            (workflow.id === workflowId ? { ...workflow, name } : workflow)),
    };
};

/** Removes workflows and ungroups their cards. */
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

/** Removes workflow classes and ungroups their classes. */
export const removeWorkflowClasses = (content: BoardContent, workflowIds: string[]): BoardContent | null => {
    const going = new Set(workflowIds.filter(id => findWorkflowClass(content, id)));
    if (going.size === 0) return null;
    return {
        ...content,
        workflowClasses: (content.workflowClasses ?? [])
            .filter(workflow => !going.has(workflow.id)),
        flowNodeClasses: content.flowNodeClasses.map(one =>
            (going.has(one.workflowClass) ? { ...one, workflowClass: '' } : one)),
    };
};
