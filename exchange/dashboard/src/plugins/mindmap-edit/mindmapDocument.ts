/**
 * A map as the file holds it, and the two arrows between the two.
 *
 * The map is the **content** of a document; the rest of the file is its envelope, and none of it
 * is this editor's business. The document's id and its birth date are carried through untouched —
 * rewriting them would mint a new document over the old one at every keystroke — and so is any
 * field this build has never heard of.
 *
 * Reading is forgiving in the way the format is everywhere: a map may have been hand-written,
 * produced by a turn or pasted in from another instance, so the bare content is accepted as well
 * as the enveloped document, and what could not be drawn is put right on the way in
 * ([well-formed](./lib/well-formed.ts)) rather than taking the editor down on the first render.
 */

import { Mindmap, MINDMAP_DOC_TYPE, MINDMAP_DOC_VERSION } from './model';
import { NOTES, RELATIONS, wellFormedMindmap } from './lib/well-formed';

export interface MindmapDocument {
    /** The document's fields other than its content, as the file had them. */
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
    // A document, or the bare content of one: a map may have been hand-written or pasted in as the
    // elements it is.
    const enveloped = 'content' in raw;
    return {
        envelope: enveloped ? raw : {},
        mindmap: readMindmap(enveloped ? raw.content : raw),
    };
};

/**
 * Map → the exact text a save writes. The identity is only reached for where the file carried
 * none, so it is minted once for the file rather than on every write. The update stamp is carried
 * through the same way: it moves when the editor saves, not when it serializes, so writing the
 * same document twice writes the same text twice.
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
    // After them, and in a settled order, so a field this build knows nothing about is neither
    // lost by a save nor moved by every one of them.
    Object.keys(envelope)
        .filter(key => !REWRITTEN.has(key))
        .sort()
        .forEach(key => { out[key] = envelope[key]; });
    return JSON.stringify(out, null, 2);
};
