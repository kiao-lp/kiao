import * as ops from './boardOps';
import {
    ClassVersionPatchDto, NewClassVersionDto, NewFlowNodeClassDto, NewFlowNodeDto,
    SuccessDto, FlowNodeClassPatchDto, FlowNodePatchDto, HybridflowClient, HybridflowError,
} from './service';
import { ClassVersionEdit, FlowNodeClassEdit, FlowNodeEdit } from './boardOps';
import { FlowNodeClass, FlowNodeClassVersion } from './flowNodeClass';
import { saysSuccess, FlowNodeSuccess } from './flowNodeSuccess';
import { BoardContent, FlowNode, Workflow, WorkflowClass } from './boardContent';

/**
 * The call that makes a gesture true, for each gesture the board has.
 *
 * ── one function per gesture, and no diffing ──────────────────────────────────
 *
 * Nothing here compares two boards to work out what changed. Each gesture says what it did, because
 * it knows: deriving it back out of a before-and-after is how a move becomes a delete-and-create on
 * the day two of them overlap.
 */

/**
 * What follows a flow node, as the service is told it. The empties are left out and the two answers about
 * the chat are not: `mode` says what an unsaid one cannot — a chain written before it existed meant
 * *carry the chat on* — and `compact` is sent as the boolean it is, false and absent meaning the
 * same thing at the other end.
 */
const successDto = (success: FlowNodeSuccess): SuccessDto => ({
    flowNode: success.flowNode || undefined,
    flowNodes: success.flowNodes.length ? [...success.flowNodes] : undefined,
    mode: success.mode,
    compact: success.compact || undefined,
});

/**
 * A card as the service is asked to create it. The id is the one the editor minted.
 */
export const newFlowNodeDto = (flowNode: FlowNode): NewFlowNodeDto => ({
    id: flowNode.id,
    title: flowNode.type === 'note' ? '' : flowNode.title,
    type: flowNode.type,
    note: flowNode.type === 'note' ? (flowNode.note || undefined) : undefined,
    value: flowNode.type === 'value' ? (flowNode.value ?? {}) : undefined,
    tags: flowNode.type !== 'note' && flowNode.type !== 'value' && flowNode.tags.length ? flowNode.tags : undefined,
    body: flowNode.body || undefined,
    criteria: flowNode.criteria.length ? flowNode.criteria.map(criterion => ({ ...criterion })) : undefined,
    complexity: flowNode.complexity ?? undefined,
    settings: Object.keys(flowNode.settings).length ? { ...flowNode.settings } : undefined,
    at: flowNode.at || undefined,
    duration: flowNode.duration || undefined,
    spot: flowNode.spot ? { x: flowNode.spot.x, y: flowNode.spot.y } : undefined,
    status: flowNode.status,
    archived: flowNode.archived || undefined,
    chat: flowNode.chat || undefined,
    // The chain is sent with the card, and the service defers the constraint that would otherwise
    // refuse a pasted pair whose first card names its second.
    onSuccess: saysSuccess(flowNode.onSuccess) ? successDto(flowNode.onSuccess) : undefined,
    workflow: flowNode.workflow || undefined,
});

