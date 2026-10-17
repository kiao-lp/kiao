import React from 'react';
import { Tag } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { BoundCommand as Command } from '../commands/CommandRegistry-ctx';

export const CandidateCmp: React.FC<{ candidate: Command }> = ({ candidate }) => (
    <Tooltip title={candidate.title}>
        <Tag style={{ margin: 0 }}>{candidate.group || candidate.shortcut}</Tag>
    </Tooltip>
);
