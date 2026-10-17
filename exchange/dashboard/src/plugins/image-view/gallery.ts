import { FileDto, extractName } from '@cms-core';

/**
 * The suffixes the viewer opens — and therefore what counts as a neighbour when the reader steps
 * through a folder. One list, read twice: `fileConfigFor` claims a file with it, and the gallery
 * below keeps only the siblings this same viewer could show.
 */
export const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

export const isImagePath = (path: string): boolean => {
    const name = extractName(path).toLowerCase();
    return supportedExtensions.some(extension => name.endsWith(extension));
};

/**
 * The pictures of a folder listing, in the order the file browser shows them — the same
 * case-insensitive compare, so "next" means the next one down the list the reader just left.
 * Anything else in the folder is skipped: stepping onto a `.md` would leave the viewer.
 */
export const imagesIn = (files: FileDto[]): string[] =>
    files
        .filter(file => !file.isDirectory && isImagePath(file.path))
        .map(file => file.path)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

export interface GalleryPosition {
    /** 1-based rank of the open picture among the folder's, or 0 while the listing has not arrived. */
    rank: number;
    count: number;
    /** The paths either side, or null at an end — which is also what disables an arrow. */
    previous: string | null;
    next: string | null;
}

export const positionOf = (images: string[], path: string): GalleryPosition => {
    const index = images.indexOf(path);
    return {
        rank: index + 1,
        count: images.length,
        previous: index > 0 ? images[index - 1] : null,
        next: index >= 0 && index < images.length - 1 ? images[index + 1] : null,
    };
};

/**
 * Where the reader is taken once the open picture is deleted: the picture that took its place —
 * the next one — or the previous one when the deleted one was last, or `null` when the folder
 * holds no other picture, which is the caller's cue to fall back to the folder itself.
 *
 * Read *before* the deletion, since the listing it works from no longer holds the file after.
 */
export const afterDeleting = (images: string[], path: string): string | null => {
    const { previous, next } = positionOf(images, path);
    return next ?? previous;
};
