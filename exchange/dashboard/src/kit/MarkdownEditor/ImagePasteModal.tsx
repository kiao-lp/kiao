import React, { useEffect, useRef, useState } from 'react';
import { Input, Modal, Radio, Select, Slider, Typography, message } from 'antd';
import { ImagePreview } from '@kiao-dashboard-core';
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
    image: File | null;
    /** Worker path, no leading slash; '' = root. */
    defaultDirectory: string;
    documentName: string;
    onCancel: () => void;
    onConfirm: (result: ImagePasteResult) => Promise<void>;
}

const FORMAT_OPTIONS: { value: ImageOutputFormat; label: string }[] = [
    { value: 'original', label: 'Original' },
    { value: 'image/png', label: 'PNG' },
    { value: 'image/jpeg', label: 'JPEG' },
    { value: 'image/webp', label: 'WebP' },
];

const DEFAULT_QUALITY = 0.85;

interface Conversion {
    image: File;
    format: ImageOutputFormat;
    quality: number;
    result?: ConvertedImage;
    error?: string;
}

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
    const [conversion, setConversion] = useState<Conversion | null>(null);
    const [busy, setBusy] = useState(false);
    const inserting = useRef(false);

    useEffect(() => {
        if (!image) return;
        setStorage('file');
        setFormat('original');
        setQuality(DEFAULT_QUALITY);
        const name = defaultImageFileName(documentName, image.type);
        setPath(defaultDirectory ? `${defaultDirectory}/${name}` : name);
    }, [image, defaultDirectory, documentName]);

    useEffect(() => {
        setOriginalUrl(undefined);
        if (!image) return;
        let current = true;
        blobToDataUrl(image).then(url => { if (current) setOriginalUrl(url); }).catch(() => {});
        return () => { current = false; };
    }, [image]);

    useEffect(() => {
        if (!image) {
            setConversion(null);
            return;
        }
        let cancelled = false;
        convertImage(image, format, quality)
            .then((result) => {
                if (!cancelled) setConversion({ image, format, quality, result });
            })
            .catch((cause: unknown) => {
                if (!cancelled) setConversion({ image, format, quality, error: cause instanceof Error ? cause.message : String(cause) });
            });
        return () => {
            cancelled = true;
        };
    }, [image, format, quality]);

    const current = conversion?.image === image && conversion.format === format && conversion.quality === quality ? conversion : null;
    const converted = current?.result;
    const conversionError = current?.error;
    const converting = image !== null && !converted && !conversionError;
    const canInsert = !!converted && (storage === 'embed' || !!path.trim());

    const handleFormatChange = (next: ImageOutputFormat) => {
        setFormat(next);
        const extension = next === 'original' ? extensionForMime(image?.type || '') : extensionForMime(next);
        setPath((p) => replaceExtension(p, extension));
    };

    const handleOk = async () => {
        if (!converted || !canInsert || inserting.current) return;
        inserting.current = true;
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
            inserting.current = false;
            setBusy(false);
        }
    };

    const dimensions = converted ? `${converted.width} × ${converted.height}` : '';
    const resultCaption = converted
        ? `${formatBytes(converted.blob.size)} — ${dimensions}` +
          (storage === 'embed' ? ` (≈ ${formatBytes(base64Size(converted.blob))} as base64)` : '')
        : converting ? 'Converting…' : '';
    const showQuality = format === 'image/jpeg' || format === 'image/webp';

    return (
        <Modal
            title="Paste image"
            open={image !== null}
            onOk={handleOk}
            onCancel={() => { if (!inserting.current) onCancel(); }}
            closable={!busy}
            cancelButtonProps={{ disabled: busy }}
            okText="Insert"
            okButtonProps={{
                loading: busy || converting,
                disabled: busy || !canInsert,
                'aria-label': 'Insert',
                'aria-busy': busy || converting,
            }}
            width={640}
            destroyOnHidden
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                    <ImagePreview
                        label="Before"
                        src={originalUrl}
                        caption={image ? `${image.type || 'image'} — ${formatBytes(image.size)}` : ''}
                    />
                    <ImagePreview
                        label="After"
                        src={converted?.dataUrl}
                        caption={resultCaption}
                    />
                </div>
                {conversionError && <Typography.Text type="danger" role="alert">Image conversion failed. {conversionError}</Typography.Text>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Typography.Text strong>Storage</Typography.Text>
                    <Radio.Group
                        value={storage}
                        disabled={busy}
                        onChange={(e) => setStorage(e.target.value)}
                        options={[
                            { value: 'file', label: 'Image file next to the document' },
                            { value: 'embed', label: 'Inside the markdown (base64)' },
                        ]}
                    />
                    {storage === 'file' && (
                        <Input
                            value={path}
                            disabled={busy}
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
                            aria-label="Image format"
                            disabled={busy}
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
                                disabled={busy}
                                min={0.1}
                                max={1}
                                step={0.05}
                                value={quality}
                                onChange={setQuality}
                                tooltip={{ open: false }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
};
