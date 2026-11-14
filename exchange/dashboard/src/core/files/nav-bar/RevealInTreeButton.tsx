import React, { useCallback } from 'react';
import { AimOutlined } from '@ant-design/icons';
import { Tooltip } from 'src/core/ui-foundation/feedback/Tooltip';
import { useToolBarsOptional } from 'src/core/dashboard-ui/toolbars/ToolBars-ctx';
import { FILE_NAVIGATION_TREE_TAB_ID } from './fileNavigationTab';
import { useRevealInTree } from './RevealInTree-ctx';

export interface RevealInTreeButtonProps {
    /** Store path without leading slash; root is `''`. `null` renders a disabled button. */
    path: string | null;
    /** Tooltip noun when not "document". */
    subject?: string;
    className?: string;
    'data-testid'?: string;
}

/** Shows a path in the file tree without opening it. Brings the tree tab forward first. */
export const RevealInTreeButton: React.FC<RevealInTreeButtonProps> = ({
    path, subject = 'document', className, 'data-testid': testId,
}) => {
    const { reveal } = useRevealInTree();
    const bars = useToolBarsOptional();

    const onClick = useCallback((event: React.MouseEvent) => {
        // Do not trigger a surrounding link or field.
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

    // Disabled buttons fire no tooltip, so no hover wrapper is used.
    return path === null ? button : <Tooltip title={`Show the ${subject} in the file navigator`}>{button}</Tooltip>;
};
