import { type ActionAppliesTo } from 'kiao-worker';

/** The entry an action is being offered on: everything the rule is allowed to look at. */
export interface ActionTarget {
    path: string;
    isDirectory: boolean;
}

/**
 * Whether an action applies to an entry.
 *
 * The rule vocabulary is deliberately tiny — a suffix match on the file name and a directory flag —
 * precisely so it can be evaluated here, from what the context menu already holds, without a round
 * trip per right-click. The price is that the rule is implemented twice: `actionApplies` in
 * `operation/worker/actions.go` is the other half, and `PROTOCOL.md` is what they must both
 * agree with.
 *
 * Both keys are optional and are AND-ed, so an empty rule matches anything. Matching is on the
 * file *name*, not the path, which is what makes compound extensions like `.ttst.md` behave and
 * keeps a folder called `notes.md/` from claiming its children's actions.
 */
export const actionApplies = (rule: ActionAppliesTo | undefined, target: ActionTarget): boolean => {
    if (!rule) return true;
    if (rule.directory !== undefined && rule.directory !== target.isDirectory) return false;
    if (rule.extensions && rule.extensions.length > 0) {
        const name = (target.path.split('/').pop() ?? target.path).toLowerCase();
        if (!rule.extensions.some(ext => name.endsWith(ext.toLowerCase()))) return false;
    }
    return true;
};
