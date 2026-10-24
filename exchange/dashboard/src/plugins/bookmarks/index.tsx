import React from 'react';
import { StarOutlined } from '@ant-design/icons';
import { CmsPlugin, lazyComponent } from '@cms-core';
import { BookmarksProvider } from './Bookmarks-ctx';
import { BOOKMARKS_TAB_ID } from './constants';

const BookmarksPanel = lazyComponent(() => import('./BookmarksPanel').then(m => ({ default: m.BookmarksPanel })));

/**
 * Bookmarks are a panel-only plugin: they claim no file type — `kiao-user-config/bookmarks.json`
 * is JSON, and `code-edit` edits it as such — and the list they hold is an app-level provider,
 * because the panel lives in a tool bar and every navigation between documents replaces those.
 */
export const plugin: CmsPlugin = {
    id: 'bookmarks',
    fileConfigFor: () => null,
    providers: [BookmarksProvider],
    toolBars: [{
        id: BOOKMARKS_TAB_ID,
        title: 'Bookmarks',
        icon: <StarOutlined />,
        render: () => <BookmarksPanel />,
    }],
};
