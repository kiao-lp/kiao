import React, { MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import classnames from 'classnames';
import { Dropdown } from 'antd';

import { KEEP_MENU_IN_VIEWPORT, useFileBrowsingPersistenceContext, useSelectionContext } from '@cms-core';
import { usePointedElementContext, usePointedLocationTracker, withPointedLocationTracker } from 'react-advanced-interactions';

import { HEIGHT, WIDTH } from '../lib/geom2d';
import { MindmapElement, MindmapRect, Note, MindmapRelation } from '../model';
import { useMindmapStateContext, useMindmapMode } from '../state';

import { NoteCmp } from './Note';
import { MindmapRelationCmp } from './MindmapRelation';
import { useMindmapDragAndDropContext } from './MindmapDragAndDrop';
import { useRelationDragContext } from './RelationDrag-ctx';
import { RelationDraftCmp } from './RelationDraft-cmp';
import { useMindmapMenuItems } from './MindmapContextMenu';
import { useBoxSelection } from '../hooks/useBoxSelection';
import { useMouseOverViewport } from '../hooks/useMouseOverViewport';
import { useWheelZoom } from '../hooks/useWheelZoom';
import { useKeyboardZoom } from '../hooks/useKeyboardZoom';
import { useCreateNote } from '../hooks/useNote';
import { useMapFileDrop } from '../hooks/useDroppedFiles';
import { useFindRelationEnd } from '../hooks/useRelationUtils';


export const MindmapViewportCmp: React.FC<{}> = withPointedLocationTracker(() => {
    const { mindmap, setPointedLocation, zoom, setZoom } = useMindmapStateContext();
    const [mode, setMode] = useMindmapMode();
    const [selection, setSelection] = useSelectionContext();
    const [divRef, onTrackedMouseEvent, divPointedLocation] = usePointedLocationTracker();
    const [pointedElement] = usePointedElementContext();
    const { onMindmapMove, onElementUp } = useMindmapDragAndDropContext();
    const { from: relationPulledFrom, dropOnMap, cancel: cancelRelationDrag } = useRelationDragContext();
    const { isActive: isBoxSelecting, boxBounds, startSelection, updateSelection, endSelection } = useBoxSelection(setSelection, zoom);

    // Zoom-related hooks
    const { isMouseOverViewport, onMouseEnter, onMouseLeave } = useMouseOverViewport();
    useWheelZoom(divRef, zoom, setZoom);
    useKeyboardZoom(isMouseOverViewport, zoom, setZoom);

    // Where a pointer sits in the mindmap's own coordinates, the viewport being drawn zoomed.
    const mindmapLocation = useCallback((clientX: number, clientY: number) => {
        const rect = divRef?.current?.getBoundingClientRect();
        return rect ? [(clientX - rect.left) / zoom, (clientY - rect.top) / zoom] : null;
    }, [divRef, zoom]);

    // A file dragged out of the file navigator and let go on the bare map leaves a note holding a
    // link to it, over the point it was let go at. Over a note it is that note's drop, which stops
    // the event before it reaches here.
    const dropLocation = useCallback(
        (event: React.DragEvent) => mindmapLocation(event.clientX, event.clientY),
        [mindmapLocation]);
    const fileDropProps = useMapFileDrop(dropLocation);

    // Where the relation being pulled has got to, and out of which note. Kept here rather than
    // in the relation drag context so that following the pointer redraws the draft alone and not
    // every note, and named by its note so that a spent draft cannot be drawn against the next.
    const [relationDraft, setRelationDraft] = useState<{ from: string, to: number[] } | null>(null);

    // A note is created by double clicking the bare mindmap, or by a long press on a touch screen.
    const createNote = useCreateNote();
    const touchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartPos = React.useRef<{ x: number, y: number } | null>(null);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        if (mode !== 'EDIT') return;
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const location = mindmapLocation(touch.clientX, touch.clientY);

        if (location) {
            const [x, y] = location;
            touchStartPos.current = { x, y };

            touchTimer.current = setTimeout(() => {
                // Determine if we are clicking on an empty area
                // We can't easily check elements here without raycasting or similar
                // But generally the mindmap div handles background clicks.
                // If a child element stopped propagation, this wouldn't fire?
                // Actually React events bubble.
                // But let's assume if the user is long pressing on the background.
                // The requirement says "clicking inside the mindmap where there is nothing".
                // If I touch a note, I might be selecting it.
                // For now, let's implement it on the container.
                createNote(undefined, [x, y]);
                if (navigator.vibrate) navigator.vibrate(50);
                touchTimer.current = null;
            }, 500);
        }
    }, [mode, createNote, mindmapLocation]);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        if (touchTimer.current && touchStartPos.current) {
            const touch = e.touches[0];
            const location = mindmapLocation(touch.clientX, touch.clientY);
            if (location) {
                const dist = Math.sqrt(Math.pow(location[0] - touchStartPos.current.x, 2) + Math.pow(location[1] - touchStartPos.current.y, 2));
                if (dist > 10) {
                    clearTimeout(touchTimer.current);
                    touchTimer.current = null;
                }
            }
        }
    }, [mindmapLocation]);

    const onTouchEnd = useCallback(() => {
        if (touchTimer.current) {
            clearTimeout(touchTimer.current);
            touchTimer.current = null;
        }
    }, []);

    // A first click on the bare mindmap is what turns visualising into editing, so whether the
    // map was already being edited is remembered before that click has moved the mode on.
    const editedBeforeClick = useRef(false);

    // The element id a right-click landed on, captured when the menu opens — see
    // `useMindmapMenuItems` — and forgotten when it closes.
    const [menuTarget, setMenuTarget] = useState<string | null>(null);
    const { items: menuItems, selectedKeys: menuSelectedKeys } = useMindmapMenuItems(menuTarget);
    const findRelationEnd = useFindRelationEnd();

    const onMindmapDown = useCallback((e: MouseEvent) => {
        // The right button is the menu's: it neither enters editing, nor clears the selection
        // the menu is about to act on, nor starts a box selection.
        if (e.button === 2) return;
        if (e.detail <= 1) {
            editedBeforeClick.current = mode !== 'VISUALIZE';
        }
        if (mode !== 'EDIT') {
            setMode('EDIT');
        }
        // Clear selection when clicking on empty mindmap area (unless Ctrl is held for additive selection)
        if (!(e.ctrlKey || e.metaKey)) {
            setSelection([]);
        }
        // Start box selection
        if (divRef?.current) {
            const rect = divRef.current.getBoundingClientRect();
            startSelection(e, rect, selection);
        }
    }, [mode, setMode, divRef, startSelection, selection, setSelection]);

    const onMindmapClick = useCallback(() => {
        // No-op: selection is handled on mousedown
    }, []);

    // Double clicking the bare mindmap of a map being edited drops a new note over the click.
    // Over a note or a relation the double click belongs to that element, not to the map.
    const onMindmapDoubleClick = useCallback((e: MouseEvent) => {
        if (!editedBeforeClick.current || pointedElement) return;

        const location = mindmapLocation(e.clientX, e.clientY);
        if (location) createNote(undefined, location);
    }, [pointedElement, mindmapLocation, createNote]);

    const localOnMindmapMove = useCallback((mouseEvent: MouseEvent) => {
        onMindmapMove(mouseEvent);
        onTrackedMouseEvent(mouseEvent);

        // The relation being pulled follows the pointer, wherever over the map it goes.
        if (relationPulledFrom) {
            const at = mindmapLocation(mouseEvent.clientX, mouseEvent.clientY);
            if (at) setRelationDraft({ from: relationPulledFrom, to: at });
        }

        // Update box selection if active
        if (isBoxSelecting && divRef?.current) {
            const rect = divRef.current.getBoundingClientRect();
            updateSelection(mouseEvent, rect);
        }
    }, [onTrackedMouseEvent, onMindmapMove, isBoxSelecting, divRef, updateSelection, relationPulledFrom, mindmapLocation]);

    // Letting a pulled relation go over the bare map leaves a new note there, related to the one
    // it was pulled from. Over a note the drop belongs to that note, which stops the event.
    //
    // A drag ends here too. What is dragged follows the pointer on a timer, so a quick one leaves
    // it behind and the button comes up over the map rather than over the element — a relation's
    // centre especially, being the smallest thing there is to hold. Ending the drag only where it
    // started left the map stuck in EDIT_DRAG, and the movement unsaved. With no drag running,
    // `onElementUp` does nothing.
    // A right-click captures its target for the menu and, on a note or a relation, picks it
    // out where it is not already among the selection — the svg canvas's own rule. A relation's
    // end is not selectable, its menu being addressed to the end itself, so the selection is
    // left alone there. Outside EDIT mode the browser's own menu opens instead.
    const onMindmapContextMenu = useCallback((e: MouseEvent) => {
        if (mode !== 'EDIT') return;
        const at = mindmapLocation(e.clientX, e.clientY);
        if (at) setPointedLocation(at);
        setMenuTarget(pointedElement);
        if (pointedElement && !selection.includes(pointedElement) && !findRelationEnd(pointedElement)) {
            setSelection([pointedElement]);
        }
    }, [mode, mindmapLocation, setPointedLocation, pointedElement, selection, setSelection, findRelationEnd]);

    const onMenuOpenChange = useCallback((open: boolean) => {
        if (!open) setMenuTarget(null);
    }, []);

    const onMindmapUp = useCallback((e: MouseEvent) => {
        if (e.button === 2) return;
        if (relationPulledFrom) {
            setRelationDraft(null);
            const location = mindmapLocation(e.clientX, e.clientY);
            if (location) dropOnMap(location); else cancelRelationDrag();
            return;
        }
        onElementUp();
        endSelection();
    }, [endSelection, onElementUp, relationPulledFrom, mindmapLocation, dropOnMap, cancelRelationDrag]);

    // The pointer taken out of the map takes the relation with it: there is nothing out there to
    // let it go onto.
    const localOnMouseLeave = useCallback(() => {
        onMouseLeave();
        if (relationPulledFrom) {
            setRelationDraft(null);
            cancelRelationDrag();
        }
    }, [onMouseLeave, relationPulledFrom, cancelRelationDrag]);

    useEffect(() => {
        setPointedLocation(divPointedLocation);
    }, [divPointedLocation, setPointedLocation]);

    const { currentFile } = useFileBrowsingPersistenceContext();

    if (!currentFile || !mindmap) {
        return null;
    }

    let maxWidth = 0;
    let maxHeight = 0;

    mindmap.elements.notes.forEach((element: MindmapElement) => {
        const rect = element as unknown as MindmapRect;
        if (rect.userBounds) {
            const [x, y, w, h] = rect.userBounds;
            const right = x + (w ?? (rect.bounds ? rect.bounds[WIDTH] : 0));
            const bottom = y + (h ?? (rect.bounds ? rect.bounds[HEIGHT] : 0));
            if (right > maxWidth) maxWidth = right;
            if (bottom > maxHeight) maxHeight = bottom;
        }
    });




    const style = {
        minWidth: ((maxWidth + 10) * zoom) + 'px',
        minHeight: ((maxHeight + 10) * zoom) + 'px'
    };

    return (
        <Dropdown
            menu={{ items: menuItems, selectedKeys: menuSelectedKeys }}
            trigger={mode === 'EDIT' ? ['contextMenu'] : []}
            onOpenChange={onMenuOpenChange}
            {...KEEP_MENU_IN_VIEWPORT}
        >
        <div className={classnames('mindmap', {
            'mindmap-visualize': mode === 'VISUALIZE',
            'mindmap-edit': mode !== 'VISUALIZE'
        })} ref={divRef}
            onMouseDown={onMindmapDown}
            onMouseMove={localOnMindmapMove}
            onClick={onMindmapClick}
            onDoubleClick={onMindmapDoubleClick}
            onContextMenu={onMindmapContextMenu}
            onMouseUp={onMindmapUp}
            onMouseEnter={onMouseEnter}
            onMouseLeave={localOnMouseLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            {...fileDropProps}
            style={style}>
            <div className="mindmap-zoom-container" style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: `${100 / zoom}%`,
                height: `${100 / zoom}%`
            }}>
                {relationDraft && relationDraft.from === relationPulledFrom && (
                    <RelationDraftCmp from={relationDraft.from} to={relationDraft.to} />
                )}
                {mindmap.elements.relations && mindmap.elements.relations.map((mindmapElement: MindmapElement) => (
                    <MindmapRelationCmp key={mindmapElement.id} element={mindmapElement as MindmapRelation} />
                ))}
                {mindmap.elements.notes.map((mindmapElement: MindmapElement) => (
                    <NoteCmp key={mindmapElement.id} element={mindmapElement as Note} />
                ))}
                {/* Box Selection Overlay - now inside zoom container */}
                {isBoxSelecting && boxBounds && (
                    <div
                        className="box-selection-overlay"
                        style={{
                            left: boxBounds.left,
                            top: boxBounds.top,
                            width: boxBounds.width,
                            height: boxBounds.height,
                        }}
                    />
                )}
            </div>
        </div>
        </Dropdown>
    );
});
