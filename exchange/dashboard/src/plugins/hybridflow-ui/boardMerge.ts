/**
 * Two writers, one board.
 *
 * A board is written from both ends at once. **Here**, by whoever is keeping it —
 * typing a ticket, dragging a card, chaining one to another. **There**, by worker, which plays the
 * flow nodes: it marks the one it has taken `running`, writes down the conversation it is playing it in,
 * and it does both straight into the board, because a run outlives the browser that started it.
 * A Claude turn holding the `hybridflow` skill writes the same board, and so does a second tab.
 *
 * Writing the board whole over whatever the service had is what this replaces. A run lasts minutes to
 * hours and the board is live throughout: the point of playing a flow node is to be free to write the
 * next one while it runs, and every keystroke landing on top of a mark made meanwhile made that a
 * lie.
 *
 * **What makes the merge possible is that the two writers touch different fields.** The run writes
 * `status` and `chat`; everything else — titles, descriptions, criteria, complexities, settings,
 * chains, where a card sits — is only ever written here. So the merge is a three-way one over a keyed structure, and the key is
 * the id every flow node carries:
 *
 *  - `base` — the board as the service last showed it, which is what both sides moved away from;
 *  - `ours` — the board on screen, with whatever has not reached the service yet;
 *  - `theirs` — the board the service now holds.
 *
 * A field one side moved is that side's. A field both moved is **ours**.
 *
 * The result is what is drawn, so the two ends converge on it rather than taking turns overwriting.
 */

import { FlowNodeClass } from './flowNodeClass';
import { BoardContent, FlowNode, Workflow, WorkflowClass } from './boardContent';

/** Field equality, for the fields that are objects as well as the ones that are strings. */
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * One field, three versions. Ours as soon as it has been touched here, theirs otherwise — which is
 * also the answer when neither moved, both versions being the base.
 */
const pick = <V>(base: V, ours: V, theirs: V): V => (same(ours, base) ? theirs : ours);

const mergeFlowNode = (base: FlowNode, ours: FlowNode, theirs: FlowNode): FlowNode => ({
    id: ours.id,
    title: pick(base.title, ours.title, theirs.title),
    // What kind of card it is, and — where it is a Scheduler — the datetime it waits for. Neither is
    // ever the run's: both are answered in the panel, so the side that changed one meant to.
    type: pick(base.type, ours.type, theirs.type),
    at: pick(base.at, ours.at, theirs.at),
    duration: pick(base.duration, ours.duration, theirs.duration),
    // Where the card sits. Only ever written here — a run drags nothing — so
    // the side that moved it is the side that meant to, and a card placed by a second tab reaches a
    // board that has never placed it.
    spot: pick(base.spot, ours.spot, theirs.spot),
    // What the card is filed under: written only here, like the title, so the side that changed it
    // is the side that meant to.
    tags: pick(base.tags, ours.tags, theirs.tags),
    // The description, which the run sends and leaves alone: a new description typed while the turn
    // ran is kept, which is the card being written for its next play.
    body: pick(base.body, ours.body, theirs.body),
    // What the work is done when, and how heavy it looks: written only here, like the
    // description, so the side that changed one meant to.
    criteria: pick(base.criteria, ours.criteria, theirs.criteria),
    complexity: pick(base.complexity, ours.complexity, theirs.complexity),
    settings: pick(base.settings, ours.settings, theirs.settings),
    // The two the run writes. It writes them while a card is being typed in, and they are not
    // things this end is usually saying at the same moment — so they arrive by simply not having
    // been touched here.
    status: pick(base.status, ours.status, theirs.status),
    // Archived is written here by the archive gesture and arrives from elsewhere the same way.
    archived: pick(base.archived, ours.archived, theirs.archived),
    chat: pick(base.chat, ours.chat, theirs.chat),
    onSuccess: pick(base.onSuccess, ours.onSuccess, theirs.onSuccess),
    // The class version it was made from: written here when the link is broken, and arriving
    // from an instantiation made elsewhere — so the side that changed it is the side that
    // meant to.
    classVersion: pick(base.classVersion, ours.classVersion, theirs.classVersion),
    // The workflow it is grouped in: written here when the card is grouped, and arriving
    // from a rectangle made elsewhere — so the side that changed it is the side that meant
    // to.
    workflow: pick(base.workflow, ours.workflow, theirs.workflow),
});

