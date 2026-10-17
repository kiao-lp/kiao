/**
 * Pure arithmetic behind drag-to-reorder. Kept apart from the hook so the interesting part —
 * where a row lands — is testable without a pointer.
 *
 * Two indexings meet here and must not be confused:
 *  - a *row index*, `0 … count - 1`, names a row;
 *  - a *slot*, `0 … count`, names the gap the insertion line is drawn in — slot `i` is the gap
 *    above row `i`, slot `count` the gap below the last row.
 */

/** Moves the item at `from` to index `to`, both read on the list as it stands. */
export const moveInArray = <T>(list: T[], from: number, to: number): T[] => {
    if (from === to) return list;
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

/**
 * The index the row dragged from `from` ends up at when dropped in `slot`.
 *
 * Dropping below its own position closes the gap the row leaves behind, so every slot past it
 * counts one less — which is also why slots `from` and `from + 1` both mean "stay put".
 */
export const indexForSlot = (from: number, slot: number): number => (slot > from ? slot - 1 : slot);

/** Top and bottom of a row, in viewport coordinates. */
export interface RowBounds {
    top: number;
    bottom: number;
}

/**
 * The slot a pointer at `y` is in: the first row whose middle it has not passed yet, or the gap
 * below the last row. Rows are read in list order, so the halves of neighbouring rows meet exactly
 * at the gap they share and no vertical position is ambiguous.
 */
export const slotAt = (y: number, rows: (RowBounds | null)[]): number => {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        if (y < (row.top + row.bottom) / 2) return i;
    }
    return rows.length;
};
