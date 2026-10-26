import React from 'react';
import { MenuProps } from 'antd';
import { LayoutOutlined } from '@ant-design/icons';
import { useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { layoutGridMenuItem } from '../tool-bars/LayoutGrid-cmp';
import { CentralCount, OFF } from '../tool-bars/barsModel';

/** Pinned tabs are excluded: they stay in their bar and offer nothing to choose. */
export const useShowMenuItems = (): MenuProps['items'] => {
    const bars = useToolBarsOptional();
    if (!bars || bars.tabs.length === 0) return [];

    return [{
        key: 'show',
        icon: <LayoutOutlined />,
        label: 'Show',
        children: [
            {
                key: 'show-central-areas',
                label: 'Central areas',
                children: ([1, 2, 3] as CentralCount[]).map(count => ({
                    key: `show-central-${count}`,
                    label: (
                        <span data-testid={`show-central-count-${count}`}>
                            {count === bars.centralCount ? '✓ ' : ''}{count} {count === 1 ? 'area' : 'areas'}
                        </span>
                    ),
                    onClick: () => bars.setCentralCount(count),
                })),
            },
            { type: 'divider' as const, key: 'show-central-divider' },
            ...bars.tabs.filter(tab => !tab.pinned).sort((a, b) => a.title.localeCompare(b.title)).map(tab => {
                const hidden = bars.placementOf(tab.id) === OFF;
                return {
                    key: `show-${tab.id}`,
                    icon: tab.icon,
                    label: <span style={hidden ? { opacity: 0.45 } : undefined} data-testid={`show-tab-${tab.id}`}>{tab.title}</span>,
                    children: [layoutGridMenuItem(tab.id, `show-${tab.id}-grid`)],
                };
            }),
        ],
    }];
};
