import { type ActionAppliesTo } from 'kiao-worker';

export interface ActionTarget {
    path: string;
    isDirectory: boolean;
}

/** Mirrors `actionApplies` in `operation/worker/actions.go`; both follow `PROTOCOL.md`. Matches file name, not path; keys AND-ed, empty rule matches anything. */
export const actionApplies = (rule: ActionAppliesTo | undefined, target: ActionTarget): boolean => {
    if (!rule) return true;
    if (rule.directory !== undefined && rule.directory !== target.isDirectory) return false;
    if (rule.extensions && rule.extensions.length > 0) {
        const name = (target.path.split('/').pop() ?? target.path).toLowerCase();
        if (!rule.extensions.some(ext => name.endsWith(ext.toLowerCase()))) return false;
    }
    return true;
};
