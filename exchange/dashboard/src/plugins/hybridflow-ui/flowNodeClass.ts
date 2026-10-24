/**
 * A flow node class: the reusable card, and its successive versions.
 *
 * A class is a card that is never played — it holds what every instance shares (the title, the
 * kind, the chain to the next class, and, for an AI one, how a turn answers its tool calls and
 * where it is pinned), and its versions hold what changes: the description, what done means,
 * and the default agent. Only the latest version that is not a draft is used when the class is
 * instantiated; the others are past versions kept for statistics.
 *
 * What a class is *not* asked is the design as much as what it is: no folder, no effort, no
 * chat, no body, no success criteria and no agent of its own — and no status, a class never
 * being executed. Its versions are draft or published instead.
 */

import { readSchedule, readDuration } from './flowNodeSchedule';
import { readSpot, FlowNodeSpot, writeSpot } from './flowNodeSpot';
import {
    noSuccess, readSuccess, saysSuccess, successFor, FlowNodeSuccess, writeSuccess,
} from './flowNodeSuccess';
import { readType, saysType, FlowNodeType } from './flowNodeType';
import { newId, readCriteria, readTags, SuccessCriterion } from './boardContent';

export type ClassVersionStatus = 'draft' | 'published';

/** One version of a class: the words, under a successive number. */
export interface FlowNodeClassVersion {
    id: string;
    /** The version's place in the succession: 1 for the first, then one more per version. */
    number: number;
    /**
     * The description: what an instance made from this version is asked — or the template it
     * is instantiated from, where {@link template} says so.
     */
    body: string;
    /** What done means for an instance made from this version. */
    criteria: SuccessCriterion[];
    /**
     * Whether the body is a template: one the instantiation fills in rather than copies. Asked
     * with a checkbox, and instantiating walks the chain's templates one by one before any flow
     * node is made.
     */
    template: boolean;
    /**
     * The default agent: the managed agent an instance made from this version is played by
     * at first — a managed agent's id, or `''` for none. Asked of an AI class's versions and
     * of no other kind.
     */
    agent: string;
    status: ClassVersionStatus;
}

/**
 * One node class: the reusable card, with its succession beneath it.
 *
 * The shape echoes the flow node's own — `type`, `tags`, `at`, `spot`, `onSuccess` — because
 * the board draws one beside the other. `onSuccess.flowNode` names a **class**, never a
 * version or a simple flow node: the two kinds chain among themselves and never across.
 */
export interface FlowNodeClass {
    /** Stable for the life of the class: it is the same class wherever it ends up. */
    id: string;
    title: string;
    /**
     * Whether the class is offered in the Instantiate menu. Off unless ticked: a class
     * nobody ticked is still instantiated as the successor of one that is.
     */
    instantiable: boolean;
    type: FlowNodeType;
    tags: string[];
    /**
     * A **Scheduler**'s preset datetime, as `YYYY-MM-DDTHH:mm`, or `''` for none. The instance
     * starts from it and may change it.
     */
    at: string;
    /** Fixed wait from play, as positive h/m/s/ms components; alternative to at. */
    duration?: string;
    /** Where the card sits on the board, or null for one nobody has placed. */
    spot: FlowNodeSpot | null;
    /**
     * The class after this one when its instances are over and went well, and — on an AI
     * class — what becomes of an instance's chat. A **Shutdown** names none.
     */
    onSuccess: FlowNodeSuccess;
    /**
     * How an AI instance's tool calls are answered. Asked of an AI class and of no other kind;
     * `''` where it names none.
     */
    permission: string;
    /**
     * Which runner plays an AI instance — a runner's id, or `''` for wherever a Play is
     * pressed. Asked of an AI class and of no other kind.
     */
    runner: string;
    /**
     * What the class editor keeps beside the reusable card: what the class is for, when to
     * instantiate it, what its instances assume. Asked of every kind of class and copied to
     * no instance.
     */
    note: string;
    /**
     * The workflow class the class is grouped in, by id — or `''` for none. At most one per
     * card, like a flow node's workflow.
     */
    workflowClass: string;
    /** The succession, oldest first. */
    versions: FlowNodeClassVersion[];
}

/** What a flow node says about the class version it was made from. */
export interface ClassRef {
    classId: string;
    classTitle: string;
    versionId: string;
    versionNumber: number;
}

/** A new class: the kind picked, at the point right-clicked — and opened, to be named. */
export const newFlowNodeClass = (type: FlowNodeType, spot: FlowNodeSpot | null = null): FlowNodeClass => ({
    id: newId(), title: '', instantiable: false, type, tags: [], at: '', spot,
    onSuccess: noSuccess(), permission: '', runner: '', note: '', workflowClass: '', versions: [],
});

/**
 * A new version under its class: one more than the succession holds, and a draft. A version
 * made from another starts as its source said — template mode included — which is what
 * successive versions are.
 */
export const newClassVersion = (
    versions: FlowNodeClassVersion[], body = '', criteria: SuccessCriterion[] = [],
    template = false, agent = '',
): FlowNodeClassVersion => ({
    id: newId(),
    number: versions.reduce((held, version) => Math.max(held, version.number), 0) + 1,
    body, criteria, template, agent, status: 'draft',
});

/**
 * The version an instantiation makes a flow node from: the latest one that is not a draft —
 * or null where the class has none published, in which case it cannot be instantiated.
 */
export const latestPublished = (flowNodeClass: FlowNodeClass): FlowNodeClassVersion | null => {
    let latest: FlowNodeClassVersion | null = null;
    for (const version of flowNodeClass.versions) {
        if (version.status === 'published' && (!latest || version.number > latest.number)) {
            latest = version;
        }
    }
    return latest;
};

