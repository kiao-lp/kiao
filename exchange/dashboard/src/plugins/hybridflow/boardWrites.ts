import * as ops from './boardOps';
import {
    NewFlowNodeDto,
    SuccessDto, FlowNodePatchDto, HybridflowClient, HybridflowError,
} from './service';
import { FlowNodeEdit } from './boardOps';
import { writeBitbucketEvent } from './flowNodeBitbucket';
import { readLimiter } from './flowNodeLimiter';
import { saysSuccess, FlowNodeSuccess } from './flowNodeSuccess';
import { isDisplay } from './flowNodeType';
import { writeSize } from './flowNodeSize';
import { BoardContent, FlowNode, Workflow } from './boardContent';

/** The calls that make each board gesture true. */

/** What follows a flow node, as the service is told it. */
const successDto = (success: FlowNodeSuccess): SuccessDto => ({
    flowNode: success.flowNode || undefined,
    flowNodes: success.flowNodes.length ? [...success.flowNodes] : undefined,
    mode: success.mode,
    compact: success.compact || undefined,
});

/** Build the create request for a flow node. */
export const newFlowNodeDto = (flowNode: FlowNode): NewFlowNodeDto => ({
    id: flowNode.id,
    title: flowNode.type === 'note' ? '' : flowNode.title,
    type: flowNode.type,
    note: flowNode.type === 'note' ? (flowNode.note || undefined) : undefined,
    value: flowNode.type === 'value' ? flowNode.value : undefined,
    valueType: flowNode.type === 'value' && flowNode.valueType ? flowNode.valueType : undefined,
    ...(flowNode.type === 'role' ? {
        roleId: flowNode.roleId, roleKind: flowNode.roleKind, people: flowNode.people, description: flowNode.description,
    } : {}),
    tags: !isDisplay(flowNode.type) && flowNode.tags.length ? flowNode.tags : undefined,
    outputType: flowNode.type === 'ai' || flowNode.type === 'human' ? flowNode.outputType || undefined : undefined,
    routes: flowNode.type === 'exclusive-gateway' ? flowNode.routes : undefined,
    body: flowNode.body || undefined,
    multiPartTemplate: flowNode.multiPartTemplate || undefined,
    criteria: flowNode.criteria.length ? flowNode.criteria.map(criterion => ({ ...criterion })) : undefined,
    complexity: flowNode.complexity ?? undefined,
    settings: Object.keys(flowNode.settings).length ? { ...flowNode.settings } : undefined,
    at: flowNode.at || undefined,
    duration: flowNode.duration || undefined,
    ...writeBitbucketEvent(flowNode),
    ...(flowNode.type === 'limiter' ? readLimiter(flowNode) : {}),
    spot: flowNode.spot ? { x: flowNode.spot.x, y: flowNode.spot.y } : undefined,
    size: flowNode.size ? writeSize(flowNode.size) : undefined,
    status: flowNode.status,
    archived: flowNode.archived || undefined,
    chat: flowNode.chat || undefined,
    // The service defers validation so a pasted node can link to another in the same batch.
    onSuccess: saysSuccess(flowNode.onSuccess) ? successDto(flowNode.onSuccess) : undefined,
    workflow: flowNode.workflow || undefined,
});

