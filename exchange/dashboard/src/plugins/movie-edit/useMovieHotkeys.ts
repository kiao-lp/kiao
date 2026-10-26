import { useRef } from 'react';
import { usePluginHotkeys } from '@cms-core';
import { useMovieEdit } from './MovieEdit-ctx';

/**
 * The arrows step through a video's images while it is open, as they step through a folder's
 * pictures while a picture is: ← and → an image at a time, and with Shift a key image at a time.
 * A recording has no images, and registers none.
 *
 * Registered once, and read through a ref, for the reason the image viewer gives: the registry
 * snapshots which keys are live, and a key registered anew at every change of position would be
 * dead in between. A step with nowhere to go does nothing, which is what its disabled button says.
 */
export const useMovieHotkeys = (): void => {
    const movie = useMovieEdit();
    const movieRef = useRef(movie);
    movieRef.current = movie;

    usePluginHotkeys('movie-edit', movie.audio ? [] : [
        {
            id: 'movie-previous-image',
            key: 'ArrowLeft',
            title: '←. Previous image',
            execute: () => movieRef.current.stepImage(-1),
        },
        {
            id: 'movie-next-image',
            key: 'ArrowRight',
            title: '→. Next image',
            execute: () => movieRef.current.stepImage(1),
        },
        {
            id: 'movie-previous-key-image',
            key: 'Shift+ArrowLeft',
            title: 'Shift+←. Previous key image',
            execute: () => movieRef.current.stepKeyImage(-1),
        },
        {
            id: 'movie-next-key-image',
            key: 'Shift+ArrowRight',
            title: 'Shift+→. Next key image',
            execute: () => movieRef.current.stepKeyImage(1),
        },
    ], [movie.audio]);
};
