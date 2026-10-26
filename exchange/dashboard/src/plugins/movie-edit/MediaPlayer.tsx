import React, { useCallback, useRef } from 'react';
import { useFileViewState } from '@cms-core';
import { useMovieEdit } from './MovieEdit-ctx';
import styles from './MovieEdit.module.css';

/** Reopening this close to the end means it was finished — start over instead. */
const RESUME_TAIL_SECONDS = 10;

/**
 * The video or the recording, in the browser's own player: its seek bar, its volume and its full
 * screen are the browser's. What this plugin adds is in the banner and in the segments panel —
 * nothing is drawn over what is being watched.
 */
export const MediaPlayer: React.FC = () => {
    const { url, audio, attach } = useMovieEdit();
    // A podcast script's audio is long; picking it up where it stopped is the
    // point of remembering anything about it at all.
    const [playback, setPlayback] = useFileViewState('media', { position: 0 });
    const positionRef = useRef(playback.position);
    positionRef.current = playback.position;

    const handleLoaded = useCallback((e: React.SyntheticEvent<HTMLMediaElement>) => {
        const el = e.currentTarget;
        const stored = positionRef.current;
        if (stored > 0 && stored < el.duration - RESUME_TAIL_SECONDS) el.currentTime = stored;
    }, []);

    const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLMediaElement>) => {
        // Once a second is enough; the store drops writes that change nothing.
        setPlayback({ position: Math.floor(e.currentTarget.currentTime) });
    }, [setPlayback]);

    const mediaProps = {
        ref: attach,
        src: url,
        controls: true,
        onLoadedMetadata: handleLoaded,
        onTimeUpdate: handleTimeUpdate,
        'data-testid': 'movie-player',
    };

    return (
        <div className={styles.stage}>
            {audio ? (
                <audio className={styles.audio} {...mediaProps}>
                    Your browser does not support the audio tag.
                </audio>
            ) : (
                <video className={styles.video} {...mediaProps}>
                    Your browser does not support the video tag.
                </video>
            )}
        </div>
    );
};
