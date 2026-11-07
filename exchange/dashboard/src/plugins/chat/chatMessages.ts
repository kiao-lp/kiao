
import type { AgentAttachment, AgentQueuedMessage, AgentTurnExecution, AgentTurnUsage } from 'kiao-worker';

/** `notice` is service-authored text the CLI never saw, not model output. */
export type MessageRole = 'user' | 'assistant' | 'notice';

export interface ToolUse {
    name: string;
    summary: string;

    detail?: string;
}

/** Service lanes: waiting on its owner; finished includes failure and abandonment at turn end. */
export type BackgroundState = 'running' | 'waiting' | 'finished';

/** `terminal` uses the turn's vocabulary; absent while the child is running. */
export interface BackgroundChild {
    childId: string;
    label: string;
    status: string;
    state: BackgroundState;
    terminal?: string;
}

/** `status` is the host's word; `state` is its counting lane. Only workflows have children. */
export interface BackgroundTask {
    id: string;
    kind: string;
    label: string;
    status: string;
    state: BackgroundState;
    children: BackgroundChild[];
}

/** Child blocks retain production order, including nested delegations; `truncated` marks an incomplete. */
export interface SubagentDetail {
    subagentId?: string;
    childSessionId?: string;
    role?: string;
    objective?: string;
    status?: string;
    result?: string;
    truncated?: boolean;
    blocks: MessageBlock[];
}

/** Blocks preserve production order across text, reasoning and tool calls. */
export type MessageBlock =
    | { kind: 'text'; text: string }
    | { kind: 'thinking'; text: string }
    | ({ kind: 'tool_use' } & ToolUse)
    | { kind: 'subagent'; text: string; subagent: SubagentDetail };

export interface ChatMessage {
    execution?: AgentTurnExecution;
    usage?: AgentTurnUsage;
    queue?: AgentQueuedMessage[];
    id: string;
    role: MessageRole;
    content: string;

    between?: boolean;
    /** User bubbles only; sourced from the stored transcript, not the sending composer. */
    attachments?: AgentAttachment[];

    blocks?: MessageBlock[];
    toolUses?: ToolUse[];
    isStreaming?: boolean;

    pending?: boolean;

    interrupted?: boolean;

    failureReason?: string;
    truncated?: boolean;
}

/** From permission_request: toolName already uses displayName when available; input is preformatted. */
export interface PermissionRequest {
    requestId: string;
    toolName: string;
    description?: string;
    input?: string;
    /** Epoch milliseconds for worker auto-approval (manualLive only); UI counts down and offers Deny. */
    decideAt?: number;
}

/** The selected label is sent back. */
export interface QuestionOption {
    label: string;
    description?: string;
    preview?: string;
}

/** Options are suggestions; free text is always accepted. */
export interface Question {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: QuestionOption[];
}

/** Separate from permissions; never answered automatically, regardless of permission mode. */
export interface QuestionRequest {
    requestId: string;
    toolName: string;
    questions: Question[];
}
