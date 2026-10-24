// ── The usage panel ───────────────────────────────────────────────────────────
//
// One section per agent this deployment offers, one after the other: the agent's name, a refresh,
// and the account's gauges. Every section starts empty — nothing is read until its refresh is
// pressed — and a refresh reads that agent's account only, so asking about Muse never spends
// anything of Claude's.
//
// The figures live in the app-level provider (ChatUsage-ctx) rather than in this tab: what a
// refresh recorded is then what any surface reads, and a second surface showing the quota — a
// warning beside a conversation running low — asks for no second read.

import React from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { AgentLoginOffer } from 'kiao-worker';
import { useChatOptionLists } from './useChatOptionLists';
import { useChatUsage } from './ChatUsage-ctx';
import { ChatUsagePanel } from './ChatUsagePanel';
import { ChatSignIn } from './ChatSignIn';
import './ChatPrompt.css';

const ChatUsageSection: React.FC<{ agent: string; label: string; login?: AgentLoginOffer }> = ({
    agent, label, login,
}) => {
    const { usage, loading, error, refresh } = useChatUsage(agent);
    // The sign-in the service advertises for this agent — offered only where it holds a shape the
    // panel can drive, so a method nobody has a case for is left alone rather than a button that
    // cannot work.
    const methods = login?.methods ?? [];
    const signIn = methods.includes('device') || methods.includes('api-key') ? login : undefined;
    return (
        <section className="chat-usage-section" aria-label={label}>
            <div className="chat-usage-section-head">
                <span className="chat-usage-section-title">{label}</span>
                <span className="chat-usage-section-actions">
                    {signIn && <ChatSignIn agent={agent} label={label} login={signIn} />}
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => void refresh()}
                        loading={loading}
                        aria-label={`Actualiser l'usage ${label}`}
                    >
                        Actualiser
                    </Button>
                </span>
            </div>
            <ChatUsagePanel usage={usage} loading={loading} error={error} />
        </section>
    );
};

export const ChatUsageTab: React.FC = () => {
    // Wait for the service before saying whether an agent is enabled and available.
    const { agents, loading } = useChatOptionLists();

    if (!loading && agents.length === 0) {
        return (
            <div className="chat-usage-tab chat-usage-tab--empty">
                No agent is enabled and available. Enable or install Claude Code, Codex, Muse or
                OpenCode in the configuration panel, and this tab will show their usage.
            </div>
        );
    }
    return (
        <div className="chat-usage-tab">
            {agents.map(entry => (
                <ChatUsageSection
                    key={entry.value}
                    agent={entry.value}
                    label={entry.label || entry.value}
                    login={entry.login}
                />
            ))}
        </div>
    );
};
