import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { mergeBoardContent } from './boardMerge';
import { BoardSummary, useHybridflowClient, HybridflowClient, HybridflowError } from './service';
import { readBoardContent, BoardContent } from './boardContent';

/**
 * The open board, kept in step with the service.
 *
 * ── what the board is at any moment ───────────────────────────────────────────
 *
 * Three copies, and each of them earns its place:
 *
 *  - **`shown`** is what is drawn. A gesture changes it at once — the pure operation in
 *    [boardOps](./boardOps.ts) runs locally — so a drag lands under the hand rather than after a
 *    round trip.
 *  - **`base`** is the board as the service last told it. It is what the merge measures against.
 *  - what comes back from a **re-read** is the truth, which is not the same as being right about
 *    what somebody is typing this second.
 *
 * So a re-read is a three-way merge — `mergeBoardContent(base, shown, fetched)` — and not a
 * replacement. That function is the file-backed board's own, unchanged and still tested: the
 * problem it solved is the problem that remains. A run marks a card while a person
 * is typing in another, and the mark must arrive without taking the keystrokes with it.
 *
 * ── being told rather than asking ─────────────────────────────────────────────
 *
 * The file-backed board polled the document every couple of seconds. Here a request is **held** by
 * the service until something on this board changes (`GET /changes?wait=1`), so a card a run just
 * marked redraws in the time a notification takes. The loop re-arms itself, and a failure backs off
 * rather than spinning: a service that is down must not become a request per frame.
 *
 * ── what a write is ──────────────────────────────────────────────────────────
 *
 * `apply` takes two things: the local operation, and the call that makes it true. They are given
 * together on purpose. Deriving one from the other — diffing two whole boards to work out which
 * endpoint to call — is the shape this whole migration exists to get away from: it puts the
 * knowledge of what changed in the wrong place and gets it subtly wrong under concurrency.
 *
 * Writes are sent **in order**, one at a time. A write names what the gesture did against the
 * board as the local operation left it, so two writes sent at once could be resolved against a
 * board that the first of them was about to change.
 *
 * A write that comes back refused is **reported**, and the board read again. The gesture has
 * already been drawn by the time the answer arrives, so a refusal nobody is told about is a board
 * that looks right until it is next opened and has quietly lost whatever the gesture did.
 */
export interface BoardSync {
    /** The board's own row: its name, its handle, its revision. Null while it is being read. */
    board: BoardSummary | null;
    /** What is drawn. Null while the board is being read, and for a handle that names none. */
    content: BoardContent | null;
    loading: boolean;
    /** What went wrong, worded by the service. Null when nothing has. */
    error: string | null;
    /**
     * Applies an operation that may find nothing to do, in which case the board does not move, and
     * sends the write that makes it true.
     *
     * `write` is given the board **as it was before** the operation as well as after, because a
     * write names its neighbours: the card a moved card now sits under is read off the result, and
     * the card it *was* under is sometimes what has to be undone.
     */
    apply: (
        change: (held: BoardContent) => BoardContent | null,
        write?: (client: HybridflowClient, handle: string, before: BoardContent, after: BoardContent) => Promise<unknown>,
    ) => void;
    /** Reads the board again now, rather than waiting to be told. */
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

    // The three copies, as refs: every one of them is read by a callback that must see what is there
    // now rather than what was there when it was made.
    const shown = useRef<BoardContent | null>(null);
    const base = useRef<BoardContent | null>(null);
    const cursor = useRef(0);
    // The handle the refs above belong to. A board closed and another opened must not merge the
    // second into the first.
    const owner = useRef<string | null>(null);

    const show = useCallback((next: BoardContent | null) => {
        shown.current = next;
        setContent(next);
    }, []);

    /**
     * Reads the board and puts what came back together with what is on screen.
     *
     * The **cursor is taken from the same answer**, so watching resumes exactly where this read
     * stood: a change that landed between the read and the watch is one the watch reports, rather
     * than one nobody ever hears about.
     */
    const fetchBoard = useCallback(async (target: string, merge: boolean) => {
        if (!client) return;
        try {
            const dto = await client.board(target);
            if (owner.current !== target) return; // another board was opened while this was in flight
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

    // Opening a board: everything held is dropped, and the board is read from the beginning. Its
    // next opening is a first opening.
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

    // Watching. One held request at a time, re-armed as each answer comes back, and abandoned when
    // the board is closed — which is what the abort controller is for: a held request left behind
    // would keep a connection open for a board nobody is looking at.
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
                    // Anything at all: the change names the card, and re-reading the board is one
                    // cheap query. Reading one card instead would be three more endpoints for a
                    // saving nobody can measure on a board of sixty cards.
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

    // The writes still to go out, in order. A promise chain rather than a list, because what has to
    // be true is only that the next one starts after the last one finished.
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
                // A refused write is the board having moved under the gesture. Reading it again is
                // the answer and the whole of it: what is on screen was optimistic, and the truth
                // is one query away. The merge keeps whatever else was being typed meanwhile.
                const said = cause instanceof Error ? cause.message : String(cause);
                // And said out loud, because the gesture it refuses has already been drawn: the
                // cards are on the board until it is read again, and a board that quietly drops
                // them the next time it is opened is one nobody can tell from a broken one.
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
