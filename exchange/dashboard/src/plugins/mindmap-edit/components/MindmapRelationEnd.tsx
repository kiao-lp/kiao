import React, { useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { usePointedElementApi, useAutoUnpointOnDestroy } from 'react-advanced-interactions';
import {
    Quadratic, quadraticBandOutlinePath, quadraticBandPath, quadraticPath, round, startFacingDeg, trimQuadraticStart
} from '../lib/quadratic';
import { MindmapRelationEnd } from '../model';
import { useMindmapStateContext, useMindmapMode } from '../state';
import { useWidenRelation } from '../hooks/useRelation';

import EmptyTriangleSvg from './images/EmptyTriangle.svg?react';
import FullTriangleSvg from './images/FullTriangle.svg?react';
import EmptyRectangleSvg from './images/EmptyRectangle.svg?react';
import FullRectangleSvg from './images/FullRectangle.svg?react';

const size = 24;

const decorations = {
    EMPTY_TRIANGLE: EmptyTriangleSvg,
    FULL_TRIANGLE: FullTriangleSvg,
    EMPTY_RECTANGLE: EmptyRectangleSvg,
    FULL_RECTANGLE: FullRectangleSvg
};

/**
 * Half of a relation: the curve from the border of one note to the relation's centre, with the
 * decoration the end carries drawn where it meets the note, facing the way the curve leaves.
 *
 * The ink stops a decoration's length short of the note, as the straight line it replaces did, so
 * that a hollow decoration is not drawn around a line running through it.
 *
 * Under it all runs the halo: the same curve again, wider than whatever is drawn on top of it and
 * invisible until the relation is selected, when it is what shows the selection. It is also what
 * the pointer has to hit — an eight pixel line is a small thing to catch by hand, and the end is
 * what the decoration and attach point commands are addressed to. A selected relation is ringed
 * rather than tinted, as a selected note is, and for the same reason: the colour a relation is
 * drawn in is its own, and a tint would overrule it.
 *
 * A relation given a width is drawn as a band running along that same curve instead of stroked
 * along it, so its body follows the bend rather than lying straight across it. `widths` is how
 * wide the band is where it meets this note and where it meets the centre; without them the
 * relation is the line, and the line is a stroke.
 *
 * `hollow` is the rectangle: a band drawn as its own outline rather than filled in. It is the
 * whole relation's business and not this half's — the base of a triangle is as wide at both its
 * corners as a rectangle is, and a half left to judge by its own two widths would take it for one.
 *
 * `Pointable` is not used here because it is a `div`, and this is drawn inside an `svg`. Its two
 * hooks are, so an end is pointed and unpointed exactly as anything else on the map is.
 */
export const MindmapRelationEndCmp: React.FC<{
    curve: Quadratic, widths: [number, number] | null, hollow?: boolean, end: MindmapRelationEnd
}> =
    ({ curve, widths, hollow, end }) => {

        const [mode] = useMindmapMode();
        const { pointed, point, unPoint } = usePointedElementApi(end.id);
        useAutoUnpointOnDestroy(end.id);
        const { saveMindmap } = useMindmapStateContext();
        const widenRelation = useWidenRelation();

        const pointable = mode !== 'VISUALIZE';
        const DecorationSvg = end.decoration ? decorations[end.decoration] : undefined;

        const ink = useMemo(() => {
            const drawn = DecorationSvg ? trimQuadraticStart(curve, size) : curve;
            if (!widths) return quadraticPath(drawn);
            const band = hollow ? quadraticBandOutlinePath : quadraticBandPath;
            return band(drawn, widths[0], widths[1]);
        }, [curve, widths, hollow, DecorationSvg]);

        // Wider than whatever it runs under, so that a body is ringed rather than covered and a
        // line is catchable by a hand that is not on it exactly.
        const haloWidth = (widths ? Math.max(widths[0], widths[1]) : 0) + 12;

        // As the wheel resizes a note it is over, it widens the relation it is over — every end
        // of it at once, so that a rectangle stays a rectangle and a triangle a triangle.
        const onWheel = useCallback((event: React.WheelEvent) => {
            if (!pointable) return;
            event.stopPropagation();
            widenRelation(end.id, -Math.round(event.deltaY / 10));
            saveMindmap();
        }, [pointable, widenRelation, end.id, saveMindmap]);

        return (
            <g className={classNames('relation-end', { pointed })}
                onMouseEnter={pointable ? point : undefined}
                onMouseLeave={pointable ? unPoint : undefined}
                onWheel={onWheel}>

                {pointable && <path className="relation-halo" d={quadraticPath(curve)}
                    style={{ strokeWidth: haloWidth }} />}

                <path className={classNames(widths ? 'relation-body' : 'relation-curve', { hollow })} d={ink} />

                {DecorationSvg && (
                    <g transform={`translate(${round(curve[0][0])},${round(curve[0][1])}) rotate(${round(startFacingDeg(curve))})`}>
                        <DecorationSvg x={-size} y={-size / 2} width={size} height={size} />
                    </g>
                )}
            </g>
        );
    };
