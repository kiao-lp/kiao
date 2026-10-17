import React from 'react';
import { MenuProps } from 'antd';
import { LayoutOutlined } from '@ant-design/icons';
import { useToolBarsOptional } from '../tool-bars/ToolBars-ctx';
import { LayoutGridCmp } from '../tool-bars/LayoutGrid-cmp';
import { OFF } from '../tool-bars/barsModel';

/** Keeps the grid from being read as a clickable menu entry of its own. */
const GRID_ITEM_STYLE: React.CSSProperties = {
    height: 'auto',
    lineHeight: 'normal',
    padding: 8,
    cursor: 'default',
    backgroundColor: 'transparent',
};

/**
 * The **Show** entry of the tools menu: one sub-menu per registered tab, each opening on the
 * picture of the app the tab is placed in (see `tool-bars/LayoutGrid-cmp.tsx`).
 *
 * A tab currently out of the layout is listed dimmed — the grid says where a tab *is* by greying
 * that rectangle, and has no way of saying "nowhere". A pinned tab is not listed at all: the
 * document stays where it is pinned, so there is nothing to choose for it.
 */
export const useShowMenuItems = (): MenuProps['items'] => {
    const bars = useToolBarsOptional();
    if (!bars || bars.tabs.length === 0) return [];

    return [{
        key: 'show',
        icon: <LayoutOutlined />,
        label: 'Show',
        children: bars.tabs.filter(tab => !tab.pinned).map(tab => {
            const hidden = bars.placementOf(tab.id) === OFF;
            return {
                key: `show-${tab.id}`,
                icon: tab.icon,
                label: <span style={hidden ? { opacity: 0.45 } : undefined} data-testid={`show-tab-${tab.id}`}>{tab.title}</span>,
                children: [{
                    key: `show-${tab.id}-grid`,
                    label: <LayoutGridCmp tabId={tab.id} />,
                    style: GRID_ITEM_STYLE,
                }],
            };
        }),
    }];
};
