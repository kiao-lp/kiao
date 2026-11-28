import type { FlowNodeType } from './flowNodeType';

export type RoleKind = 'human' | 'agent';

export interface RoleFields {
    roleId?: string;
    roleKind?: RoleKind;
    people?: string[];
    description?: string;
}

export const isRoleId = (id: string): boolean => /^[A-Za-z0-9_-]*$/.test(id);

export const readPeople = (lines: unknown[]): string[] =>
    lines.flatMap(line => typeof line === 'string' && line.trim() ? [line.trim()] : []);

export const readRole = (type: FlowNodeType, raw: Record<string, unknown>): RoleFields =>
    type === 'role' ? {
        roleId: typeof raw.roleId === 'string' ? raw.roleId.trim() : '',
        roleKind: raw.roleKind === 'agent' ? 'agent' : 'human',
        people: Array.isArray(raw.people) ? readPeople(raw.people) : [],
        description: typeof raw.description === 'string' ? raw.description.trim() : '',
    } : {};
