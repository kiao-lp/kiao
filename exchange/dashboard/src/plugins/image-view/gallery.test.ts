import { describe, it, expect } from 'vitest';
import { FileDto } from '@cms-core';
import { afterDeleting, imagesIn, isImagePath, positionOf } from './gallery';

const file = (path: string, isDirectory = false): FileDto =>
    ({ path, isDirectory, size: 0, lastModified: 0 });

/** A folder as the listing service returns one: unordered, and not only pictures. */
const folder = [
    file('album/Zebra.png'),
    file('album/notes.md'),
    file('album/beach.JPG'),
    file('album/thumbs', true),
    file('album/apple.gif'),
];

describe('imagesIn', () => {
    it('keeps the pictures the viewer can open, in the browser\'s order', () => {
        // Case-insensitive, as the file browser sorts: "beach" sits between "apple" and "Zebra".
        expect(imagesIn(folder)).toEqual(['album/apple.gif', 'album/beach.JPG', 'album/Zebra.png']);
    });

    it('drops folders even when they are named like a picture', () => {
        expect(imagesIn([file('album/holidays.png', true)])).toEqual([]);
    });
});

describe('positionOf', () => {
    const images = imagesIn(folder);

    it('places a picture between its neighbours', () => {
        expect(positionOf(images, 'album/beach.JPG')).toEqual({
            rank: 2, count: 3, previous: 'album/apple.gif', next: 'album/Zebra.png',
        });
    });

    it('leaves the arrow at each end with nowhere to go', () => {
        expect(positionOf(images, 'album/apple.gif').previous).toBeNull();
        expect(positionOf(images, 'album/Zebra.png').next).toBeNull();
    });

    it('offers no step at all while the listing has not arrived', () => {
        expect(positionOf([], 'album/beach.JPG')).toEqual({
            rank: 0, count: 0, previous: null, next: null,
        });
    });

    it('offers no step for a picture the listing does not hold', () => {
        // Navigated to straight, ahead of its folder being read — nothing to step to yet.
        expect(positionOf(images, 'elsewhere/other.png')).toMatchObject({
            rank: 0, previous: null, next: null,
        });
    });
});

describe('afterDeleting', () => {
    const images = imagesIn(folder);

    it('moves on to the picture that takes its place', () => {
        expect(afterDeleting(images, 'album/apple.gif')).toBe('album/beach.JPG');
    });

    it('falls back on the one before when the last is deleted', () => {
        expect(afterDeleting(images, 'album/Zebra.png')).toBe('album/beach.JPG');
    });

    it('has nowhere to go when the folder held one picture', () => {
        expect(afterDeleting(['album/only.png'], 'album/only.png')).toBeNull();
    });
});

describe('isImagePath', () => {
    it('claims the supported suffixes whatever their case', () => {
        ['a.jpg', 'a.jpeg', 'a.png', 'a.gif', 'a.webp', 'DIR/A.PNG'].forEach(path =>
            expect(isImagePath(path)).toBe(true));
    });

    it('leaves everything else alone', () => {
        ['a.txt', 'a.pdf', 'a.mp4', 'png', 'a.png.txt'].forEach(path =>
            expect(isImagePath(path)).toBe(false));
    });
});
