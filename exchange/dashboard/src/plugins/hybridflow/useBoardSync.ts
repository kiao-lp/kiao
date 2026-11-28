import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { mergeBoardContent } from './boardMerge';
import { BoardSummary, useHybridflowClient, HybridflowClient, HybridflowError } from './service';
import { readBoardContent, BoardContent } from './boardContent';

/** The open board, kept in step with the service. */
export interface BoardSync {

    board: BoardSummary | null;

    content: BoardContent | null;
    loading: boolean;

    error: string | null;

    apply: (
        change: (held: BoardContent) => BoardContent | null,
        write?: (client: HybridflowClient, handle: string, before: BoardContent, after: BoardContent) => Promise<unknown>,
    ) => Promise<boolean>;

    enqueueWrite: (
        target: string, write: (client: HybridflowClient, handle: string) => Promise<unknown>,
    ) => Promise<boolean>;

    reload: (target?: string) => Promise<void>;
}

/** How long to wait before watching again after the watch itself failed. */
const RETRY_AFTER_MS = 3000;

export const useBoardSync = (handle: string | null): BoardSync => {
    const client = useHybridflowClient();
    const [board, setBoard] = useState<BoardSummary | null>(null);
    const [content, setContent] = useState<BoardContent | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The three copies, as refs: every one of them is read by a callback that must see what is there now rather than what.
    const shown = useRef<BoardContent | null>(null);
    const base = useRef<BoardContent | null>(null);
    const cursor = useRef(0);
    // A board closed and another opened must not merge the second into the first.
    const owner = useRef<{ handle: string | null }>({ handle: null });

    const show = useCallback((next: BoardContent | null) => {
        shown.current = next;
        setContent(next);
    }, []);

    const fetchBoard = useCallback(async (scope: typeof owner.current, merge: boolean, signal?: AbortSignal) => {
        if (!client || !scope.handle || owner.current !== scope) return;
        try {
            const dto = await client.board(scope.handle, signal);
            if (owner.current !== scope || signal?.aborted) return;
            const fetched = readBoardContent(dto);
            const held = shown.current;
            const from = base.current;
            base.current = fetched;
            cursor.current = dto.cursor;
            setBoard(dto.board);
            show(merge && held && from ? mergeBoardContent(from, held, fetched) : fetched);
            setError(null);
        } catch (cause) {
            if (owner.current !== scope || signal?.aborted) return;
            const gone = cause instanceof HybridflowError && cause.gone;
            setError(gone ? 'There is no board at this address.'
                : cause instanceof Error ? cause.message : String(cause));
            if (gone) {
                base.current = null;
                show(null);
            }
        }
    }, [client, show]);

    useEffect(() => {
        const scope = { handle };
        owner.current = scope;
        base.current = null;
        cursor.current = 0;
        shown.current = null;
        setContent(null);
        setBoard(null);
        setError(null);
        if (!handle || !client) {
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        void fetchBoard(scope, false, controller.signal).finally(() => {
            if (owner.current === scope && !controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [handle, client, fetchBoard]);

    const current = owner.current.handle === handle;
    const boardId = current ? board?.id : null;
    useEffect(() => {
        if (!client || !handle || !boardId) return;
        const scope = owner.current;
        const controller = new AbortController();
        let stopped = false;
        const watch = async () => {
            while (!stopped) {
                try {
                    const answer = await client.changes(boardId, cursor.current,
                        { wait: true, signal: controller.signal });
                    if (stopped) return;
                    cursor.current = answer.cursor;

                    if (answer.changes.length > 0) await fetchBoard(scope, true, controller.signal);
                } catch (cause) {
                    if (stopped || (cause instanceof DOMException && cause.name === 'AbortError')) return;
                    await new Promise(resolve => setTimeout(resolve, RETRY_AFTER_MS));
                }
            }
        };
        void watch();
        return () => {
            stopped = true;
            controller.abort();
        };
    }, [client, handle, boardId, fetchBoard]);

    const queue = useRef<Promise<boolean>>(Promise.resolve(true));

    const enqueueWrite = useCallback<BoardSync['enqueueWrite']>((target, write) => {
        if (!client) return Promise.resolve(false);
        const scope = owner.current;
        queue.current = queue.current
            .then(async () => {
                await write(client, target);
                return true;
            })
            .catch(async cause => {
                const said = cause instanceof Error ? cause.message : String(cause);
                message.error(`The board could not be written: ${said}`);
                if (owner.current === scope && scope.handle === target) {
                    setError(said);
                    await fetchBoard(scope, true);
                }
                return false;
            });
        return queue.current;
    }, [client, fetchBoard]);

    const apply = useCallback<BoardSync['apply']>((change, write) => {
        const held = shown.current;
        const target = owner.current.handle;
        if (!held) return Promise.resolve(false);
        const next = change(held);
        if (!next) return Promise.resolve(false);
        show(next);
        if (!write || !target) return Promise.resolve(false);
        return enqueueWrite(target, (client, handle) => write(client, handle, held, next));
    }, [enqueueWrite, show]);

    const reload = useCallback(async (target = owner.current.handle) => {
        if (target === owner.current.handle) await fetchBoard(owner.current, true);
    }, [fetchBoard]);

    return current
        ? { board, content, loading, error, apply, enqueueWrite, reload }
        : { board: null, content: null, loading: !!handle, error: null, apply, enqueueWrite, reload };
};
