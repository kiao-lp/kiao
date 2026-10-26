import type { AgentCapabilities, AgentProfileOffer, AgentTurnExecution, AgentQueuedMessage } from './agent-profile-types';

/**
 * Wire protocol for `/hybridflow-runner/usage` and `/ws/hybridflow-runner`; see operation/worker/PROTOCOL.md.
 * Field names are wire contracts; do not rename them.
 */

export interface AgentUsageWindow {
    /** Rolling-window length in minutes; 0 means the agent did not report a length. */
    windowMinutes: number;
    /** Rolling-window utilisation, 0-100. */
    percentUsed: number;
    /** Unix epoch seconds at which the window resets. */
    resetAtEpochSeconds: number;
}

/**
 * GET /hybridflow-runner/usage?agent=…; omitted agent selects the default.
 * Windows are tightest first; an empty list means unavailable quota, not failure.
 */
export interface AgentUsage {
    windows: AgentUsageWindow[];
}

/**
 * GET /hybridflow-runner/auth/status?agent=…: host CLI sign-in status (Claude by default).
 * `loginEnabled` reports whether this deployment exposes that agent's sign-in endpoints.
 */
export interface AgentAuthStatus {
    loggedIn: boolean;
    /** "claude.ai", "none", … */
    authMethod?: string;
    email?: string;
    orgName?: string;
    subscriptionType?: string;
    loginEnabled: boolean;
}

/**
 * GET /hybridflow-runner/runner. `env` (KIAO_WORKER_RUNNER_ID) overrides `file`
 * (runner.json beside dashboard.json) for the process lifetime; `none` has an empty runnerId.
 */
export interface RunnerIdentity {
    runnerId: string;
    source: 'env' | 'file' | 'none';
}

/**
 * Login results: /hybridflow-runner/auth/login/{start,code,cancel},
 * POST /hybridflow-runner/auth/{agent}/key, or
 * POST /hybridflow-runner/auth/{agent}/login/{start,cancel}.
 * CLI refusal returns HTTP 200 with ok: false and a displayable message.
 * Only start sets url; device start also sets userCode for confirmation on that page.
 */
export interface AgentLoginResult {
    ok: boolean;
    url?: string;
    userCode?: string;
    message?: string;
}

/**
 * GET /hybridflow-runner/auth/{agent}/login/status. Pending until CLI approval exits.
 * Reading a finished result consumes it; subsequent reads return 409.
 */
export interface AgentDeviceLoginStatus {
    pending: boolean;
    ok: boolean;
    message?: string;
}

export type AgentLoginMethod = 'device' | 'api-key';

/** Absent when the panel cannot sign this agent in. Clients ignore unsupported methods. */
export interface AgentLoginOffer {
    /** Preferred method first, alternatives after it. */
    methods: AgentLoginMethod[];
    /** False means show hostCommand instead of a sign-in button. */
    enabled: boolean;
    /** Host-side sign-in command when endpoints are disabled. */
    hostCommand?: string;
}

export interface AgentOption {
    value: string;
    label: string;
}

export interface AgentOptionsEntry {
    profiles?: AgentProfileOffer[];
    defaultProfileId?: string;
    capabilities?: AgentCapabilities;
    /** Wire name sent as agent on create or fork. */
    value: AgentName;
    label: string;
    models: AgentOption[];
    efforts: AgentOption[];
    permissionModes: AgentOption[];
    /**
     * Defaults for new conversations; each must belong to its corresponding list.
     * Either may be absent (e.g. Codex), leaving the client to supply its default.
     */
    defaultModel?: string;
    defaultEffort?: string;
    login?: AgentLoginOffer;
}

/**
 * GET /hybridflow-runner/options is authoritative for installed CLI choices; do not hard-code them.
 * permissionModes values are AgentPermissionMode values. Top-level lists describe the default agent
 * for older clients; agent-aware clients use each agents entry.
 */
export interface AgentOptions {
    models: AgentOption[];
    efforts: AgentOption[];
    permissionModes: AgentOption[];
    /** Default agent's defaults for conversations that omit them. */
    defaultModel?: string;
    defaultEffort?: string;
    /** One entry per agent, the first being the default. Absent on a service that offers only one. */
    agents?: AgentOptionsEntry[];
    /** The agent a conversation created without naming one is bound to. */
    defaultAgent?: AgentName;
}

