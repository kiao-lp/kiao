
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { CloseOutlined, FileOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import type { AgentAttachment } from 'kiao-worker';
import { useWorkerClient, Tooltip } from '@cms-core';

/** How many files one message may carry. */
export const MAX_ATTACHMENTS = 10;

/** What the service refuses above. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Bytes as something a chip has room for. */
export const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * One file in the composer, from the moment it is attached to the moment it is sent.
 * `stored` is what the service gave back and is the only thing a prompt can refer to; everything else.
 */
export interface PendingAttachment {

    key: string;
    name: string;
    size: number;
    mediaType: string;

    previewUrl?: string;
    stored?: AgentAttachment;

    error?: string;
}

export const isImage = (mediaType?: string): boolean => !!mediaType?.startsWith('image/');

let attachmentKeySeq = 0;

/** The composer's attachments: a list, and the three ways things get into it. */
export const useChatAttachments = () => {
    const workerClient = useWorkerClient();
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

    // The ref is the authority and the state is the render copy, rather than the other way round.
    const latest = useRef<PendingAttachment[]>([]);
    const setAll = useCallback((next: PendingAttachment[]) => {
        latest.current = next;
        setAttachments(next);
    }, []);

    useEffect(() => () => {
        latest.current.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
    }, []);

    // Everything this pane has ever uploaded, by id.
    const uploaded = useRef(new Map<string, AgentAttachment>());

    const patch = useCallback((key: string, change: Partial<PendingAttachment>) => {
        setAll(latest.current.map(a => (a.key === key ? { ...a, ...change } : a)));
    }, [setAll]);


    const add = useCallback((files: File[]): string[] => {
        if (!files.length) return [];
        const refusals: string[] = [];
        const accepted: { pending: PendingAttachment; file: File }[] = [];
        let room = MAX_ATTACHMENTS - latest.current.length;
        for (const file of files) {
            const label = file.name || 'a pasted file';
            if (room <= 0) {
                refusals.push(`${label} — a message may carry at most ${MAX_ATTACHMENTS} files`);
                continue;
            }
            if (file.size > MAX_ATTACHMENT_BYTES) {
                refusals.push(`${label} — larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}`);
                continue;
            }
            room -= 1;
            const mediaType = file.type || 'application/octet-stream';
            accepted.push({
                file,
                pending: {
                    key: `att-${Date.now()}-${attachmentKeySeq += 1}`,
                    name: file.name || `pasted-image${mediaType === 'image/jpeg' ? '.jpg' : '.png'}`,
                    size: file.size,
                    mediaType,
                    previewUrl: isImage(mediaType) ? URL.createObjectURL(file) : undefined,
                },
            });
        }
        if (!accepted.length) return refusals;

        setAll([...latest.current, ...accepted.map(a => a.pending)]);
        accepted.forEach(({ pending, file }) => {
            workerClient.uploadAgentAttachment(file, pending.name)
                .then(stored => {
                    uploaded.current.set(stored.id, stored);
                    patch(pending.key, {
                        stored,
                        name: stored.name,
                        size: stored.size,
                        mediaType: stored.mediaType ?? pending.mediaType,
                    });
                })
                .catch(e => patch(pending.key, { error: errorText(e) }));
        });
        return refusals;
    }, [workerClient, patch, setAll]);

    const remove = useCallback((key: string) => {
        const going = latest.current.find(a => a.key === key);
        if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
        setAll(latest.current.filter(a => a.key !== key));
    }, [setAll]);


    const clear = useCallback(() => {
        if (!latest.current.length) return;
        latest.current.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
        setAll([]);
    }, [setAll]);


    const restore = useCallback((ids: string[]) => {
        const held = new Set(latest.current.map(a => a.stored?.id));
        const back = ids
            .filter(id => !held.has(id))
            .map(id => uploaded.current.get(id))
            .filter((stored): stored is AgentAttachment => !!stored)
            .map(stored => ({
                key: `att-${Date.now()}-${attachmentKeySeq += 1}`,
                name: stored.name,
                size: stored.size,
                mediaType: stored.mediaType ?? 'application/octet-stream',
                stored,
            }));
        if (back.length) setAll([...latest.current, ...back]);
    }, [setAll]);

    const uploading = attachments.some(a => !a.stored && !a.error);
    const failed = attachments.some(a => a.error);

    const ids = attachments.map(a => a.stored?.id).filter((id): id is string => !!id);

    return { attachments, add, remove, restore, clear, uploading, failed, ids };
};

/** Files taken out of a paste, a drop or a picker. */
export const filesFromPaste = (clipboard: DataTransfer | null): File[] => {
    if (!clipboard) return [];
    const files = Array.from(clipboard.files ?? []);
    if (!files.length) return [];
    return clipboard.getData('text/plain') ? [] : files;
};

export const filesFromDrop = (transfer: DataTransfer | null): File[] =>
    Array.from(transfer?.files ?? []);


/** One attached file in the composer: what it is, how it is going, and a way to take it back out. */
const ComposerChip: React.FC<{ attachment: PendingAttachment; onRemove: () => void; disabled?: boolean }> = ({
    attachment, onRemove, disabled,
}) => {
    const state = attachment.error ? 'error' : attachment.stored ? 'ready' : 'uploading';
    const title = attachment.error
        ? `${attachment.name} — could not be attached: ${attachment.error}`
        : `${attachment.name} · ${formatBytes(attachment.size)}${state === 'uploading' ? ' · uploading…' : ''}`;
    return (
        <Tooltip title={title}>
            <div className={`chat-attachment-chip chat-attachment-chip--${state}`}>
                {attachment.previewUrl ? (
                    <img className="chat-attachment-thumb" src={attachment.previewUrl} alt={attachment.name} />
                ) : (
                    <span className="chat-attachment-icon">
                        {state === 'error' ? <WarningOutlined /> : <FileOutlined />}
                    </span>
                )}
                <span className="chat-attachment-name">{attachment.name}</span>
                <span className="chat-attachment-size">
                    {state === 'uploading' ? <LoadingOutlined /> : formatBytes(attachment.size)}
                </span>
                <button
                    type="button"
                    className="chat-attachment-remove"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={onRemove}
                    disabled={disabled}
                >
                    <CloseOutlined />
                </button>
            </div>
        </Tooltip>
    );
};

/** The row above the message box. */
export const ChatAttachmentStrip: React.FC<{
    attachments: PendingAttachment[];
    onRemove: (key: string) => void;
    disabled?: boolean;
}> = ({ attachments, onRemove, disabled }) => {
    if (!attachments.length) return null;
    return (
        <div className="chat-attachment-strip">
            {attachments.map(attachment => (
                <ComposerChip
                    key={attachment.key}
                    attachment={attachment}
                    onRemove={() => onRemove(attachment.key)}
                    disabled={disabled}
                />
            ))}
        </div>
    );
};

/** One attached file inside a message that was sent. */
const TranscriptChip: React.FC<{ attachment: AgentAttachment }> = ({ attachment }) => {
    const workerClient = useWorkerClient();
    const [url, setUrl] = useState<string | null>(null);
    const [gone, setGone] = useState(false);
    const image = isImage(attachment.mediaType);

    useEffect(() => {
        if (!image) return;
        let objectUrl: string | null = null;
        let cancelled = false;
        workerClient.getAgentAttachmentBlob(attachment.id)
            .then(blob => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setUrl(objectUrl);
            })
            .catch(() => { if (!cancelled) setGone(true); });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [workerClient, attachment.id, image]);

    const label = `${attachment.name} · ${formatBytes(attachment.size)}`;
    if (image && url) {
        return (
            <Tooltip title={`${label} — open full size`}>
                <a
                    className="chat-attachment-sent chat-attachment-sent--image"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                >
                    <img src={url} alt={attachment.name} />
                </a>
            </Tooltip>
        );
    }
    return (
        <Tooltip title={gone ? `${label} — this attachment is no longer on the server` : label}>
            <span
                className={`chat-attachment-sent${gone ? ' chat-attachment-sent--gone' : ''}`}
            >
                <FileOutlined /> {attachment.name}
            </span>
        </Tooltip>
    );
};

/** What a sent message carried, under its text. */
export const ChatSentAttachments: React.FC<{ attachments?: AgentAttachment[] }> = ({ attachments }) => {
    if (!attachments?.length) return null;
    return (
        <div className="chat-attachments-sent">
            {attachments.map(attachment => (
                <TranscriptChip key={attachment.id} attachment={attachment} />
            ))}
        </div>
    );
};

/** The paperclip, and the file input it opens. */
export const ChatAttachButton: React.FC<{
    onFiles: (files: File[]) => void;
    disabled?: boolean;
}> = ({ onFiles, disabled }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <>
            <input
                ref={inputRef}
                type="file"
                multiple
                className="chat-attachment-input"
                aria-hidden="true"
                tabIndex={-1}
                onChange={e => {
                    onFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                }}
            />
            <Tooltip title="Attach an image or a document — you can also paste or drop one into the box">
                <Button
                    size="small"
                    icon={<span className="chat-attach-icon">📎</span>}
                    onClick={() => inputRef.current?.click()}
                    disabled={disabled}
                    aria-label="Attach a file"
                />
            </Tooltip>
        </>
    );
};
