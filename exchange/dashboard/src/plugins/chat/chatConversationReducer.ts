// Live or last turn from `/ws/hybridflow-runner`; settled history belongs to the REST transcript.

import type {
    AgentQueuedMessage,
    AgentBackgroundState,
    AgentConversationMessage,
    AgentErrorCode,
    AgentPermissionMode,
    AgentWireBackgroundChild,
    AgentWireBackgroundTask,
    AgentWireBlock,
    AgentWirePermissionRequest,
    AgentWireQuestionRequest,
    AgentWireSubagent,
    AgentWireToolUse,
} from 'kiao-worker';
import type {
    BackgroundChild, BackgroundState, BackgroundTask,
    MessageBlock, PermissionRequest, QuestionRequest, SubagentDetail, ToolUse,
} from './chatMessages';

export interface ConversationRuntime {
    queue?: AgentQueuedMessage[];
    conversationId: string;
    /** Epoch fence; null until the first `start` or `sync`. */
    turnId: string | null;
    running: boolean;
    sessionId: string | null;
    /** Live or last turn prompt, shown optimistically. */
    userText: string;
    /** Ordered user interjections, already persisted but shown here until the end-of-turn REST read. */
    betweens: string[];
    /** Text, thinking and tool calls interleaved in model order. */
    blocks: MessageBlock[];
    /** Whole background roster, including finished work; each `background` frame replaces it. */
    background: BackgroundTask[];
    permissionRequests: PermissionRequest[];
    /** Questions require a user answer; no permission mode may answer them automatically. */
    questionRequests: QuestionRequest[];
    /** From the turn's `start`/`sync`; toolbar and conversation settings may describe the next turn. */
    permissionMode: AgentPermissionMode | null;
    lastError: { code: AgentErrorCode; message: string } | null;
    /**
     * Ephemeral driver notice; each replaces the last. Turn boundaries and host activity clear it;
     * a sync of the same running turn preserves it.
     */
    notice: string | null;
    /** Only `stopped` sets this: callers must distinguish external termination from completion. */
    stopped: boolean;
    /** View-owned flag: REST has taken over this turn, so suppress its live bubbles. Reset for a new turn. */
    settled: boolean;
    /**
     * First seen already finished via `sync`: records precede completion, so render from REST.
     * Unlike `settled`, this does not confirm the transcript has been read.
     */
    arrivedFinished: boolean;
    /** Unacknowledged or refused prompt, held apart because `sync` overwrites `userText`. */
    pendingText: string;
    /** Waiting for `start`; the epoch still names the previous turn while `running` may be optimistic. */
    awaitingStart: boolean;
}

export const emptyRuntime = (conversationId: string): ConversationRuntime => ({
    conversationId,
    turnId: null,
    running: false,
    sessionId: null,
    userText: '',
    betweens: [],
    queue: [],
    blocks: [],
    background: [],
    permissionRequests: [],
    questionRequests: [],
    permissionMode: null,
    lastError: null,
    notice: null,
    stopped: false,
    settled: false,
    arrivedFinished: false,
    pendingText: '',
    awaitingStart: false,
});

/**
 * Only these refusals guarantee no process remains; `spawn_failed` has already closed its record.
 * `cli_error` can precede more output, `not_permitted` can reject another tab's stop, and
 * `conversation_busy` means a turn is running. Unknown codes must also preserve the live turn,
 * its Stop button, epoch fence and transcript handover.
 */
const SETTLING_ERRORS: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
    'unknown_conversation',
    'bad_folder',
    'profile_unavailable',
    'unknown_permission_mode',
    'too_many_turns',
    'spawn_failed',
]);

/** Shared tool summary for socket frames and REST history. */
export const summariseTool = (name: string, input?: string): string =>
    name + (input ? `(${input})` : '');

const toToolUse = (wire: AgentWireToolUse): ToolUse => ({
    name: wire.name,
    summary: summariseTool(wire.name, wire.input),
    detail: wire.detail,
});

/** Shared block conversion for live frames and REST history, including nested delegations. */
export const toMessageBlock = (wire: AgentWireBlock): MessageBlock => {
    if (wire.kind === 'tool_use') return { kind: 'tool_use', ...toToolUse(wire) };
    if (wire.kind === 'subagent') {
        // A delegation without child details still renders the parent's text.
        if (!wire.subagent) return { kind: 'text', text: wire.text };
        return { kind: 'subagent', text: wire.text, subagent: toSubagentDetail(wire.subagent) };
    }
    return { kind: wire.kind, text: wire.text };
};

