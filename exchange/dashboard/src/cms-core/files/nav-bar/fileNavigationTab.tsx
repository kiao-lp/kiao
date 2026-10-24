import React from 'react';
import { ApartmentOutlined } from '@ant-design/icons';
import type { ToolBarTab } from 'src/cms-core/tool-bars/ToolBars-ctx';
import { FileNavigationTreeCmp } from './FileNavigationTree-cmp';

export const FILE_NAVIGATION_TREE_TAB_ID = 'file-navigation-tree';

/** The left column starts hidden; its banner toggle reveals the tree. */
export const fileNavigationTreeTab: ToolBarTab = {
    id: FILE_NAVIGATION_TREE_TAB_ID,
    title: 'File tree',
    icon: <ApartmentOutlined />,
    defaultBar: 'left',
    flush: true,
    render: () => <FileNavigationTreeCmp />,
};
