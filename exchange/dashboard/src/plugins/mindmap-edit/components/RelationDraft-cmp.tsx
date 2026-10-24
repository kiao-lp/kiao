import React from 'react';
import { flatLineCoordsDegRotation, flatLineCoordsLength } from '../lib/geom2d';

import { MindmapRect } from '../model';
import { useMindmapStateContext } from '../state';

/**
 * The relation a shift drag is pulling, drawn from the middle of the note it comes from to
 * wherever the pointer has got to. It is only a promise of a relation, so it is dashed, and it
 * lies under the notes — it leaves its note the way a real relation does.
 */
export const RelationDraftCmp: React.FC<{ from: string, to: number[] }> = ({ from, to }) => {
    const { mindmap } = useMindmapStateContext();

    const note = mindmap?.elements.notes
        .find(element => element.id === from) as MindmapRect | undefined;
    const bounds = note?.bounds ?? note?.userBounds;
    if (!bounds) return null;

    const [left, top, width, height] = bounds;
    const [fromX, fromY] = [left + (width ?? 0) / 2, top + (height ?? 0) / 2];
    const rotation = flatLineCoordsDegRotation(fromX, fromY, to[0], to[1]);

    return (
        <div className="relation-draft" style={{
            transformOrigin: 'center left',
            transform: `translate(${fromX}px, ${fromY}px) rotate(${rotation + 270}deg)`,
            width: flatLineCoordsLength(fromX, fromY, to[0], to[1])
        }} />
    );
};
