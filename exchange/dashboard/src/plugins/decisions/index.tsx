import React from 'react';
import { AuditOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { DashboardPlugin, lazyComponent, stackPanelItem } from '@kiao-dashboard-core';
import { DecisionsProvider } from './Decisions-ctx';
import { DECISIONS_TAB_ID, DECISION_SOURCES_TAB_ID } from './constants';

const DecisionsPanel = lazyComponent(() => import('./DecisionsPanel').then(m => ({ default: m.DecisionsPanel })));
const SourcesPanel = lazyComponent(() => import('./SourcesPanel').then(m => ({ default: m.SourcesPanel })));

export const plugin = {
    id: 'decisions',
    providers: [DecisionsProvider],
    toolBars: [{
        id: DECISIONS_TAB_ID,
        title: 'Decisions',
        icon: <AuditOutlined />,
        defaultBar: 'center',
        render: () => <DecisionsPanel />,
    }],
    toolsMenuItems: [stackPanelItem({
        id: DECISION_SOURCES_TAB_ID,
        title: 'Decision sources',
        icon: <FolderOpenOutlined />,
        content: <SourcesPanel />,
    })],
} satisfies DashboardPlugin;
