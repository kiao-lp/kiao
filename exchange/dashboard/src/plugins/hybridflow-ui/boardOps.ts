/**
 * What the board does to the content it is showing: place a flow node, edit one, chain one to
 * another, and take one off.
 *
 * Every one of them is a pure function from a {@link BoardContent} to the next — no store, no React —
 * so the interesting part of a board, which is what a gesture does to the document, is testable on
 * its own. They are also all keyed on **ids** rather than on positions: a flow node is the same flow node
 * wherever it has been dragged to since the caller last looked, which is the whole reason the
 * format gives it one.
 */

import { CLONE_STEP } from './boardSpots';
import { FlowNodeClass, FlowNodeClassVersion } from './flowNodeClass';
import { sameSpot, spotAt, FlowNodeSpot } from './flowNodeSpot';
import { FlowNodeStatus } from './flowNodeStatus';
import { hasSuccess, withoutSuccessor } from './flowNodeSuccess';
import { chains } from './flowNodeType';
import {
    isRunnable, newId, BoardContent, FlowNode, Workflow, WorkflowClass,
} from './boardContent';

/** Where a flow node sits: the flow node, and its place in the list. */
export interface FlowNodeAt {
    flowNode: FlowNode;
    /** Its index in the document's list of cards. */
    index: number;
}

/** Finds a flow node by id, anywhere on the board. Null when it is no longer there. */
export const findFlowNode = (content: BoardContent, flowNodeId: string): FlowNodeAt | null => {
    const index = content.flowNodes.findIndex(flowNode => flowNode.id === flowNodeId);
    if (index < 0) return null;
    return { flowNode: content.flowNodes[index], index };
};

/** Where a node class sits: the class, and its place in the list. */
export interface FlowNodeClassAt {
    flowNodeClass: FlowNodeClass;
    /** Its index in the document's list of classes. */
    index: number;
}

/** Finds a node class by id, anywhere on the board. Null when it is no longer there. */
export const findFlowNodeClass = (content: BoardContent, classId: string): FlowNodeClassAt | null => {
    const index = content.flowNodeClasses.findIndex(flowNodeClass => flowNodeClass.id === classId);
    if (index < 0) return null;
    return { flowNodeClass: content.flowNodeClasses[index], index };
};

/**
 * The flow nodes played in a conversation, by id. A chat is shared by a whole chain, so what is asked of
 * it — whether it may be deleted with the card being deleted — is asked of the board and not of one
 * flow node.
 */
export const flowNodesOnChat = (content: BoardContent, chat: string): FlowNode[] =>
    (chat ? content.flowNodes.filter(flowNode => flowNode.chat === chat) : []);

/** Whether the card is shown anywhere. Archived cards stay stored but are hidden, with their links. */
export const isLiveFlowNode = (flowNode: FlowNode): boolean => !flowNode.archived;

/** The cards the board draws: everything not archived, in board order. */
export const liveFlowNodes = (content: BoardContent): FlowNode[] =>
    content.flowNodes.filter(isLiveFlowNode);

/** The cards archiving put away, in board order. Stored but never drawn. */
export const archivedFlowNodes = (content: BoardContent): FlowNode[] =>
    content.flowNodes.filter(flowNode => flowNode.archived);

/** The content with `flowNodes` in place of its own — the one place a new list of cards is made. */
const withFlowNodes = (content: BoardContent, flowNodes: FlowNode[]): BoardContent => ({ ...content, flowNodes });

/** The flow nodes `flowNodeIds` names, in board order, each once. */
export const flowNodesNamed = (content: BoardContent, flowNodeIds: string[]): FlowNode[] => {
    const named = new Set(flowNodeIds);
    return content.flowNodes.filter(flowNode => named.has(flowNode.id));
};

/**
 * Puts flow nodes on the board, at its end: what a paste does, however many cards the clipboard
 * held. They land **in the order they are given**, which for a paste is the order they were copied
 * in.
 *
 * One write for the lot, like a delete of several: a paste of six cards is one edit to the document,
 * so what the file holds is never half a paste. Returns null when there is nothing to file.
 */
