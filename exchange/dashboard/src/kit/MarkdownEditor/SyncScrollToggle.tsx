import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '@cms-core';
import { SwapOutlined } from '@ant-design/icons';

export interface SyncScrollToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
}

/**
 * Switches synchronized source/preview scrolling on and off. Shared so every
 * markdown editing view offers the same control (see MarkdownEditorToolbar and
 * a note editor opened over a preview).
 */
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
