import React, { useEffect } from 'react';
import {
    AppstoreOutlined, CloudServerOutlined, GroupOutlined, NodeIndexOutlined, ProjectOutlined,
    TeamOutlined,
} from '@ant-design/icons';
import { CmsPlugin, useAppRoute, lazyComponent } from '@cms-core';
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

export const plugin: CmsPlugin = {
    id: 'hybridflow-ui',
    // No file type: a board is not a document of the store. Every file opens in its own
    // viewer, and the boards open at their URL.
    fileConfigFor: () => null,
    // Board URLs open the Board panel and bypass file metadata lookup.
    appRoutes: [{
        prefix: BOARDS_PREFIX,
        panel: BOARD_TAB_ID,
        render: () => <BoardRoute />,
        // The way in is the Boards panel tab, not the page: opening the list must not take the
        // open document away. The page stays for a bare `/boards` URL.
    }],
    // Board state, drafts and controls survive document navigation and panel placement.
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
        // The open workflow: its name, which is all a rectangle has. A tab of its own
        // rather than a face of the Node tab — the board edits one thing at a time, and
        // the rectangle is not a card.
        id: WORKFLOW_TAB_ID,
        title: 'Workflow',
        icon: <GroupOutlined />,
        render: () => <WorkflowPanel />,
    }, {
        // The chain runs, wherever they are playing. It is not a panel about the open document
        // — a run's board is mostly not the one on screen — which is why it is registered like the
        // chat is, for every view, and why it reads the runs rather than the board this plugin has
        // open.
        //
        // Off where the deployment has no chat: a list of plays is a list of nothing at all where
        // nothing can be played. The `chat` plugin's own absence is not covered here — a store
        // assembled without it publishes no run, so the panel draws its empty line and says how to
        // start one, which is the same answer the board gives by drawing no Play button.
        id: HYBRIDFLOW_TAB_ID,
        title: 'Chain runs',
        icon: <NodeIndexOutlined />,
        isEnabled: config => config.chatEnabled,
        flush: true,
        render: () => <HybridflowPanel />,
    }, {
        // The managed agents: the named definitions of what plays a flow node, kept in the
        // hybridflow-store beside the boards. It is this plugin's and not the chat's: what it
        // lists is picked by flow nodes, and a run is only what plays them.
        id: AGENTS_TAB_ID,
        title: 'Node agents',
        icon: <TeamOutlined />,
        render: () => <AgentsPanel />,
    }, {
        // The runners: the machines that play cards, kept in the hybridflow-store beside the
        // boards. It is this plugin's and not the chat's, for the reason the agents' is: what it
        // lists is picked by tasks, and a run is only what plays them.
        id: RUNNERS_TAB_ID,
        title: 'Runners',
        icon: <CloudServerOutlined />,
        render: () => <RunnersPanel />,
    }, {
        // The board list stays beside the open document.
        id: BOARDS_TAB_ID,
        title: 'Boards',
        icon: <AppstoreOutlined />,
        render: () => <BoardsPanel />,
    }],
};