export const insertFlowNodes = (
    content: BoardContent,
    coming: FlowNode[],
): BoardContent | null => {
    if (coming.length === 0) return null;
    return withFlowNodes(content, [...content.flowNodes, ...coming]);
};

/**
 * A second card just like one already on the board, filed **directly under it**, and says which
 * card that is so the caller can open it. What the menu's Clone does, and what a copy and a paste
 * would do in two gestures without going near the clipboard.
 *
 * **An id of its own, and no chat.** Both for the reasons a paste has them
 * ([boardClip.ts](./boardClip.ts)): ids are what the board tells its cards apart by, and a chat is
 * one conversation — two cards naming it because one was made from the other is not what either of
 * them says. The copy is played into a chat of its own.
 *
 * **The chain does come along**, which is where this parts company with a flow node pasted on its own.
 * That one names a card the clipboard does not hold; this one names a card sitting on this very
 * board, so the copy hands on to what the original hands on to — a step duplicated in the middle of
 * a chain still leads where the step it was copied from leads.
 *
 * Returns null when no card has that id.
 */
export const cloneFlowNode = (
    content: BoardContent,
    flowNodeId: string,
): { content: BoardContent; flowNode: FlowNode } | null => {
    const at = findFlowNode(content, flowNodeId);
    if (!at) return null;
    // And nudged clear of the card it was made from on the canvas: two cards in one place is
    // a card nobody can see, and a copy sent to the foot of the canvas is one nobody can find. The
    // offset every duplicate anywhere makes, which also says which of the two is the new one.
    const spot = at.flowNode.spot ? spotAt(at.flowNode.spot.x + CLONE_STEP, at.flowNode.spot.y + CLONE_STEP) : null;
    // The criteria come along as their own pairs: they are what the copy is measured against too,
    // and the ids stay — they name lines of this card, and no other card, so nothing collides.
    const copy: FlowNode = {
        ...at.flowNode, id: newId(), chat: '', spot, archived: false,
        criteria: at.flowNode.criteria.map(criterion => ({ ...criterion })),
    };
    // Straight after the original in the list, which is directly under it wherever it is drawn.
    const flowNodes = [...content.flowNodes];
    flowNodes.splice(at.index + 1, 0, copy);
    return { content: withFlowNodes(content, flowNodes), flowNode: copy };
};

/**
 * Takes flow nodes off the board, and with them every chain that named one: a flow node deleted is a
 * successor nobody has, and an `onSuccess` left pointing at it would be an id the board keeps
 * and no card shows. Only the id goes — the cards left behind keep their transition mode, which is
 * theirs and says nothing about the card that has gone.
 *
 * One write for the lot, and not one per card: several cards deleted at once are one edit to the
 * board, so what the board holds is never a half-done deletion. Returns null when no id names a
 * card, ids that name none being simply passed over.
 */
export const removeFlowNodes = (content: BoardContent, flowNodeIds: string[]): BoardContent | null => {
    const going = new Set(flowNodesNamed(content, flowNodeIds).map(flowNode => flowNode.id));
    if (going.size === 0) return null;
    const kept = content.flowNodes
        .filter(flowNode => !going.has(flowNode.id))
        .map(flowNode => (going.has(flowNode.onSuccess.flowNode)
            ? { ...flowNode, onSuccess: withoutSuccessor(flowNode.onSuccess) }
            : flowNode));
    // A workflow left with no members goes with its cards: a rectangle with nothing in it is
    // a shape nobody can pick up again, so the board does not keep it.
    const held = new Set(kept.map(flowNode => flowNode.workflow).filter(id => id !== ''));
    const workflows = (content.workflows ?? []).filter(workflow => held.has(workflow.id));
    if (workflows.length === (content.workflows ?? []).length) return withFlowNodes(content, kept);
    return { ...content, flowNodes: kept, workflows };
};

/** Takes one flow node off the board — what {@link removeFlowNodes} is on a single card. */
export const removeFlowNode = (content: BoardContent, flowNodeId: string): BoardContent | null =>
    removeFlowNodes(content, [flowNodeId]);

