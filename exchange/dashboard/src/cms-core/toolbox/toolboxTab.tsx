import React from 'react';
import { SettingOutlined } from '@ant-design/icons';
import { ToolBarTab } from 'src/cms-core/tool-bars/ToolBars-ctx';
import { ToolboxPanel } from './ToolboxPanel';

/** The id the tools menu opens by name. */
export const TOOLBOX_TAB_ID = 'toolbox';

/**
 * The configuration panel as a tool bar tab, like every other panel in DCMS: the user decides which
 * bar it sits in, or takes it out of the layout entirely. It ships in the right column, which is
 * where a panel that is consulted rather than worked in belongs.
 */
export const toolboxTab: ToolBarTab = {
    id: TOOLBOX_TAB_ID,
    title: 'Configuration',
    icon: <SettingOutlined />,
    render: () => <ToolboxPanel />,
};
