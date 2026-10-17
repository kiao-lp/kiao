import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Pointable } from 'react-advanced-interactions';
import { Selectable, useElementSelection } from '@cms-core';
import { MindmapElementOwner, MindmapRelation } from '../model';
import { useMindmapStateContext, useMindmapMode } from '../state';
import { computeRelationGeometry, relationBodyWidths, relationEndCurve } from '../hooks/useRelationUtils';
import { useMindmapDragAndDropContext } from './MindmapDragAndDrop';
import { MindmapRelationEndCmp } from './MindmapRelationEnd';
import { RelationContextMenuCmp } from './RelationContextMenu-cmp';

const stopEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
};

/**
 * The relation's centre, and the handle it is moved by. It carries no selected background: what
 * says a relation is selected is the halo along its whole curve, and a tint here would sit over
 * the ink where the two halves meet — a hole in the middle of the very thing being styled.
 *
 * The disc it draws is a join: it fills the notch the two halves leave on the outside of a bend,
 * and it is the ink's own colour, so on a line and on a filled body it is not a mark of its own.
 * A hollow body has no ink there to join and would show it as a dot in the middle of an empty
 * shape, so it draws none — the disc comes up under the pointer, which is where the handle has
 * to say it is there, and nowhere else.
 *
 * Pressing it selects the relation and
 * starts a drag, exactly as pressing a note does, so the map's own machinery carries the movement
 * to the relation's bend and saves it when the drag is let go. A press that moved nothing leaves
 * the map modifying the element instead, which is what opens the menu — so a relation cannot be
 * dragged and asked about at once.
 *
 * Control picks relations out one at a time, again as it does notes: the one pressed joins the
 * selection or leaves it, and no drag starts — what is being held together is being gathered,
 * to be styled or deleted in one go, not moved.
 */
const RelationAnchorCmp = ({ x, y, hollow, element }:
    { x: number, y: number, hollow: boolean, element: MindmapRelation }) => {

    const [mode, setMode] = useMindmapMode();
    const { selected, select, addToSelection, deselect } = useElementSelection(element.id, false);
    const { onElementDown, onElementUp } = useMindmapDragAndDropContext();
    const anchorDivRef = useRef<HTMLDivElement>(null);
    const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);

    const isEdited = selected && mode === 'EDIT_MODIFY_ELEMENT';

    useLayoutEffect(() => {
        setMenuAnchorRect(isEdited ? anchorDivRef.current?.getBoundingClientRect() ?? null : null);
    }, [isEdited]);

    // Pressing what is already selected leaves the selection alone, as pressing a note does: a
    // relation picked out with others is dragged with them rather than dropping them.
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        stopEvent(e);
        if (mode === 'VISUALIZE') return;

        if (e.ctrlKey) {
            if (selected) deselect(); else addToSelection();
            return;
        }

        if (!selected) select();
        onElementDown();
    }, [mode, selected, select, addToSelection, deselect, onElementDown]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        stopEvent(e);
        if (mode === 'VISUALIZE') return;
        onElementUp();
    }, [mode, onElementUp]);

    const closeMenu = useCallback(() => setMode('EDIT'), [setMode]);

    return <>
        <Pointable id={element.id} disabled={mode === 'VISUALIZE'}>
            <div ref={anchorDivRef} className='relation-anchor pointed-background' style={{ left: x, top: y }}
                onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onClick={stopEvent}>
                <div className={classNames('relation-anchor-join', { hollow })}></div>
            </div>
        </Pointable>
        {menuAnchorRect && (
            <RelationContextMenuCmp
                relation={element}
                anchorRect={menuAnchorRect}
                onClose={closeMenu}
            />
        )}
    </>;
}

export const MindmapRelationCmp: React.FC<MindmapElementOwner<MindmapRelation>> = React.memo(({ element }) => {
    const { mindmap } = useMindmapStateContext();
    const geometry = useMemo(() => mindmap ? computeRelationGeometry(element, mindmap) : null, [element, mindmap]);

    if (!geometry) return null;

    const { anchor, attachPoints } = geometry;
    const [fromEnd, toEnd] = element.ends;

    // A body runs from one end's width to the other's, so at the centre — where the two halves
    // meet — it is halfway between them, and each half is drawn from its own note's width to that.
    const widths = relationBodyWidths(element);
    const middleWidth = widths && (widths[0] + widths[1]) / 2;

    // A rectangle is drawn as its own outline and a triangle filled in, and which of the two a
    // relation is can only be said here: an end brought to a point is what makes a triangle, and
    // that end is the other one as often as it is this one.
    const hollow = !!widths && !widths.includes(0);

    // The colour is carried by a wrapper rather than written onto each piece: the curve, the
    // body, the decorations and the centre are all drawn in `--relation-ink`, which is what that
    // wrapper sets. One place says what colour a relation is.
    //
    // One surface over the whole map per relation, drawn in the map's own coordinates: the notes
    // are placed in those, so the curve is written with the numbers the geometry gives and there
    // is no box to size or offset to keep. It catches no pointer of its own — only the two hit
    // paths inside it do — so the surfaces stacked over each other are not in each other's way.
    return (
        <Selectable id={element.id}>
            <div className={classNames('relation', element.color && `relation-color-${element.color}`)}>
                <svg className="relation-curves">
                    <MindmapRelationEndCmp end={fromEnd} curve={relationEndCurve(attachPoints[0], geometry)}
                        widths={widths && [widths[0], middleWidth!]} hollow={hollow} />
                    <MindmapRelationEndCmp end={toEnd} curve={relationEndCurve(attachPoints[1], geometry)}
                        widths={widths && [widths[1], middleWidth!]} hollow={hollow} />
                </svg>

                <RelationAnchorCmp x={anchor[0]} y={anchor[1]} hollow={hollow} element={element} />
            </div>
        </Selectable>
    );
});