/**
 * Upload to POST /hybridflow-runner/attachments before referencing its id in a prompt.
 * The CLI receives a host file path and reads it with its Read tool, not inline bytes.
 * GET /hybridflow-runner/attachments/{id} retrieves bytes. name is the stored, path-safe name
 * shown to both model and user. Files expire after a month; transcript metadata persists
 * and expired-file GETs return 404.
 */
export interface AgentAttachment {
    id: string;
    name: string;
    /** Size in bytes, as stored. */
    size: number;
    /** Derived from the extension, e.g. `image/png`. Never the browser's own claim about it. */
    mediaType?: string;
}

/**
 * Tool permission modes:
 * - manual: relay permission_request and wait for permission_decision.
 * - manualLive: the service allows unanswered requests at decideAt, even without a client.
 * - bypassPermissions: CLI --dangerously-skip-permissions; may be disabled by
 *   KIAO_WORKER_CLAUDE_BYPASS_ENABLED=false. Then omitted from options and rejected with
 *   HTTP 400 on conversation endpoints or bypass_disabled on the socket.
 * Question requests always require a user answer; no mode or countdown answers them.
 */
export type AgentPermissionMode = 'manual' | 'manualLive' | 'bypassPermissions';

/**
 * Deployment-defined wire name; discover via hello.agents and GET /hybridflow-runner/options.
 * Permission modes are per agent (AgentOptionsEntry.permissionModes). Codex has no approval
 * channel and only offers bypassPermissions; manual is rejected with HTTP 400 or socket
 * mode_unsupported. Disabling bypass leaves Codex with no available mode.
 */
export type AgentName = string;

/**
 * Pending request pushed as permission_request and replayed in sync; answer by requestId.
 * input is pretty-printed JSON truncated by the server, not the 80-character tool_use summary.
 */
export interface AgentWirePermissionRequest {
    type?: 'permission_request';
    requestId: string;
    /** Tool name as the CLI reports it, e.g. "Edit". */
    toolName: string;
    /** Display name for the tool, when the CLI supplies one. */
    displayName?: string;
    /** Short human subtitle, e.g. the file being written. */
    description?: string;
    input?: string;
    /** Id of the `tool_use` block this request is about. */
    toolUseId?: string;
    /**
     * Server auto-allow deadline in epoch milliseconds, manualLive only.
     * Clients may deny before it; a card remaining past it awaits permission_resolved.
     */
    decideAt?: number;
}

/** How a permission request was answered. `cancelled` means the CLI withdrew it. */
export type AgentPermissionOutcome = 'allow' | 'deny' | 'cancelled';

/** Send label back as the answer. */
export interface AgentWireQuestionOption {
    label: string;
    description?: string;
    /** Model-written monospaced preview; returned with the chosen option so the model can identify it. */
    preview?: string;
}

/**
 * multiSelect answers are comma-separated option labels. Free text is always allowed;
 * options may be empty. header is a short panel label.
 */
export interface AgentWireQuestion {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options: AgentWireQuestionOption[];
}

/**
 * Pushed as question_request and replayed in sync. Answer with question_answer, never
 * permission_decision. No mode or countdown answers on the user’s behalf.
 */
export interface AgentWireQuestionRequest {
    type?: 'question_request';
    requestId: string;
    /** Asking tool name, e.g. AskUserQuestion. */
    toolName: string;
    questions: AgentWireQuestion[];
    /** Id of the `tool_use` block this question is about. */
    toolUseId?: string;
}

/**
 * input is a JSON-encoded summary capped at 80 characters; detail is the full input
 * capped at 4000; result is capped at 8192. exitCode is present when the agent reports it.
 */
export interface AgentWireToolUse {
    name: string;
    input?: string;
    detail?: string;
    /** Agent call id joining invocation, result and permission request. */
    toolUseId?: string;
    result?: string;
    isError?: boolean;
    exitCode?: number;
}

/**
 * Delegation details beneath the parent block’s summary text. Child blocks retain production
 * order and nested delegations; truncated marks capture or on-disk record limits.
 */
export interface AgentWireSubagent {
    subagentId?: string;
    /** Child session id usable with muse export --session. */
    childSessionId?: string;
    role?: string;
    objective?: string;
    /** Agent status vocabulary: completed, failed, running. */
    status?: string;
    result?: string;
    durationMs?: number;
    truncated?: boolean;
    blocks?: AgentWireBlock[];
}

