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

/** The relation's centre, and the handle it is moved by. */
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

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        stopEvent(e);
        if (e.button === 2) return;
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
        if (e.button === 2) return;
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

    const widths = relationBodyWidths(element);
    const middleWidth = widths && (widths[0] + widths[1]) / 2;

    // A rectangle is drawn as its own outline and a triangle filled in, and which of the two a relation is can only be said here:.
    const hollow = !!widths && !widths.includes(0);

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
