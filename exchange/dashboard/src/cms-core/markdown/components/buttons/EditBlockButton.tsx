import React from 'react';
import { Tooltip } from '../../../ui-foundation/feedback/Tooltip';

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
