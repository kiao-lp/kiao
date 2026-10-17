import React, { useCallback } from 'react';
import { useFileSelection } from '../selection/SelectionModel-ctx';
import { useNavigation } from '../navigation/NavigationModel';
import { useIsCoarsePointer } from './useLongPress';

export interface RowInteractionsArgs {
    path: string;
    visiblePaths: string[];
    isFolder: boolean;
}

export interface RowInteractionHandlers {
    onClick: (e: React.MouseEvent) => void;
    onDoubleClick: (e: React.MouseEvent) => void;
    onAuxClick: (e: React.MouseEvent) => void;
}

const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return !!target.closest('button, a, input, textarea, select, [data-row-action]');
};

export const useRowInteractions = ({ path, visiblePaths }: RowInteractionsArgs): RowInteractionHandlers => {
    const selection = useFileSelection();
    const nav = useNavigation();
    const isCoarse = useIsCoarsePointer();

    const onClick = useCallback((e: React.MouseEvent) => {
        if (isInteractiveTarget(e.target)) return;
        if (e.shiftKey) {
            selection.selectRange(path, visiblePaths);
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            selection.select(path, 'toggle');
            return;
        }
        // Touch tap: open immediately unless we're in select-mode
        if (isCoarse && (e as unknown as PointerEvent).pointerType !== 'mouse') {
            if (selection.selectMode) {
                selection.select(path, 'toggle');
            } else {
                nav.open(path);
            }
            return;
        }
        selection.select(path, 'replace');
    }, [selection, nav, path, visiblePaths, isCoarse]);

    const onDoubleClick = useCallback((e: React.MouseEvent) => {
        if (isInteractiveTarget(e.target)) return;
        if (isCoarse) return; // touch already handles open via tap
        if (e.ctrlKey || e.metaKey) {
            nav.openInNewTab(path);
            return;
        }
        if (e.shiftKey) {
            nav.openInNewWindow(path);
            return;
        }
        nav.open(path);
    }, [nav, path, isCoarse]);

    const onAuxClick = useCallback((e: React.MouseEvent) => {
        if (e.button === 1) {
            e.preventDefault();
            nav.openInNewTab(path);
        }
    }, [nav, path]);

    return { onClick, onDoubleClick, onAuxClick };
};