/**
 * Background task lanes:
 * - running: agent still working.
 * - waiting: manualReconciliation; only owner instructions can resume it.
 * - finished: succeeded, failed, or abandoned when the turn ended; no longer counted.
 */
export type AgentBackgroundState = 'running' | 'waiting' | 'finished';

/**
 * Folded workflow child. status uses host vocabulary; terminal carries the agent’s
 * completed/failed/cancelled verdict and is absent while running.
 */
export interface AgentWireBackgroundChild {
    childId: string;
    /** Host label, falling back to the id. */
    label?: string;
    status: string;
    state: AgentBackgroundState;
    terminal?: string;
}

/**
 * Whole turn roster in first-sight order, including finished tasks. status uses host
 * control vocabulary (running, resultReady, manualReconciliation) until settlement, then
 * completed/failed/cancelled; state maps it to a counting lane.
 */
export interface AgentWireBackgroundTask {
    /** Stable host item id joining updates. */
    id: string;
    /** Host kind: workflow, subagent, or backgrounded toolCall. */
    kind: string;
    label: string;
    status: string;
    state: AgentBackgroundState;
    /** Workflow-only folded children; replaced whole on each change. */
    children?: AgentWireBackgroundChild[];
}

/**
 * Reply blocks in production order. thinking text is normally empty (opaque CLI signature),
 * but retained if disclosed. subagent text is the parent’s summary; details are in subagent.
 * at (RFC3339) and durationMs are transcript metadata, absent from live frames.
 */
export type AgentWireBlock =
    | { kind: 'text'; text: string; at?: string; durationMs?: number }
    | { kind: 'thinking'; text: string; at?: string; durationMs?: number }
    | ({ kind: 'tool_use'; at?: string; durationMs?: number } & AgentWireToolUse)
    | { kind: 'subagent'; text: string; at?: string; durationMs?: number; subagent?: AgentWireSubagent };

/** The protocol version this package's types describe. Compare against `hello.protocolVersion`. */
export const AGENT_PROTOCOL_VERSION = 20;

/**
 * Branch on code, not message text.
 * unknown_conversation: missing/deleted conversation; conversation_busy: turn already running.
 * bad_folder: missing, non-directory, or outside store root.
 * unknown_permission_mode: service cannot drive this mode.
 * too_many_turns: concurrent-turn cap; spawn_failed: CLI could not start.
 * not_permitted: caller does not own the turn; cli_error: mid-turn CLI error event.
 */
export type AgentErrorCode =
    | 'unknown_conversation'
    | 'conversation_busy'
    | 'bad_folder'
    | 'unknown_permission_mode'
    /** Agent no longer offered. Its session cannot move engines; fork onto another agent. */
    | 'unknown_agent'
    | 'profile_unavailable'
    /** Mode unavailable for this agent; see AgentOptionsEntry.permissionModes. */
    | 'mode_unsupported'
    /** The mode asked for is `bypassPermissions`, which this deployment does not allow. */
    | 'bypass_disabled'
    | 'too_many_turns'
    /** Missing/expired attachment or too many attachments; refuse rather than run without them. */
    | 'bad_attachment'
    | 'spawn_failed'
    | 'not_permitted'
    /** between reached no running turn; return text to the user so it can be sent as a prompt. */
    | 'no_running_turn'
    | 'cli_error'
    /** Host signed out; turn never ran. Offer agent sign-in, unlike a mid-turn cli_error. */
    | 'not_signed_in';

/** Route by conversationId; fence by turnId. */
export interface AgentTurnRef {
    conversationId: string;
    /** Server-minted, one per CLI process. A frame from another turn is a straggler — drop it. */
    turnId: string;
}

