import React, { useCallback } from 'react';
import { AimOutlined } from '@ant-design/icons';
import { IconButton } from '../../ui-foundation/toolbar/IconButton';
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

    return (
        <IconButton
            type="plain"
            label={`Show the ${subject} in the file navigator`}
            tooltip={path !== null}
            icon={<AimOutlined />}
            className={`cms-reveal-in-tree${className ? ` ${className}` : ''}`}
            onClick={onClick}
            disabled={path === null}
            data-testid={testId}
        />
    );
};
