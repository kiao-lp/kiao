import { useEffect, useRef, useState } from 'react';
import { HEAD_BYTES, openRangeSource, readFrameTimeline } from './containers';
import type { FrameTimeline } from './timeline';

export interface FileTimeline {

    status: 'loading' | 'ready' | 'unknown';

    timeline: FrameTimeline | null;
}

/**
 * Where the images of the video at `path` are, read out of its file in the background — see.
 * The video plays meanwhile; only the steps wait for it.
 */
export const useFrameTimeline = (path: string, url: string, enabled: boolean): FileTimeline => {
    const [state, setState] = useState<FileTimeline>({ status: enabled ? 'loading' : 'unknown', timeline: null });
    const urlRef = useRef(url);
    urlRef.current = url;

    useEffect(() => {
        if (!enabled) {
            setState({ status: 'unknown', timeline: null });
            return;
        }
        const abort = new AbortController();
        setState({ status: 'loading', timeline: null });
        (async () => {
            try {
                const { source, head } = await openRangeSource(urlRef.current, HEAD_BYTES, abort.signal);
                const timeline = await readFrameTimeline(source, head);
                if (abort.signal.aborted) return;
                setState(timeline ? { status: 'ready', timeline } : { status: 'unknown', timeline: null });
            } catch (error) {
                if (abort.signal.aborted) return;
                console.debug('Could not read where the images of this video are', path, error);
                setState({ status: 'unknown', timeline: null });
            }
        })();
        return () => abort.abort();
    }, [path, enabled]);

    return state;
};
