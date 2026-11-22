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

export const base64Size = (blob: Blob): number => Math.ceil(blob.size / 3) * 4;

export const buildImageMarkdown = (alt: string, src: string): string =>
    `![${alt.replace(/[[\]]/g, '')}](${src})`;

/** Paths are root-relative; `''` folder is the root. Relative if under the document folder, else root-prefixed; `fromRoot` forces root. */
export const imageLinkPath = (imagePath: string, documentFolder: string, fromRoot = false): string => {
    const path = imagePath.replace(/^\/+/, '');
    if (fromRoot) return `/${path}`;
    const folder = documentFolder.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!folder) return path;
    return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : `/${path}`;
};

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
            // SVG blobs fail on some browsers; fall through to <img>.
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

/** Quality applies to JPEG/WebP only. `'original'` keeps the bytes; it still decodes for dimensions. */
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
