/** A card's resized dimensions in canvas pixels; an absent height keeps the natural one. */

export interface FlowNodeSize {
    w: number;
    h?: number;
}

const round = (value: number): number => Math.round(value);

/** Invalid or missing dimensions mean the type's default; valid sizes round to whole pixels. */
export const readSize = (raw: unknown): FlowNodeSize | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { w, h } = raw as Record<string, unknown>;
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) return null;
    const size: FlowNodeSize = { w: round(w) };
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) size.h = round(h);
    return size;
};

export const writeSize = (size: FlowNodeSize): FlowNodeSize => ({
    w: round(size.w),
    ...(size.h === undefined ? {} : { h: round(size.h) }),
});
