/** Successors reference stable node ids. Gateway branches run in parallel; Shutdown has no successor. */

import { isPlayable, FlowNodeSettings } from './flowNodeSettings';
import { chains, hasTransition, FlowNodeType } from './flowNodeType';

/** `continue` forks transcript and agent session, preserving this node's chat; `end` starts a fresh chat. */
export type TransitionMode = 'end' | 'continue';

export const TRANSITION_MODE_LABELS: Record<TransitionMode, string> = {
    continue: 'Continue',
    end: 'End conversation',
};

export const TRANSITION_MODE_ORDER: TransitionMode[] = ['continue', 'end'];

/** End is safe for nodes without a conversation. */
export const TRANSITION_MODE_DEFAULT: TransitionMode = 'end';

export const impliesClaude = (success: FlowNodeSuccess): boolean =>
    success.mode !== TRANSITION_MODE_DEFAULT || success.compact;

/** Flags chat actions without playable AI settings; explains the error rather than adding a play gate. */
export const brokenTransition = (success: FlowNodeSuccess, settings: FlowNodeSettings): boolean =>
    impliesClaude(success) && !isPlayable(settings);

export interface FlowNodeSuccess {
    /** Successor id, empty for none; unused by Gateways. */
    flowNode: string;
    /** Gateway-only branch ids, in listed order; started in parallel. */
    flowNodes: string[];
    /** Independent of whether a successor is named. */
    mode: TransitionMode;
    /** Send `/compact` as a separate turn after success, before forking for a successor. */
    compact: boolean;
}

export const noSuccess = (): FlowNodeSuccess => ({
    flowNode: '', flowNodes: [], mode: TRANSITION_MODE_DEFAULT, compact: false,
});

export const hasSuccess = (success: FlowNodeSuccess): boolean =>
    !!success.flowNode || success.flowNodes.length > 0;

export const saysSuccess = (success: FlowNodeSuccess): boolean =>
    hasSuccess(success) || success.mode !== TRANSITION_MODE_DEFAULT || success.compact;

export const carriesChat = (success: FlowNodeSuccess): boolean => success.mode === 'continue';

/** Removing a chain preserves the node's own chat actions. */
export const withoutSuccessor = (success: FlowNodeSuccess): FlowNodeSuccess => ({ ...success, flowNode: '' });

/**
 * Drop chat actions on non-AI nodes, Shutdown successors and non-Gateway branches.
 * Otherwise hidden, uneditable document values could leave a card marked broken.
 */
export const successFor = (success: FlowNodeSuccess, type: FlowNodeType): FlowNodeSuccess => {
    const asked = hasTransition(type);
    const mode = asked ? success.mode : TRANSITION_MODE_DEFAULT;
    const compact = asked && success.compact;
    const gateway = type === 'gateway';
    const flowNode = gateway ? '' : (chains(type) ? success.flowNode : '');
    const flowNodes = gateway ? success.flowNodes : [];
    const sameBranches = flowNodes.length === 0
        ? success.flowNodes.length === 0
        : flowNodes === success.flowNodes;
    return mode === success.mode && compact === success.compact
        && flowNode === success.flowNode && sameBranches
        ? success
        : { flowNode, flowNodes, mode, compact };
};

// Legacy compact mode meant both shortening the chat and handing it on.
const TRANSITION_WORDS: Record<string, Omit<FlowNodeSuccess, 'flowNode' | 'flowNodes'>> = {
    continue: { mode: 'continue', compact: false },
    end: { mode: 'end', compact: false },
    compact: { mode: 'continue', compact: true },
};

const readMode = (raw: unknown, legacy: unknown, chained: boolean): Omit<FlowNodeSuccess, 'flowNode' | 'flowNodes'> => {
    const said = typeof raw === 'string' ? raw.trim() : '';
    // Explicit unknown modes (including retired shutdown) end the chat; do not use the legacy chain default.
    if (said) return TRANSITION_WORDS[said] ?? { mode: TRANSITION_MODE_DEFAULT, compact: false };
    // Legacy chat applies only to a named successor.
    if (!chained) return { mode: TRANSITION_MODE_DEFAULT, compact: false };
    const before = typeof legacy === 'string' ? legacy.trim() : '';
    // Legacy chains without a mode continued the chat.
    return TRANSITION_WORDS[before] ?? { mode: 'continue', compact: false };
};

export const readBranches = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string') continue;
        const id = entry.trim();
        if (!id || out.includes(id)) continue;
        out.push(id);
    }
    return out;
};

export const readSuccess = (raw: unknown): FlowNodeSuccess => {
    if (typeof raw === 'string') {
        const flowNode = raw.trim();
        // Bare successor ids predate modes and imply continuation.
        return flowNode ? { flowNode, flowNodes: [], mode: 'continue', compact: false } : noSuccess();
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return noSuccess();
    const source = raw as Record<string, unknown>;
    const flowNode = typeof source.flowNode === 'string' ? source.flowNode.trim() : '';
    const said = readMode(source.mode, source.chat, !!flowNode);
    return {
        flowNode, flowNodes: readBranches(source.flowNodes),
        mode: said.mode, compact: said.compact || source.compact === true,
    };
};

/** Always write mode: omitting it on a chain would imply legacy continuation. */
export const writeSuccess = (success: FlowNodeSuccess): unknown => ({
    ...(success.flowNode ? { flowNode: success.flowNode } : {}),
    ...(success.flowNodes.length ? { flowNodes: [...success.flowNodes] } : {}),
    mode: success.mode,
    ...(success.compact ? { compact: true } : {}),
});
