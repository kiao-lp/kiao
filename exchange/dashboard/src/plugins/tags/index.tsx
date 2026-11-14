import React from 'react';
import { TagsOutlined } from '@ant-design/icons';
import { DashboardPlugin, lazyComponent, stackPanelItem } from '@kiao-dashboard-core';
import { TagsProvider } from './Tags-ctx';
import { TAGS_TAB_ID } from './constants';
import { TagChips } from './TagChip';

const TagsPanel = lazyComponent(() => import('./TagsPanel').then(m => ({ default: m.TagsPanel })));
const TagPicker = lazyComponent(() => import('./TagPicker').then(m => ({ default: m.TagPicker })));

/** Panel-only plugin; the list is an app-level provider shared by the panel and board cards. */
export const plugin: DashboardPlugin = {
    id: 'tags',
    providers: [TagsProvider],
    capabilities: { 'tags.ui': { TagChips, TagPicker } },
    toolsMenuItems: [stackPanelItem({
        id: TAGS_TAB_ID,
        title: 'Tags',
        icon: <TagsOutlined />,
        content: <TagsPanel />,
    })],
};
