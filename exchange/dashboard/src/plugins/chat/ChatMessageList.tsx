import React, { useState } from 'react';
import { Button } from 'antd';
import { BranchesOutlined, InfoCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { ConfiguredMarkdown, zoomable, Tooltip } from '@kiao-dashboard-core';
import { localizeNoticeDateTimes } from '@kiao-dashboard-kit/date-time';
import type { ChatMessage, MessageBlock, SubagentDetail, ToolUse } from './chatMessages';
import { ChatSentAttachments } from './ChatAttachments';
import type { StickToBottom } from '@kiao-dashboard-core';

const usageNotice = /^(?:API Error\b|Claude(?: AI)? usage limit reached\b|You[’'](?:ve hit your|re out of usage credits)\b|Your (?:usage window resets|usage allocation has been|group[’']s usage limit)\b)/i;

/** One run of prose the model wrote, rendered the way the CMS renders every other document it holds. */
const ReplyMarkdown: React.FC<{ folder: string; children: string }> = ({ folder, children }) => (
    <div className="chat-text-block" {...zoomable}>
        <ConfiguredMarkdown className="chat-message-markdown" documentFolder={folder}>
            {usageNotice.test(children.trim()) ? localizeNoticeDateTimes(children) : children}
        </ConfiguredMarkdown>
    </div>
);

const ToolUseIndicator: React.FC<{ toolUses: ToolUse[] }> = ({ toolUses }) => (
    <div className="chat-tool-uses">
        {toolUses.map((t, i) => (
            <span key={i} className="chat-tool-use-badge" title={t.summary}>
                🔧 {t.summary}
            </span>
        ))}
    </div>
);

/** One tool call where it happened. */
const ToolUseBlock: React.FC<{ tool: ToolUse }> = ({ tool }) => {
    const [open, setOpen] = useState(false);
    if (!tool.detail) {
        return <div className="chat-tool-uses"><span className="chat-tool-use-badge" title={tool.summary}>🔧 {tool.summary}</span></div>;
    }
    return (
        <div className="chat-tool-uses">
            <button
                type="button"
                className="chat-tool-use-badge chat-tool-use-badge--openable"
                aria-expanded={open}
                title={tool.summary}
                onClick={() => setOpen(o => !o)}
            >
                🔧 {tool.summary}
            </button>
            {open && <pre className="chat-tool-detail">{tool.detail}</pre>}
        </div>
    );
};

/** Where the model stopped to reason, collapsed. **The text is normally empty, and that is the CLI's. */
const ThinkingBlock: React.FC<{ text: string }> = ({ text }) => {
    const [open, setOpen] = useState(false);
    const toggle = (
        <button
            type="button"
            className="chat-thinking-toggle"
            aria-expanded={open}
            disabled={!text}
            onClick={() => setOpen(o => !o)}
        >
            💭 {text ? `Thought · ${text.length} characters` : 'Thought'}
        </button>
    );
    return (
        <div className="chat-thinking">
            <Tooltip title={text ? undefined : 'The model thought here. The CLI does not disclose the reasoning itself.'}>
                {/* A disabled button fires no mouse events, so the tooltip would never open on it directly — the span carries the hover. */}
                {text ? toggle : <span style={{ display: 'inline-block' }}>{toggle}</span>}
            </Tooltip>
            {open && text && <div className="chat-thinking-text">{text}</div>}
        </div>
    );
};

