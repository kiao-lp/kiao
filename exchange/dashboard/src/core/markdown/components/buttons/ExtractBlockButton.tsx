import React from 'react';

export const ExtractBlockButton: React.FC<{ onClick: () => void; title?: string }> = ({ onClick, title = 'Extract' }) => (
    <button
        type="button"
        onClick={onClick}
        className="code-extract-btn"
        aria-label={title}
    >
        ⤓
    </button>
);
