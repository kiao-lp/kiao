import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import type { ResourceClient } from './Client';
import { useDraftWriter } from '../useDraftWriter';

interface FileTarget {
    client: ResourceClient;
    name: string;
    path: string;
    revision?: string;
}

interface FileEdit {
    target: FileTarget;
    content: string;
}

export function useResourceSource(client: ResourceClient | null, name: string | undefined, path: string | undefined, onSaved: () => Promise<unknown>) {
    const [opened, setOpened] = useState<{ target: FileTarget; content: string; saved: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [switching, setSwitching] = useState(false);
    const switchingFile = useRef(false);
    const saveFailed = useRef(false);
    const reads = useRef(0);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const { schedule, flush: drain } = useDraftWriter<FileEdit>(async ({ target, content }) => {
        const saved = await target.client.writeResourceFile(target.name, { path: target.path, content, revision: target.revision });
        target.revision = saved.revision;
        saveFailed.current = false;
        try {
            await onSaved();
        } catch (cause) {
            message.warning(`The file was saved. The resource list could not be refreshed. ${cause}`);
        }
        setOpened(current => current?.target === target ? { ...current, saved: saved.content } : current);
        setError(null);
    }, cause => {
        saveFailed.current = true;
        const detail = cause instanceof Error ? cause.message : String(cause);
        if (mounted.current) setError(detail);
        else message.error(detail);
    });

    const reload = useCallback(async () => {
        const read = ++reads.current;
        setOpened(null);
        setError(null);
        await drain();
        if (read !== reads.current || !client || !name || !path) return;
        saveFailed.current = false;
        setError(null);
        try {
            const file = await client.resourceFile(name, path);
            if (read !== reads.current) return;
            setOpened({ target: { client, name, path, revision: file.revision }, content: file.content, saved: file.content });
        } catch (cause) {
            if (read === reads.current) setError(cause instanceof Error ? cause.message : String(cause));
        }
    }, [client, name, path, drain]);

    useEffect(() => {
        void reload();
        return () => { reads.current++; };
    }, [reload]);

    const file = opened?.target.client === client && opened?.target.name === name && opened?.target.path === path ? opened : null;
    const change = (content: string) => {
        if (!file) return;
        setOpened(current => current?.target === file.target ? { ...current, content } : current);
        schedule({ target: file.target, content });
    };
    const flush = useCallback(async () => await drain() && !saveFailed.current, [drain]);
    const switchFile = async (select: () => void) => {
        if (switchingFile.current) return;
        switchingFile.current = true;
        setSwitching(true);
        try {
            if (await flush()) select();
        } finally {
            switchingFile.current = false;
            setSwitching(false);
        }
    };
    return { file, error, change, reload, flush, switching, switchFile };
}