/**
 * Archiving is a boolean flip, not a delete and not a file. The card stays stored with
 * `archived` set, hidden everywhere with the links to and from it. Returns null when no id
 * names a live card.
 */
export const archiveFlowNodes = (content: BoardContent, flowNodeIds: string[]): BoardContent | null => {
    const going = new Set(flowNodesNamed(content, flowNodeIds).filter(flowNode => !flowNode.archived).map(flowNode => flowNode.id));
    if (going.size === 0) return null;
    return withFlowNodes(content, content.flowNodes.map(flowNode =>
        (going.has(flowNode.id) ? { ...flowNode, archived: true } : flowNode)));
};

/** Takes one flow node off the shown board by archiving it. */
export const archiveFlowNode = (content: BoardContent, flowNodeId: string): BoardContent | null =>
    archiveFlowNodes(content, [flowNodeId]);

/**
 * Puts archived cards back on the shown board. Stored for the API and the tests; the board
 * draws no archived card, so nothing on screen offers it.
 */
export const unarchiveFlowNodes = (content: BoardContent, flowNodeIds: string[]): BoardContent | null => {
    const going = new Set(flowNodesNamed(content, flowNodeIds).filter(flowNode => flowNode.archived).map(flowNode => flowNode.id));
    if (going.size === 0) return null;
    return withFlowNodes(content, content.flowNodes.map(flowNode =>
        (going.has(flowNode.id) ? { ...flowNode, archived: false } : flowNode)));
};

/**
 * What may be written on an open flow node. Its id is not on the list: that is what it is.
 */
export type FlowNodeEdit =
    Partial<Pick<FlowNode,
        'title' | 'type' | 'tags' | 'body' | 'criteria' | 'complexity' | 'settings' | 'at' | 'duration'
        | 'spot' | 'status' | 'archived' | 'chat' | 'onSuccess' | 'classVersion' | 'workflow'>>;

export const editFlowNode = (content: BoardContent, flowNodeId: string, edit: FlowNodeEdit): BoardContent | null => {
    if (!findFlowNode(content, flowNodeId)) return null;
    return withFlowNodes(content, content.flowNodes.map(flowNode => (flowNode.id === flowNodeId ? { ...flowNode, ...edit } : flowNode)));
};

/**
 * Says where a flow node stands, from the panel: a flow node marked `error` that has since been dealt with is
 * one somebody sets back to `ready`. A play writes the same field, but it writes it in
 * worker — nothing filed by a run comes through here.
 */
export const setFlowNodeStatus = (content: BoardContent, flowNodeId: string, status: FlowNodeStatus): BoardContent | null =>
    editFlowNode(content, flowNodeId, { status });

/**
 * The flow node played after a played one, or null where none is: it names none, the one it names has
 * left the board, or that one is not a card a run can take — an AI card missing part of the set a
 * turn is run with, a Scheduler with no datetime, or a card somebody is to do by hand.
 *
 * Found by id **anywhere on the board**, like everything else here: a chain survives the drag that
 * reorders it.
 */
export const successorOf = (content: BoardContent, flowNode: FlowNode): FlowNode | null => {
    if (flowNode.archived || !flowNode.onSuccess.flowNode) return null;
    const at = findFlowNode(content, flowNode.onSuccess.flowNode);
    if (!at || at.flowNode.archived || !isRunnable(at.flowNode)) return null;
    return at.flowNode;
};

