import React from 'react';
import { TagsOutlined } from '@ant-design/icons';
import { CmsPlugin, lazyComponent } from '@cms-core';
import { TagsProvider } from './Tags-ctx';
import { TAGS_TAB_ID } from './constants';
import { TagChips } from './TagChip';

const TagsPanel = lazyComponent(() => import('./TagsPanel').then(m => ({ default: m.TagsPanel })));
const TagPicker = lazyComponent(() => import('./TagPicker').then(m => ({ default: m.TagPicker })));

/**
 * Tags are a panel-only plugin: they claim no file type — `kiao-user-config/tags.json` is JSON, and
 * `code-edit` shows it as such — and the list they hold is an app-level provider, because it has
 * two readers that never share a lifetime. The panel lives in a tool bar, which every navigation
 * between documents replaces; the colours are worn on the cards of a board, which is a main view.
 *
 * The chips and the picker are published as a capability rather than imported: the board wears them
 * where the assembly has this plugin, and wears nothing where it does not.
 */
export const plugin: CmsPlugin = {
    id: 'tags',
    fileConfigFor: () => null,
    providers: [TagsProvider],
    capabilities: { 'tags.ui': { TagChips, TagPicker } },
    toolBars: [{
        id: TAGS_TAB_ID,
        title: 'Tags',
        icon: <TagsOutlined />,
        render: () => <TagsPanel />,
    }],
};
