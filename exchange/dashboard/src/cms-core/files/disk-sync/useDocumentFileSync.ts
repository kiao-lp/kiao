import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notification } from 'antd';
import debounce from 'lodash.debounce';
import { extractName } from 'kiao-worker';
import { useWorkerClient } from '../service/ui';
import { decideDiskChange } from './diskSync';

/** Shared save debounce; see docs/architecture/containers/dashboard/saving.md. */
const SAVE_DEBOUNCE_MS = 1000;
const POLL_INTERVAL_MS = 2000;

export interface DocumentCodec<T> {
    /** Throw if the text is not a valid document. */
    parse: (text: string) => T;
    serialize: (doc: T) => string;
    /**
     * Optional three-way merge for a cooperating second writer whose writes occupy separate fields.
     * base is the last disk document, ours the editor, theirs the current disk document.
     * The result is displayed and written back. Serialization reformats source-view text.
     */
    merge?: (base: T, ours: T, theirs: T) => T;
}

export interface DocumentFileSync<T> {
    doc: T | null;
    /** Source text as typed, without re-serialization. */
    text: string;
    loading: boolean;
    /** Serialize a structural edit, update text and schedule a write. */
    onDocChange: (doc: T) => void;
    /** Preserve typed text, re-parse and schedule a write. */
    onTextChange: (text: string) => void;
    /** Request a disk check without waiting for the polling interval. */
    checkNow: () => void;
}

/**
 * Autosave and follow an open file. Modification time triggers reads; text comparison
 * distinguishes external changes from our own writes. Unsaved edits are kept on conflict
 * unless the codec can merge. Invalid text parses to null on load/reload; mid-edit it
 * retains the last valid document while saving the text as typed.
 */
