import React from 'react';
import { Spin } from 'antd';

/** A compact, accessible status indicator for long-running operations. */
export const InProgressFeedback: React.FC<{ label?: string; 'aria-label'?: string }> = ({
    label = 'In progress…', 'aria-label': ariaLabel,
}) => (
    <span role="status" aria-live="polite" aria-label={ariaLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Spin size="small" />
        <span>{label}</span>
    </span>
);
