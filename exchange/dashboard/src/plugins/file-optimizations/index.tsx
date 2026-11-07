import React from 'react';
import { PieChartOutlined } from '@ant-design/icons';
import { CmsPlugin, lazyComponent } from '@cms-core';

const FileOptimizations = lazyComponent(() => import('./FileOptimizationsView').then(m => ({ default: m.FileOptimizationsBody })));

export const plugin = {
    id: 'file-optimizations',
    toolsMenuItems: [{
        id: 'file-optimizations',
        label: 'File optimizations…',
        icon: <PieChartOutlined />,
        panel: {
            label: 'File optimizations',
            content: <FileOptimizations />,
        },
    }],
} satisfies CmsPlugin;
