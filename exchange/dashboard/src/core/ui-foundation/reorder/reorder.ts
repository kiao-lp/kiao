/** Row indexes are `0 … count - 1`. Slots are `0 … count`; slot `i` is the gap above row `i`. */

/** Moves the item at `from` to index `to`, both read on the list as it stands. */
export const moveInArray = <T>(list: T[], from: number, to: number): T[] => {
    if (from === to) return list;
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
};

/** Slots past `from` count one less. Slots `from` and `from + 1` mean no move. */
export const indexForSlot = (from: number, slot: number): number => (slot > from ? slot - 1 : slot);

export interface RowBounds {
    top: number;
    bottom: number;
}

/** First row whose middle is below `y`, or `rows.length`. */
export const slotAt = (y: number, rows: (RowBounds | null)[]): number => {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        if (y < (row.top + row.bottom) / 2) return i;
    }
    return rows.length;
};
