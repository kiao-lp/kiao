import React from 'react';
import { Tooltip } from '../../../ui/Tooltip';

/**
 * Hands a fenced block back to be replaced by something it contains
 * (see `ConfiguredMarkdownProps.blockExtractors`). Only shown when a handler was
 * passed for the block's language.
 */
export const ExtractBlockButton: React.FC<{ onClick: () => void; title?: string }> = ({ onClick, title = 'Extract' }) => (
    <Tooltip title={title}>
        <button
            type="button"
            onClick={onClick}
            className="code-extract-btn"
            aria-label={title}
        >
            ⤓
        </button>
    </Tooltip>
);