/** Messages the client sends to the `/ws/hybridflow-runner` socket. */
export type AgentClientMessage =
    /**
     * Additive, idempotent subscription, valid while idle. Each id gets sync or not_running.
     * Resend after reconnect to force resync.
     */
    | { type: 'subscribe'; conversationIds: string[] }
    /** Stop receiving these conversations' frames. Their turns keep running. */
    | { type: 'unsubscribe'; conversationIds: string[] }
    /**
     * Starts a turn and subscribes the sending socket. Folder and resume session come only
     * from the conversation record. Settings override stored defaults and become new defaults;
     * omitted settings reuse them. An active turn causes conversation_busy, never replacement.
     */
    | {
          type: 'prompt';
          conversationId: string;
          prompt: string;
          model?: string;
          effort?: string;
          /** `false` disables extended thinking (`CLAUDE_CODE_DISABLE_THINKING=1`) for the turn. */
          thinking?: boolean;
          permissionMode?: AgentPermissionMode;
          /**
           * Already-uploaded attachment ids, in attachment order; never host paths.
           * At most ten, all still available, otherwise bad_attachment.
           */
          attachments?: string[];
      }
    /**
     * Send text into the running turn’s stdin; folded in at its next tool boundary.
     * No process or start frame, settings changes, or attachments. Idle conversations return
     * no_running_turn; never promoted to prompt. Echoed as between to every subscriber.
     */
    | { type: 'between'; conversationId: string; text: string }
    | { type: 'follow_up'; conversationId: string; text: string }
    | { type: 'clear_queue'; conversationId: string }
    /** Kill the conversation's running turn. An unknown or idle conversation is a no-op. */
    | { type: 'stop'; conversationId: string }
    /**
     * Answer permission_request with allow/deny; cancelled is server-only.
     * Duplicate, unknown, or ended-turn answers are dropped without reaching the CLI.
     */
    | {
          type: 'permission_decision';
          conversationId: string;
          requestId: string;
          behavior: 'allow' | 'deny';
          message?: string;
      }
    /**
     * One answer per question in order: option label, comma-separated labels for multiSelect,
     * or free text. Blank entries are unanswered; all blanks dismiss the card and tell the model
     * it was unanswered. Use question_answer, never permission_decision.
     */
    | {
          type: 'question_answer';
          conversationId: string;
          requestId: string;
          answers: string[];
      };

/** Frames scoped to one conversation. Route on `conversationId`; fence on `turnId`. */
export type AgentConversationMessage =
    | (AgentTurnRef & { type: 'queue'; messages: AgentQueuedMessage[] })
    /** A CLI process spawned, with the settings the turn actually runs with. */
    | (AgentTurnRef & {
          type: 'start';
          model: string;
          effort: string;
          thinking: boolean;
          permissionMode: AgentPermissionMode;
          /** Conversation’s agent, never overridden by the prompt. */
          agent: AgentName;
          /** Store-relative working directory of this turn; `""` is the store root. */
          folder: string;
          /** Unix epoch millis. */
          startedAt: number;
      })
    /** The CLI reported its session id. Recorded server-side; a client needs it only to display. */
    | (AgentTurnRef & { type: 'session'; sessionId: string })
    /** Append data to block index. Empty deltas still open blocks (e.g. redacted thinking). */
    | (AgentTurnRef & { type: 'output'; index: number; kind: 'text' | 'thinking'; data: string })
    /** Set tool call at index. Late results update only the transcript copy. */
    | (AgentTurnRef & { type: 'tool_use'; index: number } & AgentWireToolUse)
    /** Set delegation at index, replacing rather than appending; text is the parent summary. */
    | (AgentTurnRef & {
          type: 'subagent';
          index: number;
          kind: 'subagent';
          text: string;
          subagent?: AgentWireSubagent;
      })
    /**
     * Replace the whole roster, including finished tasks in first-sight order.
     * Agents without background tracking send none.
     */
    | (AgentTurnRef & {
          type: 'background';
          tasks: AgentWireBackgroundTask[];
      })
    /**
     * Echo to all subscribers after transcript recording and CLI delivery.
     * User interruption text, never part of reply blocks.
     */
    | (AgentTurnRef & { type: 'between'; text: string })
    /** Ephemeral display notice; supersedes the previous one, never recorded or terminal. */
    | (AgentTurnRef & { type: 'notice'; text: string })
    /** The process exited. Never sent for a turn that was stopped — that settles on `stopped`. */
    | (AgentTurnRef & { type: 'done'; exitCode?: number })
    /** Acknowledges `stop`. The turn's transcript record is written before this arrives. */
    | (AgentTurnRef & { type: 'stopped' })
    /** Waits for an answer; manualLive may auto-allow at decideAt. */
    | (AgentTurnRef & { type: 'permission_request' } & AgentWirePermissionRequest)
    /** Waits for a user answer; no timeout or automatic answer in any mode. */
    | (AgentTurnRef & { type: 'question_request' } & AgentWireQuestionRequest)
    /**
     * Removes a pending request: answered on any socket or withdrawn.
     * Answered questions also resolve here with outcome allow.
     */
    | (AgentTurnRef & {
          type: 'permission_resolved';
          requestId: string;
          outcome: AgentPermissionOutcome;
      })
    /**
     * Current or last held turn in response to subscribe. Replace blocks whole.
     * Completed history comes from GET /hybridflow-runner/conversations/{id}; a turn finishing
     * between that GET and subscribe is still reported here to close the race.
     */
    | (AgentTurnRef & {
          type: 'sync';
          running: boolean;
          /** The prompt this turn was started with, so a reattaching tab can show what was asked. */
          userText: string;
          /** All between texts in order; replace, do not append. */
          betweens?: string[];
          queue?: AgentQueuedMessage[];
          blocks: AgentWireBlock[];
          /** Actual turn mode, as in start; stored conversation settings catch up only at settlement. */
          permissionMode: AgentPermissionMode;
          agent: AgentName;
          sessionId?: string;
          pendingPermissions?: AgentWirePermissionRequest[];
          /** Pending questions replayed on reconnect; answered separately from permissions. */
          pendingQuestions?: AgentWireQuestionRequest[];
          /** Whole background roster; replace, do not append. Absent when nothing was handed off. */
          background?: AgentWireBackgroundTask[];
          startedAt: number;
          finishedAt?: number;
          exitCode?: number;
      })
    /** Subscribed, but no turn is held for this conversation. The normal state of an idle one. */
    | { type: 'not_running'; conversationId: string }
    /** A turn was refused or failed. */
    | {
          type: 'error';
          conversationId: string;
          turnId?: string;
          code: AgentErrorCode;
          message: string;
      };

