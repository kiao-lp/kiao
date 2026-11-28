import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerError } from 'kiao-worker';
import type { Segment } from './segments';
import { useSaveSegments } from './useSaveSegments';

const client = vi.hoisted(() => ({
    listFiles: vi.fn(),
    saveMediaSegments: vi.fn(),
    getToolbox: vi.fn(),
    installToolboxComponents: vi.fn(),
    getToolboxJob: vi.fn(),
}));

vi.mock('@kiao-dashboard-core', () => ({
    extractName: (path: string) => path.split('/').at(-1),
    useWorkerClient: () => client,
    useRefreshFileList: () => vi.fn(),
}));

const movie = (name: string) => ({
    path: 'clips/video.mp4',
    segments: [{ id: 'one', name, startMs: 0, endMs: 100 }],
    spanOf: (segment: Segment) => ({ fromMs: segment.startMs, toMs: segment.endMs }),
    loading: false, invalid: false, audio: true, timelineStatus: 'ready' as const,
});

afterEach(() => vi.useRealTimers());

it('reuses the checked export plan after confirmation and FFmpeg installation', async () => {
    vi.useFakeTimers();
    client.listFiles.mockResolvedValue([{ path: 'clips/intro.mkv', isDirectory: false }]);
    client.saveMediaSegments.mockRejectedValueOnce(new WorkerError('FFmpeg is required', 424, 'Failed Dependency'))
        .mockResolvedValueOnce({ id: 'save', state: 'running', path: 'clips/video.mp4' });
    client.getToolbox.mockResolvedValue({ enabled: true, components: [{ id: 'ffmpeg', state: 'available' }] });
    client.installToolboxComponents.mockResolvedValue({ id: 'install', state: 'running' });
    client.getToolboxJob.mockResolvedValue({ id: 'install', state: 'done' });
    const { result, rerender } = renderHook(({ name }) => useSaveSegments(movie(name)), {
        initialProps: { name: 'intro' },
    });

    await act(async () => { result.current.save(); });
    expect(result.current.phase).toMatchObject({ kind: 'confirming', replaced: ['intro.mkv'] });

    rerender({ name: 'renamed during confirmation' });
    await act(async () => { result.current.confirm(); });
    expect(result.current.phase.kind).toBe('needs-ffmpeg');

    await act(async () => { result.current.install(); });
    rerender({ name: 'renamed during installation' });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    const checked = ['clips/video.mp4', [{ name: 'intro', fromMs: 0, toMs: 100 }]];
    expect(client.saveMediaSegments.mock.calls).toEqual([checked, checked]);
    expect(result.current.phase.kind).toBe('saving');
});
