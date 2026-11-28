import React from 'react';
import { IconButton } from '../../../ui-foundation/toolbar/IconButton';

export const ExtractBlockButton: React.FC<{ onClick: () => void; title?: string }> = ({ onClick, title = 'Extract' }) => (
    <IconButton type="plain" label={title} icon="⤓" className="code-extract-btn" onClick={onClick} />
);
