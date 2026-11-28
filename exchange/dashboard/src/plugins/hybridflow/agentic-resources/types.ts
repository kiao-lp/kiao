import type { ManagedAgentVersion } from 'kiao-worker';

/** Named by settings. agent using its id. */
export interface AgentDto {
	draftError?: string;
    effort?: string;
    repository?: string;
 project?: string;
    version?: string;
    published?: AgentVersionDto;
    hasUnpublishedChanges?: boolean;
    id: string;
    archived?: boolean;
    name: string;
    harness: string;
    harnesses?: string[];
    supersedes?: string[];
    model?: string;
    profileId?: string;
    /** Selection guidance for tasks, never sent to the agent's turns. */
    description?: string;
    instructions?: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
}

export type AgentVersionDto = ManagedAgentVersion;

/** Agent id is generated server-side. */
export interface NewAgentDto {
 repository?: string;
    importOnly?: boolean;
    effort?: string;
    name: string;
    harness: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}

export interface AgentPatchDto {
    effort?: string;
    name?: string;
    harness?: string;
    model?: string;
    profileId?: string;
    description?: string;
    instructions?: string;
}


export type ResourceKind = 'agent' | 'skill' | 'mcp';

export interface AgenticResourceDto {
    name: string;
    kind: ResourceKind;
    description?: string;
    repository?: string;
    commit?: string;
    version?: string;
    publishedVersion?: string;
    dirty: boolean;
    files: string[];
}
export type AgentDependencyKind = 'skills' | 'mcp';
export interface AgentDependencyDto {
    name: string;
    linked: boolean;
    available: boolean;
    hasRemote: boolean;
    local: boolean;
}
export interface ResourceFileDto { path: string; content: string; revision?: string; }

export interface AgentRemoteDto {
    hasRemote: boolean;
    /** Commits the remote holds beyond the working tree. */
    behind: number;
    /** Why the remote cannot be read; `behind` is then unknown. */
    problem?: string;
}

export interface PushConfirmation { dependencies: string[]; token: string; }

export interface DeletionStatus { noRemote: boolean; dirty: boolean; unpushed: boolean; remoteUnavailable: boolean; confirmation: string; }