/** One delegation where it happened, collapsed: who was asked and to do what on the toggle line,. */
const SubagentBlock: React.FC<{ text: string; subagent: SubagentDetail; folder: string }> = ({ text, subagent, folder }) => {
    const [open, setOpen] = useState(false);
    const thoughts = subagent.blocks.filter(block => block.kind === 'thinking').length;
    const tools = subagent.blocks.filter(block => block.kind === 'tool_use').length;
    const counts = [
        thoughts === 1 ? '1 thought' : thoughts > 1 ? `${thoughts} thoughts` : '',
        tools === 1 ? '1 tool' : tools > 1 ? `${tools} tools` : '',
    ].filter(Boolean).join(', ');
    const headline = ['🤖 Subagent', subagent.role, subagent.status].filter(Boolean).join(' · ');
    // What the child was asked: its objective, or the parent's line where it never said more.
    const asked = subagent.objective || text;
    const expandable = subagent.blocks.length > 0 || !!subagent.result;
    return (
        <div
            className="chat-subagent"
            title={subagent.childSessionId ? `Child session ${subagent.childSessionId}` : undefined}
        >
            <button
                type="button"
                className="chat-subagent-toggle"
                aria-expanded={open}
                disabled={!expandable}
                onClick={() => setOpen(o => !o)}
            >
                {headline}{counts ? ` · ${counts}` : ''}
            </button>
            {asked && <div className="chat-subagent-objective">{asked}</div>}
            {open && expandable && (
                <div className="chat-subagent-body">
                    {subagent.result && <ReplyMarkdown folder={folder}>{subagent.result}</ReplyMarkdown>}
                    <MessageBlocks blocks={subagent.blocks} folder={folder} />
                    {subagent.truncated && (
                        <div className="chat-subagent-truncated">
                            Showing the most recent of a longer transcript.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/** The reply in the order it happened: one element per block, and no reordering of any kind. */
const MessageBlocks: React.FC<{ blocks: MessageBlock[]; folder: string }> = ({ blocks, folder }) => (
    <>
        {blocks.map((block, i) => {
            if (block.kind === 'tool_use') return <ToolUseBlock key={i} tool={block} />;
            if (block.kind === 'thinking') return <ThinkingBlock key={i} text={block.text} />;
            if (block.kind === 'subagent') {
                return <SubagentBlock key={i} text={block.text} subagent={block.subagent} folder={folder} />;
            }
            return <ReplyMarkdown key={i} folder={folder}>{block.text}</ReplyMarkdown>;
        })}
    </>
);

const StreamingDot: React.FC = () => (
    <span className="chat-streaming-dots">
        <span /><span /><span />
    </span>
);

/** How the reply ended, when it did not end on its own. */
const EndMarkers: React.FC<{ message: ChatMessage }> = ({ message }) => {
    if (!message.interrupted && !message.truncated && !message.pending) return null;
    return (
        <div className="chat-message-markers">
            {message.pending && (
                <span aria-label="The service has not taken this message yet." className="chat-message-marker">
                    not sent
                </span>
            )}
            {message.interrupted && (
                <span aria-label="The turn was stopped before it finished." className="chat-message-marker">
                    interrupted
                </span>
            )}
            {message.truncated && (
                <Tooltip title="The reply was too long to record in full.">
                    <span className="chat-message-marker">
                        truncated
                    </span>
                </Tooltip>
            )}
        </div>
    );
};

/**
 * Where a conversation branches, asked of the prompt it branches at.
 * It lives on the message and not in the switcher's row of actions because *where* is the whole of.
 */
const ForkFromHere: React.FC<{ onFork: () => void }> = ({ onFork }) => (
    <span className="chat-message-fork">
        <Tooltip title="Copies preceding messages into a new conversation, ready to ask this message again.">
            <Button
                size="small"
                type="text"
                icon={<BranchesOutlined />}
                aria-label="Fork conversation from here"
                onClick={onFork}
            />
        </Tooltip>
    </span>
);

const MessageBubble: React.FC<{
    message: ChatMessage;
    folder: string;

    onFork?: () => void;
}> = ({ message, folder, onFork }) => {
    if (message.role === 'notice') {
        return (
            <div className="chat-message chat-message--notice">
                <div className="chat-notice">
                    <InfoCircleOutlined /> <span>{localizeNoticeDateTimes(message.content)}</span>
                </div>
            </div>
        );
    }

    const isUser = message.role === 'user';
    // A between is a user message that landed *inside* a turn instead of starting one.
    const between = isUser && message.between;
    // A reply recorded in order renders in order.
    const ordered = !isUser && message.blocks !== undefined;
    return (
        <div className={`chat-message chat-message--${message.role}`
            + `${message.pending ? ' chat-message--pending' : ''}`
            + `${between ? ' chat-message--between' : ''}`}
        >
            <div className="chat-message-bubble">
                {between && (
                    <div className="chat-message-markers chat-message-markers--above">
                        <Tooltip title="Delivered at the next step of the running turn; continues the same turn.">
                            <span className="chat-message-marker">
                                said mid-turn
                            </span>
                        </Tooltip>
                    </div>
                )}
                {!ordered && message.toolUses && message.toolUses.length > 0 && (
                    <ToolUseIndicator toolUses={message.toolUses} />
                )}
                {ordered ? (
                    <MessageBlocks blocks={message.blocks!} folder={folder} />
                ) : isUser ? (
                    <div className="chat-message-text" {...zoomable}>{message.content}</div>
                ) : (
                    <ReplyMarkdown folder={folder}>{message.content || ''}</ReplyMarkdown>
                )}
                {/* What the user handed this turn, under what they typed — a conversation about a screenshot is unreadable a week later. */}
                <ChatSentAttachments attachments={message.attachments} />
                {!!message.queue?.length && <div className="chat-queue" data-testid="chat-queue">
                    {message.queue.map(item => <div key={item.id}><strong>{item.state}</strong> · {item.text}</div>)}
                </div>}
                {message.isStreaming && <StreamingDot />}
                {(message.execution || message.usage) && <div className="chat-message-markers" data-testid="chat-turn-details">
                    {message.execution && <span>{message.execution.provider}/{message.execution.model} · {message.execution.effort}</span>}
                    {message.usage && <span>
                        {message.usage.scope === 'session' ? 'Session' : 'Turn'}
                        {message.usage.inputTokens !== undefined && ` · ${message.usage.inputTokens.toLocaleString()} input tokens`}
                        {message.usage.outputTokens !== undefined && ` · ${message.usage.outputTokens.toLocaleString()} output tokens`}
                        {message.usage.totalCostUSD !== undefined && ` · $${message.usage.totalCostUSD.toFixed(6)}`}
                    </span>}
                </div>}
                <EndMarkers message={message} />
                {message.failureReason && <div className="chat-notice" role="status">
                    <InfoCircleOutlined /> <span>{localizeNoticeDateTimes(message.failureReason)}</span>
                </div>}
            </div>
            {onFork && <ForkFromHere onFork={onFork} />}
        </div>
    );
};

/** Which messages a conversation can be forked from: a prompt of its own, recorded, and settled. */
const isBranchPoint = (message: ChatMessage): boolean =>
    message.role === 'user' && !message.between && !message.pending && !message.isStreaming;

/** Where a conversation is kept, relative to the store root: one directory per conversation under. */
const CONVERSATION_STORAGE_PREFIX = '.kiao-config/conversations';

/** Scrollable chat history: where the conversation is kept, then empty prompt hint or one bubble per. */
export const ChatMessageList: React.FC<{
    messages: ChatMessage[];
    stick: StickToBottom;

    folder: string;

    conversationId: string | null;

    onFork?: (message: ChatMessage) => void;
}> = ({ messages, stick, folder, conversationId, onFork }) => (
    <div className="chat-messages-area" ref={stick.ref} onScroll={stick.onScroll}>
        {conversationId !== null && (
            <div
                className="chat-conversation-storage"
                title={`${CONVERSATION_STORAGE_PREFIX}/${conversationId}`}
            >
                {`${CONVERSATION_STORAGE_PREFIX}/${conversationId}`}
            </div>
        )}
        {messages.length === 0 ? (
            <div className="chat-empty-state">
                <RobotOutlined className="chat-empty-icon" />
                <p>Ask the harness anything about this project.<br />Ctrl+Enter to send.</p>
            </div>
        ) : (
            messages.map(m => (
                <MessageBubble
                    key={m.id}
                    message={m}
                    folder={folder}
                    onFork={onFork && isBranchPoint(m) ? () => onFork(m) : undefined}
                />
            ))
        )}
    </div>
);
