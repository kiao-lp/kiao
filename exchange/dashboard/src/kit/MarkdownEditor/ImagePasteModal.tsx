import React, { useEffect, useState } from 'react';
import { Input, Modal, Radio, Select, Slider, Typography, message, theme } from 'antd';
import {
    ConvertedImage,
    ImageOutputFormat,
    base64Size,
    blobToDataUrl,
    convertImage,
    defaultImageFileName,
    extensionForMime,
    formatBytes,
    replaceExtension,
} from './imagePaste';

export type ImageStorage = 'embed' | 'file';

export interface ImagePasteResult {
    storage: ImageStorage;
    /** Target worker path — only set when `storage` is `'file'`. */
    path?: string;
    blob: Blob;
    dataUrl: string;
}

export interface ImagePasteModalProps {
    /** The pasted image; the modal is open while this is non-null. */
    image: File | null;
    /** Directory (worker path, no leading slash; '' = root) seeding the default file path. */
    defaultDirectory: string;
    /** Name of the edited document, seeding the unique default image name. */
    documentName: string;
    onCancel: () => void;
    /** Persist / embed the image; the modal shows a busy OK button until it settles. */
    onConfirm: (result: ImagePasteResult) => Promise<void>;
}

const FORMAT_OPTIONS: { value: ImageOutputFormat; label: string }[] = [
    { value: 'original', label: 'Original' },
    { value: 'image/png', label: 'PNG' },
    { value: 'image/jpeg', label: 'JPEG' },
    { value: 'image/webp', label: 'WebP' },
];

const DEFAULT_QUALITY = 0.85;

/** Checkerboard so transparency is visible in the previews. */
const previewBackground = {
    backgroundImage:
        'repeating-conic-gradient(rgba(128, 128, 128, 0.18) 0% 25%, transparent 0% 50%)',
    backgroundSize: '16px 16px',
};

const PreviewPane: React.FC<{ label: string; src?: string; caption: string }> = ({ label, src, caption }) => {
    const { token } = theme.useToken();
    return (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label}</Typography.Text>
            <div
                style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    height: 180,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    ...previewBackground,
                }}
            >
                {src
                    ? <img src={src} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <Typography.Text type="secondary">…</Typography.Text>}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{caption}</Typography.Text>
        </div>
    );
};

/**
 * Paste-an-image dialog: previews the pasted image before / after conversion,
 * lets the user pick where it goes (embedded as base64 vs. saved as a file at
 * an editable path) and its format / quality, and live-updates the resulting
 * size as those change.
 */
export const ImagePasteModal: React.FC<ImagePasteModalProps> = ({
    image,
    defaultDirectory,
    documentName,
    onCancel,
    onConfirm,
}) => {
    const [storage, setStorage] = useState<ImageStorage>('file');
    const [format, setFormat] = useState<ImageOutputFormat>('original');
    const [quality, setQuality] = useState(DEFAULT_QUALITY);
    const [path, setPath] = useState('');
    const [originalUrl, setOriginalUrl] = useState<string | undefined>(undefined);
    const [converted, setConverted] = useState<ConvertedImage | null>(null);
    const [busy, setBusy] = useState(false);

    // Reset the dialog for each newly pasted image
    useEffect(() => {
        if (!image) return;
        setStorage('file');
        setFormat('original');
        setQuality(DEFAULT_QUALITY);
        const name = defaultImageFileName(documentName, image.type);
        setPath(defaultDirectory ? `${defaultDirectory}/${name}` : name);
    }, [image, defaultDirectory, documentName]);

    // "Before" preview: the pasted image as-is
    useEffect(() => {
        if (!image) {
            setOriginalUrl(undefined);
            return;
        }
        blobToDataUrl(image).then(setOriginalUrl).catch(() => setOriginalUrl(undefined));
    }, [image]);

    // Re-encode whenever the image, format or quality changes
    useEffect(() => {
        if (!image) {
            setConverted(null);
            return;
        }
        let cancelled = false;
        setConverted(null);
        convertImage(image, format, quality)
            .then((result) => {
                if (cancelled) return;
                setConverted(result);
            })
            .catch((err) => {
                console.error('Image conversion failed', err);
                if (!cancelled) message.error(`Image conversion failed: ${err.message || err}`);
            });
        return () => {
            cancelled = true;
        };
    }, [image, format, quality]);

    const handleFormatChange = (next: ImageOutputFormat) => {
        setFormat(next);
        const extension = next === 'original' ? extensionForMime(image?.type || '') : extensionForMime(next);
        setPath((p) => replaceExtension(p, extension));
    };

    const handleOk = async () => {
        if (!converted) return;
        setBusy(true);
        try {
            await onConfirm({
                storage,
                path: storage === 'file' ? path.trim() : undefined,
                blob: converted.blob,
                dataUrl: converted.dataUrl,
            });
        } catch (err: any) {
            console.error('Failed to insert image', err);
            message.error(`Failed to insert image: ${err.message || err}`);
        } finally {
            setBusy(false);
        }
    };

    const dimensions = converted ? `${converted.width} × ${converted.height}` : '';
    const resultCaption = converted
        ? `${formatBytes(converted.blob.size)} — ${dimensions}` +
          (storage === 'embed' ? ` (≈ ${formatBytes(base64Size(converted.blob))} as base64)` : '')
        : 'Converting…';
    const showQuality = format === 'image/jpeg' || format === 'image/webp';

    return (
        <Modal
            title="Paste image"
            open={image !== null}
            onOk={handleOk}
            onCancel={onCancel}
            okText="Insert"
            okButtonProps={{
                loading: busy,
                disabled: !converted || (storage === 'file' && path.trim() === ''),
            }}
            width={640}
            destroyOnHidden
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                    <PreviewPane
                        label="Before"
                        src={originalUrl}
                        caption={image ? `${image.type || 'image'} — ${formatBytes(image.size)}` : ''}
                    />
                    <PreviewPane
                        label="After"
                        src={converted?.dataUrl}
                        caption={resultCaption}
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Typography.Text strong>Storage</Typography.Text>
                    <Radio.Group
                        value={storage}
                        onChange={(e) => setStorage(e.target.value)}
                        options={[
                            { value: 'file', label: 'Image file next to the document' },
                            { value: 'embed', label: 'Inside the markdown (base64)' },
                        ]}
                    />
                    {storage === 'file' && (
                        <Input
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            placeholder="path/to/image.png"
                            data-testid="image-paste-path"
                        />
                    )}
                </div>

                <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Typography.Text strong>Format</Typography.Text>
                        <Select
                            value={format}
                            onChange={handleFormatChange}
                            options={FORMAT_OPTIONS.map((o) =>
                                o.value === 'original' && image?.type ? { ...o, label: `Original (${image.type})` } : o,
                            )}
                            style={{ width: 200 }}
                        />
                    </div>
                    {showQuality && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Typography.Text strong>Quality</Typography.Text>
                            <Slider
                                min={0.1}
                                max={1}
                                step={0.05}
                                value={quality}
                                onChange={setQuality}
                                tooltip={{ formatter: (v) => `${Math.round((v ?? 0) * 100)}%` }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};