/**
 * The chain an instantiation makes flow nodes from: the class named and its successors — each
 * from its latest published version — until nothing is named, a class that has gone, or a class
 * already in the chain. Empty where the class itself is gone.
 */
export const instantiationChainOf = (
    classes: FlowNodeClass[], classId: string,
): FlowNodeClass[] => {
    const byId = new Map(classes.map(one => [one.id, one]));
    const chain: FlowNodeClass[] = [];
    const seen = new Set<string>();
    for (let id: string | null = classId; id; ) {
        if (seen.has(id)) break;
        seen.add(id);
        const one = byId.get(id);
        if (!one) break;
        chain.push(one);
        id = one.onSuccess.flowNode || null;
    }
    return chain;
};

/**
 * The members of a workflow class: the classes grouped in the rectangle it names, in the
 * order they are given. What a workflow-class instantiation makes flow nodes from — members
 * only, a chain onto a class outside the rectangle being left off rather than followed.
 */
export const workflowMembersOf = (
    classes: FlowNodeClass[], workflowClassId: string,
): FlowNodeClass[] => classes.filter(one => one.workflowClass === workflowClassId);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readVersionStatus = (raw: unknown): ClassVersionStatus =>
    (raw === 'published' ? 'published' : 'draft');

const readVersion = (raw: unknown): FlowNodeClassVersion | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const number = source.number;
    return {
        id: text(source.id) || newId(),
        number: typeof number === 'number' && number >= 1 ? Math.floor(number) : 1,
        body: text(source.body),
        criteria: readCriteria(source.criteria),
        template: source.template === true,
        agent: text(source.agent).trim(),
        status: readVersionStatus(source.status),
    };
};

const readVersions = (raw: unknown): FlowNodeClassVersion[] =>
    list(raw).map(readVersion).filter((version): version is FlowNodeClassVersion => version !== null);

/** What a flow node says about the class version it was made from, or null for none. */
export const readClassRef = (raw: unknown): ClassRef | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    if (!text(source.versionId) || !text(source.classId)) return null;
    const number = source.versionNumber;
    return {
        classId: text(source.classId),
        classTitle: text(source.classTitle),
        versionId: text(source.versionId),
        versionNumber: typeof number === 'number' && number >= 1 ? Math.floor(number) : 1,
    };
};

const readFlowNodeClass = (raw: unknown): FlowNodeClass | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    // A class names no agent, so a document saying no type is simply Human.
    const type = readType(source.type, {});
    // A default agent on a version of a class that is not AI is a thing the service drops at
    // the write — read here the way it is held there, so the two never disagree about it.
    const versions = readVersions(source.versions)
        .map(version => (type === 'ai' ? version : { ...version, agent: '' }));
    return {
        id: text(source.id) || newId(),
        title: text(source.title),
        instantiable: source.instantiable === true,
        type,
        tags: readTags(source.tags),
        at: readSchedule(source.at),
        ...(readDuration(source.duration) ? { duration: readDuration(source.duration) } : {}),
        spot: readSpot(source.spot),
        // Read against the class's **type**: a mode claiming a conversation on a class that
        // has none, or a chain on a class that ends the board, is a thing this build cannot
        // show and cannot be asked to fix.
        onSuccess: successFor(readSuccess(source.onSuccess), type),
        permission: type === 'ai' ? text(source.permission).trim() : '',
        runner: type === 'ai' ? text(source.runner).trim() : '',
        note: text(source.note),
        workflowClass: text(source.workflowClass).trim(),
        versions,
    };
};

export const readFlowNodeClasses = (raw: unknown): FlowNodeClass[] =>
    list(raw).map(readFlowNodeClass).filter((one): one is FlowNodeClass => one !== null);

/** One class as the document holds it. */
export const writeFlowNodeClass = (flowNodeClass: FlowNodeClass): unknown => ({
    id: flowNodeClass.id,
    title: flowNodeClass.title,
    ...(flowNodeClass.instantiable ? { instantiable: true } : {}),
    ...(saysType(flowNodeClass.type) ? { type: flowNodeClass.type } : {}),
    ...(flowNodeClass.tags.length ? { tags: [...flowNodeClass.tags] } : {}),
    ...(flowNodeClass.at ? { at: flowNodeClass.at } : {}),
    ...(flowNodeClass.duration ? { duration: flowNodeClass.duration } : {}),
    ...(flowNodeClass.spot ? { spot: writeSpot(flowNodeClass.spot) } : {}),
    ...(saysSuccess(flowNodeClass.onSuccess) ? { onSuccess: writeSuccess(flowNodeClass.onSuccess) } : {}),
    ...(flowNodeClass.permission ? { permission: flowNodeClass.permission } : {}),
    ...(flowNodeClass.runner ? { runner: flowNodeClass.runner } : {}),
    ...(flowNodeClass.note ? { note: flowNodeClass.note } : {}),
    ...(flowNodeClass.workflowClass ? { workflowClass: flowNodeClass.workflowClass } : {}),
    versions: flowNodeClass.versions.map(version => ({
        id: version.id,
        number: version.number,
        ...(version.body ? { body: version.body } : {}),
        ...(version.criteria.length ? { criteria: version.criteria.map(criterion => ({ ...criterion })) } : {}),
        ...(version.template ? { template: true } : {}),
        ...(version.agent ? { agent: version.agent } : {}),
        ...(version.status === 'published' ? { status: version.status } : {}),
    })),
});
