import React from 'react';
import { ApartmentOutlined, FolderOpenOutlined } from '@ant-design/icons';
import type { ToolBarTab } from 'src/cms-core/tool-bars/ToolBars-ctx';
import { FileNavigationMenuCmp, FileNavigationTreeCmp } from './FileNavigationBar-cmp';

export const FILE_NAVIGATION_BAR_TAB_ID = 'file-navigation-bar';
export const FILE_NAVIGATION_TREE_TAB_ID = 'file-navigation-tree';

/** Separate tab identities let the folder bar and store tree appear together and move independently. */
export const fileNavigationBarTab: ToolBarTab = {
    id: FILE_NAVIGATION_BAR_TAB_ID,
    title: 'Files',
    icon: <FolderOpenOutlined />,
    orientation: 'horizontal',
    defaultBar: 'top',
    flush: true,
    render: () => <FileNavigationMenuCmp />,
};

/** The left column starts hidden; its banner toggle reveals the tree. */
export const fileNavigationTreeTab: ToolBarTab = {
    id: FILE_NAVIGATION_TREE_TAB_ID,
    title: 'File tree',
    icon: <ApartmentOutlined />,
    orientation: 'vertical',
    defaultBar: 'left',
    flush: true,
    render: () => <FileNavigationTreeCmp />,
};
