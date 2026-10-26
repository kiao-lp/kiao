/** An absent spot means never placed; the view assigns an initial position. */

/** Canvas pixels right and down from the top left, persisted on the card. */
export interface FlowNodeSpot {
    x: number;
    y: number;
}

const round = (value: number): number => Math.round(value);

/** Invalid or missing coordinates mean unplaced; valid coordinates round to whole pixels. */
export const readSpot = (raw: unknown): FlowNodeSpot | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { x, y } = raw as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: round(x), y: round(y) };
};

export const writeSpot = (spot: FlowNodeSpot): unknown => ({ x: round(spot.x), y: round(spot.y) });

export const spotAt = (x: number, y: number): FlowNodeSpot =>
    ({ x: round(Math.max(0, x)), y: round(Math.max(0, y)) });

export const sameSpot = (a: FlowNodeSpot | null, b: FlowNodeSpot | null): boolean =>
    (a === null || b === null ? a === b : a.x === b.x && a.y === b.y);
