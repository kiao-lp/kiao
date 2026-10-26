import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from 'src/test/render';
import { WorkerError, type MediaJob, type Toolbox, type ToolboxJob } from 'kiao-worker';

/**
 * The provider the player, the banner and the segments panel share, wired to stand-ins for the
 * two things it drives: a video element whose clock the test turns — jsdom plays nothing — and
 * the sidecar, as the disk-sync hook hands it over.
 *
 * What is pinned is what only the wiring can get wrong: a position saved as the start of the image
 * on screen, a step taken from it with the player stopped, the two ends of a segment gone to by
 * the middle of their images, and a sidecar that does not read never being written over.
 */

const sidecar = vi.hoisted(() => ({ text: '', writes: [] as string[] }));

/** `vp9.mp4` as its file describes it: ten images a second for two seconds, key images at 0, 0.7 and 1.4. */
const clip = vi.hoisted(() => ({
    status: 'ready' as const,
    timeline: { frames: Array.from({ length: 20 }, (_, i) => i / 10), frameDuration: 0.1, keys: [0, 0.7, 1.4] },
}));

vi.mock('./useFrameTimeline', () => ({ useFrameTimeline: () => clip }));

/** The files client a save talks to, answering as each test says, and the tree it refreshes. */
const files = await vi.hoisted(async () => {
    const { mockFunctions } = await import('src/test/mocks');
    return {
        client: mockFunctions(
            'listFiles', 'saveMediaSegments', 'getMediaJob', 'stopMediaJob',
            'getToolbox', 'installToolboxComponents', 'getToolboxJob',
        ),
        refresh: vi.fn(),
    };
});

vi.mock('@cms-core', async () => {
    const { useState } = await import('react');
    return {
        useWorkerClient: () => files.client,
        useRefreshFileList: () => files.refresh,
        useAuthenticatedFileUrl: (path: string) => `/api/files/getFile?path=${encodeURIComponent(path)}`,
        useFileViewState: <T extends object>(_scope: string, defaults: T) => {
            const [state, setState] = useState(defaults);
            const update = (patch: Partial<T>) => setState(previous => ({ ...previous, ...patch }));
            return [state, update] as const;
        },
        // Read once, and every edit a write.
        useDocumentFileSync: <T,>(_path: string, codec: { parse: (text: string) => T; serialize: (doc: T) => string }) => {
            const [doc, setDoc] = useState<T | null>(() => {
                try { return codec.parse(sidecar.text); } catch { return null; }
            });
            return {
                doc,
                text: sidecar.text,
                loading: false,
                checkNow: () => undefined,
                onTextChange: () => undefined,
                onDocChange: (next: T) => {
                    sidecar.writes.push(codec.serialize(next));
                    setDoc(next);
                },
            };
        },
        extractName: (path: string) => path.split('/').pop() ?? path,
        Tooltip: ({ children }: { children: React.ReactNode }) => children,
    };
});

import { MovieEditProvider, useMovieEdit, type MovieEditValue } from './MovieEdit-ctx';
import { SegmentsPanel } from './SegmentsPanel';

/** A video element whose clock is the test's. */
const fakeVideo = (): HTMLVideoElement => {
    const video = document.createElement('video');
    const clock = { time: 0, paused: true };
    Object.defineProperties(video, {
        duration: { configurable: true, get: () => 2 },
        currentTime: { configurable: true, get: () => clock.time, set: (t: number) => { clock.time = t; } },
        paused: { configurable: true, get: () => clock.paused },
    });
    video.pause = () => { clock.paused = true; };
    video.play = async () => { clock.paused = false; };
    return video;
};

let movie: MovieEditValue;

const Probe: React.FC<{ video: HTMLVideoElement }> = ({ video }) => {
    movie = useMovieEdit();
    const { attach } = movie;
    React.useEffect(() => { attach(video); }, [attach, video]);
    return null;
};

const mount = async (children?: React.ReactNode): Promise<HTMLVideoElement> => {
    const video = fakeVideo();
    await act(async () => {
        render(
            <MovieEditProvider path="/films/clip.mp4" audio={false}>
                <Probe video={video} />
                {children}
            </MovieEditProvider>,
        );
    });
    return video;
};

/** Puts the playhead somewhere, as a seek landing there would. */
const standAt = async (video: HTMLVideoElement, t: number) => {
    await act(async () => {
        video.currentTime = t;
        video.dispatchEvent(new Event('seeked'));
    });
};

const written = () => JSON.parse(sidecar.writes[sidecar.writes.length - 1]);

const twoSegments = JSON.stringify({
    segments: [
        { id: 'a', name: 'A', startMs: 700, endMs: 1400 },
        { id: 'b', name: 'B', startMs: 1500, endMs: 1900 },
    ],
});

