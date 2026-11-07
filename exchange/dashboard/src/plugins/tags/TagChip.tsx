import React from 'react';
import { paintOf, Tag, UNKNOWN_TAG_COLOR } from './tagsFile';
import { useTags } from './Tags-ctx';
import styles from './Tags.module.css';

/**
 * One tag, as it is worn: its word on its colour.
 *
 * A filled pill rather than a coloured dot beside black text, because a tag is read at a glance on
 * a card among other cards and a colour with no word is a colour nobody remembers the meaning of.
 * The ink is computed from the fill (`@cms-kit/color`), so a chip is legible whatever colour was
 * picked and in either theme — it supplies both halves of its own contrast and depends on nothing
 * under it.
 */
export const TagChip: React.FC<{ label: string; color: string; title?: string }> = ({
    label, color, title,
}) => {
    const paint = paintOf(color);
    const unknown = paint.fill === UNKNOWN_TAG_COLOR;
    return (
        <span
            className={styles.chip}
            style={{ background: paint.fill, color: paint.ink }}
            title={title ?? (unknown ? `${label} — not one of the store’s tags` : label)}
            data-testid="tag-chip"
            data-tag={label}
        >
            {label}
        </span>
    );
};

/**
 * The tags a document carries, in the order it carries them, each in the colour the **store** gives
 * it. A word the store has never named is still worn — in the neutral grey, saying its word: a card
 * pasted in from another instance, or written by hand, says what it says.
 */
export const TagChips: React.FC<{ labels: string[]; className?: string }> = ({ labels, className }) => {
    const { tags, ensureLoaded } = useTags();
    React.useEffect(() => { if (labels.length) ensureLoaded(); }, [labels.length, ensureLoaded]);
    if (!labels.length) return null;
    return (
        <div className={className ? `${styles.chips} ${className}` : styles.chips}>
            {labels.map(label => (
                <TagChip key={label} label={label} color={colorOf(tags, label)} />
            ))}
        </div>
    );
};

const colorOf = (tags: Tag[], label: string): string => {
    const wanted = label.toLowerCase();
    return tags.find(tag => tag.label.toLowerCase() === wanted)?.color ?? UNKNOWN_TAG_COLOR;
};
