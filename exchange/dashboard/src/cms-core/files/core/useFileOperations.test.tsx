import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    client: { deleteBatch: vi.fn(), createFolder: vi.fn(), download: vi.fn(), update: vi.fn() },
    refresh: vi.fn(),
    clearSelection: vi.fn(),
    startRename: vi.fn(),
    notification: { open: vi.fn(), destroy: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock('antd', () => ({ notification: h.notification }));
vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: () => h.client }));
vi.mock('./CurrentFileList-ctx', () => ({ useRefreshFileList: () => h.refresh }));
vi.mock('../selection/SelectionModel-ctx', () => ({ useFileSelection: () => ({ clear: h.clearSelection }) }));
vi.mock('../selection/RenameTarget-ctx', () => ({ useRenameTarget: () => ({ startRename: h.startRename }) }));
vi.mock('./deleteScope', () => ({
    collectDeleteScope: vi.fn(async (_client, selection) => ({ selection, entries: [], truncated: false })),
}));

import { InProgressFeedback } from './InProgressFeedback-cmp';
import { useFileOperations } from './useFileOperations';

describe('useFileOperations deletion feedback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.client.deleteBatch.mockResolvedValue(undefined);
    });

    it('closes the confirmation before showing in-progress feedback and deleting', async () => {
        const { result } = renderHook(() => useFileOperations());

        await act(async () => { await result.current.requestDelete(['docs/file.txt']); });
        expect(result.current.deleteScope?.selection).toEqual(['docs/file.txt']);

        await act(async () => { await result.current.confirmDelete(); });

        expect(result.current.deleteScope).toBeNull();
        expect(h.client.deleteBatch).toHaveBeenCalledWith(['docs/file.txt']);
        expect(h.notification.open).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Deleting files from docs…',
            description: expect.objectContaining({ type: InProgressFeedback }),
            duration: 0,
        }));
        expect(h.notification.destroy).toHaveBeenCalledTimes(1);
        expect(h.notification.success).toHaveBeenCalledWith({ message: 'Files deleted from docs' });
    });
});
