import React from 'react';
import { StarOutlined } from '@ant-design/icons';
import { DashboardPlugin, lazyComponent } from '@kiao-dashboard-core';
import { BookmarksProvider } from './Bookmarks-ctx';
import { BOOKMARKS_TAB_ID } from './constants';

const BookmarksPanel = lazyComponent(() => import('./BookmarksPanel').then(m => ({ default: m.BookmarksPanel })));

/** Panel-only plugin; it claims no file type. The provider is app-level because the toolbar remounts on navigation. */
export const plugin: DashboardPlugin = {
    id: 'bookmarks',
    providers: [BookmarksProvider],
    toolBars: [{
        id: BOOKMARKS_TAB_ID,
        title: 'Bookmarks',
        icon: <StarOutlined />,
        defaultBar: 'left',
        render: () => <BookmarksPanel />,
    }],
};
