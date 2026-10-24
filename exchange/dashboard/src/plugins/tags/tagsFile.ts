/**
 * `kiao-user-config/tags.json` is an optional array of { label, color }; absent means empty.
 * Documents store label strings, not IDs. Unknown labels remain valid and render grey.
 * Renaming an entry does not update documents carrying its old label.
 */

import { inkFor, isHexColor } from '@cms-kit/color';

export const TAGS_PATH = 'kiao-user-config/tags.json';

export interface Tag {
    /** Label identity is case-insensitive; stored labels are trimmed and nonempty. */
    label: string;
    /** Hex chip fill; text contrast is computed by `paintOf`. */
    color: string;
}

/** Grey distinguishes unknown labels from the named palette. */
export const UNKNOWN_TAG_COLOR = '#6b7280';

/**
 * Colour-blind categorical palette shared with the activity log.
 * Chips compute their own ink, so one shade per hue works in both themes.
 */
export const TAG_PALETTE = [
    '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767',
] as const;

export interface TagPaint {
    fill: string;
    ink: string;
}

export const paintOf = (color: string): TagPaint => {
    const fill = isHexColor(color) ? color : UNKNOWN_TAG_COLOR;
    return { fill, ink: inkFor(fill) };
};

/** Trim and collapse whitespace before storing or comparing labels. */
export const normalizeLabel = (label: string): string => label.trim().replace(/\s+/g, ' ');

/**
 * Accept hand-written input: skip invalid/empty entries and case-insensitive duplicates
 * (first spelling wins); invalid colours fall back to grey.
 */
export const readTags = (raw: unknown): Tag[] => {
    if (!Array.isArray(raw)) return [];
    const tags: Tag[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const source = entry as Record<string, unknown>;
        const label = normalizeLabel(typeof source.label === 'string' ? source.label : '');
        if (!label || seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        const color = typeof source.color === 'string' ? source.color.trim() : '';
        tags.push({ label, color: isHexColor(color) ? color.toLowerCase() : UNKNOWN_TAG_COLOR });
    }
    return tags;
};

export const writeTags = (tags: Tag[]): unknown =>
    tags.map(tag => ({ label: tag.label, color: tag.color }));

export const tagsFileText = (tags: Tag[]): string => `${JSON.stringify(writeTags(tags), null, 2)}\n`;

/** Case-insensitive lookup preserves the spelling chosen in the tags panel. */
export const findTag = (tags: Tag[], label: string): Tag | null => {
    const wanted = normalizeLabel(label).toLowerCase();
    return tags.find(tag => tag.label.toLowerCase() === wanted) ?? null;
};

export const paintForLabel = (tags: Tag[], label: string): TagPaint =>
    paintOf(findTag(tags, label)?.color ?? UNKNOWN_TAG_COLOR);

/** Use an unused colour, then cycle; grey is reserved for unknown labels. */
export const nextColor = (tags: Tag[]): string => {
    const taken = new Set(tags.map(tag => tag.color.toLowerCase()));
    return TAG_PALETTE.find(color => !taken.has(color)) ?? TAG_PALETTE[tags.length % TAG_PALETTE.length];
};

/** Reuse known labels case-insensitively, preserving their spelling. */
export const withTag = (tags: Tag[], label: string): { tags: Tag[]; tag: Tag } => {
    const wanted = normalizeLabel(label);
    const known = findTag(tags, wanted);
    if (known) return { tags, tag: known };
    const tag: Tag = { label: wanted, color: nextColor(tags) };
    return { tags: [...tags, tag], tag };
};
