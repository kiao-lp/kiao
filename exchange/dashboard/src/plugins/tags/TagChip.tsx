import React from 'react';
import { paintOf, Tag, UNKNOWN_TAG_COLOR } from './tagsFile';
import { useTags } from './Tags-ctx';
import styles from './Tags.module.css';

// Tag pill: word on its colour; ink from @kiao-dashboard-kit/color.
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