export const useDocumentFileSync = <T>(path: string | undefined, codec: DocumentCodec<T>): DocumentFileSync<T> => {
    const client = useWorkerClient();
    const [state, setState] = useState<{ doc: T | null; text: string }>({ doc: null, text: '' });
    const [loading, setLoading] = useState(true);

    // Read the current codec without reloading for inline codec objects on every render.
    const codecRef = useRef(codec);
    codecRef.current = codec;

    // Last read or scheduled text and last-read mtime. Refs keep edits from re-arming the poll.
    const synced = useRef<{ text: string; at: number }>({ text: '', at: 0 });
    const local = useRef<string>('');
    // Reads must wait for writes, including a pending edit flushed when leaving another file.
    const writing = useRef<Promise<unknown>>(Promise.resolve());
    // Recheck the active path after async reads/merges to discard results for a file we left.
    const pathRef = useRef(path);
    pathRef.current = path;

    const tryParse = useCallback((text: string): T | null => {
        try {
            return codecRef.current.parse(text);
        } catch (err) {
            console.debug('Text does not parse as a document', err);
            return null;
        }
    }, []);

    // Depend on path, not FileDto: metadata refreshes must not reset caret and scroll.
    useEffect(() => {
        // Clear before reading: a failed load must not leave the previous document editable at this path.
        synced.current = { text: '', at: 0 };
        local.current = '';
        setState({ doc: null, text: '' });
        if (!path) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                // Await flushed edits before reading a file, including one just reopened.
                await writing.current;
                if (cancelled) return;
                // Read mtime first: a concurrent write can then only cause a redundant read, not hide new text.
                const meta = await client.getFileMetadata(path);
                // Missing files start empty; the first save creates them (e.g. sidecars).
                const text = meta ? await client.getFileText(path) : '';
                if (cancelled) return;
                synced.current = { text, at: meta?.lastModified ?? 0 };
                local.current = text;
                setState({ doc: tryParse(text), text });
            } catch (err) {
                if (!cancelled) console.error('Failed to read file', path, err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [path, client, tryParse]);

    /** Used by poll and pre-save checks; true only when a merge needs writing back. */
    const check = useCallback(async (target: string): Promise<boolean> => {
        try {
            const meta = await client.getFileMetadata(target);
            if (!meta || meta.lastModified === synced.current.at) return false;
            const disk = await client.getFileText(target);
            if (pathRef.current !== target) return false;
            const change = decideDiskChange(disk, local.current, synced.current.text);
            if (change !== 'conflict') {
                synced.current = { text: disk, at: meta.lastModified };
                if (change === 'reload') {
                    local.current = disk;
                    setState({ doc: tryParse(disk), text: disk });
                }
                return false;
            }
            // Conflicts require a merge codec and three parseable documents; otherwise keep local edits.
            let together: string | null = null;
            const merge = codecRef.current.merge;
            if (merge) {
                const base = tryParse(synced.current.text);
                const ours = tryParse(local.current);
                const theirs = tryParse(disk);
                if (base !== null && ours !== null && theirs !== null) {
                    try {
                        together = codecRef.current.serialize(merge(base, ours, theirs));
                    } catch (err) {
                        console.error('Failed to merge the file with the edits on screen', target, err);
                    }
                }
            }
            // Advance mtime even on conflict to avoid repeated warnings/merges. Keep the old base on failure.
            synced.current = { text: together === null ? synced.current.text : disk, at: meta.lastModified };
            if (together === null) {
                notification.warning({
                    key: `disk-conflict-${target}`,
                    message: `${extractName(target)} changed on disk`,
                    description: 'It has edits here that are not written yet, so it was left as it is.',
                });
                return false;
            }
            local.current = together;
            setState({ doc: tryParse(together), text: together });
            return true;
        } catch (err) {
            console.debug('Disk check failed', target, err);
            return false;
        }
    }, [client, tryParse]);

    // The debounced writer must use the latest check callback.
    const checkRef = useRef(check);
    checkRef.current = check;

    const save = useMemo(
        () => debounce((target: string, text: string) => {
            writing.current = (async () => {
                // Check cooperating writers before replacing a whole document. Only check the active file:
                // a flushed write for a file we left must not read or replace the new file's editor state.
                const here = () => pathRef.current === target;
                if (codecRef.current.merge && here()) await checkRef.current(target);
                // Use current text after awaiting: the poll may have merged while the pre-save check was pending.
                const settled = here() ? local.current : text;
                if (here()) {
                    // Record before writing so a concurrent poll recognises our own text.
                    synced.current = { ...synced.current, text: settled };
                }
                await client.update(target, settled);
            })().catch(err => console.error('Failed to save file', target, err));
        }, SAVE_DEBOUNCE_MS),
        [client],
    );

    // Flush to the original path when leaving; never drop the pending edit.
    useEffect(() => () => { save.flush(); }, [path, save]);

    // Flush the last keystrokes when leaving the tab as well as the file.
    useEffect(() => {
        const onBeforeUnload = () => { save.flush(); };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [save]);

    const onDocChange = useCallback((doc: T) => {
        const text = codecRef.current.serialize(doc);
        local.current = text;
        setState({ doc, text });
        if (path) save(path, text);
    }, [path, save]);

    const onTextChange = useCallback((text: string) => {
        local.current = text;
        setState(prev => {
            let doc = prev.doc;
            // Keep the last valid document mid-edit; invalid source text is still saved as typed.
            try { doc = codecRef.current.parse(text); } catch { }
            return { doc, text };
        });
        if (path) save(path, text);
    }, [path, save]);

    const [nudge, setNudge] = useState(0);
    const checkNow = useCallback(() => setNudge(id => id + 1), []);

    useEffect(() => {
        if (!path || loading) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;

        const tock = async () => {
            if (!document.hidden && (await check(path)) && !stopped) save(path, local.current);
            if (!stopped) timer = setTimeout(tock, POLL_INTERVAL_MS);
        };

        timer = setTimeout(tock, nudge ? 0 : POLL_INTERVAL_MS);
        return () => { stopped = true; clearTimeout(timer); };
    }, [path, loading, check, save, nudge]);

    return { doc: state.doc, text: state.text, loading, onDocChange, onTextChange, checkNow };
};
