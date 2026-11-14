import React, { MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import classnames from 'classnames';
import { Dropdown } from 'antd';

import { KEEP_MENU_IN_VIEWPORT, useFileBrowsingPersistenceContext, useSelectionContext } from '@kiao-dashboard-core';
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
import { useMouseOverViewport } from '@kiao-dashboard-core';
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

    const { isMouseOverViewport, onMouseEnter, onMouseLeave } = useMouseOverViewport();
    useWheelZoom(divRef, zoom, setZoom);
    useKeyboardZoom(isMouseOverViewport, zoom, setZoom);

    const mindmapLocation = useCallback((clientX: number, clientY: number) => {
        const rect = divRef?.current?.getBoundingClientRect();
        return rect ? [(clientX - rect.left) / zoom, (clientY - rect.top) / zoom] : null;
    }, [divRef, zoom]);

    const dropLocation = useCallback(
        (event: React.DragEvent) => mindmapLocation(event.clientX, event.clientY),
        [mindmapLocation]);
    const fileDropProps = useMapFileDrop(dropLocation);

    // Where the relation being pulled has got to, and out of which note. every note, and named by its note so that a spent draft cannot.
    const [relationDraft, setRelationDraft] = useState<{ from: string, to: number[] } | null>(null);

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
                // We can't easily check elements here without raycasting or similar If I touch a note, I might be selecting it.
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

    const editedBeforeClick = useRef(false);

    const [menuTarget, setMenuTarget] = useState<string | null>(null);
    const { items: menuItems, selectedKeys: menuSelectedKeys } = useMindmapMenuItems(menuTarget);
    const findRelationEnd = useFindRelationEnd();

    const onMindmapDown = useCallback((e: MouseEvent) => {
        if (e.button === 2) return;
        if (e.detail <= 1) {
            editedBeforeClick.current = mode !== 'VISUALIZE';
        }
        if (mode !== 'EDIT') {
            setMode('EDIT');
        }
        if (!(e.ctrlKey || e.metaKey)) {
            setSelection([]);
        }
        if (divRef?.current) {
            const rect = divRef.current.getBoundingClientRect();
            startSelection(e, rect, selection);
        }
    }, [mode, setMode, divRef, startSelection, selection, setSelection]);

    const onMindmapClick = useCallback(() => {
    }, []);

    const onMindmapDoubleClick = useCallback((e: MouseEvent) => {
        if (!editedBeforeClick.current || pointedElement) return;

        const location = mindmapLocation(e.clientX, e.clientY);
        if (location) createNote(undefined, location);
    }, [pointedElement, mindmapLocation, createNote]);

    const localOnMindmapMove = useCallback((mouseEvent: MouseEvent) => {
        onMindmapMove(mouseEvent);
        onTrackedMouseEvent(mouseEvent);

        if (relationPulledFrom) {
            const at = mindmapLocation(mouseEvent.clientX, mouseEvent.clientY);
            if (at) setRelationDraft({ from: relationPulledFrom, to: at });
        }

        if (isBoxSelecting && divRef?.current) {
            const rect = divRef.current.getBoundingClientRect();
            updateSelection(mouseEvent, rect);
        }
    }, [onTrackedMouseEvent, onMindmapMove, isBoxSelecting, divRef, updateSelection, relationPulledFrom, mindmapLocation]);

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
