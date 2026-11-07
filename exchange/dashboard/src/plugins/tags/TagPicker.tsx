import React, { useMemo } from 'react';
import { Select } from 'antd';
import { Tooltip } from '@cms-core';
import { normalizeLabel, paintOf, UNKNOWN_TAG_COLOR } from './tagsFile';
import { useTags } from './Tags-ctx';
import styles from './Tags.module.css';

export const TAGS_HELP = 'Its tags. The store\u2019s are offered; a typed word joins them with the first '
    + 'free colour. A tag is the word, so it travels with a copied card.';

interface TagPickerProps {
    /** The words carried now, in the order they are carried. */
    value: string[];
    onChange: (next: string[]) => void;
    /** Where the picker is: a tool bar's width, or a row of the large editor. */
    className?: string;
    'aria-label'?: string;
    'data-testid'?: string;
}

/**
 * The tags of whatever is open, picked from the store's and added to it.
 *
 * **A word typed here joins the store's tags.** The alternative — offering only what the panel has
 * already been used to write — makes tagging a two-step errand through another tool bar, which is
 * how a store ends up with no tags at all. So the picker is the ordinary way one is made, and the
 * panel is where they are then coloured, reordered and thrown away.
 *
 * What it writes is the **words**, which is what the document holds: there is no id to look up
 * here and none to be missing at the other end. See [tagsFile](./tagsFile.ts).
 */
export const TagPicker: React.FC<TagPickerProps> = ({
    value, onChange, className, 'aria-label': ariaLabel = 'Tags', 'data-testid': testId = 'tag-picker',
}) => {
    const { tags, add, ensureLoaded } = useTags();

    // The list is read the first time a picker is drawn, not when the app starts.
    React.useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

    const options = useMemo(() => tags.map(tag => ({
        value: tag.label,
        label: (
            <span className={styles.option}>
                <span className={styles.swatch} style={{ background: paintOf(tag.color).fill }} />
                {tag.label}
            </span>
        ),
    })), [tags]);

    return (
        <Tooltip title={TAGS_HELP}>
            <Select
                size="small"
                mode="tags"
                className={className}
                value={value}
                options={options}
                placeholder="Tags"
                aria-label={ariaLabel}
                data-testid={testId}
                tokenSeparators={[',']}
                // The chip in the box wears the tag's own colour, which is the whole point of the
                // store keeping one: the picker reads like the card it writes.
                tagRender={({ label, value: word, closable, onClose }) => {
                    const known = tags.find(tag => tag.label.toLowerCase() === String(word).toLowerCase());
                    const paint = paintOf(known?.color ?? UNKNOWN_TAG_COLOR);
                    return (
                        <span
                            className={styles.chip}
                            style={{ background: paint.fill, color: paint.ink, marginInlineEnd: 4 }}
                        >
                            {typeof label === 'string' ? label : String(word)}
                            {closable && (
                                <button
                                    type="button"
                                    className={styles.chipClose}
                                    style={{ color: paint.ink }}
                                    aria-label={`Remove ${String(word)}`}
                                    onMouseDown={event => event.preventDefault()}
                                    onClick={onClose}
                                >
                                    ×
                                </button>
                            )}
                        </span>
                    );
                }}
                onChange={(next: string[]) => {
                    // Trimmed, de-duplicated, and every new word filed in the store's own list —
                    // typing a tag is the ordinary way one is made.
                    const words: string[] = [];
                    for (const raw of next) {
                        const word = normalizeLabel(raw);
                        if (!word || words.some(held => held.toLowerCase() === word.toLowerCase())) continue;
                        words.push(add(word).label);
                    }
                    onChange(words);
                }}
            />
        </Tooltip>
    );
};
