import { useCallback } from 'react';
import { Bounds } from '../lib/geom2d';
import { Quadratic, controlThrough } from '../lib/quadratic';
import {
    DEFAULT_BODY_WIDTH, Mindmap, MindmapRelation, MindmapRelationEnd, Note, NoteShape, RelationBody,
    RelationEnds, RELATION_LINE_WIDTH, instanceOfMindmapRelation
} from '../model';
import { useMindmapStateContext } from '../state';

/** A note an end attaches to, reduced to what deciding where its line stops needs. */
interface AttachNote {
    bounds: Bounds;
    shape?: NoteShape;
}

const center = (bounds: Bounds) => [bounds[0] + bounds[2] / 2, bounds[1] + bounds[3] / 2];

/** How far from a note's centre its border lies along the direction `[nx, ny]`, as a multiple of. */
const borderDistance = (shape: NoteShape | undefined, nx: number, ny: number): number => {
    switch (shape) {
        case 'ellipse': return 1 / Math.hypot(nx, ny);
        case 'diamond': return 1 / (Math.abs(nx) + Math.abs(ny));
        default: return 1 / Math.max(Math.abs(nx), Math.abs(ny));
    }
};

/**
 * Where a line aimed at `aim` stops against a note: on the ellipse or the diamond drawn inside its.
 * An aim already inside the note is itself where it stops — the border is then never reached.
 */
const getBorderPoint = (note: AttachNote, aim: number[]): number[] => {
    const [, , w, h] = note.bounds;
    const [cx, cy] = center(note.bounds);
    if (w <= 0 || h <= 0) return [cx, cy];

    const [dx, dy] = [aim[0] - cx, aim[1] - cy];
    const distance = Math.min(borderDistance(note.shape, dx / (w / 2), dy / (h / 2)), 1);

    return [cx + dx * distance, cy + dy * distance];
};

/** The place around a note an end numbered 0 to 11 is pinned to — the quarters of each side of its. */
const getAimPoint = (bounds: Bounds, attachPointNumber?: number): number[] | null => {
    const [x, y, w, h] = bounds;

    switch (attachPointNumber) {
        case 0: return [x + w * 2 / 4, y];
        case 1: return [x + w * 3 / 4, y];
        case 2: return [x + w, y + h * 1 / 4];
        case 3: return [x + w, y + h * 2 / 4];
        case 4: return [x + w, y + h * 3 / 4];
        case 5: return [x + w * 3 / 4, y + h];
        case 6: return [x + w * 2 / 4, y + h];
        case 7: return [x + w * 1 / 4, y + h];
        case 8: return [x, y + h * 3 / 4];
        case 9: return [x, y + h * 2 / 4];
        case 10: return [x, y + h * 1 / 4];
        case 11: return [x + w * 1 / 4, y];
        default: return null;
    }
};

/** The note an end attaches to, or null when there is none to attach to: the note is not measured yet. */
const attachNote = (mindmap: Mindmap, end: MindmapRelationEnd): AttachNote | null => {
    const note = mindmap.elements["notes"]?.find(element => element.id === end.target) as Note | undefined;
    return note?.bounds ? { bounds: note.bounds, shape: note.shape } : null;
};

/** Where an end meets its note: on the note's border, towards the numbered place it is pinned to,. */
const getAttachPoint = (note: AttachNote, end: MindmapRelationEnd, origin?: number[]) =>
    getBorderPoint(note, getAimPoint(note.bounds, end.attachPointNumber) ?? origin ?? center(note.bounds));


type AttachPoints = [number[], number[]];

/** The curve a relation is drawn as: where it meets each of its notes, the centre it passes through. */
export interface RelationGeometry {
    anchor: number[];
    control: number[];
    attachPoints: AttachPoints;
}

const midpoint = ([[ax, ay], [bx, by]]: AttachPoints) => [(ax + bx) / 2, (ay + by) / 2];

const movedBy = ([x, y]: number[], bend?: number[]) => bend ? [x + bend[0], y + bend[1]] : [x, y];

/** The curve a relation is drawn as, or null when there is nothing to draw: a note that is gone or not. */
export const computeRelationGeometry = (relation: MindmapRelation, mindmap: Mindmap): RelationGeometry | null => {
    const [fromEnd, toEnd] = relation.ends ?? [];
    if (!fromEnd || !toEnd) return null;

    const from = attachNote(mindmap, fromEnd);
    const to = attachNote(mindmap, toEnd);
    if (!from || !to) return null;

    const attachTowards = (aim?: number[]): AttachPoints =>
        [getAttachPoint(from, fromEnd, aim), getAttachPoint(to, toEnd, aim)];

    const straight = attachTowards(midpoint(attachTowards()));
    const anchor = movedBy(midpoint(straight), relation.bend);

    const attachPoints = attachTowards(anchor);

    return { anchor, control: controlThrough(attachPoints[0], attachPoints[1], anchor), attachPoints };
}

/** The half of the curve that belongs to one end: the whole of it cut at its centre, taken from. */
export const relationEndCurve = (attachPoint: number[], { anchor, control }: RelationGeometry): Quadratic =>
    [attachPoint, [(attachPoint[0] + control[0]) / 2, (attachPoint[1] + control[1]) / 2], anchor];


/** How wide a relation's body is at each of its two ends, or null for one that has no body to speak of. */
export const relationBodyWidths = (relation: MindmapRelation): [number, number] | null => {
    const widths = relation.ends.map(end => end.width);
    if (widths.every(width => width === undefined)) return null;

    return widths.map(width => width ?? RELATION_LINE_WIDTH) as [number, number];
};

/** Which of the three shapes a relation is drawn as. */
export const relationBody = (relation: MindmapRelation): RelationBody => {
    const widths = relationBodyWidths(relation);
    if (!widths) return 'line';

    return widths.includes(0) ? 'triangle' : 'rectangle';
};

/** How wide a relation's body is — its widest end — or what to start one at, having none. */
export const relationBodyWidth = (relation: MindmapRelation): number =>
    Math.max(...relation.ends.map(end => end.width ?? 0)) || DEFAULT_BODY_WIDTH;

export const useFindRelationEnd = () => {
    const { selectElements } = useMindmapStateContext();

    return useCallback((id: string) => {
        const ends = selectElements(instanceOfMindmapRelation)
            .map(element => element as MindmapRelation)
            .flatMap(relation => relation.ends.filter(end => end.id === id));

        return ends[0] || null;
    }, [selectElements]);
};

export const useMapRelationEnd = () => {
    const { mapElements } = useMindmapStateContext();

    return useCallback((mapFn: (end: MindmapRelationEnd) => MindmapRelationEnd) => {
        return mapElements(
            (element) => {
                if (!instanceOfMindmapRelation(element))
                    return element;

                const relation = element as MindmapRelation;
                return {
                    ...relation,
                    ends: relation.ends.map(mapFn) as RelationEnds
                };
            })
    }, [mapElements]);
}