const toSubagentDetail = (wire: AgentWireSubagent): SubagentDetail => ({
    subagentId: wire.subagentId,
    childSessionId: wire.childSessionId,
    role: wire.role,
    objective: wire.objective,
    status: wire.status,
    result: wire.result,
    truncated: wire.truncated,
    blocks: (wire.blocks ?? []).map(toMessageBlock),
});

/** Preserve unknown lanes verbatim; guessing `running` could leave the UI waiting forever. */
const toBackgroundState = (state: AgentBackgroundState): BackgroundState => state;

const toBackgroundChild = (wire: AgentWireBackgroundChild): BackgroundChild => ({
    childId: wire.childId,
    label: wire.label ?? wire.childId,
    status: wire.status,
    state: toBackgroundState(wire.state),
    terminal: wire.terminal,
});

export const toBackgroundTask = (wire: AgentWireBackgroundTask): BackgroundTask => ({
    id: wire.id,
    kind: wire.kind,
    label: wire.label,
    status: wire.status,
    state: toBackgroundState(wire.state),
    children: (wire.children ?? []).map(toBackgroundChild),
});

/** Match server settlement: unfinished tasks and children become abandoned when the turn ends. */
export const settleBackground = (tasks: BackgroundTask[]): BackgroundTask[] => tasks.map(task => ({
    ...task,
    state: 'finished',
    status: task.state === 'finished' ? task.status : 'abandoned',
    children: task.children.map(child => ({
        ...child,
        state: 'finished',
        status: child.state === 'finished' ? child.status : 'abandoned',
    })),
}));

/**
 * Deltas arrive in order; wire indices fix block positions. Pad gaps so a missing frame
 * cannot shift subsequent blocks.
 */
const appendDelta = (
    blocks: MessageBlock[],
    index: number,
    kind: 'text' | 'thinking',
    data: string,
): MessageBlock[] => {
    const next = blocks.slice();
    while (next.length <= index) next.push({ kind, text: '' });
    const held = next[index];
    next[index] = { kind, text: (held.kind === 'tool_use' ? '' : held.text) + data };
    return next;
};

const toPermissionRequest = (wire: AgentWirePermissionRequest): PermissionRequest => ({
    requestId: wire.requestId,
    toolName: wire.displayName || wire.toolName,
    description: wire.description,
    input: wire.input,
    // Preserve the server deadline across syncs; reconnecting must not restart the countdown.
    decideAt: wire.decideAt,
});

const toQuestionRequest = (wire: AgentWireQuestionRequest): QuestionRequest => ({
    requestId: wire.requestId,
    toolName: wire.toolName,
    questions: (wire.questions ?? []).map(question => ({
        question: question.question,
        header: question.header,
        multiSelect: question.multiSelect,
        options: question.options ?? [],
    })),
});

/**
 * Reject stale-turn frames before aggregation. Only `start` and `sync` move the epoch;
 * frames without a turnId belong to no turn and bypass the fence.
 */
