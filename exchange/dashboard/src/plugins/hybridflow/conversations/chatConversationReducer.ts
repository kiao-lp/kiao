
import type {
    HarnessQueuedMessage,
    HarnessBackgroundState,
    HarnessConversationMessage,
    HarnessErrorCode,
    HarnessPermissionMode,
    HarnessWireBackgroundChild,
    HarnessWireBackgroundTask,
    HarnessWireBlock,
    HarnessWirePermissionRequest,
    HarnessWireQuestionRequest,
    HarnessWireSubagent,
    HarnessWireToolUse,
} from 'kiao-worker';
import type {
    BackgroundChild, BackgroundState, BackgroundTask,
    MessageBlock, PermissionRequest, QuestionRequest, SubagentDetail, ToolUse,
} from './chatMessages';

export interface ConversationRuntime {
    queue?: HarnessQueuedMessage[];
    conversationId: string;

    turnId: string | null;
    running: boolean;
    sessionId: string | null;
    userText: string;

    betweens: string[];

    blocks: MessageBlock[];

    background: BackgroundTask[];
    permissionRequests: PermissionRequest[];
    /** Questions require a user answer; no permission mode may answer them automatically. */
    questionRequests: QuestionRequest[];

    permissionMode: HarnessPermissionMode | null;
    lastError: { code: HarnessErrorCode; message: string } | null;

    notice: string | null;
    /** Only `stopped` sets this: callers must distinguish external termination from completion. */
    stopped: boolean;

    settled: boolean;

    arrivedFinished: boolean;
    /** Unacknowledged or refused prompt, held apart because `sync` overwrites `userText`. */
    pendingText: string;

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

/** Only these refusals guarantee no process remains; `spawn_failed` has already closed its record. */
const SETTLING_ERRORS: ReadonlySet<HarnessErrorCode> = new Set<HarnessErrorCode>([
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

const toToolUse = (wire: HarnessWireToolUse): ToolUse => ({
    name: wire.name,
    summary: summariseTool(wire.name, wire.input),
    detail: wire.detail,
});

/** Shared block conversion for live frames and REST history, including nested delegations. */
export const toMessageBlock = (wire: HarnessWireBlock): MessageBlock => {
    if (wire.kind === 'tool_use') return { kind: 'tool_use', ...toToolUse(wire) };
    if (wire.kind === 'subagent') {
        // A delegation without child details still renders the parent's text.
        if (!wire.subagent) return { kind: 'text', text: wire.text };
        return { kind: 'subagent', text: wire.text, subagent: toSubagentDetail(wire.subagent) };
    }
    return { kind: wire.kind, text: wire.text };
};

const toSubagentDetail = (wire: HarnessWireSubagent): SubagentDetail => ({
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
const toBackgroundState = (state: HarnessBackgroundState): BackgroundState => state;

const toBackgroundChild = (wire: HarnessWireBackgroundChild): BackgroundChild => ({
    childId: wire.childId,
    label: wire.label ?? wire.childId,
    status: wire.status,
    state: toBackgroundState(wire.state),
    terminal: wire.terminal,
});

export const toBackgroundTask = (wire: HarnessWireBackgroundTask): BackgroundTask => ({
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
 * Deltas arrive in order; wire indices fix block positions.
 * Pad gaps so a missing frame cannot shift subsequent blocks.
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

const toPermissionRequest = (wire: HarnessWirePermissionRequest): PermissionRequest => ({
    requestId: wire.requestId,
    toolName: wire.displayName || wire.toolName,
    description: wire.description,
    input: wire.input,
    // Preserve the server deadline across syncs; reconnecting must not restart the countdown.
    decideAt: wire.decideAt,
});

const toQuestionRequest = (wire: HarnessWireQuestionRequest): QuestionRequest => ({
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
 * Reject stale-turn frames before aggregation.
 * Only `start` and `sync` move the epoch; frames without a turnId belong to no turn and bypass.
 */
export const applyFrame = (
    state: ConversationRuntime,
    msg: HarnessConversationMessage,
): ConversationRuntime => {
    const movesEpoch = msg.type === 'start' || msg.type === 'sync';
    if (!movesEpoch && 'turnId' in msg && msg.turnId && state.turnId && msg.turnId !== state.turnId) {
        return state;
    }

    switch (msg.type) {
        case 'queue': return { ...state, queue: msg.messages };
        case 'start':
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
            const answered = !state.lastError && !!state.pendingText && state.pendingText === msg.userText;
            const pendingText = answered ? '' : state.pendingText;
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
            const blocks = state.blocks.slice();
            while (blocks.length <= msg.index) blocks.push({ kind: 'text', text: '' });
            blocks[msg.index] = { kind: 'tool_use', ...toToolUse(msg) };
            return { ...state, blocks, notice: null };
        }
        case 'subagent': {
            const blocks = state.blocks.slice();
            while (blocks.length <= msg.index) blocks.push({ kind: 'text', text: '' });
            blocks[msg.index] = toMessageBlock(msg);
            return { ...state, blocks, notice: null };
        }
        case 'background':
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
                turnId: msg.turnId ?? null,
                lastError,
            };
        }
        default: {
            const unhandled: never = msg;
            console.warn('[harness] unhandled frame', unhandled);
            return state;
        }
    }
};
