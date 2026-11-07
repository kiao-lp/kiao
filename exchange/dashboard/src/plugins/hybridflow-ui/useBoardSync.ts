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
    ) => void;

    reload: () => void;
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
    const owner = useRef<string | null>(null);

    const show = useCallback((next: BoardContent | null) => {
        shown.current = next;
        setContent(next);
    }, []);


    const fetchBoard = useCallback(async (target: string, merge: boolean) => {
        if (!client) return;
        try {
            const dto = await client.board(target);
            if (owner.current !== target) return; 
            const fetched = readBoardContent({
                flowNodes: dto.flowNodes, flowNodeClasses: dto.flowNodeClasses,
                workflows: dto.workflows, workflowClasses: dto.workflowClasses,
            });
            const held = shown.current;
            const from = base.current;
            base.current = fetched;
            cursor.current = dto.cursor;
            setBoard(dto.board);
            show(merge && held && from ? mergeBoardContent(from, held, fetched) : fetched);
            setError(null);
        } catch (cause) {
            if (owner.current !== target) return;
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
        owner.current = handle;
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
        setLoading(true);
        void fetchBoard(handle, false).finally(() => {
            if (owner.current === handle) setLoading(false);
        });
    }, [handle, client, fetchBoard]);

    const boardId = board?.id ?? null;
    useEffect(() => {
        if (!client || !handle || !boardId) return;
        const controller = new AbortController();
        let stopped = false;
        const watch = async () => {
            while (!stopped) {
                try {
                    const answer = await client.changes(boardId, cursor.current,
                        { wait: true, signal: controller.signal });
                    if (stopped) return;
                    cursor.current = answer.cursor;

                    if (answer.changes.length > 0) await fetchBoard(handle, true);
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

    const queue = useRef<Promise<unknown>>(Promise.resolve());

    const apply = useCallback<BoardSync['apply']>((change, write) => {
        const held = shown.current;
        const target = owner.current;
        if (!held) return;
        const next = change(held);
        if (!next) return;
        show(next);
        if (!write || !client || !target) return;
        queue.current = queue.current
            .then(() => write(client, target, held, next))
            .catch(cause => {

                const said = cause instanceof Error ? cause.message : String(cause);
                // And said out loud, because the gesture it refuses has already been drawn: the cards are on the board until it is read again.
                message.error(`The board could not be written: ${said}`);
                setError(said);
                return fetchBoard(target, true);
            });
    }, [client, show, fetchBoard]);

    const reload = useCallback(() => {
        if (owner.current) void fetchBoard(owner.current, true);
    }, [fetchBoard]);

    return { board, content, loading, error, apply, reload };
};
