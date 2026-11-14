import React from 'react';

export const EditBlockButton: React.FC<{ onClick: () => void; title?: string }> = ({ onClick, title = 'Edit' }) => (
    <button
        type="button"
        onClick={onClick}
        className="code-edit-btn"
        aria-label={title}
    >
        ✎
    </button>
);