/** Broadcast to every open socket, regardless of subscriptions. */
export type AgentRegistryMessage =
    /** A conversation was created, renamed, archived, started or settled. */
    | { type: 'conversation'; conversationId: string; conversation: AgentConversation }
    | { type: 'conversation_deleted'; conversationId: string };

/**
 * Run states:
 * - playing: turn for flowNodeId running or about to start.
 * - compacting: completed card’s chat is being compacted at its request; card stays marked playing.
 * - waiting: transient error; resend the flow node at retryAt (20 minutes).
 * - refreshing: quota exhausted; at the limit’s retryAt, resume the cut-off turn instead of
 *   resending the node. Card document status is waiting-refresh.
 * - scheduled: Scheduler card waiting for its datetime, read from the card itself.
 * - stopping: stop requested; running node is the last played.
 * - suspended: turn stopped from chat; chat input resumes via POST /hybridflow-runner/chain-runs/resume.
 */
export type AgentChainRunState =
    | 'playing'
    | 'compacting'
    | 'waiting'
    | 'refreshing'
    | 'scheduled'
    | 'stopping'
    | 'suspended'
    | 'ended';

export interface AgentChainRunFlowNode {
    id: string;
    title: string;
    /** Board status, with ready explicit instead of empty. Empty if the card was removed. */
    status: string;
    /** Already played, excluding current and upcoming cards. */
    played?: boolean;
    /** The card the run is on right now: exactly one while it is live, none once it has ended. */
    current?: boolean;
}

/**
 * Service-owned run; continues independently of connected clients. Concurrent runs are
 * allowed, except on the same card. Ended runs remain listed with their ending and restart option.
 */
export interface AgentChainRun {
    id: string;
    name: string;
    /** Board handle used by the browser, sent as path. */
    path: string;
    /** The card the run was started on, and the one a restart plays again. */
    rootFlowNodeId: string;
    /** Current node, including while its completed chat is compacting. */
    flowNodeId: string;
    /** The conversation that flow node is played in. */
    chat: string;
    state: AgentChainRunState;
    /** Epoch milliseconds, only while waiting (20-minute retry) or refreshing (quota reset time). */
    retryAt?: number;
    startedAt: number;
    /** When the run stopped, epoch millis, and absent while it has not. */
    endedAt?: number;
    /** Last board write, epoch milliseconds; reload on change to avoid overwriting unseen answers. */
    documentAt?: number;
    /** Played nodes in order, current node, then upcoming onSuccess chain; usable without the board. */
    flowNodes?: AgentChainRunFlowNode[];
    /** Absent until the run stops. */
    ending?: string;
}

