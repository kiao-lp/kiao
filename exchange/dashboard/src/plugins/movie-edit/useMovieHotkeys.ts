import { useRef } from 'react';
import { usePluginHotkeys } from '@cms-core';
import { useMovieEdit } from './MovieEdit-ctx';

/** The arrows step through a video's images while it is open, as they step through a folder's pictures. */
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
