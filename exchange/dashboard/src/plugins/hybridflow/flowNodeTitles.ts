import type { FlowNodeAt } from './boardOps';

export const flowNodeTitles = (nodes: FlowNodeAt[]): string => {
    const visible = nodes.slice(0, 6).map(({ flowNode }) => `“${flowNode.title || 'Untitled'}”`);
    const rest = nodes.length - visible.length;
    const titles = visible.join(', ');
    return rest > 0 ? `${titles} and ${rest} more` : titles;
};
