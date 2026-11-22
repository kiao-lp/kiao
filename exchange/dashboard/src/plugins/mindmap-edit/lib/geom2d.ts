
export type Bounds = number[];

export const LEFT = 0;
export const TOP = 1;
export const WIDTH = 2;
export const HEIGHT = 3;

export const locationEqual = (boundsA: Bounds, boundsB: Bounds) => boundsA[LEFT] === boundsB[LEFT] && boundsA[TOP] === boundsB[TOP];

export const sizeEqual = (boundsA: Bounds, boundsB: Bounds) => boundsA[WIDTH] === boundsB[WIDTH] && boundsA[HEIGHT] === boundsB[HEIGHT];

export const boundsEqual = (boundsA: Bounds, boundsB: Bounds) => locationEqual(boundsA, boundsB) && sizeEqual(boundsA, boundsB);

export const extractSize = (bounds: Bounds) => [bounds[WIDTH], bounds[HEIGHT]];

export const extractLocation = (bounds: Bounds) => [bounds[LEFT], bounds[TOP]];

export const flatLineCoordsDegRotation = (aX: number, aY: number, bX: number, bY: number): number => {
    const rad = Math.atan2(0, -1) - Math.atan2(bX - aX, bY - aY);
    return (rad / Math.PI * 180.0 + 360) % 360;
}

export const flatLineCoordsLength = (aX: number, aY: number, bX: number, bY: number): number => {
    return Math.sqrt(Math.pow(bX - aX, 2) + Math.pow(bY - aY, 2));
}
