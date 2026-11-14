import React from 'react';
import { RobotOutlined, DashboardOutlined } from '@ant-design/icons';
import { DashboardPlugin, lazyComponent } from '@kiao-dashboard-core';
import { ChatSocketProvider } from './ChatSocket-ctx';
import { ChatShowProvider } from './ChatShow-ctx';
import { ChatUsageProvider } from './ChatUsage-ctx';
import { ChatChainRunsProvider } from './ChatChainRuns-ctx';
import { CONVERSATIONS_TAB_ID, CHAT_USAGE_TAB_ID } from './constants';
import { chatCapabilities } from './capabilities';

const ChatPromptContent = lazyComponent(() => import('./ChatPrompt').then(m => ({ default: m.ChatPromptContent })));
const ChatUsageTab = lazyComponent(() => import('./ChatUsageTab').then(m => ({ default: m.ChatUsageTab })));

/** The chat is a panel-only plugin, with four app-level providers. */
export const plugin: DashboardPlugin = {
    id: 'chat',
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
        defaultBar: 'left',
        render: () => <ChatUsageTab />,
    }],
};
