import React from 'react';
import { ApiOutlined, SettingOutlined } from '@ant-design/icons';
import { stackPanelItem, type ToolsMenuItemDeclaration } from '../extensibility/FileBasedPlugin';
import { lazyComponent } from '../ui-foundation/react/lazyComponent';
import { HARNESS_PROFILES_TAB_ID, TOOLBOX_TAB_ID } from './panelIds';

const ToolboxPanel = lazyComponent(() => import('./ToolboxPanel').then(m => ({ default: m.ToolboxPanel })));
const HarnessProfilesPanel = lazyComponent(() => import('./HarnessProfilesPanel').then(m => ({ default: m.HarnessProfilesPanel })));

export const configurationMenuItem: ToolsMenuItemDeclaration = stackPanelItem({
    id: TOOLBOX_TAB_ID,
    title: 'Configuration',
    icon: <SettingOutlined />,
    content: <ToolboxPanel />,
});

export const harnessProfilesMenuItem: ToolsMenuItemDeclaration = stackPanelItem({
    id: HARNESS_PROFILES_TAB_ID,
    title: 'Pi profiles',
    icon: <ApiOutlined />,
    content: <HarnessProfilesPanel />,
});

export const toolboxMenuItems: ToolsMenuItemDeclaration[] = [configurationMenuItem, harnessProfilesMenuItem];
