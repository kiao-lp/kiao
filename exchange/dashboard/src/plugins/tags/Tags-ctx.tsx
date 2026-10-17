import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'lodash.debounce';
import { useWorkerClient } from '@cms-core';
import { moveInArray } from '@cms-kit/reorder';
import {
    findTag, normalizeLabel, readTags, Tag, TAGS_PATH, tagsFileText, withTag,
} from './tagsFile';

interface TagsValue {
    tags: Tag[];
    /** True until the first read lands; nothing has a list to draw before that. */
    loading: boolean;
    /** Adds a word to the store's tags, with the first colour no tag holds, and gives it back. */
    add: (label: string) => Tag;
    /**
     * Renames the entry, and says whether it took: a word the list already holds elsewhere would
     * be the same tag twice, which the file cannot say. Cards carrying the old word keep it — see
     * [tagsFile](./tagsFile.ts).
     */
    rename: (index: number, label: string) => boolean;
    recolor: (index: number, color: string) => void;
    remove: (index: number) => void;
    /** Puts the tag at `from` at rank `to`: the order of the list is the order of the file. */
    move: (from: number, to: number) => void;
    /**
     * The list is wanted. Reads the file once; cheap to call again — the board's cards ask for it
     * as readily as the panel does, and neither of them knows whether the other has.
     */
    ensureLoaded: () => void;
    /** Reads the file again — it is an ordinary store file, and may be edited as one. */
    reload: () => void;
}

const TagsContext = createContext<TagsValue | null>(null);

export const useTags = (): TagsValue => {
    const context = useContext(TagsContext);
    if (!context) throw new Error('useTags must be used within a TagsProvider');
    return context;
};

const SAVE_DEBOUNCE_MS = 800;

/**
 * The store's tags, and the writes back to `kiao-user-config/tags.json`.
 *
 * It is mounted for the life of the application rather than for the life of a view, and for a
 * reason the bookmarks panel has too and one it has not. The panel lives in a tool bar, which every
 * navigation between documents replaces — so a panel-owned list would be read again on the way to
 * every document. And the list has a **second reader**: a board's cards wear its colours, and a
 * board is a main view. One list, read once, above both.
 *
 * The file is the store's, not the app's: read when something first asks for it and whenever it
 * asks again, never on a timer, and what is owed to it always leaves before a read.
 */
export const TagsProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const client = useWorkerClient();

    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(true);

    // What is waiting to be written, and the write in flight. A read must never overtake the
    // latter: it would come back with the text the write was about to replace.
    const pending = useRef<string | null>(null);
    const saving = useRef<Promise<unknown>>(Promise.resolve());

    const flush = useCallback(() => {
        const content = pending.current;
        if (content === null) return;
        pending.current = null;
        saving.current = client.update(TAGS_PATH, content)
            .catch(error => console.error('Failed to save the tags', error));
    }, [client]);

    const scheduleSave = useMemo(() => debounce(flush, SAVE_DEBOUNCE_MS), [flush]);

    /** Everything owed to the store leaves now; what comes back is the promise of it landing. */
    const flushNow = useCallback(() => {
        scheduleSave.cancel();
        flush();
        return saving.current;
    }, [flush, scheduleSave]);

    // No Save button here either, so the last keystrokes are caught on the way out — both when the
    // panel goes away and when the tab does.
    useEffect(() => {
        const onBeforeUnload = () => flushNow();
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            flushNow();
        };
    }, [flushNow]);

    // `null` until something has asked: a store's tags must not cost a read on every page load of
    // a session that never opens a board or the panel.
    const [readId, setReadId] = useState<number | null>(null);
    const ensureLoaded = useCallback(() => setReadId(id => id ?? 0), []);
    const reload = useCallback(() => setReadId(id => (id ?? 0) + 1), []);

    useEffect(() => {
        if (readId === null) return;
        let cancelled = false;
        setLoading(true);
        // A store that has never named a tag has no file, which is not an error — it is the empty
        // list, and the first tag creates the file.
        flushNow()
            .then(() => client.getFileText(TAGS_PATH).catch(() => ''))
            .then(content => {
                if (cancelled) return;
                setTags(readTags(parse(content)));
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [client, readId, flushNow]);

    // Read by the handlers, which must see the list as it stands now rather than as it stood when
    // the callback was made.
    const held = useRef(tags);
    held.current = tags;

    /**
     * The list, changed. It moves `held` as well as the state, which is what lets **two changes in
     * one event** compose: three words pasted into a picker at once are three `add` calls before
     * anything renders, and a second one reading the list as it stood would write the first one
     * back out of it.
     */
    const write = useCallback((next: Tag[]) => {
        held.current = next;
        setTags(next);
        pending.current = tagsFileText(next);
        scheduleSave();
    }, [scheduleSave]);

    /**
     * A word is added, or the tag already wearing it is given back. Both are the same answer to
     * *tag this with `bug`*: the list is a set of words, so asking for one it holds is asking for
     * that one.
     */
    const add = useCallback((label: string): Tag => {
        const wanted = normalizeLabel(label);
        const known = findTag(held.current, wanted);
        if (known) return known;
        const { tags: next, tag } = withTag(held.current, wanted);
        write(next);
        return tag;
    }, [write]);

    const rename = useCallback((index: number, label: string): boolean => {
        const wanted = normalizeLabel(label);
        const current = held.current[index];
        if (!current || !wanted) return false;
        // A word the list already holds elsewhere would be the same tag twice, which the file
        // cannot say and the panel must not write. The panel is told, and puts the box back.
        const clash = findTag(held.current, wanted);
        if (clash && clash !== current) return false;
        write(held.current.map((tag, i) => (i === index ? { ...tag, label: wanted } : tag)));
        return true;
    }, [write]);

    const recolor = useCallback((index: number, color: string) => {
        if (!held.current[index]) return;
        // Lower case, which is how the file is read back: a colour picked as `#3987E5` and one
        // read as `#3987e5` are the same colour, and the file should not show both spellings.
        const hex = color.trim().toLowerCase();
        write(held.current.map((tag, i) => (i === index ? { ...tag, color: hex } : tag)));
    }, [write]);

    const remove = useCallback((index: number) => {
        if (!held.current[index]) return;
        write(held.current.filter((_, i) => i !== index));
    }, [write]);

    const move = useCallback((from: number, to: number) => {
        if (!held.current[from] || !held.current[to] || from === to) return;
        write(moveInArray(held.current, from, to));
    }, [write]);

    const value = useMemo<TagsValue>(
        () => ({ tags, loading, add, rename, recolor, remove, move, ensureLoaded, reload }),
        [tags, loading, add, rename, recolor, remove, move, ensureLoaded, reload],
    );

    return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>;
};

/** A file that is not JSON at all is read as no tags, like every other unreadable document here. */
const parse = (content: string): unknown => {
    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
};