/** An edit from the panel, as the patch that writes exactly the fields it names. */
export const patchOf = (edit: FlowNodeEdit): FlowNodePatchDto => {
    const patch: FlowNodePatchDto = {};
    if (edit.title !== undefined) patch.title = edit.title;
    if (edit.note !== undefined) patch.note = edit.note;
    if (edit.value !== undefined) patch.value = edit.value;
    if (edit.valueType !== undefined) patch.valueType = edit.valueType;
    if (edit.roleId !== undefined) patch.roleId = edit.roleId;
    if (edit.roleKind !== undefined) patch.roleKind = edit.roleKind;
    if (edit.people !== undefined) patch.people = [...edit.people];
    if (edit.description !== undefined) patch.description = edit.description;
    if (edit.outputType !== undefined) patch.outputType = edit.outputType;
    if (edit.output !== undefined) patch.output = edit.output;
    if (edit.routes !== undefined) patch.routes = edit.routes;
    if (edit.type !== undefined) patch.type = edit.type;
    if (edit.tags !== undefined) patch.tags = edit.tags;
    if (edit.body !== undefined) patch.body = edit.body;
    if (edit.multiPartTemplate !== undefined) patch.multiPartTemplate = edit.multiPartTemplate;
    if (edit.criteria !== undefined) patch.criteria = edit.criteria.map(criterion => ({ ...criterion }));
    // A complexity of null is one taken off, which an absent field cannot say.
    if (edit.complexity !== undefined) {
        if (edit.complexity === null) patch.clearComplexity = true;
        else patch.complexity = edit.complexity;
    }
    if (edit.settings !== undefined) patch.settings = { ...edit.settings };
    if (edit.at !== undefined) patch.at = edit.at;
    if (edit.duration !== undefined) patch.duration = edit.duration;
    if (edit.pullRequestId !== undefined) patch.pullRequestId = edit.pullRequestId;
    if (edit.pullRequestStatus !== undefined) patch.pullRequestStatus = edit.pullRequestStatus;
    if (edit.commitId !== undefined) patch.commitId = edit.commitId;
    if (edit.commitStatus !== undefined) patch.commitStatus = edit.commitStatus;
    if (edit.maxPasses !== undefined) patch.maxPasses = edit.maxPasses;
    if (edit.resetPasses) patch.resetPasses = true;
    if (edit.status !== undefined) patch.status = edit.status;
    if (edit.archived !== undefined) patch.archived = edit.archived;
    if (edit.chat !== undefined) patch.chat = edit.chat;
    if (edit.onSuccess !== undefined) patch.onSuccess = successDto(edit.onSuccess);
    // A null spot clears the saved position. An omitted spot leaves it alone.
    if (edit.spot !== undefined) {
        if (edit.spot === null) patch.clearSpot = true;
        else patch.spot = { x: edit.spot.x, y: edit.spot.y };
    }
    if (edit.size !== undefined && edit.size !== null) patch.size = writeSize(edit.size);

    if (edit.workflow !== undefined) patch.workflow = edit.workflow;
    return patch;
};

/** Create a batch of flow nodes in one request. */
export const writeCreate = (flowNodes: FlowNode[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.createFlowNodes(handle, flowNodes.map(newFlowNodeDto));

/** Writing where nodes sit on the board: one patch per node that moved. */
export const writeSpots = (flowNodeIds: string[]) =>
    async (client: HybridflowClient, handle: string, _before: BoardContent, after: BoardContent) => {
        for (const id of flowNodeIds) {
            const flowNode = ops.findFlowNode(after, id)?.flowNode;
            if (!flowNode) continue;
            await client.patchFlowNode(handle, id,
                flowNode.spot ? { spot: { x: flowNode.spot.x, y: flowNode.spot.y } } : { clearSpot: true });
        }
    };

/** Filing a workflow with the nodes it groups: one call, the rectangle the editor drew. */
export const writeCreateWorkflow = (workflow: Workflow, flowNodeIds: string[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.createWorkflow(handle, { id: workflow.id, name: workflow.name, flowNodes: flowNodeIds });

/** Taking workflows off the board: their nodes are ungrouped and left where they are. */
export const writeDeleteWorkflows = (workflowIds: string[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.deleteWorkflows(handle, workflowIds);

/**
 * Taking off the workflows a delete emptied: the rectangles the gesture left with no members.
 * Read off the before-and-after rather than named by the caller, because the caller removed nodes.
 */
export const writeDeleteEmptiedWorkflows = () =>
    async (client: HybridflowClient, handle: string, before: BoardContent, after: BoardContent) => {
        const held = new Set((after.workflows ?? []).map(workflow => workflow.id));
        const emptied = (before.workflows ?? [])
            .map(workflow => workflow.id)
            .filter(id => !held.has(id));
        if (!emptied.length) return;
        try {
            await client.deleteWorkflows(handle, emptied);
        } catch (e) {
            if (e instanceof HybridflowError && e.gone) return;
            throw e;
        }
    };