/** Displayable notice carried with its state update. */
export interface AgentChainRunNotice {
    level: 'info' | 'warning' | 'error';
    text: string;
    at: number;
    /** Run name; absent for notices belonging to no run. */
    chainRun?: string;
}

/** Broadcast whole run list to every open socket; replace, do not merge deltas. */
export type AgentChainRunMessage = {
    type: 'chainRun';
    /** Every run the service knows, live and lately ended, oldest first. */
    runs: AgentChainRun[];
    notice?: AgentChainRunNotice;
};

/** Sent once, unprompted, on connect. */
export type AgentSocketMessage = {
    type: 'hello';
    /** Bumped whenever a frame shape changes; a client built against another number must reload. */
    protocolVersion: number;
    socketId: string;
    /** Conversations with a turn running right now — what to subscribe to after a reconnect. */
    runningConversations: string[];
    maxConcurrentTurns: number;
    /** Deployment agent names, nonempty, default first. Choices are in GET /hybridflow-runner/options. */
    agents: AgentName[];
    /** Initial run list; subsequent updates arrive as chainRun frames. */
    chainRuns?: AgentChainRun[];
};

export type AgentServerMessage =
    | AgentConversationMessage
    | AgentRegistryMessage
    | AgentChainRunMessage
    | AgentSocketMessage;

export const isAgentRegistryMessage = (m: AgentServerMessage): m is AgentRegistryMessage =>
    m.type === 'conversation' || m.type === 'conversation_deleted';

export const isAgentChainRunMessage = (m: AgentServerMessage): m is AgentChainRunMessage =>
    m.type === 'chainRun';

/** One conversation's summary, as listed by `GET /hybridflow-runner/conversations`. */
export interface ManagedAgentVersion {
    /** Effective defaults resolved once when the conversation was created. */
    resolvedModel?: string;
    resolvedProfileId?: string;
    agentId: string;
    version: number;
    name: string;
    platform: string;
    model: string;
    profileId?: string;
    description?: string;
    instructions?: string;
    publishedAt: string;
}

export interface AgentConversation {
    /** Immutable publication selected when this task conversation was created. */
    agentVersion?: ManagedAgentVersion;
    profileId?: string;
    id: string;
    title: string;
    /** Store-relative CLI cwd; "" is the store root. Immutable: must match the CLI transcript’s folder slug. */
    folder: string;
    /**
     * Resolved agent (default if absent in storage). Immutable because sessions belong to an engine;
     * changing agent requires AgentConversationFork.
     */
    agent: AgentName;
    model: string;
    effort: string;
    permissionMode: AgentPermissionMode;
    thinking: boolean;
    /** The CLI session this conversation resumes. Absent once it has been lost. */
    sessionId?: string;
    /** Whether a turn is running right now — the job registry's answer, not the stored state's. */
    running: boolean;
    archived: boolean;
    /** Display-only pin to a separate switcher column; does not affect listing or turns. */
    pinned: boolean;
    messageCount: number;
    /** RFC3339. */
    createdAt: string;
    updatedAt: string;
    lastExitCode?: number;
    /** The CLI refused to resume; the next turn starts a fresh session with no memory of the above. */
    sessionLost?: boolean;
    /** Fork source and branch message; empty message means whole-conversation fork, both absent if not forked. */
    forkedFrom?: string;
    forkedFromMessage?: string;
    /**
     * Capture raw bidirectional protocol stream for future turns only; off by default.
     * Process invocation and stderr are always traced. Raw streams are unbounded.
     */
    traceStream?: boolean;
}

export type AgentMessageRole = 'user' | 'assistant' | 'notice';

export interface AgentTranscriptTool {
    name: string;
    input?: string;
}

/** Agent-reported usage: scope is turn; session occurs on older Muse records. */
export interface AgentTurnUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    /** Reasoning tokens included in outputTokens, when the agent reports the breakdown. */
    reasoningTokens?: number;
    totalCostUSD?: number;
    scope?: string;
}

/**
 * Recorded permission/question outcome. decidedBy: user, countdown, bypass, agent, stop, or end.
 * questions marks a question request; answers are keyed by full question text.
 */
