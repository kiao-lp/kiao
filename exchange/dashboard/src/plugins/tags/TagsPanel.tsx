import React, { useEffect, useState } from 'react';
import { ColorPicker, Input } from 'antd';
import { AsyncList, CommitInput, IconButton, ReorderableList, Tooltip, useConfirmation } from '@kiao-dashboard-core';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTags } from './Tags-ctx';
import { normalizeLabel, paintOf, TAG_PALETTE, Tag } from './tagsFile';
import styles from './Tags.module.css';

export const RENAME_HELP = 'Renames this entry; documents keep the old word and lose its colour.';

/** The eight the picker offers first: the store's own palette, before the whole spectrum. */
const PRESETS = [{ label: 'Palette', colors: [...TAG_PALETTE] }];

const TagFields: React.FC<{
    tag: Tag;
    onRename: (label: string) => void;
    onRecolor: (color: string) => void;
    onRemove: () => void;
}> = ({ tag, onRename, onRecolor, onRemove }) => {
    const confirm = useConfirmation();

    return (
        <>
            <ColorPicker
                size="small"
                disabledAlpha
                value={paintOf(tag.color).fill}
                presets={PRESETS}
                onChangeComplete={color => onRecolor(color.toHexString())}
                aria-label={`Colour of ${tag.label}`}
                data-testid="tag-color"
            />
            <Tooltip title={RENAME_HELP}>
                <CommitInput
                    className={styles.rowLabel}
                    value={tag.label}
                    aria-label={`Name of ${tag.label}`}
                    data-testid="tag-label"
                    onCommit={value => {
                        const label = normalizeLabel(value);
                        if (label && label !== tag.label) onRename(label);
                    }}
                />
            </Tooltip>
            <IconButton
                label={`Delete ${tag.label}`}
                danger
                icon={<DeleteOutlined />}
                data-testid="delete-tag"
                onClick={() => confirm({
                    title: `Delete tag “${tag.label}”?`,
                    description: 'The cards carrying the word keep it, and lose its colour.',
                    onConfirm: onRemove,
                })}
            />
        </>
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
                <IconButton label="Add tag" icon={<PlusOutlined />} data-testid="add-tag" onClick={addTyped} />
                <IconButton label="Refresh tags" icon={<ReloadOutlined />} onClick={reload} />
            </div>
            <AsyncList loading={loading} empty={!tags.length && <>
                No tags yet. Name one here, or type one straight onto a flow node — either way it is
                written to <code>kiao-user-config/tags.json</code>.
            </>}>
                <ReorderableList
                    items={tags}
                    itemKey={tag => tag.label}
                    onMove={move}
                    className={styles.list}
                    rowProps={{ className: styles.row, 'data-testid': 'tag-row' }}
                    handleLabel={tag => `Move ${tag.label}`}
                >
                    {(tag, index, handle) => <>
                        {handle}
                        <TagFields
                            tag={tag}
                            onRename={label => rename(index, label)}
                            onRecolor={color => recolor(index, color)}
                            onRemove={() => remove(index)}
                        />
                    </>}
                </ReorderableList>
            </AsyncList>
        </div>
    );
};
