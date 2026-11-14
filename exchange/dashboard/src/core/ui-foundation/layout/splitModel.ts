/** Parts store proportional weights; tool-bar columns store pixels. Drags redistribute only the pair. */

export const DEFAULT_PART_WEIGHT = 1;

/** Drag minimum in pixels, not a layout floor: window resizing may shrink parts below it. */
export const MIN_PART_SIZE = 80;

/** Weights by part name; absent entries use DEFAULT_PART_WEIGHT. */
export type PartWeights = Record<string, number>;

export const weightOf = (weights: PartWeights, name: string): number =>
    weights[name] ?? DEFAULT_PART_WEIGHT;

/** Adjacent parts at drag start. */
export interface DraggedPair {
    /** Screen widths in pixels, including padding and borders. */
    beforeSize: number;
    afterSize: number;
    /** Padding and borders; excluded so the handle tracks the cursor. */
    beforeExtra: number;
    afterExtra: number;

    beforeWeight: number;
    afterWeight: number;
}

/** Persist weights to three decimal places. */
const rounded = (weight: number): number => Math.round(weight * 1000) / 1000;

/** Moves the handle, preserving pair total. Narrow pairs split evenly. */
export const weightsAfterDrag = (
    pair: DraggedPair,
    delta: number,
): { before: number; after: number } => {
    const size = pair.beforeSize + pair.afterSize;
    const weight = pair.beforeWeight + pair.afterWeight;

    const shared = size - pair.beforeExtra - pair.afterExtra;
    if (shared <= 0 || weight <= 0) return { before: pair.beforeWeight, after: pair.afterWeight };

    const smallest = Math.min(MIN_PART_SIZE, size / 2);
    const dragged = Math.max(smallest, Math.min(size - smallest, pair.beforeSize + delta));
    const share = Math.max(0, Math.min(shared, dragged - pair.beforeExtra));
    const before = rounded((weight * share) / shared);
    return { before, after: rounded(weight - before) };
};
