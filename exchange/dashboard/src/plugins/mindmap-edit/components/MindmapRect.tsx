import React, { createRef, MouseEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, WheelEvent } from 'react';
import classNames from 'classnames';


import { useFileBrowsingPersistenceContext, useSelectionContext, Selectable, useElementSelection } from '@cms-core';
import { boundsEqual, extractSize, HEIGHT, LEFT, TOP, WIDTH } from '../lib/geom2d';
import { drawnSize, RESIZE_EDGES, ResizeEdge, resizedAroundCentre, resizedByEdge } from '../lib/note-resize';
import { Pointable } from 'react-advanced-interactions';

import { useMindmapStateContext, useMindmapMode } from '../state';
import { useMindmapDragAndDropContext } from './MindmapDragAndDrop';
import { useRelationDragContext } from './RelationDrag-ctx';
import { useNoteFileDrop } from '../hooks/useDroppedFiles';
import { AutoDimension, MindmapRect, instanceOfMindmapRect } from '../model';

interface MindmapRectCmpProps extends MindmapRect {
    children?: React.ReactNode;
}

/** Widest an auto-sized rect may grow: past that its content wraps instead of pushing the rect further. */
export const AUTO_WIDTH_LIMIT = 400;

const autoWidthLimit = (userWidth: AutoDimension) => userWidth ? undefined : AUTO_WIDTH_LIMIT;

const useMindmapRectClassNames = () => {
    return useMemo(() => classNames({
        floating: true,
        "mindmap-rect": true,
        "pointed-background": true,
    }), []);
};

const stopEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
};


export const MindmapRectCmpEditable: React.FC<MindmapRectCmpProps> = ({
    children, bounds, userBounds, id, zIndex, group
}) => {
    const { selected, select, addToSelection, deselect } = useElementSelection(id, false);
    const { patchElement, saveMindmap, selectElements, zoom } = useMindmapStateContext();
    const [selection, setSelection] = useSelectionContext();
    const { onElementDown, onElementUp } = useMindmapDragAndDropContext();
    const { from: relationPulledFrom, pullFrom, dropOnNote } = useRelationDragContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    const { dropping, dropProps } = useNoteFileDrop(id);

    const rootDiv = createRef<HTMLDivElement>();

    const measureRealBounds = useCallback(() => {
        const boundingClientRect = rootDiv.current?.getBoundingClientRect();
        if (boundingClientRect) {
            const { x, y, width, height } = boundingClientRect;
            return [x, y, Math.round(width / zoom), Math.round(height / zoom)];
        }
        return undefined;
    }, [rootDiv, zoom]);

    useEffect(() => {
        const realBounds = measureRealBounds();
        if (realBounds) {
            const targetBounds = [userBounds[0], userBounds[1], ...extractSize(realBounds)];
            if (!bounds || !boundsEqual(bounds, targetBounds)) {
                patchElement<MindmapRect>('notes', id, { bounds: targetBounds });
                saveMindmap();
            }
        }
    }, [measureRealBounds, bounds, patchElement, id, userBounds, currentFile, saveMindmap, zoom]);


    const currentSize = useCallback(
        () => drawnSize(userBounds, bounds ?? measureRealBounds()),
        [userBounds, bounds, measureRealBounds]);

    const onWheel = useCallback((event: WheelEvent) => {
        event.stopPropagation();
        const drawn = currentSize();
        if (!drawn) return;

        const step = -Math.round(event.deltaY / 10);
        const next: [AutoDimension, AutoDimension] = event.shiftKey
            ? [userBounds[WIDTH], drawn[1] + step]
            : [drawn[0] + step, userBounds[HEIGHT]];

        patchElement<MindmapRect>('notes', id, { userBounds: resizedAroundCentre(userBounds, drawn, next) });
        saveMindmap();
    }, [currentSize, id, userBounds, patchElement, saveMindmap]);

    // A note picked out on its own — control-clicked, which selects without opening it — carries opposite, so the note grows or shrinks.
    const resizedEdge = useRef<ResizeEdge | null>(null);


    const mapPointOf = useCallback((event: PointerEvent): [number, number] | undefined => {
        const box = rootDiv.current?.getBoundingClientRect();
        return box && [
            userBounds[LEFT] + (event.clientX - box.left) / zoom,
            userBounds[TOP] + (event.clientY - box.top) / zoom
        ];
    }, [rootDiv, userBounds, zoom]);

    const onResizeDown = useCallback((edge: ResizeEdge, event: PointerEvent) => {
        stopEvent(event);
        resizedEdge.current = edge;
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }, []);

    const onResizeMove = useCallback((event: PointerEvent) => {
        const edge = resizedEdge.current;
        if (!edge) return;
        // a pointer capture that never took.
        if (event.buttons === 0) {
            resizedEdge.current = null;
            return;
        }
        stopEvent(event);

        const drawn = currentSize();
        const pointer = mapPointOf(event);
        if (!drawn || !pointer) return;

        patchElement<MindmapRect>('notes', id, { userBounds: resizedByEdge(userBounds, drawn, edge, pointer) });
    }, [currentSize, mapPointOf, id, userBounds, patchElement]);

    // Every move has already moved the note; letting go is only what puts the last of it on disk.
    const onResizeUp = useCallback((event: PointerEvent) => {
        if (!resizedEdge.current) return;
        stopEvent(event);
        resizedEdge.current = null;
        saveMindmap();
    }, [saveMindmap]);

    const onMouseDown = useCallback((event: MouseEvent) => {
        stopEvent(event);

        if (event.button === 2) return;

        if (event.shiftKey) {
            pullFrom(id);
            return;
        }

        const selectWithGroup = () => {
            if (group) {
                const groupMembers = selectElements((el) =>
                    instanceOfMindmapRect(el) && (el as MindmapRect).group === group
                ).map(el => el.id);
                setSelection(groupMembers);
            } else {
                select();
            }
        };

        const addToSelectionWithGroup = () => {
            if (group) {
                const groupMembers = selectElements((el) =>
                    instanceOfMindmapRect(el) && (el as MindmapRect).group === group
                ).map(el => el.id);
                setSelection(prev => Array.from(new Set([...prev, ...groupMembers])));
            } else {
                addToSelection();
            }
        };

        if (event.ctrlKey) {
            if (selected) {
                deselect();
            } else {
                addToSelectionWithGroup();
            }
        } else {
            if (!selected) {
                selectWithGroup();
            }
        }

        if (!event.ctrlKey) {
            onElementDown();
        }
    }, [addToSelection, select, onElementDown, selected, deselect, group, selectElements, setSelection, pullFrom, id]);

    const onMouseUp = useCallback((event: MouseEvent) => {
        stopEvent(event);

        if (event.button === 2) return;

        if (relationPulledFrom) {
            dropOnNote(id);
            return;
        }

        onElementUp();
    }, [onElementUp, relationPulledFrom, dropOnNote, id]);

    const [userLeft, userTop, userWidth, userHeight] = userBounds;
    const classes = useMindmapRectClassNames();

    // Only when this note is the whole of the selection: a handle says which note it resizes by
    const resizable = selected && selection.length === 1;

    return (
        <div
            ref={rootDiv}
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onClick={stopEvent}
            {...dropProps}
            className={classNames(classes, { 'file-drop-target': dropping })}
            style={{
                left: userLeft, top: userTop, width: userWidth ?? undefined, height: userHeight ?? undefined,
                maxWidth: autoWidthLimit(userWidth),
                zIndex,
            }}
        >
            <div style={{ pointerEvents: 'none' }}>
                {children}
            </div>
            {resizable && RESIZE_EDGES.map(edge => (
                <div
                    key={edge}
                    data-resize-edge={edge}
                    className={`mindmap-note-resize mindmap-note-resize-${edge}`}
                    onPointerDown={event => onResizeDown(edge, event)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeUp}
                    onPointerCancel={onResizeUp}
                    /* The note's own press is what selects it and starts a drag, and the map's
                       what makes a note where a touch is held: a press on a handle is neither. */
                    onMouseDown={stopEvent}
                    onMouseUp={stopEvent}
                    onClick={stopEvent}
                    onTouchStart={event => event.stopPropagation()}
                />
            ))}
        </div>
    );
};

