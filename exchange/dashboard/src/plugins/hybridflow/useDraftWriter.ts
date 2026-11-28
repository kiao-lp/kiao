import { useCallback, useEffect, useMemo, useRef } from 'react';
import debounce from 'lodash.debounce';

export function useDraftWriter<T extends object>(write: (change: T) => Promise<unknown>, onError: (cause: unknown) => void) {
    const handlers = useRef({ write, onError });
    handlers.current = { write, onError };
    const pending = useRef<T>();
    const writing = useRef<Promise<boolean>>();

    const enqueue = useCallback((change: T, revert?: () => void) => {
        const { write, onError } = handlers.current;
        const saving = Promise.resolve(writing.current).then(async () => {
            try {
                await write(change);
                return true;
            } catch (cause) {
                onError(cause);
                revert?.();
                return false;
            }
        });
        writing.current = saving;
        void saving.finally(() => {
            if (writing.current === saving) writing.current = undefined;
        });
        return saving;
    }, []);

    const save = useMemo(() => debounce(() => {
        const change = pending.current;
        pending.current = undefined;
        if (change) void enqueue(change);
    }, 1000), [enqueue]);

    const flush = useCallback(() => {
        save.flush();
        return writing.current ?? Promise.resolve(true);
    }, [save]);

    useEffect(() => {
        const finish = () => { void flush(); };
        window.addEventListener('beforeunload', finish);
        return () => { window.removeEventListener('beforeunload', finish); finish(); };
    }, [flush]);

    const discard = (key: keyof T) => {
        if (!pending.current) return;
        delete pending.current[key];
        if (Object.keys(pending.current).length === 0) {
            pending.current = undefined;
            save.cancel();
        }
    };

    return {
        schedule(change: T) {
            pending.current = { ...pending.current, ...change };
            save();
        },
        commit(change: T, revert?: () => void) {
            for (const key of Object.keys(change) as (keyof T)[]) discard(key);
            return enqueue(change, revert);
        },
        hasPending: (key: keyof T) => !!pending.current && key in pending.current,
        discard,
        flush,
    };
}
