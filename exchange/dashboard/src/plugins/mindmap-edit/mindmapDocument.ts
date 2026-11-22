/** A map as the file holds it, and the two arrows between the two. */

import { Mindmap, MINDMAP_DOC_TYPE, MINDMAP_DOC_VERSION } from './model';
import { NOTES, RELATIONS, wellFormedMindmap } from './lib/well-formed';

export interface MindmapDocument {

    envelope: Record<string, unknown>;
    mindmap: Mindmap;
}

/** The identity a document written without one is given. */
export interface MindmapIdentity {
    docId: string;
    createdAt: string;
}

/** The fields below are written afresh; everything else the envelope carries is kept as it was. */
const REWRITTEN = new Set(['content', 'docType', 'docId', 'docTypeVersion', 'createdAt', 'updatedAt']);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** A map on which everything can be drawn — an empty one, for content that holds no map at all. */
const readMindmap = (content: unknown): Mindmap =>
    wellFormedMindmap(object(content) as unknown as Mindmap) ?? { elements: { [NOTES]: [], [RELATIONS]: [] } };

/** Text → map. Throws only on a file that is not JSON at all, which is a file to leave alone. */
export const decodeMindmap = (source: string): MindmapDocument => {
    const raw = object(JSON.parse(source));
    const enveloped = 'content' in raw;
    return {
        envelope: enveloped ? raw : {},
        mindmap: readMindmap(enveloped ? raw.content : raw),
    };
};

/**
 * Map → the exact text a save writes.
 * The identity is only reached for where the file carried none, so it is minted once for the file.
 */
export const encodeMindmap = (document: MindmapDocument, identity: MindmapIdentity): string => {
    const { envelope } = document;
    const out: Record<string, unknown> = {
        content: document.mindmap,
        docType: MINDMAP_DOC_TYPE,
        docId: text(envelope.docId) || identity.docId,
        docTypeVersion: MINDMAP_DOC_VERSION,
        createdAt: text(envelope.createdAt) || identity.createdAt,
        updatedAt: text(envelope.updatedAt) || identity.createdAt,
    };
    Object.keys(envelope)
        .filter(key => !REWRITTEN.has(key))
        .sort()
        .forEach(key => { out[key] = envelope[key]; });
    return JSON.stringify(out, null, 2);
};