export interface AgentTranscriptAsk {
    id: string;
    tool: string;
    displayName?: string;
    description?: string;
    input?: string;
    questions?: AgentWireQuestion[];
    answers?: Record<string, string>;
    outcome: AgentPermissionOutcome;
    decidedBy?: string;
    at?: string;
}

/**
 * notice entries are service-only; the model never saw them. Render blocks when present;
 * text (excluding thinking) and tools are derived fallbacks. Older entries lack blocks
 * because their ordering was never captured.
 */
export interface AgentTranscriptMessage {
    execution?: AgentTurnExecution;
    queue?: AgentQueuedMessage[];
    profileId?: string;
    id: string;
    role: AgentMessageRole;
    text: string;
    at: string;
    /** Shared by prompt, betweens and reply; absent on unowned messages and older records. */
    turnId?: string;
    /**
     * User message sent into a running turn. Records are ordered prompt, betweens, reply;
     * afterBlocks locates each between within the reply that was already streaming.
     */
    between?: boolean;
    /** Reply block count when this between arrived; 0 before first block, absent on older records. */
    afterBlocks?: number;
    blocks?: AgentWireBlock[];
    tools?: AgentTranscriptTool[];
    model?: string;
    effort?: string;
    permissionMode?: AgentPermissionMode;
    exitCode?: number;
    /** The turn was stopped, or the service restarted while it ran. */
    interrupted?: boolean;
    /** The reply exceeded the per-record cap and was cut. */
    truncated?: boolean;
    /**
     * When the turn ran (RFC3339), how long it ran, and how long its first block took to arrive.
     * Assistant messages only.
     */
    startedAt?: string;
    finishedAt?: string;
    durationMs?: number;
    firstBlockMs?: number;
    /** Why the turn ended, in the sentence it ended in. Assistant messages only. */
    endReason?: string;
    /**
     * Muse verdict: completed, cancelled, or failed, beside a synthesised exit code.
     * Absent for other agents, whose exit codes are real.
     */
    terminal?: string;
    /** What the turn cost, and everything it parked on. Assistant messages only. */
    usage?: AgentTurnUsage;
    asks?: AgentTranscriptAsk[];
    /** User prompts only: actual composed message, briefing, and managed-agent standing orders. */
    composedPrompt?: string;
    systemPrompt?: string;
    instructions?: string;
    /** Published agent name, executed agent ID, publication and play identity; on prompt and reply. */
    playedBy?: string;
    agentRef?: string;
    agentVersion?: number;
    runId?: string;
    flowNodeId?: string;
    board?: string;
    /** Fork notice source; empty forkFromMessage means whole-conversation fork. */
    forkFrom?: string;
    forkFromMessage?: string;
    /** User records only; metadata persists after attachment files expire. */
    attachments?: AgentAttachment[];
}

export interface AgentConversationDetail extends AgentConversation {
    messages: AgentTranscriptMessage[];
}

/** POST /hybridflow-runner/conversations/{id}/fork; source is unchanged, empty body forks it whole. */
export interface AgentConversationFork {
    profileId?: string;
    /** Copy ends before this message, leaving its prompt to ask again. Omit to fork the whole conversation. */
    fromMessageId?: string;
    /**
     * Omit to keep the source agent. Changing agent drops the session and starts a new one
     * with the copied transcript as preamble. Model, effort and permission mode use the new
     * agent’s defaults; the fork notice identifies the unread prior history.
     */
    agent?: AgentName;
}

/** folder and agent are immutable; turn settings are defaults overridable by prompts. */
export interface AgentConversationCreate {
    profileId?: string;
    folder: string;
    /** Omitted selects the default. Unknown agent or unsupported permissionMode returns HTTP 400. */
    agent?: AgentName;
    title?: string;
    model?: string;
    effort?: string;
    permissionMode?: AgentPermissionMode;
    thinking?: boolean;
}

/**
 * Omitted fields are unchanged. folder and agent are immutable.
 * A permissionMode unsupported by the conversation’s agent returns HTTP 400.
 */
export interface AgentConversationPatch {
    title?: string;
    archived?: boolean;
    pinned?: boolean;
    model?: string;
    effort?: string;
    permissionMode?: AgentPermissionMode;
    thinking?: boolean;
    traceStream?: boolean;
}