const mergeFlowNodeClass = (base: FlowNodeClass, ours: FlowNodeClass, theirs: FlowNodeClass): FlowNodeClass => ({
    id: ours.id,
    title: pick(base.title, ours.title, theirs.title),
    instantiable: pick(base.instantiable, ours.instantiable, theirs.instantiable),
    type: pick(base.type, ours.type, theirs.type),
    tags: pick(base.tags, ours.tags, theirs.tags),
    at: pick(base.at, ours.at, theirs.at),
    duration: pick(base.duration, ours.duration, theirs.duration),
    spot: pick(base.spot, ours.spot, theirs.spot),
    onSuccess: pick(base.onSuccess, ours.onSuccess, theirs.onSuccess),
    permission: pick(base.permission, ours.permission, theirs.permission),
    runner: pick(base.runner, ours.runner, theirs.runner),
    note: pick(base.note, ours.note, theirs.note),
    // The workflow class it is grouped in: the side that changed it is the side that meant
    // to, like a card's workflow.
    workflowClass: pick(base.workflowClass, ours.workflowClass, theirs.workflowClass),
    // The succession, whole: a version is written through its own calls, and a re-read carries
    // whatever the service holds — so the side that changed the list is the side that meant to.
    versions: pick(base.versions, ours.versions, theirs.versions),
});

/**
 * A class added here that the service already holds: the first re-read after its creation.
 * What was typed here is kept — but the succession is the service's. A version's id is minted
 * there, so an empty list here is a list never seen, not one emptied: keeping it would bury the
 * first version under every re-read to come, each one reading the emptiness as said here.
 */
const mergeNewFlowNodeClass = (mine: FlowNodeClass, yours: FlowNodeClass): FlowNodeClass => ({
    ...mine,
    versions: yours.versions,
});

const byId = <T extends { id: string }>(items: T[]): Map<string, T> => new Map(items.map(item => [item.id, item]));

const idsOf = (items: { id: string }[]): string[] => items.map(item => item.id);

/**
 * Which flow nodes survive, and what each of them says.
 *
 * The rule is about **deletion**, the one move that cannot be told from never having existed
 * without the base:
 *
 *  - here and there → merged, field by field;
 *  - here and there, and the base did not → added here and already there: kept, with what only
 *    the service could have minted taken from there;
 *  - here only, and the base had it → deleted there. It goes, *unless* it has been written here
 *    since: a card somebody is typing into is not one to take out from under them;
 *  - here only, and the base did not → added here, and kept;
 *  - there only, and the base did not → added there, and taken;
 *  - there only, and the base did → deleted here, and it stays deleted.
 */
const survivors = <T>(
    base: Map<string, T>, ours: Map<string, T>, theirs: Map<string, T>,
    merge: (was: T, mine: T, yours: T) => T,
    mergeNew: (mine: T, yours: T) => T = mine => mine,
): Map<string, T> => {
    const kept = new Map<string, T>();
    ours.forEach((mine, id) => {
        const was = base.get(id);
        const yours = theirs.get(id);
        if (yours) kept.set(id, was ? merge(was, mine, yours) : mergeNew(mine, yours));
        else if (!was || !same(was, mine)) kept.set(id, mine);
    });
    theirs.forEach((yours, id) => {
        if (!ours.has(id) && !base.has(id)) kept.set(id, yours);
    });
    return kept;
};

/**
 * `into`, with every id of `from` that it lacks and `wanted` asks for put in straight after the id it
 * follows in `from` — or first, where it follows nothing `into` has. How one arrangement is laid over
 * another without losing what only the other one knows about.
 */
