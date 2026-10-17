import React, { useCallback } from 'react';
import { AimOutlined } from '@ant-design/icons';
import { Tooltip } from 'src/cms-core/ui/Tooltip';
import { useToolBarsOptional } from 'src/cms-core/tool-bars/ToolBars-ctx';
import { FILE_NAVIGATION_TREE_TAB_ID } from './fileNavigationTab';
import { useRevealInTree } from './RevealInTree-ctx';

export interface RevealInTreeButtonProps {
    /**
     * The store path to show — no leading slash, the root being the empty string. `null` is a
     * button with nothing to point at: it is drawn all the same, and disabled, so a box that will
     * hold a path keeps the same shape while it is empty.
     */
    path: string | null;
    /** What the tooltip calls it, when "document" is not the word — "folder", say. */
    subject?: string;
    className?: string;
    'data-testid'?: string;
}

/**
 * The crosshair that says **where this is in the store**, put beside anything naming a document:
 * a link in a rendered page, the folder written on a flow node.
 *
 * It is the reading counterpart of the one in the navigation pane's corner, which goes back to the
 * open document — the same glyph, because it is the same move, asked of a path the reader is
 * looking at rather than of the document they are in. It **does not open** what it points at:
 * following the link is what the link is for, and the whole point of the crosshair is to place a
 * document *without* leaving the one being read.
 *
 * It brings the file tree forward first, since being shown where something is is no answer while
 * the tree is behind another panel, out of the layout or in a column that is switched off. Now that
 * the tree is a tab of its own it always lands on a tree — the file line across the top is a
 * different tab, and there was never a row to show in it.
 */
export const RevealInTreeButton: React.FC<RevealInTreeButtonProps> = ({
    path, subject = 'document', className, 'data-testid': testId,
}) => {
    const { reveal } = useRevealInTree();
    const bars = useToolBarsOptional();

    const onClick = useCallback((event: React.MouseEvent) => {
        // Beside a link, and inside a box that takes the click as its own: neither the anchor nor
        // the field around it is being asked for here.
        event.preventDefault();
        event.stopPropagation();
        if (path === null) return;
        bars?.showTab(FILE_NAVIGATION_TREE_TAB_ID);
        reveal(path);
    }, [bars, path, reveal]);

    const button = (
        <button
            type="button"
            className={`cms-reveal-in-tree${className ? ` ${className}` : ''}`}
            onClick={onClick}
            disabled={path === null}
            aria-label={`Show the ${subject} in the file navigator`}
            data-testid={testId}
        >
            <AimOutlined />
        </button>
    );

    // A disabled button fires nothing, tooltips included, so the empty one says nothing rather
    // than being wrapped in a span whose only job is to catch a hover.
    return path === null ? button : <Tooltip title={`Show the ${subject} in the file navigator`}>{button}</Tooltip>;
};
