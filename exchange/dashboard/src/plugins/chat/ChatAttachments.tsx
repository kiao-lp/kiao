// ── What a user hands a turn that is not typed ────────────────────────────────
//
// A screenshot pasted into the message box, a PDF dropped on it, a file picked from disk. The CLI
// takes text on a pipe and nothing else, so an attachment travels a different road than the prompt:
// it is uploaded the moment it is attached, and the prompt that follows names its id. The service
// then tells the turn where the file landed on its own disk, and the agent reads it with the Read tool
// — which is why this carries a .docx as readily as a PNG.
//
// Uploading on attach rather than on send is what makes the box honest. A file is either there or
// it failed, and the user is looking at the answer before they have finished typing the sentence
// that goes with it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { CloseOutlined, FileOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import type { AgentAttachment } from 'kiao-worker';
import { useWorkerClient, Tooltip } from '@cms-core';

/** How many files one message may carry. The service refuses an eleventh; this stops before it. */
export const MAX_ATTACHMENTS = 10;

/** What the service refuses above. Checked here too, so an oversize file is named before it is sent. */
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
 *
 * `stored` is what the service gave back and is the only thing a prompt can refer to; everything
 * else is local and exists so the chip can be drawn before — or instead of — that answer arriving.
 * The name shown is the *stored* one once there is one: it is reduced to path-safe characters
 * server-side, and it is what the model was told the file is called.
 */
export interface PendingAttachment {
    /** Local and stable across the upload — the key a chip is drawn and removed by. */
    key: string;
    name: string;
    size: number;
    mediaType: string;
    /** An object URL for an image, made from the local file so the thumbnail needs no round trip. */
    previewUrl?: string;
    stored?: AgentAttachment;
    /** Why this one will not be sent. A chip with an error is still removable and nothing else. */
    error?: string;
}

export const isImage = (mediaType?: string): boolean => !!mediaType?.startsWith('image/');

let attachmentKeySeq = 0;

/**
 * The composer's attachments: a list, and the three ways things get into it.
 *
 * Object URLs are revoked when their chip goes and when the pane unmounts — a pasted screenshot is
 * several megabytes of decoded bitmap, and a panel that is switched away from and back to all day
 * would otherwise hold every one of them until the tab is closed.
 */
export const useChatAttachments = () => {
    const workerClient = useWorkerClient();
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

    // The ref is the authority and the state is the render copy, rather than the other way round.
    // Two of the three ways files arrive can happen twice in one tick — a paste while a drop's
    // uploads are still starting — and a room check made against a state that has not re-rendered
    // yet would let both claim the last slot. It is also what the unmount cleanup reads, which must
    // see the current list without re-running on every change.
    const latest = useRef<PendingAttachment[]>([]);
    const setAll = useCallback((next: PendingAttachment[]) => {
        latest.current = next;
        setAttachments(next);
    }, []);

    useEffect(() => () => {
        latest.current.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
    }, []);

    // Everything this pane has ever uploaded, by id. It is what `restore` reads: a prompt the
    // transport gave up on comes back as text and a list of ids, and the files behind those ids are
    // still on the server — so the chips can be put back rather than the second attempt going
    // without the screenshot the first one was about.
    const uploaded = useRef(new Map<string, AgentAttachment>());

    const patch = useCallback((key: string, change: Partial<PendingAttachment>) => {
        setAll(latest.current.map(a => (a.key === key ? { ...a, ...change } : a)));
    }, [setAll]);

    /**
     * Takes files from a paste, a drop or the picker, and starts uploading each. Returns what it
     * refused, for the caller to say out loud: silently dropping the eleventh file of a drop is how
     * a user ends up asking about a screenshot that was never attached.
     */
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
                    // A clipboard paste is a File with an empty name. It gets one here so the chip
                    // has something to say and the server an extension to key the media type on.
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
                        // The stored name is the one the model was told; showing the local one
                        // would put a name on screen that nothing else in the system uses.
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

    /** Emptied when a message is sent: the files are the service's from then on. */
    const clear = useCallback(() => {
        if (!latest.current.length) return;
        latest.current.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
        setAll([]);
    }, [setAll]);

    /**
     * Puts back the chips for ids this pane uploaded — what a dropped prompt is answered with.
     *
     * There is no thumbnail on a restored image: the local file is gone (the object URL was revoked
     * when the message was sent) and the id is what matters, since it is what the next attempt will
     * name. An id this pane never uploaded is skipped rather than drawn as a chip it knows nothing
     * about; only a reload can produce one, and a reload has emptied the box anyway.
     */
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
    /** The ids a prompt names, in the order they were attached. */
    const ids = attachments.map(a => a.stored?.id).filter((id): id is string => !!id);

    return { attachments, add, remove, restore, clear, uploading, failed, ids };
};

/**
 * Files taken out of a paste, a drop or a picker.
 *
 * A paste is the delicate one. Copying an image gives a clipboard holding only files; copying from
 * a word processor gives one holding files *and* the text — and there, the text is what the user
 * meant to paste. So files win only when there is no text alongside them, which leaves an ordinary
 * paste behaving exactly as it always did.
 */
export const filesFromPaste = (clipboard: DataTransfer | null): File[] => {
    if (!clipboard) return [];
    const files = Array.from(clipboard.files ?? []);
    if (!files.length) return [];
    return clipboard.getData('text/plain') ? [] : files;
};

export const filesFromDrop = (transfer: DataTransfer | null): File[] =>
    Array.from(transfer?.files ?? []);

// ── The chips ────────────────────────────────────────────────────────────────

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

/** The row above the message box. Renders nothing at all when nothing is attached. */
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

/**
 * One attached file inside a message that was sent.
 *
 * An image fetches its own bytes back and shows them: a conversation about a screenshot is
 * unreadable a week later without the screenshot in it. The fetch goes through the files client
 * rather than an `<img src>` because the endpoint is behind the same bearer token as everything
 * else, and an image element carries no Authorization header.
 *
 * A 404 is the ordinary end of an attachment's life — they are swept after a month while the
 * transcript that names them is kept — so it is said plainly rather than treated as a failure.
 */
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

/** What a sent message carried, under its text. Renders nothing when it carried nothing. */
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
                    // Cleared so picking the same file twice in a row is two events, not one.
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