const graft = (into: string[], from: string[], wanted: (id: string) => boolean): string[] => {
    const out = [...into];
    from.forEach((id, index) => {
        if (out.includes(id) || !wanted(id)) return;
        const after = from.slice(0, index).reverse().find(held => out.includes(held));
        out.splice(after === undefined ? 0 : out.indexOf(after) + 1, 0, id);
    });
    return out;
};

/**
 * One order out of three — the board's list of cards — laid out with what survived.
 *
 * Nothing rearranges a board but this end — no run drags a card — so once anything has been
 * rearranged here, this board's arrangement is the board's. What the service still has to say is what
 * it holds that this board has never seen: a card **added** elsewhere, which goes in
 * after whatever it follows there rather than being dropped for having arrived during a drag.
 *
 * Where nothing has been rearranged here, the service's arrangement is taken whole — a card reordered
 * elsewhere reaches a board nobody is rearranging — with what this board kept and the service no longer
 * has put back after what it followed here: a card deleted there while it was being typed into here.
 *
 * A card cannot be in two places, and two arrangements laid over one another can put it there: the
 * first place it appears is the one it is in.
 */
const arrange = <T>(base: string[], ours: string[], theirs: string[], kept: Map<string, T>): T[] => {
    const known = new Set(base);
    const order = same(ours, base)
        ? graft(theirs, ours, id => kept.has(id))
        : graft(ours, theirs, id => !known.has(id));
    const seen = new Set<string>();
    return order.flatMap(id => {
        const held = kept.get(id);
        if (held === undefined || seen.has(id)) return [];
        seen.add(id);
        return [held];
    });
};

const mergeWorkflow = (base: Workflow, ours: Workflow, theirs: Workflow): Workflow => ({
    id: ours.id,
    // The name: the only thing a workflow has, and only ever written here — so the side that
    // changed it is the side that meant to.
    name: pick(base.name, ours.name, theirs.name),
});

const mergeWorkflowClass = (
    base: WorkflowClass, ours: WorkflowClass, theirs: WorkflowClass,
): WorkflowClass => ({
    id: ours.id,
    name: pick(base.name, ours.name, theirs.name),
});

/**
 * Merges the board on screen with the board the service holds, against the one both started from.
 */
export const mergeBoardContent = (base: BoardContent, ours: BoardContent, theirs: BoardContent): BoardContent => {
    const flowNodes = survivors(byId(base.flowNodes), byId(ours.flowNodes), byId(theirs.flowNodes), mergeFlowNode);
    const classes = survivors(
        byId(base.flowNodeClasses ?? []), byId(ours.flowNodeClasses ?? []),
        byId(theirs.flowNodeClasses ?? []), mergeFlowNodeClass, mergeNewFlowNodeClass);
    const workflows = survivors(
        byId(base.workflows ?? []), byId(ours.workflows ?? []),
        byId(theirs.workflows ?? []), mergeWorkflow);
    const workflowClasses = survivors(
        byId(base.workflowClasses ?? []), byId(ours.workflowClasses ?? []),
        byId(theirs.workflowClasses ?? []), mergeWorkflowClass);
    return {
        flowNodes: arrange(idsOf(base.flowNodes), idsOf(ours.flowNodes), idsOf(theirs.flowNodes), flowNodes),
        flowNodeClasses: arrange(
            idsOf(base.flowNodeClasses ?? []), idsOf(ours.flowNodeClasses ?? []),
            idsOf(theirs.flowNodeClasses ?? []), classes),
        workflows: arrange(
            idsOf(base.workflows ?? []), idsOf(ours.workflows ?? []),
            idsOf(theirs.workflows ?? []), workflows),
        workflowClasses: arrange(
            idsOf(base.workflowClasses ?? []), idsOf(ours.workflowClasses ?? []),
            idsOf(theirs.workflowClasses ?? []), workflowClasses),
    };
};
