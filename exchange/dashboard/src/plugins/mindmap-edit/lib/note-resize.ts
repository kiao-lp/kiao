import { AutoDimension, UserBounds } from '../model';
import { Bounds, HEIGHT, LEFT, TOP, WIDTH } from './geom2d';

/** The smallest a note may be made. */
export const MIN_NOTE_SIZE = 24;

/** The four sides of a note's rectangle, each of which is a handle it can be resized by. */
export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom';

/** In the order they are drawn — a corner being where two of the four strips overlap. */
export const RESIZE_EDGES: ResizeEdge[] = ['left', 'right', 'top', 'bottom'];

/** Whether dragging that edge says how wide the note is, or how high. */
export const isHorizontalResize = (edge: ResizeEdge) => edge === 'left' || edge === 'right';

/** How big the note is drawn, in map pixels: the size it was given, or — for a dimension left to grow. */
export const drawnSize = (userBounds: UserBounds, measured?: Bounds): [number, number] | undefined => {
    const width = userBounds[WIDTH] ?? measured?.[WIDTH];
    const height = userBounds[HEIGHT] ?? measured?.[HEIGHT];
    return width === undefined || height === undefined ? undefined : [width, height];
};

/** The middle of the note as it is drawn — the point a resize has to leave where it is. */
export const centreOf = (userBounds: UserBounds, drawn: [number, number]): [number, number] =>
    [userBounds[LEFT] + drawn[0] / 2, userBounds[TOP] + drawn[1] / 2];

/** The note resized to `next`, about its own middle. */
export const resizedAroundCentre = (
    userBounds: UserBounds, drawn: [number, number], next: [AutoDimension, AutoDimension]
): UserBounds => {
    const [centreX, centreY] = centreOf(userBounds, drawn);
    const width = next[0] === null ? null : Math.max(MIN_NOTE_SIZE, Math.round(next[0]));
    const height = next[1] === null ? null : Math.max(MIN_NOTE_SIZE, Math.round(next[1]));
    return [
        width === null ? userBounds[LEFT] : centreX - width / 2,
        height === null ? userBounds[TOP] : centreY - height / 2,
        width,
        height
    ];
};

/** The note resized by one of its edges being dragged to `pointer`, both in map pixels. */
export const resizedByEdge = (
    userBounds: UserBounds, drawn: [number, number], edge: ResizeEdge, pointer: [number, number]
): UserBounds => {
    const [centreX, centreY] = centreOf(userBounds, drawn);
    const next: [AutoDimension, AutoDimension] = isHorizontalResize(edge)
        ? [2 * (edge === 'right' ? pointer[0] - centreX : centreX - pointer[0]), userBounds[HEIGHT]]
        : [userBounds[WIDTH], 2 * (edge === 'bottom' ? pointer[1] - centreY : centreY - pointer[1])];
    return resizedAroundCentre(userBounds, drawn, next);
};
