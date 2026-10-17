import { Bounds } from "./lib/geom2d";
import type { Document } from "kiao-worker";

export interface RichText {
    content: string;
    fontSize?: number;
}

export interface Mindmap {
    title?: string;
    elements: ElementMap;
}

export type ElementMap = { [key: string]: MindmapElement[] };

export interface MindmapElement {
    id: string;
}

export const USER_BOUND_AUTO = null;
export type AutoDimension = number | null;
export type UserBounds = [number, number, AutoDimension, AutoDimension];

export interface MindmapRect extends MindmapElement {
    userBounds: UserBounds;
    bounds?: Bounds;
    zIndex?: number;
    group?: string;
}

export function instanceOfMindmapRect(object: any): object is MindmapRect {
    return 'userBounds' in object;
}

export interface MindmapText extends MindmapElement, RichText {
}

export function instanceOfMindmapText(object: any): object is MindmapText {
    return 'content' in object;
}

/** Theme names resolve to separate fill (--color-<name>-bg) and ink (--mindmap-relation-<name>) colors. */
export type MindmapColor =
    'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'pink' | 'brown' | 'grey';

export const MINDMAP_COLORS: MindmapColor[] =
    ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink', 'brown', 'grey'];

export const colorTitle = (color: MindmapColor): string =>
    color.charAt(0).toUpperCase() + color.slice(1);

export type NoteShape = 'ellipse' | 'rectangle' | 'diamond';
export type NoteEdge = 'none' | 'dotted' | 'solid-1' | 'solid-2' | 'solid-4' | 'solid-6' | 'solid-8';
export type NoteBackground = 'none' | MindmapColor;
export type NoteBorderColor = MindmapColor;
export type NoteTextAlign = 'left' | 'center' | 'right';
export type NoteVerticalAlign = 'top' | 'middle' | 'bottom';

export interface Note extends MindmapRect, MindmapText {
    shape?: NoteShape;
    edge?: NoteEdge;
    /** Absent uses the default border color. */
    borderColor?: NoteBorderColor;
    background?: NoteBackground;
    textAlign?: NoteTextAlign;
    verticalAlign?: NoteVerticalAlign;
}

export function instanceOfNote(object: any): object is Note {
    return instanceOfMindmapRect(object) && instanceOfMindmapText(object);
}

export type EndDecoration = 'EMPTY_TRIANGLE' | 'FULL_TRIANGLE' | 'EMPTY_RECTANGLE' | 'FULL_RECTANGLE';

export interface MindmapRelationEnd extends MindmapElement {
    target: string;
    /** One of twelve note attachment positions; absent faces the anchor. */
    attachPointNumber?: number;
    decoration?: EndDecoration;
    /**
     * Body width at this end in map pixels; absent uses RELATION_LINE_WIDTH.
     * Equal widths form a rectangle; zero at one end forms a triangle pointing there.
     */
    width?: number;
}

/** Default stroke weight and fallback for ends without a width. */
export const RELATION_LINE_WIDTH = 8;

export type RelationBody = 'line' | 'rectangle' | 'triangle';

export const DEFAULT_BODY_WIDTH = 24;

/** Exactly two notes; deleting either deletes the relation. Arrow direction comes from end decorations. */
export type RelationEnds = [MindmapRelationEnd, MindmapRelationEnd];

export type RelationColor = MindmapColor;

export interface MindmapRelation extends MindmapElement {
    ends: RelationEnds;
    /** Applies to the curve, body and decorations; absent uses the default relation color. */
    color?: RelationColor;
    /**
     * Offset from the midpoint in map pixels, so bends move with the notes.
     * Straightening removes this field rather than storing [0, 0].
     */
    bend?: [number, number];
}

export function instanceOfMindmapRelation(object: any): object is MindmapRelation {
    return 'ends' in object;
}

export interface MindmapElementOwner<T extends MindmapElement> {
    element: T
}

export const MINDMAP_DOC_TYPE = 'QuickMindmap';
export const MINDMAP_DOC_VERSION = 1;

export const emptyMindmapDocument = (): Document<Mindmap> => ({
    content: { elements: { notes: [], relations: [] } },
    docType: MINDMAP_DOC_TYPE,
    docId: crypto.randomUUID(),
    docTypeVersion: MINDMAP_DOC_VERSION,
    createdAt: new Date().toISOString(),
});

export interface NewNoteStyle {
    fontSize: number;
    shape: NoteShape;
    edge: NoteEdge;
    /** Empty selects the default border color. */
    borderColor: NoteBorderColor | '';
    background: NoteBackground;
}

/** Must match stylesheet defaults and note-toolbar fallback values. */
export const DEFAULT_NEW_NOTE_STYLE: NewNoteStyle = {
    fontSize: 20,
    shape: 'rectangle',
    edge: 'solid-1',
    borderColor: '',
    background: 'none'
};

/** Omit stylesheet defaults to preserve the unstyled stored format. */
export const newNoteProperties = (style: NewNoteStyle): Partial<Note> => ({
    ...(style.fontSize !== DEFAULT_NEW_NOTE_STYLE.fontSize && { fontSize: style.fontSize }),
    ...(style.shape !== DEFAULT_NEW_NOTE_STYLE.shape && { shape: style.shape }),
    ...(style.edge !== DEFAULT_NEW_NOTE_STYLE.edge && { edge: style.edge }),
    ...(style.borderColor && { borderColor: style.borderColor }),
    ...(style.background !== DEFAULT_NEW_NOTE_STYLE.background && { background: style.background })
});

/** Replace style fields wholesale, removing fields restored to their defaults. */
export const restyledNote = <T extends Note>(note: T, style: NewNoteStyle): T => {
    const { fontSize, shape, edge, borderColor, background, ...bare } = note;
    return { ...bare, ...newNoteProperties(style) } as T;
};

/** Triangle direction follows the creation gesture; reversed points at the other end. */
export type NewRelationBody = RelationBody | 'triangle-reversed';

export interface NewRelationStyle {
    body: NewRelationBody;
    width: number;
    /** Empty selects the default relation color. */
    color: RelationColor | '';
}

export const DEFAULT_NEW_RELATION_STYLE: NewRelationStyle = {
    body: 'line',
    width: DEFAULT_BODY_WIDTH,
    color: ''
};

/** End order follows the creation gesture; a triangle points at its zero-width end. Lines omit widths. */
export const newRelationEndWidths = (
    { body, width }: NewRelationStyle
): [number | undefined, number | undefined] => {
    switch (body) {
        case 'rectangle': return [width, width];
        case 'triangle': return [0, width];
        case 'triangle-reversed': return [width, 0];
        default: return [undefined, undefined];
    }
};

export const newRelationProperties = ({ color }: NewRelationStyle): Partial<MindmapRelation> =>
    color ? { color } : {};

/** Undefined removes the width field to restore a line; zero is a valid triangle tip. */
export const relationEndOfWidth = (end: MindmapRelationEnd, width?: number): MindmapRelationEnd => {
    if (width !== undefined) return { ...end, width };
    const { width: had, ...plain } = end;
    return plain;
};

/** Replace body style while preserving end identities, targets, attachment points and decorations. */
export const restyledRelation = (relation: MindmapRelation, style: NewRelationStyle): MindmapRelation => {
    const widths = newRelationEndWidths(style);
    const { color, ...bare } = relation;
    return {
        ...bare,
        ...newRelationProperties(style),
        ends: relation.ends.map((end, at) => relationEndOfWidth(end, widths[at])) as RelationEnds
    };
};
