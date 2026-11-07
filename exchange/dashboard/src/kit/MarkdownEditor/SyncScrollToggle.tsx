import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '@cms-core';
import { SwapOutlined } from '@ant-design/icons';

export interface SyncScrollToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
}

export const SyncScrollToggle: React.FC<SyncScrollToggleProps> = ({ value, onChange }) => (
    <Tooltip title={value ? 'Disable Synchronized Scrolling' : 'Enable Synchronized Scrolling'}>
        <Button
            type="text"
            size="small"
            icon={<SwapOutlined />}
            aria-label="Synchronized scrolling"
            aria-pressed={value}
            style={{ color: value ? 'var(--link)' : undefined, opacity: value ? 1 : 0.5 }}
            onClick={() => onChange(!value)}
        />
    </Tooltip>
);
