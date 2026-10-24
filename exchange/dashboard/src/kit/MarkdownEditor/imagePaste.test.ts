import { describe, it, expect } from 'vitest';
import {
    base64Size,
    buildImageMarkdown,
    imageLinkPath,
    defaultImageFileName,
    extensionForMime,
    formatBytes,
    replaceExtension,
} from './imagePaste';

describe('extensionForMime', () => {
    it('maps the common image mime types', () => {
        expect(extensionForMime('image/png')).toBe('png');
        expect(extensionForMime('image/jpeg')).toBe('jpg');
        expect(extensionForMime('image/webp')).toBe('webp');
        expect(extensionForMime('image/svg+xml')).toBe('svg');
    });

    it('falls back to the sanitized subtype, then png', () => {
        expect(extensionForMime('image/x-icon')).toBe('xicon');
        expect(extensionForMime('')).toBe('png');
    });
});

describe('replaceExtension', () => {
    it('swaps the extension of the last segment', () => {
        expect(replaceExtension('docs/notes/img-1.png', 'jpg')).toBe('docs/notes/img-1.jpg');
    });

    it('appends when the file has no extension', () => {
        expect(replaceExtension('docs/image', 'webp')).toBe('docs/image.webp');
    });

    it('ignores dots in directory names', () => {
        expect(replaceExtension('docs.v2/image', 'png')).toBe('docs.v2/image.png');
    });
});

describe('defaultImageFileName', () => {
    const now = new Date(2026, 6, 15, 14, 30, 59);

    it('derives a timestamped name from the document name', () => {
        expect(defaultImageFileName('notes.md', 'image/png', now)).toBe('notes-20260715-143059.png');
    });

    it('uses the mime type for the extension', () => {
        expect(defaultImageFileName('unit.mlunit.json', 'image/jpeg', now)).toBe('unit.mlunit-20260715-143059.jpg');
    });

    it('falls back to "image" for empty document names', () => {
        expect(defaultImageFileName('', 'image/png', now)).toBe('image-20260715-143059.png');
    });
});

describe('formatBytes', () => {
    it('formats bytes, kilobytes and megabytes', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2.0 KB');
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
    });
});

describe('base64Size', () => {
    it('rounds up to 4/3 of the raw size', () => {
        expect(base64Size(new Blob([new Uint8Array(3)]))).toBe(4);
        expect(base64Size(new Blob([new Uint8Array(4)]))).toBe(8);
    });
});

// A pasted image is linked the way the renderer reads it back: relative to the document, so the
// same file also shows the picture on GitHub or in an IDE preview.
describe('imageLinkPath', () => {
    it('links an image in the document folder by its name alone', () => {
        expect(imageLinkPath('units/abc/shot.png', 'units/abc')).toBe('shot.png');
    });

    it('keeps the folders below the document', () => {
        expect(imageLinkPath('units/abc/pictures/shot.png', 'units/abc')).toBe('pictures/shot.png');
    });

    it('writes an image saved elsewhere from the store root', () => {
        expect(imageLinkPath('shared/shot.png', 'units/abc')).toBe('/shared/shot.png');
    });

    it('links from the root for a document at the root', () => {
        expect(imageLinkPath('pictures/shot.png', '')).toBe('pictures/shot.png');
    });

    // A folder whose name merely starts like the document's is not below it.
    it('does not mistake a sibling folder for a subfolder', () => {
        expect(imageLinkPath('units/abcdef/shot.png', 'units/abc')).toBe('/units/abcdef/shot.png');
    });

    // A card has no document for a relative link to resolve against, so its links are written
    // from the store root even when the image sits in the board's folder.
    it('writes from the store root for content held nowhere', () => {
        expect(imageLinkPath('boards/major/shot.png', 'boards/major', true)).toBe('/boards/major/shot.png');
        expect(imageLinkPath('/boards/major/shot.png', 'boards/major', true)).toBe('/boards/major/shot.png');
    });
});

describe('buildImageMarkdown', () => {
    it('builds an image reference', () => {
        expect(buildImageMarkdown('img.png', 'docs/img.png')).toBe('![img.png](docs/img.png)');
    });

    it('strips brackets from the alt text', () => {
        expect(buildImageMarkdown('a[b]c', 'x.png')).toBe('![abc](x.png)');
    });
});
