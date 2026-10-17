import React, { useEffect } from 'react';
import {
    AppstoreOutlined, CloudServerOutlined, GroupOutlined, NodeIndexOutlined, ProjectOutlined,
    TeamOutlined,
} from '@ant-design/icons';
import { CmsPlugin, LayoutContent, MainViewCmp, TopBanner, useAppRoute } from '@cms-core';
import { AgentsProvider } from './Agents-ctx';
import { RunnersProvider } from './Runners-ctx';
import { AgentsPanel } from './components/AgentsPanel';
import { RunnersPanel } from './components/RunnersPanel';
import { Board } from './components/Board';
import { BoardsPage } from './components/BoardsPage';
import { BoardsPanel } from './components/BoardsPanel';
import { ExpandedFlowNode } from './components/ExpandedFlowNode';
import { FlowNodePanel } from './components/FlowNodePanel';
import { HybridflowPanel } from './components/HybridflowPanel';
import { WorkflowPanel } from './components/WorkflowPanel';
import { FlowNodeEditingProvider } from './FlowNodeEditing-ctx';
import { HybridflowProvider } from './Hybridflow-ctx';
import { BOARDS_PREFIX, handleOf } from './boardRoute';
import { HybridflowClientProvider } from './service';
import {
    AGENTS_TAB_ID, BOARDS_TAB_ID, FLOW_NODE_TAB_ID, HYBRIDFLOW_TAB_ID, RUNNERS_TAB_ID,
    WORKFLOW_TAB_ID,
} from './constants';

/**
 * **A board is a row in a database, reached by its own URL** — `/boards/major` — and the page at
 * `/boards` lists them.
 *
 * A board has no path, so it cannot be a file view, and it claims a URL prefix instead
 * (`appRoutes`, cms-core/app-routes).
 *
 * What the store holds for a board as a file is what only a file can be: an image pasted
 * into a card. It goes in the folder named after the board's handle — see `boardFolder` in
 * [boardRoute.ts](./boardRoute.ts). Archiving writes no file: it flips a boolean on the card.
 */
const BoardView: MainViewCmp = () => {
    const { rest } = useAppRoute() ?? { rest: '' };
    const handle = handleOf(rest);

    useEffect(() => {
        document.title = handle ?? 'Boards';
    }, [handle]);

    if (!handle) return <BoardsPage />;
    return (
        <>
            <LayoutContent>
                <Board handle={handle} />
                {/* The large editor of the open flow node, pushed onto the stack over the board. It is
                    the central area's, not the flow node panel's: the panel is a tool-bar tab, and
                    hiding the right column would otherwise close an editor filling the middle of
                    the screen. */}
                <ExpandedFlowNode />
            </LayoutContent>
            <TopBanner />
        </>
    );
};

export const plugin: CmsPlugin = {
    id: 'hybridflow-ui',
    // No file type: a board is not a document of the store. Every file opens in its own
    // viewer, and the boards open at their URL.
    fileConfigFor: () => null,
    // The boards, and the page that lists them. cms-core draws what is under the prefix in place of
    // the open document and keeps the file browsing from resolving it as a path.
    appRoutes: [{
        prefix: BOARDS_PREFIX,
        render: () => <BoardView />,
        // The way in is the Boards panel tab, not the page: opening the list must not take the
        // open document away. The page stays for a bare `/boards` URL.
    }],
    // The board is in the document area and the flow node panel in a tool bar, which every main view
    // brings up anew: what they share cannot live in either of them. The flow node being typed is
    // shared by three — the board, the panel and the large editor over the board — so its draft
    // sits above all of them, in `FlowNodeEditingProvider`, nested inside the board it reads from.
    // The client is outermost: the board provider reads the service through it, and so does the
    // agents list the panel keeps and the flow node editor picks from.
    providers: [HybridflowClientProvider, AgentsProvider, RunnersProvider, HybridflowProvider, FlowNodeEditingProvider],
    toolBars: [{
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
        // The boards, and the way in to each of them. A column's panel rather than a central page,
        // so picking a board leaves the open document where it is. Vertical only: a list of rows
        // laid across the top strip would be one unreadable line.
        id: BOARDS_TAB_ID,
        title: 'Boards',
        icon: <AppstoreOutlined />,
        orientation: 'vertical',
        render: () => <BoardsPanel />,
    }],
};