beforeEach(() => {
    sidecar.text = '';
    sidecar.writes = [];
    Object.values(files.client).forEach(fn => fn.mockReset());
    files.refresh.mockReset();
});

describe('a segment', () => {
    // 0.75 is the middle of the image starting at 0.7, which is what a step there leaves.
    it('is added at the image on screen, and becomes the current one', async () => {
        const video = await mount();
        await standAt(video, 0.75);
        act(() => movie.add());
        expect(written().segments).toEqual([{ id: movie.selected?.id, name: 'Segment 1', startMs: 700, endMs: 700 }]);
        expect(movie.selected?.name).toBe('Segment 1');
    });

    it('takes the image on screen as its start or its end', async () => {
        const video = await mount();
        await standAt(video, 0.75);
        act(() => movie.add());
        await standAt(video, 1.45);
        act(() => movie.setEnd());
        await standAt(video, 0.25);
        act(() => movie.setStart());
        expect(written().segments[0]).toMatchObject({ startMs: 200, endMs: 1400 });
    });

    it('has no start or end to take until one is current', async () => {
        sidecar.text = twoSegments;
        await mount();
        act(() => {
            movie.setStart();
            movie.setEnd();
        });
        expect(sidecar.writes).toEqual([]);
    });

    it('is gone to by the middle of its first or its last image', async () => {
        sidecar.text = twoSegments;
        const video = await mount();
        act(() => movie.goToStart('a'));
        expect(video.currentTime).toBeCloseTo(0.75, 9);
        expect(movie.selected?.id).toBe('a');
        act(() => movie.goToEnd('a'));
        expect(video.currentTime).toBeCloseTo(1.45, 9);
    });

    it('is renamed and removed — and a removed one is current no more', async () => {
        sidecar.text = twoSegments;
        await mount();
        act(() => movie.select('a'));
        act(() => movie.rename('a', 'Intro'));
        expect(written().segments.map((s: { name: string }) => s.name)).toEqual(['Intro', 'B']);
        act(() => movie.remove('a'));
        expect(written().segments.map((s: { id: string }) => s.id)).toEqual(['b']);
        expect(movie.selected).toBeNull();
    });
});

describe('the steps', () => {
    it('go an image and a key image from the one on screen, with the player stopped', async () => {
        const video = await mount();
        await standAt(video, 0.35);
        await act(async () => { await video.play(); });

        act(() => movie.stepImage(1));
        expect(video.paused).toBe(true);
        expect(video.currentTime).toBeCloseTo(0.45, 9);
        act(() => movie.stepKeyImage(1));
        expect(video.currentTime).toBeCloseTo(0.75, 9);
        act(() => movie.stepKeyImage(-1));
        expect(video.currentTime).toBeCloseTo(0.05, 9);
        expect(movie.time).toBeCloseTo(0, 9);
    });

    it('say where they cannot go', async () => {
        const video = await mount();
        await standAt(video, 1.45);
        expect(movie.can).toEqual({ previousImage: true, nextImage: true, previousKey: true, nextKey: false });
        await standAt(video, 0.05);
        expect(movie.can).toEqual({ previousImage: false, nextImage: true, previousKey: false, nextKey: true });
    });
});

describe('a sidecar that does not read', () => {
    it('is said to be so, and is never written over', async () => {
        sidecar.text = '{ "segments": [';
        await mount();
        expect(movie.invalid).toBe(true);
        act(() => movie.add());
        expect(sidecar.writes).toEqual([]);
    });
});

describe('the segments panel', () => {
    // Its tab is registered for every document, as every plugin's is.
    it('says what it is for when no video is open', () => {
        render(<SegmentsPanel />);
        expect(screen.getByText(/Open a video or a recording/)).toBeInTheDocument();
    });

    it('lists each segment with its two ends, each a way to go there', async () => {
        sidecar.text = JSON.stringify({ segments: [{ id: 'a', name: 'Intro', startMs: 700, endMs: 1400 }] });
        const video = await mount(<SegmentsPanel />);
        expect(screen.getByTestId('segment-name')).toHaveValue('Intro');
        expect(screen.getByTestId('segment-start')).toHaveTextContent('0:00.700');
        fireEvent.click(screen.getByTestId('segment-end'));
        expect(video.currentTime).toBeCloseTo(1.45, 9);
        expect(screen.getByTestId('segment-row')).toHaveAttribute('data-selected', 'true');
    });
});

