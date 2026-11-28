import React from 'react';
import {
    AppstoreOutlined, CloudServerOutlined, DashboardOutlined, GroupOutlined, NodeIndexOutlined, ProjectOutlined,
    RobotOutlined, TeamOutlined,
} from '@ant-design/icons';
import { DashboardPlugin, lazyComponent, stackPanelItem } from '@kiao-dashboard-core';
import { AgentsProvider, ResourceClientProvider } from './agentic-resources';
import { RunnersProvider } from './Runners-ctx';
import { FlowNodeEditingProvider } from './FlowNodeEditing-ctx';
import { HybridflowProvider, useHybridflow } from './Hybridflow-ctx';
import { BoardControlsProvider } from './BoardControls-ctx';
import { BoardsCatalogProvider } from './BoardsCatalog-ctx';
import { BoardFilterStrip } from './components/BoardFilter';
import { BOARDS_PREFIX, TASKS_PREFIX } from './boardRoute';
import { BoardRoute } from './components/BoardRoute';
import { HybridflowClientProvider } from './service';
import { ChatSocketProvider } from './conversations/ChatSocket-ctx';
import { ChatShowProvider } from './conversations/ChatShow-ctx';
import { ChatUsageProvider } from './conversations/ChatUsage-ctx';
import { ChatChainRunsProvider } from './conversations/ChatChainRuns-ctx';
import { CHAT_USAGE_TAB_ID, CONVERSATIONS_TAB_ID } from './conversations/constants';
import {
    AGENTIC_RESOURCES_PANEL_ID, BOARD_TAB_ID, BOARDS_TAB_ID, FLOW_NODE_TAB_ID, HYBRIDFLOW_TAB_ID, RUNNERS_TAB_ID,
    WORKFLOW_TAB_ID,
} from './constants';

const AgenticResourcesPanel = lazyComponent(() => import('./agentic-resources/components/AgenticResourcesPanel'));
const LegacyAgenticResourcesPanel = lazyComponent(() => import('./agentic-resources/components/LegacyAgenticResourcesPanel'));
const RunnersPanel = lazyComponent(() => import('./components/RunnersPanel').then(m => ({ default: m.RunnersPanel })));
const BoardPanel = lazyComponent(() => import('./components/BoardPanel').then(m => ({ default: m.BoardPanel })));
const BoardsPanel = lazyComponent(() => import('./components/BoardsPanel').then(m => ({ default: m.BoardsPanel })));
const FlowNodePanel = lazyComponent(() => import('./components/FlowNodePanel').then(m => ({ default: m.FlowNodePanel })));
const HybridflowPanel = lazyComponent(() => import('./components/HybridflowPanel').then(m => ({ default: m.HybridflowPanel })));
const WorkflowPanel = lazyComponent(() => import('./components/WorkflowPanel').then(m => ({ default: m.WorkflowPanel })));
const ChatPromptContent = lazyComponent(() => import('./conversations/ChatPrompt').then(m => ({ default: m.ChatPromptContent })));
const ChatUsageTab = lazyComponent(() => import('./conversations/ChatUsageTab').then(m => ({ default: m.ChatUsageTab })));

const BoardControls: React.FC = () => useHybridflow().handle ? <BoardFilterStrip /> : null;

export const plugin: DashboardPlugin = {
    id: 'hybridflow',

    appRoutes: [BOARDS_PREFIX, TASKS_PREFIX].map(prefix => ({
        prefix,
        panel: BOARD_TAB_ID,
        render: () => <BoardRoute />,
    })),
    providers: [
        HybridflowClientProvider, ResourceClientProvider, AgentsProvider, RunnersProvider,
        HybridflowProvider, FlowNodeEditingProvider, BoardControlsProvider, BoardsCatalogProvider,
        ChatSocketProvider, ChatShowProvider, ChatUsageProvider, ChatChainRunsProvider,
    ],
    toolBars: [{
        id: BOARD_TAB_ID,
        title: 'Board',
        icon: <AppstoreOutlined />,
        defaultBar: 'center',
        flush: true,
        render: () => <BoardPanel />,
        additionalPanels: <BoardControls />,
    }, {
        id: FLOW_NODE_TAB_ID,
        title: 'Flow node',
        icon: <ProjectOutlined />,
        render: () => <FlowNodePanel />,
    }, {
        id: WORKFLOW_TAB_ID,
        title: 'Workflow',
        icon: <GroupOutlined />,
        render: () => <WorkflowPanel />,
    }, {
        id: HYBRIDFLOW_TAB_ID,
        title: 'Chain runs',
        icon: <NodeIndexOutlined />,
        isEnabled: config => config.chatEnabled,
        flush: true,
        render: () => <HybridflowPanel />,
    }, {
        id: BOARDS_TAB_ID,
        title: 'Boards',
        icon: <AppstoreOutlined />,
        defaultBar: 'left',
        render: () => <BoardsPanel />,
    }, {
        id: CONVERSATIONS_TAB_ID,
        title: 'Conversations',
        icon: <RobotOutlined />,
        isEnabled: config => config.chatEnabled,
        render: () => <ChatPromptContent />,
    }, {
        id: CHAT_USAGE_TAB_ID,
        title: 'Usage',
        icon: <DashboardOutlined />,
        defaultBar: 'left',
        isEnabled: config => config.chatEnabled,
        render: () => <ChatUsageTab />,
    }],
    toolsMenuItems: [
        stackPanelItem({
            id: AGENTIC_RESOURCES_PANEL_ID,
            title: 'Agentic resources',
            icon: <TeamOutlined />,
            content: <AgenticResourcesPanel />,
        }),
        stackPanelItem({
            id: 'agentic-resources',
            title: 'Agentic resources (legacy)',
            icon: <CloudServerOutlined />,
            content: <LegacyAgenticResourcesPanel />,
        }),
        stackPanelItem({
            id: RUNNERS_TAB_ID,
            title: 'Runners',
            icon: <CloudServerOutlined />,
            content: <RunnersPanel />,
        }),
    ],
};
