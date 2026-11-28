import type { Workflow } from './boardContent';
import type { WorkflowPatchDto } from './service';

export type WorkflowValues = NonNullable<Workflow['values']>;
export type WorkflowValuesPatch = Pick<WorkflowPatchDto, 'setValues' | 'removeValues'>;

export function parseWorkflowValues(text: string): { values: WorkflowValues } | { error: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { error: 'Invalid JSON' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'Workflow values must be a JSON object.' };
    }
    if (Object.hasOwn(parsed, 'id') || Object.hasOwn(parsed, 'name')) {
        return { error: 'Workflow ID and name are read-only in JSON.' };
    }
    return { values: parsed as WorkflowValues };
}

// PostgreSQL can return JSON object keys in a different order.
const orderedJson = (value: unknown): string | undefined => JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const record = entry as WorkflowValues;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
});

export const equalWorkflowValues = (a: unknown, b: unknown): boolean => a === b || orderedJson(a) === orderedJson(b);

export function diffWorkflowValues(before: WorkflowValues, after: WorkflowValues): WorkflowValuesPatch | null {
    const changed = Object.entries(after).filter(([field, value]) =>
        !Object.hasOwn(before, field) || !equalWorkflowValues(value, before[field]));
    const removed = Object.keys(before).filter(field => !Object.hasOwn(after, field));
    if (changed.length === 0 && removed.length === 0) return null;
    return {
        ...(changed.length > 0 && { setValues: Object.fromEntries(changed) }),
        ...(removed.length > 0 && { removeValues: removed }),
    };
}