/** An edit from the panel, as the patch that writes exactly the fields it names. */
export const patchOf = (edit: FlowNodeEdit): FlowNodePatchDto => {
    const patch: FlowNodePatchDto = {};
    if (edit.title !== undefined) patch.title = edit.title;
    if (edit.note !== undefined) patch.note = edit.note;
    if (edit.value !== undefined) patch.value = edit.value;
    if (edit.type !== undefined) patch.type = edit.type;
    if (edit.tags !== undefined) patch.tags = edit.tags;
    if (edit.body !== undefined) patch.body = edit.body;
    if (edit.criteria !== undefined) patch.criteria = edit.criteria.map(criterion => ({ ...criterion }));
    // A complexity of `null` is one taken off, which an absent field cannot say.
    if (edit.complexity !== undefined) {
        if (edit.complexity === null) patch.clearComplexity = true;
        else patch.complexity = edit.complexity;
    }
    if (edit.settings !== undefined) patch.settings = { ...edit.settings };
    if (edit.at !== undefined) patch.at = edit.at;
    if (edit.duration !== undefined) patch.duration = edit.duration;
    if (edit.status !== undefined) patch.status = edit.status;
    if (edit.archived !== undefined) patch.archived = edit.archived;
    if (edit.chat !== undefined) patch.chat = edit.chat;
    if (edit.onSuccess !== undefined) patch.onSuccess = successDto(edit.onSuccess);
    // A spot of `null` is a card taken off the board, which an absent field cannot say.
    if (edit.spot !== undefined) {
        if (edit.spot === null) patch.clearSpot = true;
        else patch.spot = { x: edit.spot.x, y: edit.spot.y };
    }
    // A class version of `null` is a link broken, which the empty string says to the service.
    if (edit.classVersion !== undefined) {
        patch.classVersion = edit.classVersion ? edit.classVersion.versionId : '';
    }
    // A workflow of `''` is a card taken out of its rectangle.
    if (edit.workflow !== undefined) patch.workflow = edit.workflow;
    return patch;
};

/**
 * Creating cards: they all go in one call — what a paste is, however many cards the clipboard held.
 */
