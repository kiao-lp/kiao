/** A flow node class: the reusable card, and its successive versions. */

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

    number: number;

    body: string;

    criteria: SuccessCriterion[];

    template: boolean;

    agent: string;
    status: ClassVersionStatus;
}

/** One node class: the reusable card, with its succession beneath it. */
export interface FlowNodeClass {

    id: string;
    title: string;

    instantiable: boolean;
    type: FlowNodeType;
    tags: string[];

    at: string;

    duration?: string;

    spot: FlowNodeSpot | null;

    onSuccess: FlowNodeSuccess;

    permission: string;

    runner: string;

    note: string;

    workflowClass: string;
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

/** A new version under its class: one more than the succession holds, and a draft. */
export const newClassVersion = (
    versions: FlowNodeClassVersion[], body = '', criteria: SuccessCriterion[] = [],
    template = false, agent = '',
): FlowNodeClassVersion => ({
    id: newId(),
    number: versions.reduce((held, version) => Math.max(held, version.number), 0) + 1,
    body, criteria, template, agent, status: 'draft',
});

/** The version an instantiation makes a flow node from: the latest one that is not a draft — or null. */
export const latestPublished = (flowNodeClass: FlowNodeClass): FlowNodeClassVersion | null => {
    let latest: FlowNodeClassVersion | null = null;
    for (const version of flowNodeClass.versions) {
        if (version.status === 'published' && (!latest || version.number > latest.number)) {
            latest = version;
        }
    }
    return latest;
};

/** The chain an instantiation makes flow nodes from: the class named and its successors — each from. */
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

/** The members of a workflow class: the classes grouped in the rectangle it names, in the order they. */
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

    const type = readType(source.type, {});

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