/**
 * Chains one flow node to another, or takes the chain off: `fromId` hands on to `toId` when its turn
 * comes back an answer, and hands on to nothing where `toId` is null or names `fromId` itself —
 * which is what a chain dragged onto empty board, or back onto the card it started from, says.
 *
 * A Gateway is chained one branch at a time: the target is **added** to its branches — a line drawn
 * on the board is one more branch, not a branch redrawn. Dropped on empty board a Gateway keeps
 * what it holds: the gesture named no branch, and taking them all off is not what it says. Branches
 * are taken off in the panel.
 *
 * **The transition mode is left exactly where it was**, chain or no chain. It says what becomes of
 * *this flow node's* conversation, which is a question the gesture drawing a line between two cards does
 * not ask and taking that line off does not answer: a card that ends its chat still ends it with
 * nothing named after it, and a chain redrawn to another card hands on what it was handing on.
 *
 * **A Shutdown is chained to nothing**, however the gesture was aimed: nothing is played once the
 * machine is off, so a line drawn out of that card would be a line no run could ever follow. Taking
 * one off is still allowed — that is the same nothing said twice.
 *
 * Returns null where there is nothing to do: the flow node is gone, the target is not on the board, or
 * the chain already reads that way.
 */
export const chainFlowNode = (content: BoardContent, fromId: string, toId: string | null): BoardContent | null => {
    const at = findFlowNode(content, fromId);
    if (!at || at.flowNode.archived) return null;
    const held = at.flowNode.onSuccess;
    if (toId && !chains(at.flowNode.type)) return null;

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

/**
 * Writes where cards sit on the board — one edit for however many are named.
 *
 * It is what the view writes when it places the cards that have never been placed: a board
 * of forty is forty spots and one write, not forty. Ids naming no card are passed over, and a spot
 * a card already has is not written again — which is what keeps the view's own placing from being a
 * save on every render.
 *
 * Returns null when there is nothing to write.
 */
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

/**
 * Moves cards across the canvas by a distance — what a card dragged there writes, and what
 * a whole marked set dragged by one of them writes for all of them at once.
 *
 * **The distance is the group's, not each card's.** A set is carried as a block, so the delta is
 * clipped once against whichever card of it would otherwise be pushed off the top or the left, and
 * the arrangement inside the set survives the edge: five cards dragged into the corner arrive as
 * five cards, in the shape they left in, rather than as a pile in the corner.
 *
 * A card that has never been placed cannot be moved from anywhere and is passed over — by the time
 * anything is dragged, the view has placed everything it drew. Returns null when nothing moves.
 */
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

/**
 * What the board does to the node classes it is showing: the same gestures as the cards —
 * place one, edit one, chain one to another, take one off — on the classes' own list, because
 * the two kinds chain among themselves and never across.
 */

/** The content with `flowNodeClasses` in place of its own. */
const withFlowNodeClasses = (content: BoardContent, flowNodeClasses: FlowNodeClass[]): BoardContent => ({
    ...content, flowNodeClasses,
});

/** The classes `classIds` names, in board order, each once. */
export const flowNodeClassesNamed = (content: BoardContent, classIds: string[]): FlowNodeClass[] => {
    const named = new Set(classIds);
    return content.flowNodeClasses.filter(flowNodeClass => named.has(flowNodeClass.id));
};

/** Puts classes on the board, at its end: what a class made on the canvas does. */
export const insertFlowNodeClasses = (
    content: BoardContent,
    coming: FlowNodeClass[],
): BoardContent | null => {
    if (coming.length === 0) return null;
    return withFlowNodeClasses(content, [...content.flowNodeClasses, ...coming]);
};

/**
 * A second class just like one already on the board, filed **directly under it**, and says which
 * class that is so the caller can open it. What the class menu's Clone does.
 *
 * **An id of its own, and one version.** The copy holds only the latest version of the original —
 * the one with the highest number — copied as a draft, because a clone is a starting point rather
 * than a frozen statement. Its number is 1: it is the first version of a new succession, not the
 * continuation of the old one.
 *
 * **The chain does come along**, the way a cloned card's does: the class it names sits on this
 * very board, so the copy hands on to what the original hands on to.
 *
 * Returns null when no class has that id.
 */
export const cloneFlowNodeClass = (
    content: BoardContent,
    classId: string,
): { content: BoardContent; flowNodeClass: FlowNodeClass } | null => {
    const at = findFlowNodeClass(content, classId);
    if (!at) return null;
    // Nudged clear of the class it was made from, the way a cloned card is: two cards in one
    // place is a card nobody can see.
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
    // Straight after the original in the list, which is directly under it wherever it is drawn.
    const flowNodeClasses = [...content.flowNodeClasses];
    flowNodeClasses.splice(at.index + 1, 0, copy);
    return { content: withFlowNodeClasses(content, flowNodeClasses), flowNodeClass: copy };
};

/**
 * Takes classes off the board, and with them every chain that named one — the same rule a
 * deleted card follows. Only the id goes; the classes left behind keep their transition mode.
 */
export const removeFlowNodeClasses = (content: BoardContent, classIds: string[]): BoardContent | null => {
    const going = new Set(flowNodeClassesNamed(content, classIds).map(one => one.id));
    if (going.size === 0) return null;
    const kept = content.flowNodeClasses
        .filter(one => !going.has(one.id))
        .map(one => (going.has(one.onSuccess.flowNode)
            ? { ...one, onSuccess: withoutSuccessor(one.onSuccess) }
            : one));
    // A workflow class left with no members goes with its classes, like a workflow with its
    // cards.
    const held = new Set(kept.map(one => one.workflowClass).filter(id => id !== ''));
    const workflowClasses = (content.workflowClasses ?? [])
        .filter(workflow => held.has(workflow.id));
    if (workflowClasses.length === (content.workflowClasses ?? []).length) {
        return withFlowNodeClasses(content, kept);
    }
    return { ...content, flowNodeClasses: kept, workflowClasses };
};

/** What may be written on an open class. Its id is not on the list: that is what it is. */
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

/**
 * Chains one class to another, or takes the chain off. The target is a class or nothing:
 * a chain naming a simple flow node is refused here the way the service refuses it there —
 * the two kinds chain among themselves and never across.
 */
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

/** Writes where class cards sit on the board — one edit for however many are named. */
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

/** Moves class cards across the canvas by a distance — what a class dragged there writes. */
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

/** Files a version under its class, at the succession's end. */
export const insertClassVersion = (
    content: BoardContent, classId: string, version: FlowNodeClassVersion,
): BoardContent | null => {
    const at = findFlowNodeClass(content, classId);
    if (!at) return null;
    return withFlowNodeClasses(content, content.flowNodeClasses.map(one =>
        (one.id === classId ? { ...one, versions: [...one.versions, version] } : one)));
};

/** What may be written on a version: the words, whether they are a template, the default agent, and frozen. */
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

/** Takes a version off its class. Only the id goes; the succession keeps its numbers. */
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

/**
 * What the board does to the workflows it is showing: file one round a set of cards, rename
 * one, and take one off — ungrouping its cards, which stay where they are.
 */

/** Finds a workflow by id, anywhere on the board. Null when it is no longer there. */
export const findWorkflow = (content: BoardContent, workflowId: string): Workflow | null =>
    (content.workflows ?? []).find(workflow => workflow.id === workflowId) ?? null;

/** Finds a workflow class by id, anywhere on the board. Null when it is no longer there. */
export const findWorkflowClass = (content: BoardContent, workflowId: string): WorkflowClass | null =>
    (content.workflowClasses ?? []).find(workflow => workflow.id === workflowId) ?? null;

/**
 * Files a workflow round the cards `flowNodeIds` names: the rectangle at the board's end, and
 * each member naming it. A card already grouped is moved into this one, a card being in at
 * most one workflow. Ids naming no card are passed over.
 *
 * Returns null when no id names a card.
 */
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

/**
 * Files a workflow class round the classes `classIds` names. A class already grouped is moved
 * into this one. Ids naming no class are passed over.
 *
 * Returns null when no id names a class.
 */
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

/** Renames a workflow. Its members are untouched. Null when it is no longer there. */
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

/** Renames a workflow class. Its members are untouched. Null when it is no longer there. */
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

/**
 * Takes workflows off the board, and ungroups their cards: each member names no workflow
 * afterwards, and stays where it is. Ids naming no workflow are passed over.
 *
 * Returns null when no id names a workflow.
 */
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

/**
 * Takes workflow classes off the board, and ungroups their classes. Ids naming no workflow
 * class are passed over.
 *
 * Returns null when no id names a workflow class.
 */
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
