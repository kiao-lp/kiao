import type { FlowNode, Workflow } from './boardContent';

const contextSlot = /\{\{\s*(?:(input|currentWokflow|currentWorkflow)(?:\.([^{}\s]+))?|role\.([A-Za-z0-9_-]+))\s*\}\}|\{\{\s*(workflowFolder)\s*\}\}(\/?)/g;

export const hasContextReference = (text: string): boolean => text.search(contextSlot) !== -1;

export interface NodeContext {
    input?: unknown;
    workflow?: Workflow;
    roles?: ReadonlyMap<string, string>;
}

export const roleValues = (nodes: readonly FlowNode[]): ReadonlyMap<string, string> => {
    const roles = new Map<string, string>();
    for (const node of nodes) {
        if (node.type === 'role' && !node.archived && node.roleId) {
            roles.set(node.roleId, node.people?.join(', ') ?? '');
        }
    }
    return roles;
};

/** Keep missing references visible when displaying a card. */
export const renderNodeContext = (text: string, { input, workflow, roles }: NodeContext): string => {
    const workflowValues = workflow && { ...workflow.values, id: workflow.id, name: workflow.name };
    return text.replace(contextSlot, (slot, namespace: string, path?: string, roleId?: string, folder?: string, slash = '') => {
        if (folder) {
            const link = workflow?.workflowFolder;
            if (!link) return slot;
            return link === '/' ? link : link + slash;
        }
        if (roleId) return roles?.get(roleId) ?? slot;
        let value: unknown = namespace === 'input' ? input : workflowValues;
        for (const segment of path?.split('.') ?? []) {
            if (Array.isArray(value)) {
                if (!/^[+-]?\d+$/.test(segment)) return slot;
                value = value[Number(segment)];
            } else {
                if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return slot;
                value = (value as Record<string, unknown>)[segment];
            }
        }
        return typeof value === 'string' ? value : JSON.stringify(value) ?? slot;
    });
};
