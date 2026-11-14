import React from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { HarnessLoginOffer } from 'kiao-worker';
import { useChatOptionLists } from './useChatOptionLists';
import { useChatUsage } from './ChatUsage-ctx';
import { ChatUsagePanel } from './ChatUsagePanel';
import { ChatSignIn } from './ChatSignIn';
import './ChatPrompt.css';

const ChatUsageSection: React.FC<{ harness: string; label: string; login?: HarnessLoginOffer }> = ({
    harness, label, login,
}) => {
    const { usage, loading, error, refresh } = useChatUsage(harness);
    const methods = login?.methods ?? [];
    const signIn = methods.includes('device') || methods.includes('api-key') ? login : undefined;
    return (
        <section className="chat-usage-section" aria-label={label}>
            <div className="chat-usage-section-head">
                <span className="chat-usage-section-title">{label}</span>
                <span className="chat-usage-section-actions">
                    {signIn && <ChatSignIn harness={harness} label={label} login={signIn} />}
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => void refresh()}
                        loading={loading}
                        aria-label={`Refresh usage for ${label}`}
                    >
                        Refresh
                    </Button>
                </span>
            </div>
            <ChatUsagePanel usage={usage} loading={loading} error={error} />
        </section>
    );
};

export const ChatUsageTab: React.FC = () => {
    const { harnesses, loading } = useChatOptionLists();

    if (!loading && harnesses.length === 0) {
        return (
            <div className="chat-usage-tab chat-usage-tab--empty">
                No harness is enabled and available. Enable or install Claude Code, Codex, Muse or
                OpenCode in the configuration panel, and this tab will show their usage.
            </div>
        );
    }
    return (
        <div className="chat-usage-tab">
            {harnesses.map(entry => (
                <ChatUsageSection
                    key={entry.value}
                    harness={entry.value}
                    label={entry.label || entry.value}
                    login={entry.login}
                />
            ))}
        </div>
    );
};
