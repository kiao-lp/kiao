import React from 'react';
import { Spin } from 'antd';

/** A compact, accessible status indicator for long-running file operations. */
export const InProgressFeedback: React.FC = () => (
    <span role="status" aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Spin size="small" />
        <span>In progress…</span>
    </span>
);