export const writeCreate = (flowNodes: FlowNode[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.createFlowNodes(handle, flowNodes.map(newFlowNodeDto));

/** Writing where cards sit on the board: one patch per card that moved. */
export const writeSpots = (flowNodeIds: string[]) =>
    async (client: HybridflowClient, handle: string, _before: BoardContent, after: BoardContent) => {
        for (const id of flowNodeIds) {
            const flowNode = ops.findFlowNode(after, id)?.flowNode;
            if (!flowNode) continue;
            await client.patchFlowNode(handle, id,
                flowNode.spot ? { spot: { x: flowNode.spot.x, y: flowNode.spot.y } } : { clearSpot: true });
        }
    };

/**
 * A class as the service is asked to create it. The id is the one the editor minted, and the
 * first version's words go beside it — a class always has at least one version.
 */
export const newFlowNodeClassDto = (flowNodeClass: FlowNodeClass): NewFlowNodeClassDto => ({
    id: flowNodeClass.id,
    title: flowNodeClass.title,
    instantiable: flowNodeClass.instantiable || undefined,
    type: flowNodeClass.type,
    tags: flowNodeClass.tags.length ? flowNodeClass.tags : undefined,
    body: flowNodeClass.versions[0]?.body || undefined,
    criteria: flowNodeClass.versions[0]?.criteria.length
        ? flowNodeClass.versions[0].criteria.map(criterion => ({ ...criterion }))
        : undefined,
    template: flowNodeClass.versions[0]?.template || undefined,
    agent: flowNodeClass.versions[0]?.agent || undefined,
    at: flowNodeClass.at || undefined,
    duration: flowNodeClass.duration || undefined,
    spot: flowNodeClass.spot ? { x: flowNodeClass.spot.x, y: flowNodeClass.spot.y } : undefined,
    permission: flowNodeClass.permission || undefined,
    runner: flowNodeClass.runner || undefined,
    note: flowNodeClass.note || undefined,
    onSuccess: saysSuccess(flowNodeClass.onSuccess) ? successDto(flowNodeClass.onSuccess) : undefined,
    workflowClass: flowNodeClass.workflowClass || undefined,
});

/** An edit from the class editor, as the patch that writes exactly the fields it names. */
export const patchOfClass = (edit: FlowNodeClassEdit): FlowNodeClassPatchDto => {
    const patch: FlowNodeClassPatchDto = {};
    if (edit.title !== undefined) patch.title = edit.title;
    if (edit.instantiable !== undefined) patch.instantiable = edit.instantiable;
    if (edit.type !== undefined) patch.type = edit.type;
    if (edit.tags !== undefined) patch.tags = edit.tags;
    if (edit.at !== undefined) patch.at = edit.at;
    if (edit.duration !== undefined) patch.duration = edit.duration;
    if (edit.permission !== undefined) patch.permission = edit.permission;
    if (edit.runner !== undefined) patch.runner = edit.runner;
    if (edit.note !== undefined) patch.note = edit.note;
    if (edit.onSuccess !== undefined) patch.onSuccess = successDto(edit.onSuccess);
    if (edit.spot !== undefined) {
        if (edit.spot === null) patch.clearSpot = true;
        else patch.spot = { x: edit.spot.x, y: edit.spot.y };
    }
    // A workflow class of `''` is a class taken out of its rectangle.
    if (edit.workflowClass !== undefined) patch.workflowClass = edit.workflowClass;
    return patch;
};

/** A version as the service is asked to file it: the words, or the version copied from. */
export const newClassVersionDto = (from?: FlowNodeClassVersion): NewClassVersionDto =>
    (from ? { from: from.id } : {});

/** An edit to a version, as the patch that writes exactly the fields it names. */
export const patchOfVersion = (edit: ClassVersionEdit): ClassVersionPatchDto => {
    const patch: ClassVersionPatchDto = {};
    if (edit.body !== undefined) patch.body = edit.body;
    if (edit.criteria !== undefined) patch.criteria = edit.criteria.map(criterion => ({ ...criterion }));
    if (edit.template !== undefined) patch.template = edit.template;
    if (edit.agent !== undefined) patch.agent = edit.agent;
    if (edit.status !== undefined) patch.status = edit.status;
    return patch;
};

/** Creating a class: one call, with its first version's words beside it. */
export const writeCreateClass = (flowNodeClass: FlowNodeClass) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.createFlowNodeClass(handle, newFlowNodeClassDto(flowNodeClass));

/** Writing where class cards sit on the board: one patch per card that moved. */
export const writeClassSpots = (classIds: string[]) =>
    async (client: HybridflowClient, handle: string, _before: BoardContent, after: BoardContent) => {
        for (const id of classIds) {
            const flowNodeClass = ops.findFlowNodeClass(after, id)?.flowNodeClass;
            if (!flowNodeClass) continue;
            await client.patchFlowNodeClass(handle, id,
                flowNodeClass.spot
                    ? { spot: { x: flowNodeClass.spot.x, y: flowNodeClass.spot.y } }
                    : { clearSpot: true });
        }
    };

/**
 * Filing a workflow with the cards it groups: one call, the rectangle the editor drew. The id
 * is the one the editor minted, like a card's.
 */
export const writeCreateWorkflow = (workflow: Workflow, flowNodeIds: string[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.createWorkflow(handle, { id: workflow.id, name: workflow.name, flowNodes: flowNodeIds });

/** Filing a workflow class with the classes it groups. */
export const writeCreateWorkflowClass = (workflow: WorkflowClass, classIds: string[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.createWorkflowClass(handle, { id: workflow.id, name: workflow.name, classes: classIds });

/** Taking workflows off the board: their cards are ungrouped and left where they are. */
export const writeDeleteWorkflows = (workflowIds: string[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.deleteWorkflows(handle, workflowIds);

/** Taking workflow classes off the board. */
export const writeDeleteWorkflowClasses = (workflowIds: string[]) =>
    (client: HybridflowClient, handle: string, _before: BoardContent, _after: BoardContent) =>
        client.deleteWorkflowClasses(handle, workflowIds);

/**
 * Taking off the workflows a delete emptied: the rectangles the gesture left with no members.
 * Read off the before-and-after rather than named by the caller, because the caller removed
 * cards and the rectangles went with them.
 *
 * A 404 is the service having deleted the emptied rectangle with its last card: that delete
 * landing first is the outcome, not a failure.
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

/**
 * Taking off the workflow classes a delete emptied. A 404 is the service having deleted
 * the emptied rectangle with its last class.
 */
export const writeDeleteEmptiedWorkflowClasses = () =>
    async (client: HybridflowClient, handle: string, before: BoardContent, after: BoardContent) => {
        const held = new Set((after.workflowClasses ?? []).map(workflow => workflow.id));
        const emptied = (before.workflowClasses ?? [])
            .map(workflow => workflow.id)
            .filter(id => !held.has(id));
        if (!emptied.length) return;
        try {
            await client.deleteWorkflowClasses(handle, emptied);
        } catch (e) {
            if (e instanceof HybridflowError && e.gone) return;
            throw e;
        }
    };
