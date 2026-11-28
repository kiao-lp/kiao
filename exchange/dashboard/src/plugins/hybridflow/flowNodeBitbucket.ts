import type { FlowNodeDto } from './service/types';
import { hasContextReference } from './nodeContext';

export const PULL_REQUEST_STATUSES = ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'] as const;
export const COMMIT_STATUSES = ['INPROGRESS', 'SUCCESSFUL', 'FAILED', 'STOPPED'] as const;

export interface BitbucketEventFields {
    pullRequestId?: string;
    pullRequestStatus?: string;
    commitId?: string;
    commitStatus?: string;
}

const pullRequestIdShape = /^([A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*#)?[1-9][0-9]*$/;
const commitIdShape = /^([A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*@)?[a-fA-F0-9]{7,40}$/;

const readId = (raw: unknown, shape: RegExp): string => {
    const id = typeof raw === 'string' ? raw.trim() : '';
    return shape.test(id) || hasContextReference(id) ? id : '';
};

export const readPullRequestId = (raw: unknown): string => readId(raw, pullRequestIdShape);
export const readCommitId = (raw: unknown): string => readId(raw, commitIdShape);

const readStatus = (raw: unknown, statuses: readonly string[]): string => {
    const status = typeof raw === 'string' ? raw.trim() : '';
    if (hasContextReference(status)) return status;
    const literal = status.toUpperCase();
    return statuses.includes(literal) ? literal : '';
};

export const readPullRequestStatus = (raw: unknown): string => readStatus(raw, PULL_REQUEST_STATUSES);
export const readCommitStatus = (raw: unknown): string => readStatus(raw, COMMIT_STATUSES);

export const readBitbucketEvent = (type: string, source: Record<string, unknown>): BitbucketEventFields => {
    switch (type) {
        case 'bitbucket-pr-status': return {
            pullRequestId: readPullRequestId(source.pullRequestId),
            pullRequestStatus: readPullRequestStatus(source.pullRequestStatus),
        };
        case 'bitbucket-commit-status': return {
            commitId: readCommitId(source.commitId),
            commitStatus: readCommitStatus(source.commitStatus),
        };
        default: return {};
    }
};

export const writeBitbucketEvent = (
    node: Partial<Pick<FlowNodeDto, 'type' | 'pullRequestId' | 'pullRequestStatus' | 'commitId' | 'commitStatus'>>,
) => {
    switch (node.type) {
        case 'bitbucket-pr-status': return {
            pullRequestId: node.pullRequestId || undefined,
            pullRequestStatus: node.pullRequestStatus || undefined,
        };
        case 'bitbucket-commit-status': return {
            commitId: node.commitId || undefined,
            commitStatus: node.commitStatus || undefined,
        };
        default: return {};
    }
};
