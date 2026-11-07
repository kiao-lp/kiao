import React from 'react';
import { Tooltip } from '../../../ui-foundation/feedback/Tooltip';

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
