import React, { useState } from 'react';
import { Button } from 'antd';
import { BranchesOutlined, InfoCircleOutlined, RobotOutlined } from '@ant-design/icons';
import { ConfiguredMarkdown, zoomable, Tooltip } from '@cms-core';
import { localizeNoticeDateTimes } from '@cms-kit/date-time';
import type { ChatMessage, MessageBlock, SubagentDetail, ToolUse } from './chatMessages';
import { ChatSentAttachments } from './ChatAttachments';
import type { StickToBottom } from './useStickToBottom';

const usageNotice = /^(?:API Error\b|Claude(?: AI)? usage limit reached\b|You[’'](?:ve hit your|re out of usage credits)\b|Your (?:usage window resets|usage allocation has been|group[’']s usage limit)\b)/i;

/**
 * One run of prose the model wrote, rendered the way the CMS renders every other document it holds.
 *
 * It is `ConfiguredMarkdown` and not a bare `react-markdown` on purpose, and the difference is
 * visible in two places the model is told about in its briefing (`driver_claude.go`): a fenced
 * `mermaid` or `plantuml` block is drawn as the diagram it describes rather than printed as source,
 * and a link to a file of the store — `/units/abc/cadre.md` — resolves onto the app's mount point
 * and opens in place, through the one document-level listener `InternalLinkNavigator` installs.
 *
 * **This, and not the turn around it, is what a Ctrl-click magnifies.** A turn is prose, a tool
 * call, more prose, another tool call: what a reader wants larger is the passage they are reading,
 * so each run between two calls — and the last one after them all — is a zoom target of its own.
 * Enlarging the whole turn would drag its chips and its earlier paragraphs along with it. A diagram
 * inside the prose is a nearer target still, and is the one picked when it is what was clicked.
 * See cms-core/zoom.
 *
 * `documentFolder` is the conversation's own folder rather than the default — the folder the file
 * browser is showing — because a relative path in a reply is the model's, and the model's paths are
 * written against the folder it was started in.
 */
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

/**
 * One tool call where it happened. The chip is the same one the flat list used to show; what is new
 * is that it sits between the paragraphs rather than above them, and that it opens — the 80-char
 * summary is enough to follow a turn, and not enough to audit one.
 */
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

/**
 * Where the model stopped to reason, collapsed.
 *
 * **The text is normally empty, and that is the CLI's doing, not a gap here.** A `thinking` block
 * comes back carrying only an opaque signature — the reasoning itself is never put on the wire — so
 * what this marks is *that* the model thought and *where* in the turn, which is still the shape of
 * the turn and worth reading. It expands when there is something to expand, so a CLI that does
 * disclose the text needs no change here.
 */
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
                {/* A disabled button fires no mouse events, so the tooltip would never open on
                    it directly — the span carries the hover. */}
                {text ? toggle : <span style={{ display: 'inline-block' }}>{toggle}</span>}
            </Tooltip>
            {open && text && <div className="chat-thinking-text">{text}</div>}
        </div>
    );
};

/**
 * One delegation where it happened, collapsed: who was asked and to do what on the toggle line,
 * and what the child thought and did underneath once opened — its paragraphs, its reasoning and
 * its tool calls through the same rendering as the turn around it, with its nested delegations
 * the same way.
 */
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

/**
 * How the reply ended, when it did not end on its own. Both come from the transcript record: a turn
 * the user stopped (or one the service restarted under) is `interrupted`, and a reply that outgrew
 * the per-record cap is `truncated` — what is on screen is not all of it either way, which the
 * reader has no other way of telling.
 */
