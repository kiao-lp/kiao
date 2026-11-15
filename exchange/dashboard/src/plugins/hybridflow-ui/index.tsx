import React, { useEffect } from 'react';
import {
    AppstoreOutlined, CloudServerOutlined, GroupOutlined, NodeIndexOutlined, ProjectOutlined,
    TeamOutlined,
} from '@ant-design/icons';
import { DashboardPlugin, useAppRoute, lazyComponent, stackPanelItem } from '@kiao-dashboard-core';
import { AgentsProvider } from './Agents-ctx';
import { RunnersProvider } from './Runners-ctx';
import { FlowNodeEditingProvider } from './FlowNodeEditing-ctx';
import { HybridflowProvider, useHybridflow } from './Hybridflow-ctx';
import { BoardControlsProvider } from './BoardControls-ctx';
import { BoardFilterStrip } from './components/BoardFilter';
import { BOARDS_PREFIX, handleOf } from './boardRoute';
import { HybridflowClientProvider } from './service';
import {
    AGENTS_TAB_ID, BOARD_TAB_ID, BOARDS_TAB_ID, FLOW_NODE_TAB_ID, HYBRIDFLOW_TAB_ID, RUNNERS_TAB_ID,
    WORKFLOW_TAB_ID,
} from './constants';

const AgentsPanel = lazyComponent(() => import('./components/AgentsPanel').then(m => ({ default: m.AgentsPanel })));
const RunnersPanel = lazyComponent(() => import('./components/RunnersPanel').then(m => ({ default: m.RunnersPanel })));
const BoardPanel = lazyComponent(() => import('./components/BoardPanel').then(m => ({ default: m.BoardPanel })));
const BoardsPanel = lazyComponent(() => import('./components/BoardsPanel').then(m => ({ default: m.BoardsPanel })));
const FlowNodePanel = lazyComponent(() => import('./components/FlowNodePanel').then(m => ({ default: m.FlowNodePanel })));
const HybridflowPanel = lazyComponent(() => import('./components/HybridflowPanel').then(m => ({ default: m.HybridflowPanel })));
const WorkflowPanel = lazyComponent(() => import('./components/WorkflowPanel').then(m => ({ default: m.WorkflowPanel })));

/** Board URLs select the panel's board without replacing the open document. */
const BoardRoute: React.FC = () => {
    const { rest } = useAppRoute() ?? { rest: '' };
    const handle = handleOf(rest);
    const { openBoard, closeBoard } = useHybridflow();

    useEffect(() => {
        if (handle) openBoard(handle);
        else closeBoard();
        document.title = handle ?? 'Boards';
    }, [handle, openBoard, closeBoard]);

    return null;
};

const BoardControls: React.FC = () => useHybridflow().handle ? <BoardFilterStrip /> : null;

export const plugin: DashboardPlugin = {
    id: 'hybridflow-ui',

    appRoutes: [{
        prefix: BOARDS_PREFIX,
        panel: BOARD_TAB_ID,
        render: () => <BoardRoute />,
    }],
    providers: [HybridflowClientProvider, AgentsProvider, RunnersProvider, HybridflowProvider, FlowNodeEditingProvider, BoardControlsProvider],
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
        title: 'Node',
        icon: <ProjectOutlined />,
        render: () => <FlowNodePanel />,
    }, {
        id: WORKFLOW_TAB_ID,
        title: 'Workflow',
        icon: <GroupOutlined />,
        render: () => <WorkflowPanel />,
    }, {
        // The chat plugin's own absence is not covered here — a store assembled without it publishes no run, so the panel draws its empty.
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
    }],
    toolsMenuItems: [
        stackPanelItem({
            id: AGENTS_TAB_ID,
            title: 'Node agents',
            icon: <TeamOutlined />,
            content: <AgentsPanel />,
        }),
        stackPanelItem({
            id: RUNNERS_TAB_ID,
            title: 'Runners',
            icon: <CloudServerOutlined />,
            content: <RunnersPanel />,
        }),
    ],
};