export const MindmapRectCmpEdited: React.FC<MindmapRectCmpProps> = ({
    children, bounds, userBounds, zIndex
}) => {
    const [userLeft, userTop, userWidth, userHeight] = userBounds;
    const classes = useMindmapRectClassNames();

    return (
        <div
            onClick={stopEvent}
            className={classes}
            style={{
                left: userLeft, top: userTop, width: userWidth ?? undefined, height: userHeight ?? undefined,
                maxWidth: autoWidthLimit(userWidth),
                minWidth: !userWidth ? bounds && Math.min(bounds[WIDTH], AUTO_WIDTH_LIMIT) : undefined,
                minHeight: !userHeight ? bounds && bounds[HEIGHT] : undefined,
                zIndex,
            }}
        >
            {children}
        </div>
    );
};

export const MindmapRectCmpInert: React.FC<MindmapRectCmpProps> = ({
    children, userBounds, zIndex
}) => {
    const [userLeft, userTop, userWidth, userHeight] = userBounds;
    const classes = useMindmapRectClassNames();

    return (
        <div
            onMouseDown={event => event.stopPropagation()}
            onMouseUp={event => event.stopPropagation()}
            className={classes}
            style={{
                left: userLeft, top: userTop, width: userWidth ?? undefined, height: userHeight ?? undefined,
                maxWidth: autoWidthLimit(userWidth),
                zIndex,
            }}
        >
            {children}
        </div>
    );
};


export const MindmapRectCmp: React.FC<MindmapRectCmpProps> = React.memo(({ children, ...element }) => {
    const { id } = element;
    const [mode] = useMindmapMode();
    const [selection] = useSelectionContext();

    const selected = selection.includes(id);
    const isEdited = selected && mode === 'EDIT_MODIFY_ELEMENT';

    let StateComponent: React.FC<MindmapRectCmpProps>;
    switch (mode) {
        case "VISUALIZE":
            StateComponent = MindmapRectCmpInert;
            break;
        default:
            StateComponent = isEdited ? MindmapRectCmpEdited : MindmapRectCmpEditable;
    }

    return <Pointable id={id}>
        <Selectable id={id} >
            <StateComponent {...element}>{children}</StateComponent>
        </Selectable>
    </Pointable>
});
