/**
 * Status is independent of column placement; playing must not rearrange the board.
 * Ready is omitted in files; missing status means ready for compatibility with legacy boards.
 * The run writes running, waiting-refresh and terminal states; users restore ready for another play.
 */

export type FlowNodeStatus =
    | 'draft'
    | 'ready'
    | 'blocked'
    | 'running'
    | 'waiting-refresh'
    | 'interrupted'
    | 'done'
    | 'error';

export const DRAFT: FlowNodeStatus = 'draft';

export const READY: FlowNodeStatus = 'ready';

/** External dependency; only the user sets or clears it. Set ready to offer it for play again. */
export const BLOCKED: FlowNodeStatus = 'blocked';

/** Persisted by the run, so progress survives a closed tab. */
export const RUNNING: FlowNodeStatus = 'running';

/** Usage limit reached mid-turn. The run resumes the interrupted turn when the limit lifts. */
export const WAITING_REFRESH: FlowNodeStatus = 'waiting-refresh';

/** Stop preserves partial output in the conversation; also used when a run is killed or replaced. */
export const INTERRUPTED: FlowNodeStatus = 'interrupted';

/** Answer is in the conversation; the description is retained for reuse. */
export const DONE: FlowNodeStatus = 'done';

/** Failed or never ran; retains the description and status until played again. */
export const ERROR: FlowNodeStatus = 'error';

export const STATUS_LABELS: Record<FlowNodeStatus, string> = {
    draft: 'Draft',
    ready: 'Ready',
    blocked: 'Blocked',
    running: 'In progress',
    'waiting-refresh': 'Waiting refresh',
    interrupted: 'Interrupted',
    done: 'Done',
    error: 'Error',
};

const KNOWN = Object.keys(STATUS_LABELS) as FlowNodeStatus[];

/** Starting requires ready; reset terminal states explicitly. Does not govern Stop on an active run. */
export const canPlay = (status: FlowNodeStatus): boolean => status === READY;

export const readStatus = (raw: unknown): FlowNodeStatus =>
    (typeof raw === 'string' && (KNOWN as string[]).includes(raw.trim()) ? raw.trim() as FlowNodeStatus : READY);