describe('saving the segments', () => {
    const intro = JSON.stringify({ segments: [{ id: 'a', name: 'Intro', startMs: 700, endMs: 1400 }] });

    const saveJob = (over: Partial<MediaJob> = {}): MediaJob => ({
        id: 'save-1', path: 'films/clip.mp4', state: 'running', files: ['films/Intro.mkv'],
        done: 0, progress: 0, startedAt: 'now', ...over,
    });
    const installJob = (state: ToolboxJob['state']): ToolboxJob => ({
        id: 'job-1', op: 'install', ids: ['ffmpeg'], state, log: 'downloading', startedAt: 'now',
    });
    const toolbox = (over: Partial<Toolbox> = {}): Toolbox => ({
        enabled: true, platform: 'debian', strict: false,
        components: [{ id: 'ffmpeg', kind: 'runtime', title: 'FFmpeg', role: 'saves segments', state: 'available', registered: false }],
        ...over,
    });
    const noFFmpeg = () => new WorkerError(
        'FFmpeg is not installed on this machine, and saving segments needs it', 424, 'Failed Dependency');

    it('saves each segment from the start of its first image to the end of its last', async () => {
        sidecar.text = intro;
        files.client.listFiles.mockResolvedValue([]);
        files.client.saveMediaSegments.mockResolvedValue(saveJob());
        files.client.getMediaJob.mockResolvedValue(saveJob({ state: 'done', done: 1, progress: 1 }));
        await mount(<SegmentsPanel />);

        fireEvent.click(screen.getByTestId('save-segments'));
        // The image at 1.4 lasts until the one at 1.5 begins, and is in the segment whole.
        await waitFor(() => expect(files.client.saveMediaSegments)
            .toHaveBeenCalledWith('/films/clip.mp4', [{ name: 'Intro', fromMs: 700, toMs: 1500 }]));
        // Followed until it is done, and the tree then shown what it wrote.
        await waitFor(() => expect(files.refresh).toHaveBeenCalled(), { timeout: 3000 });
    });

    it('asks before replacing a file already there, whatever its case', async () => {
        sidecar.text = intro;
        files.client.listFiles.mockResolvedValue([{ path: 'films/intro.MKV', isDirectory: false }]);
        files.client.saveMediaSegments.mockResolvedValue(saveJob());
        files.client.getMediaJob.mockResolvedValue(saveJob({ state: 'done', done: 1 }));
        await mount(<SegmentsPanel />);

        fireEvent.click(screen.getByTestId('save-segments'));
        expect(await screen.findByText('Replace the files already there?')).toBeInTheDocument();
        expect(files.client.saveMediaSegments).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
        await waitFor(() => expect(files.client.saveMediaSegments).toHaveBeenCalled());
    });

    it('offers to install FFmpeg where there is none, and saves once it is in place', async () => {
        sidecar.text = intro;
        files.client.listFiles.mockResolvedValue([]);
        files.client.saveMediaSegments.mockRejectedValueOnce(noFFmpeg()).mockResolvedValue(saveJob());
        files.client.getToolbox.mockResolvedValue(toolbox());
        files.client.installToolboxComponents.mockResolvedValue(installJob('running'));
        files.client.getToolboxJob.mockResolvedValue(installJob('done'));
        files.client.getMediaJob.mockResolvedValue(saveJob({ state: 'done', done: 1 }));
        await mount(<SegmentsPanel />);

        fireEvent.click(screen.getByTestId('save-segments'));
        expect(await screen.findByText('FFmpeg is not installed on this machine, and saving segments needs it.'))
            .toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Install FFmpeg' }));
        await waitFor(() => expect(files.client.installToolboxComponents).toHaveBeenCalledWith(['ffmpeg']));
        // The save it was for starts by itself once the install is done.
        await waitFor(() => expect(files.client.saveMediaSegments).toHaveBeenCalledTimes(2), { timeout: 3000 });
    });

    it('says why, and offers nothing, where this deployment installs nothing', async () => {
        sidecar.text = intro;
        files.client.listFiles.mockResolvedValue([]);
        files.client.saveMediaSegments.mockRejectedValue(noFFmpeg());
        files.client.getToolbox.mockResolvedValue(toolbox({ enabled: false }));
        await mount(<SegmentsPanel />);

        fireEvent.click(screen.getByTestId('save-segments'));
        expect(await screen.findByText(/KIAO_WORKER_TOOLBOX_PATH is not set/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Install FFmpeg' })).toBeNull();
    });

    it('refuses two segments that would be one file, before asking anything', async () => {
        sidecar.text = JSON.stringify({ segments: [
            { id: 'a', name: 'Intro', startMs: 0, endMs: 100 },
            { id: 'b', name: 'intro', startMs: 200, endMs: 300 },
        ] });
        await mount(<SegmentsPanel />);

        fireEvent.click(screen.getByTestId('save-segments'));
        expect(await screen.findByText(/would both be saved as intro\.mkv/)).toBeInTheDocument();
        expect(files.client.listFiles).not.toHaveBeenCalled();
        expect(files.client.saveMediaSegments).not.toHaveBeenCalled();
    });
});
