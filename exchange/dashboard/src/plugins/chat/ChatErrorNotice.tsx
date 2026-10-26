// ── What the service said no to ───────────────────────────────────────────────
//
// One line above the input for every refusal the service returns. The protocol has nine error codes
// and each of them ends a prompt the user is waiting on: a turn refused for the concurrency cap, a
// `claude` binary the host cannot start, a conversation deleted from another tab, the CLI failing
// mid-turn. Left unrendered, all of them look the same from the panel — a prompt that went nowhere,
// with no spinner, no reply and nothing to read.
//
// It is dismissible because none of them is a state the user has to clear: the turn is over either
// way, and the next prompt replaces the message anyhow.
//
// The one refusal with somewhere to go is the sign-in: a turn that never ran because the host is
// signed out carries a link to the Usage tab, where that agent's Login is offered.

import React from 'react';
import { Button } from 'antd';
import { CloseOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useToolBars } from '@cms-core';
import { localizeNoticeDateTimes } from '@cms-kit/date-time';
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
