import { useCallback } from 'react';
import { useSelectionContext } from '@kiao-dashboard-core';
import { useMindmapStateContext } from '../state';
import { MindmapRect, MindmapRelation, instanceOfMindmapRect, instanceOfMindmapRelation } from '../model';

/** Moves everything selected by a movement in screen pixels — the drag of a note, and the arrow keys. */
export const useMoveSelection = () => {
    const [selection] = useSelectionContext();
    const { mapElements, zoom } = useMindmapStateContext();

    return useCallback((movement: number[]) => {
        // This ensures dragged elements follow the cursor accurately
        const adjustedMovement = [movement[0] / zoom, movement[1] / zoom];

        mapElements((element) => {
            if (selection.indexOf(element.id) === -1)
                return element;

            if (instanceOfMindmapRect(element)) {
                const rect = element as MindmapRect;
                const [x, y, ...rest] = rect.userBounds;

                return {
                    ...rect,
                    userBounds: [x + adjustedMovement[0], y + adjustedMovement[1], ...rest]
                }
            }

            if (instanceOfMindmapRelation(element)) {
                const relation = element as MindmapRelation;
                if (relation.ends.some(end => selection.indexOf(end.target) !== -1))
                    return relation;

                const [bendX, bendY] = relation.bend ?? [0, 0];

                return {
                    ...relation,
                    bend: [bendX + adjustedMovement[0], bendY + adjustedMovement[1]] as [number, number]
                }
            }

            return element;
        });
    }, [mapElements, selection, zoom]);
};
