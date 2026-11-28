import React from 'react';
import { IconButton } from '../../../ui-foundation/toolbar/IconButton';

export const EditBlockButton: React.FC<{ onClick: () => void; title?: string }> = ({ onClick, title = 'Edit' }) => (
    <IconButton type="plain" label={title} icon="✎" className="code-edit-btn" onClick={onClick} />
);
