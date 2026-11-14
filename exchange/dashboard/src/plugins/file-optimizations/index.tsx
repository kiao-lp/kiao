import React from 'react';
import { PieChartOutlined } from '@ant-design/icons';
import { DashboardPlugin, lazyComponent, stackPanelItem } from '@kiao-dashboard-core';

const FileOptimizations = lazyComponent(() => import('./FileOptimizationsView').then(m => ({ default: m.FileOptimizationsBody })));

export const plugin = {
    id: 'file-optimizations',
    toolsMenuItems: [stackPanelItem({
        id: 'file-optimizations',
        title: 'File optimizations',
        icon: <PieChartOutlined />,
        content: <FileOptimizations />,
    })],
} satisfies DashboardPlugin;
