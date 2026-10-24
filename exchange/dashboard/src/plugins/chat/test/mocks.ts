import { vi } from 'vitest';
import type { AgentErrorCode } from 'kiao-worker';
import type { PermissionRequest, QuestionRequest } from '../chatMessages';
import { mockFunctions } from 'src/test/mocks';

/** What a chat pane reads from a conversation, without standing in for the socket provider. */
export const createConversationMock = () => ({
    messages: [] as Record<string, unknown>[],
    running: false,
    permissionRequests: [] as PermissionRequest[],
    questionRequests: [] as QuestionRequest[],
    lastError: null as { code: AgentErrorCode; message: string; path?: string } | null,
    ...mockFunctions('send', 'sendBetween', 'stop', 'decidePermission', 'answerQuestions'),
});

export const createConversationsMock = () => ({
    conversations: [] as Record<string, unknown>[],
    ...mockFunctions('show', 'shown'),
    toShow: null as Record<string, unknown> | null,
    fork: vi.fn(() => Promise.resolve({})),
    patch: vi.fn(() => Promise.resolve({})),
    create: vi.fn(() => Promise.resolve({ id: 'conv-new' })),
});
