import React, { useEffect, useState } from 'react';
import { Button, ColorPicker, Input, Popconfirm, Spin } from 'antd';
import { Tooltip } from '@cms-core';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { ReorderHandle, type Reorderable, useReorderable } from '@cms-kit/reorder';
import { useTags } from './Tags-ctx';
import { normalizeLabel, paintOf, TAG_PALETTE, Tag } from './tagsFile';
import styles from './Tags.module.css';

export const RENAME_HELP = 'The word it is. Renaming renames the entry; cards holding the old word '
    + 'keep it and go grey. A tag is the word, not an id.';

export const COLOR_HELP = 'Its chip colour. The word is black or white, whichever reads on it, so every '
    + 'colour stays legible.';

/** The eight the picker offers first: the store's own palette, before the whole spectrum. */
const PRESETS = [{ label: 'Palette', colors: [...TAG_PALETTE] }];

/** One tag: the grip it is dragged by, its colour, its word, and the way out of the list. */
const TagRow: React.FC<{
    tag: Tag;
    index: number;
    reorder: Reorderable;
    onRename: (label: string) => boolean;
    onRecolor: (color: string) => void;
    onRemove: () => void;
}> = ({ tag, index, reorder, onRename, onRecolor, onRemove }) => {
    // Held while it is typed, so a word on its way to being another word is not written as each of
    // the words it passes through — and an emptied box is not a tag with no name.
    const [label, setLabel] = useState(tag.label);
    useEffect(() => { setLabel(tag.label); }, [tag.label]);

    /**
     * The word as it stands is written, or the box is put back: emptied, unchanged, or a word the
     * list already holds elsewhere — which would be the same tag twice — all leave the tag as it
     * was, and a box left showing a word the file does not hold would be a lie about the list.
     */
    const commit = () => {
        const wanted = normalizeLabel(label);
        if (!wanted || wanted === tag.label || !onRename(wanted)) setLabel(tag.label);
    };

    return (
        <div {...reorder.rowProps(index, styles.row)} data-testid="tag-row">
            <ReorderHandle {...reorder.handleProps(index)} label={`Move ${tag.label}`} />
            <Tooltip title={COLOR_HELP}>
                <ColorPicker
                    size="small"
                    disabledAlpha
                    value={paintOf(tag.color).fill}
                    presets={PRESETS}
                    onChangeComplete={color => onRecolor(color.toHexString())}
                    aria-label={`Colour of ${tag.label}`}
                    data-testid="tag-color"
                />
            </Tooltip>
            <Tooltip title={RENAME_HELP}>
                <Input
                    size="small"
                    className={styles.rowLabel}
                    value={label}
                    aria-label={`Name of ${tag.label}`}
                    data-testid="tag-label"
                    onChange={event => setLabel(event.target.value)}
                    onBlur={commit}
                    onPressEnter={commit}
                />
            </Tooltip>
            <Popconfirm
                title="Delete this tag?"
                description="The cards carrying the word keep it, and lose its colour."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={onRemove}
            >
                <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`Delete ${tag.label}`}
                    data-testid="delete-tag"
                />
            </Popconfirm>
        </div>
    );
};

/**
 * The tags of the store: the whole list, in the order the file holds them, each with its colour and
 * its word.
 *
 * It is the one place a tag is **coloured, renamed, reordered and thrown away** — it is not where
 * most of them are made. A word typed into a document's own tag picker is added here on the spot,
 * because a tag that had to be declared before it could be used is a tag nobody declares; this
 * panel is what the list is then kept in order from.
 *
 * There is no Save button, as everywhere else in this CMS: every change is a write to
 * `kiao-user-config/tags.json`, debounced. And there is a **refresh**, for the same reason the
 * bookmarks panel has one — the file is an ordinary store file, committed with the rest and one
 * click away as JSON, so what was written there wins.
 */
export const TagsPanel: React.FC = () => {
    const { tags, loading, add, rename, recolor, remove, move, ensureLoaded, reload } = useTags();
    const [typed, setTyped] = useState('');

    // Read the first time the panel is looked at, not when the app starts.
    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

    const reorder = useReorderable({ count: tags.length, onMove: move });

    const addTyped = () => {
        const wanted = normalizeLabel(typed);
        if (!wanted) return;
        add(wanted);
        setTyped('');
    };

    return (
        <div className={styles.panel} data-testid="tags-panel">
            <div className={styles.header}>
                <Input
                    size="small"
                    className={styles.newTag}
                    value={typed}
                    placeholder="New tag"
                    aria-label="New tag"
                    data-testid="new-tag"
                    onChange={event => setTyped(event.target.value)}
                    onPressEnter={addTyped}
                />
                <Tooltip title="Add this tag">
                    <Button
                        size="small"
                        type="text"
                        icon={<PlusOutlined />}
                        aria-label="Add tag"
                        data-testid="add-tag"
                        onClick={addTyped}
                    />
                </Tooltip>
                <Tooltip title="Read the file again">
                    <Button
                        size="small"
                        type="text"
                        icon={<ReloadOutlined />}
                        aria-label="Refresh tags"
                        onClick={reload}
                    />
                </Tooltip>
            </div>
            {loading ? (
                <div className={styles.center}><Spin size="small" /></div>
            ) : tags.length === 0 ? (
                <div className={styles.hint}>
                    No tags yet. Name one here, or type one straight onto a flow node — either way it is
                    written to <code>kiao-user-config/tags.json</code>.
                </div>
            ) : (
                <div className={styles.list}>
                    {tags.map((tag, index) => (
                        <TagRow
                            key={tag.label}
                            tag={tag}
                            index={index}
                            reorder={reorder}
                            onRename={label => rename(index, label)}
                            onRecolor={color => recolor(index, color)}
                            onRemove={() => remove(index)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
