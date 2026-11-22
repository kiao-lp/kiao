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

/** Half of a relation: the curve from the border of one note to the relation's centre, with. */
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

        const haloWidth = (widths ? Math.max(widths[0], widths[1]) : 0) + 12;

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
