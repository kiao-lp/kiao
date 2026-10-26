import { useCallback } from 'react';
import { useSelectionContext } from '@cms-core';
import { usePointedElementContext } from 'react-advanced-interactions';

import { useMindmapStateContext } from '../state';
import {
    MindmapElement, MindmapRelation, MindmapRelationEnd, RelationBody, RelationEnds,
    RELATION_LINE_WIDTH, instanceOfMindmapRelation, newRelationEndWidths, newRelationProperties,
    relationEndOfWidth, restyledRelation
} from '../model';
import { randomWord } from './randomWord';
import { relationBodyWidth } from './useRelationUtils';

// === Types & Helpers ===

export const filterRelationContainsEndById = (endId: string) => (element: MindmapElement) => {
    if (!instanceOfMindmapRelation(element)) {
        return false;
    }
    const relation = element as MindmapRelation;
    return relation.ends.some(end => end.id === endId);
}

/** An end reaching that note, as wide as the style asks — carrying no width when it asks none. */
const endTargeting = (target: string, width?: number): MindmapRelationEnd => ({
    id: 'END-' + randomWord(8), target, ...(width !== undefined && { width })
});

// === Hooks ===

/**
 * Relates one note to each of the others — one relation per pair, since a relation joins exactly
 * two notes. Relating a note to itself, or to the same note twice, is nothing to do.
 *
 * Every relation is made in the style the map is set to, the hub being the note it is made from:
 * a triangle therefore comes to a point at the hub or at the note reached, as that style says.
 */
export const useRelateNotes = () => {
    const { addElements, newRelationStyle } = useMindmapStateContext();

    return useCallback((hub: string, others: string[]): void => {
        const targets = [...new Set(others)].filter(id => id !== hub);
        if (!hub || targets.length === 0) return;

        const [hubWidth, targetWidth] = newRelationEndWidths(newRelationStyle);

        addElements({
            relations: targets.map(target => ({
                id: 'REL-' + randomWord(8),
                ...newRelationProperties(newRelationStyle),
                ends: [endTargeting(hub, hubWidth), endTargeting(target, targetWidth)] as RelationEnds
            }))
        });
    }, [addElements, newRelationStyle]);
};

/**
 * Hands the style the top bar holds — normally the look of relations still to come — to the
 * relations already drawn and selected, as the brush beside it does for notes. It goes through
 * without asking: what it touches is what is visibly selected, and the boxes it applies are in
 * sight above. Notes among the selection are left alone; the brush over there is theirs.
 */
export const useApplyRelationStyleToSelection = () => {
    const { mapElements, saveMindmap, newRelationStyle } = useMindmapStateContext();
    const [selection] = useSelectionContext();

    return useCallback(() => {
        if (selection.length === 0) return;

        mapElements(element => (selection.includes(element.id) && instanceOfMindmapRelation(element))
            ? restyledRelation(element as MindmapRelation, newRelationStyle)
            : element);
        saveMindmap();
    }, [mapElements, saveMindmap, selection, newRelationStyle]);
};

/**
 * Puts a relation's centre back in the middle of its line. The bend is taken off the relation
 * rather than set to nothing, so a relation straightened again is the one that was never bent.
 */
export const useStraightenRelation = () => {
    const { mapElements } = useMindmapStateContext();

    return useCallback((id: string): void => {
        mapElements(element => {
            if (element.id !== id || !instanceOfMindmapRelation(element)) return element;
            const { bend, ...straightened } = element as MindmapRelation;
            return straightened;
        });
    }, [mapElements]);
};

// === The body a relation is drawn with ===

/** The relation an end belongs to, left alone if it is not this one. */
const mapRelationOf = (endId: string, map: (relation: MindmapRelation) => MindmapRelation) =>
    (element: MindmapElement): MindmapElement => {
        if (!instanceOfMindmapRelation(element)) return element;
        const relation = element as MindmapRelation;
        return relation.ends.some(end => end.id === endId) ? map(relation) : relation;
    };

/**
 * Draws the relation an end belongs to as a line, a rectangle or a triangle, keeping the width it
 * already had. The triangle comes to a point at that very end — which is how the end under the
 * pointer says which way round the triangle goes, the pair of ends being unordered.
 */
export const useShapeRelationBody = () => {
    const { mapElements } = useMindmapStateContext();

    return useCallback((endId: string, body: RelationBody): void => {
        mapElements(mapRelationOf(endId, relation => {
            const width = relationBodyWidth(relation);
            const widthOf = (end: MindmapRelationEnd) => {
                if (body === 'line') return undefined;
                if (body === 'rectangle') return width;
                return end.id === endId ? 0 : width;
            };

            return { ...relation, ends: relation.ends.map(end => relationEndOfWidth(end, widthOf(end))) as RelationEnds };
        }));
    }, [mapElements]);
};

/**
 * Widens or narrows the body of the relation an end belongs to, by so many pixels at every end at
 * once — so the shape it is drawn as survives the resizing. An end that comes to a point keeps
 * its point, and one that never had a width starts from the line's own weight, which is what
 * turns the line under the wheel into a rectangle rather than into nothing.
 */
export const useWidenRelation = () => {
    const { mapElements } = useMindmapStateContext();

    return useCallback((endId: string, by: number): void => {
        mapElements(mapRelationOf(endId, relation => ({
            ...relation,
            ends: relation.ends.map(end => end.width === 0
                ? end
                : relationEndOfWidth(end, Math.max(2, (end.width ?? RELATION_LINE_WIDTH) + by))) as RelationEnds
        })));
    }, [mapElements]);
};

/**
 * Turns a relation's body round, by trading the widths of its two ends. It is the triangle this
 * is for — which end it comes to a point at is the whole of which way round it is — and on a
 * rectangle, whose ends are equally wide, it is nothing to do.
 */
export const useFlipRelationBody = () => {
    const { mapElements } = useMindmapStateContext();

    return useCallback((endId: string): void => {
        mapElements(mapRelationOf(endId, relation => ({
            ...relation,
            ends: relation.ends.map((end, at) => relationEndOfWidth(end, relation.ends[1 - at].width)) as RelationEnds
        })));
    }, [mapElements]);
};

export const useSelectRelation = () => {
    const [, setSelection] = useSelectionContext();
    const [pointedElement] = usePointedElementContext();
    const { selectElements } = useMindmapStateContext();

    return useCallback((): void => {
        if (pointedElement) {
            const relations = selectElements(filterRelationContainsEndById(pointedElement));
            if (relations.length === 1) {
                setSelection([relations[0].id]);
                return;
            }
        }
    }, [pointedElement, selectElements, setSelection]);
};
