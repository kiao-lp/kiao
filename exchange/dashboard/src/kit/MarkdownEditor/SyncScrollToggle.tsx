import React from 'react';
import { IconButton } from '@kiao-dashboard-core';
import { SwapOutlined } from '@ant-design/icons';

export interface SyncScrollToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
}

export const SyncScrollToggle: React.FC<SyncScrollToggleProps> = ({ value, onChange }) => (
    <IconButton
        label="Synchronized scrolling"
        tooltip={value ? 'Disable Synchronized Scrolling' : 'Enable Synchronized Scrolling'}
        icon={<SwapOutlined />}
        aria-pressed={value}
        style={{ color: value ? 'var(--link)' : undefined, opacity: value ? 1 : 0.5 }}
        onClick={() => onChange(!value)}
    />
);
