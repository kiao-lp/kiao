import { FileDto, extractName } from '@kiao-dashboard-core';

/** Extensions the viewer opens. Shared by `fileConfigFor` and gallery filtering. */
export const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

export const isImagePath = (path: string): boolean => {
    const name = extractName(path).toLowerCase();
    return supportedExtensions.some(extension => name.endsWith(extension));
};

/** Images in folder order (case-insensitive, as in the file browser). Non-images excluded. */
export const imagesIn = (files: FileDto[]): string[] =>
    files
        .filter(file => !file.isDirectory && isImagePath(file.path))
        .map(file => file.path)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

export interface GalleryPosition {
    /** 1-based rank; 0 if not in the listing. */
    rank: number;
    count: number;
    /** Adjacent paths; null at an end (disables the arrow). */
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

/** Destination after deletion: next image, else previous, else null (fall back to folder). Call before deleting. */
export const afterDeleting = (images: string[], path: string): string | null => {
    const { previous, next } = positionOf(images, path);
    return next ?? previous;
};
