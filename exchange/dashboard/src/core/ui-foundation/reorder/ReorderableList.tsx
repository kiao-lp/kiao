import type { HTMLAttributes, Key, ReactElement, ReactNode } from 'react';
import { ReorderHandle } from './ReorderHandle';
import { useReorderable, type ReorderableOptions } from './useReorderable';

interface Props<T> extends Pick<ReorderableOptions, 'onMove' | 'disabled'> {
    items: readonly T[];
    itemKey?: (item: T) => Key;
    className?: string;
    rowProps?: HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string };
    handleLabel: (item: T, index: number) => string;
    children: (item: T, index: number, handle: ReactElement) => ReactNode;
}

export function ReorderableList<T>({
    items, itemKey, className, rowProps, handleLabel, onMove, disabled, children,
}: Props<T>) {
    const reorder = useReorderable({ count: items.length, onMove, disabled });
    if (items.length === 0) return null;
    const rowClassName = ['kiao-reorder-list-row', rowProps?.className].filter(Boolean).join(' ');

    return (
        <div role="list" className={className}>
            {items.map((item, index) => (
                <div key={itemKey?.(item) ?? index} role="listitem" {...rowProps} {...reorder.rowProps(index, rowClassName)}>
                    {children(item, index, <ReorderHandle {...reorder.handleProps(index)} label={handleLabel(item, index)} />)}
                </div>
            ))}
        </div>
    );
}
