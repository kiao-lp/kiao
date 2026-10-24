import React from 'react';
import { RobotOutlined, DashboardOutlined } from '@ant-design/icons';
import { CmsPlugin, lazyComponent } from '@cms-core';
import { ChatSocketProvider } from './ChatSocket-ctx';
import { ChatShowProvider } from './ChatShow-ctx';
import { ChatUsageProvider } from './ChatUsage-ctx';
import { ChatChainRunsProvider } from './ChatChainRuns-ctx';
import { CONVERSATIONS_TAB_ID, CHAT_USAGE_TAB_ID } from './constants';
import { chatCapabilities } from './capabilities';

const ChatPromptContent = lazyComponent(() => import('./ChatPrompt').then(m => ({ default: m.ChatPromptContent })));
const ChatUsageTab = lazyComponent(() => import('./ChatUsageTab').then(m => ({ default: m.ChatUsageTab })));

/**
 * The chat is a panel-only plugin, with four app-level providers. Three have to outlive the
 * tool bars, which every navigation between documents replaces: the socket and the turns it carries,
 * the board's run — which is the service's and is watched on that socket, so a board left and
 * come back to finds it exactly where it was — and the one line that puts a conversation on screen
 * for a caller that is not the panel. The fourth, the quota, is up here for a smaller reason: it
 * holds one state per *agent* so that every surface showing an account reads the same figures, and
 * it reads nothing at all until the first refresh asks it to.
 *
 * **It is the panel for every agent the service offers, not one panel per agent.** Which engine a
 * conversation runs on is a property of that conversation — picked when it is created, fixed for its
 * life, shown on the prompt bar — and one socket, one switcher and one transcript serve all of them.
 * So the plugin is `chat` and not `claude`, and nothing below names an engine.
 *
 * What it offers the rest of the assembly — playing a flow node, the settings lists, opening a chat — is
 * published as capabilities (`./capabilities`) rather than imported by anyone: the board is
 * the caller, and a store may well be assembled with the board and without this.
 */
export const plugin: CmsPlugin = {
    id: 'chat',
    fileConfigFor: () => null,
    isEnabled: config => config.chatEnabled,
    providers: [ChatSocketProvider, ChatShowProvider, ChatUsageProvider, ChatChainRunsProvider],
    capabilities: chatCapabilities,
    toolBars: [{
        id: CONVERSATIONS_TAB_ID,
        title: 'Conversations',
        icon: <RobotOutlined />,
        render: () => <ChatPromptContent />,
    }, {
        id: CHAT_USAGE_TAB_ID,
        title: 'Usage',
        icon: <DashboardOutlined />,
        render: () => <ChatUsageTab />,
    }],
};
