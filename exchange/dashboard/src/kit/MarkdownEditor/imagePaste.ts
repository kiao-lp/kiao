/**
 * Image-paste support for the markdown editors: pure helpers for naming, sizing
 * and markdown snippets, plus canvas-based re-encoding to PNG / JPEG / WebP —
 * no image-processing dependency required.
 */

export type ImageOutputFormat = 'original' | 'image/png' | 'image/jpeg' | 'image/webp';

export interface ConvertedImage {
    blob: Blob;
    dataUrl: string;
    width: number;
    height: number;
}

const MIME_EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
};

export const extensionForMime = (mimeType: string): string => {
    if (MIME_EXTENSIONS[mimeType]) return MIME_EXTENSIONS[mimeType];
    const subtype = mimeType.split('/')[1] || '';
    const cleaned = subtype.replace(/[^a-z0-9]/gi, '');
    return cleaned || 'png';
};

/** Swap (or add) the file extension of the last path segment. */
export const replaceExtension = (path: string, extension: string): string => {
    const slash = path.lastIndexOf('/');
    const dot = path.lastIndexOf('.');
    if (dot <= slash) return `${path}.${extension}`;
    return `${path.substring(0, dot)}.${extension}`;
};

/** `notes.md` + `image/png` → `notes-20260715-143059.png` (unique per second). */
export const defaultImageFileName = (documentName: string, mimeType: string, now: Date = new Date()): string => {
    const base = documentName.replace(/\.[^.]*$/, '') || 'image';
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${base}-${stamp}.${extensionForMime(mimeType)}`;
};

export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/** Size of `blob` once base64-encoded into a data URL (markdown embedding). */
export const base64Size = (blob: Blob): number => Math.ceil(blob.size / 3) * 4;

export const buildImageMarkdown = (alt: string, src: string): string =>
    `![${alt.replace(/[[\]]/g, '')}](${src})`;

/**
 * How to write the link to an image stored at `imagePath` (root-relative) in a document held in
 * `documentFolder` (root-relative too, `''` being the store root).
 *
 * Relative whenever the image sits in that folder or under it, which is where the modal offers to
 * put it: `foo.png`, `pictures/foo.png`. That is what markdown means by a relative link — the
 * renderer reads it against the document (see cms-core/markdown/imageSource.ts) — and it is what
 * makes the document read the same on GitHub or in an IDE preview.
 *
 * An image saved anywhere else has no short form, so it is written from the store root with the
 * leading slash that says so. That slash is the only thing telling the two readings apart.
 *
 * Content the store holds no document for — a card, held in a database row — has no folder to
 * read a relative link against: neither the turn the body is sent to nor the preview stands in
 * the board's folder. Its links are written from the store root whatever folder the file went
 * into (`fromRoot`), which is also what the skill prescribes for bodies.
 */
export const imageLinkPath = (imagePath: string, documentFolder: string, fromRoot = false): string => {
    const path = imagePath.replace(/^\/+/, '');
    if (fromRoot) return `/${path}`;
    const folder = documentFolder.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!folder) return path;
    return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : `/${path}`;
};

/** First image file in a paste/drop DataTransfer, if any. */
export const findImageFile = (data: DataTransfer | null): File | null => {
    if (!data) return null;
    for (const item of Array.from(data.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) return file;
        }
    }
    return null;
};

export const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

interface DecodedImage {
    source: CanvasImageSource;
    width: number;
    height: number;
    close: () => void;
}

const decodeImage = async (blob: Blob): Promise<DecodedImage> => {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob);
            return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
        } catch {
            // e.g. SVG blobs on some browsers — fall through to <img> decoding
        }
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Could not decode image'));
            el.src = url;
        });
        return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    }
};

/**
 * Re-encode `source` to `format` via a canvas; quality ∈ (0, 1] applies to
 * JPEG / WebP only. `'original'` keeps the source bytes untouched (it is still
 * decoded once, to report the dimensions).
 */
export const convertImage = async (
    source: Blob,
    format: ImageOutputFormat,
    quality: number,
): Promise<ConvertedImage> => {
    const image = await decodeImage(source);
    try {
        if (format === 'original') {
            return { blob: source, dataUrl: await blobToDataUrl(source), width: image.width, height: image.height };
        }
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        if (format === 'image/jpeg') {
            // JPEG has no alpha channel: transparent pixels would turn black
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image.source, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error(`Conversion to ${format} failed`))),
                format,
                format === 'image/png' ? undefined : quality,
            );
        });
        return { blob, dataUrl: await blobToDataUrl(blob), width: image.width, height: image.height };
    } finally {
        image.close();
    }
};
