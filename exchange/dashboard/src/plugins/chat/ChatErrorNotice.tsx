// `claude` binary the host cannot start, a conversation deleted from another tab, the CLI failing It is dismissible because none of.

import React from 'react';
import { Button } from 'antd';
import { CloseOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useToolBars } from '@kiao-dashboard-core';
import { localizeNoticeDateTimes } from '@kiao-dashboard-kit/date-time';
import type { ConversationRuntime } from './chatConversationReducer';
import { CHAT_USAGE_TAB_ID } from './constants';

export const ChatErrorNotice: React.FC<{
    error: ConversationRuntime['lastError'];
    onDismiss: () => void;
}> = ({ error, onDismiss }) => {
    const toolBars = useToolBars();
    if (!error) return null;

    return (
        <div className="chat-error-notice" role="alert">
            <ExclamationCircleOutlined className="chat-error-notice-icon" />
            <span className="chat-error-notice-text">{localizeNoticeDateTimes(error.message)}</span>
            {error.code === 'not_signed_in' && (
                <Button
                    type="link"
                    size="small"
                    onClick={() => toolBars.showTab(CHAT_USAGE_TAB_ID)}
                >
                    Open Usage to sign in
                </Button>
            )}
            <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={onDismiss}
                aria-label="Dismiss"
            />
        </div>
    );
};
