import React from 'react';
import { Tooltip } from '../../../ui/Tooltip';

/**
 * Hands a fenced block back for editing (see `ConfiguredMarkdownProps.blockEditors`).
 * Only shown when a handler was passed for the block's language.
 */
export const EditBlockButton: React.FC<{ onClick: () => void; title?: string }> = ({ onClick, title = 'Edit' }) => (
    <Tooltip title={title}>
        <button
            type="button"
            onClick={onClick}
            className="code-edit-btn"
            aria-label={title}
        >
            ✎
        </button>
    </Tooltip>
);