export const applyFrame = (
    state: ConversationRuntime,
    msg: AgentConversationMessage,
): ConversationRuntime => {
    const movesEpoch = msg.type === 'start' || msg.type === 'sync';
    if (!movesEpoch && 'turnId' in msg && msg.turnId && state.turnId && msg.turnId !== state.turnId) {
        return state;
    }

    switch (msg.type) {
        case 'queue': return { ...state, queue: msg.messages };
        case 'start':
            // Session outlives turns; `start` omits the prompt already shown by the sending tab.
            return {
                ...emptyRuntime(msg.conversationId),
                turnId: msg.turnId,
                running: true,
                sessionId: state.sessionId,
                userText: state.userText,
                permissionMode: msg.permissionMode,
            };
        case 'sync': {
            // Recover a missed `start` after reconnect: the service persists the prompt before spawning.
            // Preserve refused prompts even if an older turn has identical text; `send` clears lastError.
            const answered = !state.lastError && !!state.pendingText && state.pendingText === msg.userText;
            const pendingText = answered ? '' : state.pendingText;
            // Sync is a full snapshot: replace collections to avoid duplicating replayed content.
            return {
                conversationId: msg.conversationId,
                turnId: msg.turnId,
                running: msg.running,
                sessionId: msg.sessionId ?? state.sessionId,
                userText: msg.userText,
                betweens: msg.betweens ?? [],
                queue: msg.queue ?? [],
                blocks: (msg.blocks ?? []).map(toMessageBlock),
                background: (msg.background ?? []).map(toBackgroundTask),
                permissionRequests: (msg.pendingPermissions ?? []).map(toPermissionRequest),
                questionRequests: (msg.pendingQuestions ?? []).map(toQuestionRequest),
                permissionMode: msg.permissionMode,
                // A refused prompt has no server turn; keep its local error and recovery action.
                lastError: pendingText ? state.lastError : null,
                notice: msg.running && msg.turnId === state.turnId ? state.notice : null,
                pendingText,
                // Sync carries no stopped flag; preserve it only for the same turn.
                stopped: msg.turnId === state.turnId && state.stopped,
                // Replayed finished turns may already be in REST; preserve handover to avoid duplicate bubbles.
                settled: !msg.running && msg.turnId === state.turnId && state.settled,
                // An unseen finished turn is already on disk and must be displayed from REST.
                arrivedFinished: !msg.running && (msg.turnId !== state.turnId || state.arrivedFinished),
                awaitingStart: false,
            };
        }
        case 'not_running':
            return {
                ...state,
                running: false,
                background: [],
                permissionRequests: [],
                questionRequests: [],
                awaitingStart: false,
                notice: null,
            };
        case 'session':
            return { ...state, sessionId: msg.sessionId, notice: null };
        case 'between':
            // Do not deduplicate: each frame represents one delivered remark, even when texts match.
            return { ...state, betweens: [...state.betweens, msg.text] };
        case 'notice':
            return { ...state, notice: msg.text };
        case 'output':
            return { ...state, blocks: appendDelta(state.blocks, msg.index, msg.kind, msg.data), notice: null };
        case 'tool_use': {
            // Whole indexed call: replay replaces the same block rather than adding a duplicate.
            const blocks = state.blocks.slice();
            while (blocks.length <= msg.index) blocks.push({ kind: 'text', text: '' });
            blocks[msg.index] = { kind: 'tool_use', ...toToolUse(msg) };
            return { ...state, blocks, notice: null };
        }
        case 'subagent': {
            // Whole indexed delegation, including its transcript; replay replaces the block.
            const blocks = state.blocks.slice();
            while (blocks.length <= msg.index) blocks.push({ kind: 'text', text: '' });
            blocks[msg.index] = toMessageBlock(msg);
            return { ...state, blocks, notice: null };
        }
        case 'background':
            // Full roster snapshot; merging would duplicate existing entries.
            return { ...state, background: msg.tasks.map(toBackgroundTask), notice: null };
        case 'permission_request':
            // Replayed requests must preserve state identity and avoid duplicate cards.
            return state.permissionRequests.some(request => request.requestId === msg.requestId)
                ? state
                : {
                    ...state,
                    permissionRequests: [...state.permissionRequests, toPermissionRequest(msg)],
                    notice: null,
                };
        case 'question_request':
            // Replayed questions must preserve state identity and avoid duplicate cards.
            return state.questionRequests.some(request => request.requestId === msg.requestId)
                ? state
                : {
                    ...state,
                    questionRequests: [...state.questionRequests, toQuestionRequest(msg)],
                    notice: null,
                };
        case 'permission_resolved':
            // Request IDs are unique across permissions and questions; resolution clears either kind.
            return {
                ...state,
                permissionRequests: state.permissionRequests.filter(request => request.requestId !== msg.requestId),
                questionRequests: state.questionRequests.filter(request => request.requestId !== msg.requestId),
            };
        case 'done':
        case 'stopped':
            return {
                ...state,
                running: false,
                background: settleBackground(state.background),
                permissionRequests: [],
                questionRequests: [],
                awaitingStart: false,
                notice: null,
                stopped: msg.type === 'stopped',
            };
        case 'error': {
            const lastError = { code: msg.code, message: msg.message };
            // Even non-settling errors end the wait for `start`: a refused prompt will not spawn.
            if (!SETTLING_ERRORS.has(msg.code)) return { ...state, lastError, awaitingStart: false };
            return {
                ...state,
                running: false,
                background: settleBackground(state.background),
                permissionRequests: [],
                questionRequests: [],
                awaitingStart: false,
                notice: null,
                // A refusal without a turnId wrote no transcript: clear the old epoch to keep the prompt visible.
                // A failed spawn names its own turn, whose record was already written.
                turnId: msg.turnId ?? null,
                lastError,
            };
        }
        default: {
            const unhandled: never = msg;
            console.warn('[agent] unhandled frame', unhandled);
            return state;
        }
    }
};
