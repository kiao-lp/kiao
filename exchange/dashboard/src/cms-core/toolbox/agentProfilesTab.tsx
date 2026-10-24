import React from 'react';
import { ApiOutlined } from '@ant-design/icons';
import type { ToolBarTab } from '../tool-bars/ToolBars-ctx';

import { AGENT_PROFILES_TAB_ID } from './panelIds';
import { lazyComponent } from '../core/lazyComponent';

const AgentProfilesPanel = lazyComponent(() => import('./AgentProfilesPanel').then(m => ({ default: m.AgentProfilesPanel })));

export { AGENT_PROFILES_TAB_ID } from './panelIds';

export const agentProfilesTab: ToolBarTab = {
    id: AGENT_PROFILES_TAB_ID,
    title: 'Pi profiles',
    icon: <ApiOutlined />,
    defaultBar: 'center',
    render: () => <AgentProfilesPanel />,
};
