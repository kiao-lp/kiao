import React from 'react';
import { Input, Segmented } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { Tooltip } from '../ui/Tooltip';
import { ITEM_KINDS, KIND_META, ToolboxItemKind } from './itemKinds';
import styles from './Toolbox.module.css';

/** What the list is narrowed to: one kind or all of them, and a word to look for. */
export interface ToolboxFilterValue {
    kind: ToolboxItemKind | 'all';
    query: string;
}

export const NO_FILTER: ToolboxFilterValue = { kind: 'all', query: '' };

/**
 * Whether a row survives the filter. The searched text is the row's own words — its title, the
 * sentence under it, and its id, which is what somebody who knows the catalogue types.
 */
export const matchesFilter = (
    filter: ToolboxFilterValue,
    kind: ToolboxItemKind,
    ...text: (string | undefined)[]
): boolean => {
    if (filter.kind !== 'all' && filter.kind !== kind) return false;
    const needle = filter.query.trim().toLowerCase();
    if (!needle) return true;
    return text.some(value => value?.toLowerCase().includes(needle));
};

/**
 * The bar above the list: search on the left, one chip per kind on the right.
 *
 * The chips carry the same icons the rows do, which is the whole reason they are icons and not
 * words — the filter teaches the row and the row teaches the filter, and neither needs a legend.
 * "All" stays a word because it is not a kind and should not look like one.
 */
export const ToolboxFilter: React.FC<{
    value: ToolboxFilterValue;
    onChange: (next: ToolboxFilterValue) => void;
}> = ({ value, onChange }) => (
    <div className={styles.filters} data-testid="toolbox-filter">
        <Input
            className={styles.search}
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search"
            aria-label="Search"
            value={value.query}
            onChange={event => onChange({ ...value, query: event.target.value })}
            data-testid="toolbox-search"
        />
        <Segmented
            size="small"
            value={value.kind}
            onChange={kind => onChange({ ...value, kind: kind as ToolboxFilterValue['kind'] })}
            options={[
                { value: 'all', label: <span data-testid="filter-all">All</span> },
                ...ITEM_KINDS.map(kind => ({
                    value: kind,
                    label: (
                        <Tooltip title={KIND_META[kind].label}>
                            <span
                                aria-label={KIND_META[kind].label}
                                role="img"
                                data-testid={`filter-${kind}`}
                            >
                                {KIND_META[kind].icon}
                            </span>
                        </Tooltip>
                    ),
                })),
            ]}
        />
    </div>
);