const EndMarkers: React.FC<{ message: ChatMessage }> = ({ message }) => {
    if (!message.interrupted && !message.truncated && !message.pending) return null;
    return (
        <div className="chat-message-markers">
            {message.pending && (
                <Tooltip title="The service has not taken this message yet.">
                    <span className="chat-message-marker">
                        not sent
                    </span>
                </Tooltip>
            )}
            {message.interrupted && (
                <Tooltip title="The turn was stopped before it finished.">
                    <span className="chat-message-marker">
                        interrupted
                    </span>
                </Tooltip>
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
 *
 * It lives on the message and not in the switcher's row of actions because *where* is the whole of
 * what a user chooses when they fork: a button above the transcript can only ever mean "at the end",
 * and the end is rarely the interesting place. The copy stops **short** of this message and hands
 * what was typed back to the box — forking a prompt is asking it again, differently, which is the
 * only reason to branch there at all.
 *
 * The panel does the same thing the VS Code extension does, by the same mechanism: the fork's first
 * turn resumes the CLI session at the reply above this prompt (`--resume-session-at`), so the copy is
 * one the agent remembers up to exactly the point the transcript shows and no further.
 */
const ForkFromHere: React.FC<{ onFork: () => void }> = ({ onFork }) => (
    <span className="chat-message-fork">
        <Tooltip title="Fork conversation from here — a copy of everything above, with this message handed back to be asked again">
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
    /** Absent when this message is no branch point: see {@link ChatMessageList}. */
    onFork?: () => void;
}> = ({ message, folder, onFork }) => {
    // A notice is this service speaking, not the model — the note left when a session could not be
    // resumed, say. It gets no bubble at all: passing it off as either side of the conversation is
    // exactly what the role exists to prevent.
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
    // A between is a user message that landed *inside* a turn instead of starting one. Same author,
    // same bubble, one caption — because the thing a reader needs, months later, is to know why the
    // reply above it changes direction.
    const between = isUser && message.between;
    // A reply recorded in order renders in order. Everything else — a user bubble, a notice, an
    // assistant record from before blocks existed — keeps the flat rendering it has always had, tool
    // chips above the text included: that record never carried an order, and drawing one would say
    // something untrue about a conversation the user can still read.
    const ordered = !isUser && message.blocks !== undefined;
    return (
        <div className={`chat-message chat-message--${message.role}`
            + `${message.pending ? ' chat-message--pending' : ''}`
            + `${between ? ' chat-message--between' : ''}`}
        >
            <div className="chat-message-bubble">
                {between && (
                    <div className="chat-message-markers chat-message-markers--above">
                        <Tooltip title="Said while the turn was running. The agent was given it at its next step and carried on — no second turn was started.">
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
                    // What was typed is one block and always was, so the whole of it is the target.
                    <div className="chat-message-text" {...zoomable}>{message.content}</div>
                ) : (
                    <ReplyMarkdown folder={folder}>{message.content || ''}</ReplyMarkdown>
                )}
                {/* What the user handed this turn, under what they typed — a conversation about a
                    screenshot is unreadable a week later without the screenshot in it. */}
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
            </div>
            {onFork && <ForkFromHere onFork={onFork} />}
        </div>
    );
};

/**
 * Which messages a conversation can be forked from: a prompt of its own, recorded, and settled.
 *
 * A **notice** is this service talking and an **assistant** message is the reply — neither is a
 * question anyone can ask again, which is what forking from a message means here. A **between** was
 * said into a running turn rather than starting one, so there is no turn boundary at it to branch on.
 * A **pending** message was refused and never reached the transcript, so the service has no record to
 * fork from — offering it would promise a branch point that does not exist.
 */
const isBranchPoint = (message: ChatMessage): boolean =>
    message.role === 'user' && !message.between && !message.pending && !message.isStreaming;

/**
 * Where a conversation is kept, relative to the store root: one directory per conversation under
 * the service's state directory, named by the conversation's id. The state directory is
 * `.kiao-config` at the store root in the default layout — see `StateDirName` (`core/state.go`)
 * and `ConversationsDirName` (`hybridflow-runner/conversations.go`) — and a deployment with a custom absolute
 * state path keeps them elsewhere instead. The file API cannot reach that directory either way,
 * so the line is for reference — selected and copied, not clicked.
 */
const CONVERSATION_STORAGE_PREFIX = '.kiao-config/conversations';

/**
 * Scrollable chat history: where the conversation is kept, then empty prompt hint or one bubble
 * per message.
 *
 * This is the scrolling element, so it is where {@link useStickToBottom} is attached — the newest
 * message is followed from here, and only while the reader has not scrolled back into the
 * conversation. The storage line scrolls with the rest rather than staying pinned: it is read
 * once, for reference, and costs no room afterwards.
 */
export const ChatMessageList: React.FC<{
    messages: ChatMessage[];
    stick: StickToBottom;
    /** The conversation's working folder, which the relative paths in a reply are written against. */
    folder: string;
    /**
     * The conversation on screen, naming where it is kept: {@link CONVERSATION_STORAGE_PREFIX}
     * plus this id. Null is the main column with nothing selected, which has no storage to name.
     */
    conversationId: string | null;
    /**
     * Forks the conversation at one of its prompts. Absent while a turn is running — the service
     * refuses to fork a conversation it is still writing, and an action that is always refused is
     * better not offered.
     */
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
                <p>Ask the agent anything about this project.<br />Ctrl+Enter to send.</p>
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
