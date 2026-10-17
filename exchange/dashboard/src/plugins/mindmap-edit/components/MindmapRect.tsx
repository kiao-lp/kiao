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

/**
 * Widest an auto-sized rect may grow: past that its content wraps instead of
 * pushing the rect further right. A rect resized by the user is not limited.
 */
export const AUTO_WIDTH_LIMIT = 400;

const autoWidthLimit = (userWidth: AutoDimension) => userWidth ? undefined : AUTO_WIDTH_LIMIT;

/* No `selected-background`: a selected note keeps the background its style gives it and
   is ringed by an outline instead (see `.mindmap .selected .mindmap-rect` in styles.css). */
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

// === Subcomponents ===

export const MindmapRectCmpEditable: React.FC<MindmapRectCmpProps> = ({
    children, bounds, userBounds, id, zIndex, group
}) => {
    const { selected, select, addToSelection, deselect } = useElementSelection(id, false);
    const { patchElement, saveMindmap, selectElements, zoom } = useMindmapStateContext();
    const [selection, setSelection] = useSelectionContext();
    const { onElementDown, onElementUp } = useMindmapDragAndDropContext();
    const { from: relationPulledFrom, pullFrom, dropOnNote } = useRelationDragContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    // A file dragged out of the file navigator and let go here is a link at the end of this note.
    const { dropping, dropProps } = useNoteFileDrop(id);

    const rootDiv = createRef<HTMLDivElement>();

    const measureRealBounds = useCallback(() => {
        const boundingClientRect = rootDiv.current?.getBoundingClientRect();
        if (boundingClientRect) {
            const { x, y, width, height } = boundingClientRect;
            // Divide by zoom since getBoundingClientRect returns visual (scaled) dimensions
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

    /**
     * How big the note is drawn right now, in map pixels: what it was given, or what it was last
     * measured at where it was given nothing. `bounds` is already free of the zoom — the measured
     * size divided by it — where the box on screen is not, which is why the size is read from
     * there and not from the DOM.
     */
    const currentSize = useCallback(
        () => drawnSize(userBounds, bounds ?? measureRealBounds()),
        [userBounds, bounds, measureRealBounds]);

    // The wheel makes the note wider, and with shift taller. It resizes about the middle, as
    // every other way of resizing does: turning the wheel is reading, and the note being read
    // should not walk off under the pointer as it grows.
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

    // === Resizing by the note's own edges ===
    //
    // A note picked out on its own — control-clicked, which selects without opening it — carries
    // a handle along each of its four sides. Dragging one moves that edge and mirrors the one
    // opposite, so the note grows or shrinks about its middle exactly as the wheel makes it. It
    // is the wheel's alternative, for the hands and the machines that have none: the pointer is
    // captured on the way down, so touch and pen drag it as a mouse does, and a hand that runs
    // off the note is still followed.
    const resizedEdge = useRef<ResizeEdge | null>(null);

    /** Where a pointer sits in the map's own coordinates, read off this note's own box. */
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
        // Nothing held down any more is a drag that ended where this handle was not told of it —
        // a pointer capture that never took. Without this the note would go on being resized by
        // a pointer merely crossing its edge afterwards.
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

        // Shift makes the drag pull a relation out of the note instead of moving it: the note
        // stays where it is, and neither the selection nor the mode is touched.
        if (event.shiftKey) {
            pullFrom(id);
            return;
        }

        // Helper to select this element plus all elements in the same group
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

        // Helper to add this element plus group members to selection
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
                deselect(); // Individual deselection still works
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

        // A relation being pulled lands here: it is this note it reaches, and no drag ends.
        if (relationPulledFrom) {
            dropOnNote(id);
            return;
        }

        onElementUp();
    }, [onElementUp, relationPulledFrom, dropOnNote, id]);

    const [userLeft, userTop, userWidth, userHeight] = userBounds;
    const classes = useMindmapRectClassNames();

    // Only when this note is the whole of the selection: a handle says which note it resizes by
    // sitting on it, and several notes ringed at once have no one edge to say that of.
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

// === Main Component ===

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
