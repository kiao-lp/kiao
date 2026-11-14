import React from 'react';
import {
    CheckCircleOutlined, ClockCircleOutlined, EditOutlined, ExclamationCircleOutlined,
    MinusCircleOutlined, PauseCircleOutlined, PlayCircleOutlined, SyncOutlined,
} from '@ant-design/icons';
import type { FlowNodeStatus } from './flowNodeStatus';

export const STATUS_GLYPH: Record<FlowNodeStatus, React.ReactNode> = {
    draft: <EditOutlined />,
    ready: <PlayCircleOutlined />,
    todo: <ClockCircleOutlined />,
    blocked: <MinusCircleOutlined />,
    running: <SyncOutlined />,
    'waiting-refresh': <ClockCircleOutlined />,
    interrupted: <PauseCircleOutlined />,
    done: <CheckCircleOutlined />,
    error: <ExclamationCircleOutlined />,
};
