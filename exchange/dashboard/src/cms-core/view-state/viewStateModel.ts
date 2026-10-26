/**
 * The shape of the view state config document and the pure operations over it.
 *
 * The document remembers how the UI was left: which panes were open, which tab
 * was showing. It is keyed by file path, so a file reopens exactly as it was
 * last closed — after a navigation, a reload, or the OIDC redirect a failed
 * token renewal falls back to.
 *
 * Kept separate from `dashboard.json`: that one is hand-edited feature flags,
 * this one is rewritten by the app as panes are arranged. Both live in the
 * worker state directory rather than in the content tree. There is one
 * of these per screen size — see `viewStateDocFor`.
 */

/** The document a roomy viewport reads and writes. */
export const VIEW_STATE_DOC = 'dashboard-view-state.json';

/**
 * The document a small viewport — a phone — reads and writes instead.
 *
 * The same store is browsed from a phone and from a desktop, and what is
 * remembered here *is* the layout: which columns are open, how wide they are,
 * which tab sits in which bar. A phone has room for one column and leaves the
 * others closed; writing that into the one document would close them on the
 * desktop too, and the desktop's answer would be just as wrong on the phone.
 * Two documents let each screen keep its own arrangement of the same files.
 */
export const SMALL_SCREEN_VIEW_STATE_DOC = 'dashboard-view-state-small.json';

/**
 * Viewports this wide or narrower are the small screen. It is the breakpoint
 * the stylesheets already lay out for, so the document that is chosen and the
 * layout it describes always agree.
 */
export const SMALL_SCREEN_MAX_WIDTH = 768;

/**
 * Which document a viewport of this width belongs to.
 *
 * Width alone, rather than any guess at the device: a desktop window dragged
 * narrow gets the small-screen layout from the stylesheets, so it should get
 * the state written for that layout too.
 */
export const viewStateDocFor = (width: number): string =>
    width <= SMALL_SCREEN_MAX_WIDTH ? SMALL_SCREEN_VIEW_STATE_DOC : VIEW_STATE_DOC;

/** Bumped only if a future shape cannot be read by `normalizeViewState`. */
export const VIEW_STATE_VERSION = 1;

/**
 * How many per-file entries are kept. The document is bounded by the service, so
 * it cannot grow without limit; the oldest-accessed entries fall back to plugin
 * defaults.
 */
export const MAX_FILE_ENTRIES = 300;

/** One plugin's slice of state, e.g. `{ showPreview: false }`. Opaque here. */
export type ViewStateScope = Record<string, unknown>;

/** A file's entry: `at` is its last-access stamp, every other key is a scope. */
export type FileViewState = { at?: number } & Record<string, ViewStateScope | number | undefined>;

export interface ViewStateFile {
    version: number;
    /** App-wide preferences — theme, tool bar columns, voice language. */
    global: Record<string, ViewStateScope | unknown>;
    /** Keyed by folder path, e.g. the file browser's per-folder view mode. */
    folders: Record<string, ViewStateScope>;
    /** Keyed by store-relative file path. */
    files: Record<string, FileViewState>;
}

export const EMPTY_VIEW_STATE: ViewStateFile = {
    version: VIEW_STATE_VERSION,
    global: {},
    folders: {},
    files: {},
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Coerce whatever is on disk into a usable document. A hand-mangled or partial
 * file must never break startup, so anything unexpected degrades to empty
 * rather than throwing — the app falls back to defaults.
 */
export const normalizeViewState = (raw: unknown): ViewStateFile => {
    if (!isPlainObject(raw)) return { ...EMPTY_VIEW_STATE };
    const section = (v: unknown): Record<string, any> => (isPlainObject(v) ? { ...v } : {});
    return {
        version: typeof raw.version === 'number' ? raw.version : VIEW_STATE_VERSION,
        global: section(raw.global),
        folders: section(raw.folders),
        files: section(raw.files),
    };
};

// --- Reading -------------------------------------------------------------

/**
 * A scope merged over its defaults. Keys the stored scope does not carry keep
 * their default, so adding an option to a plugin does not invalidate the state
 * already written for every file.
 */
export const readScope = <T extends object>(container: Record<string, any> | undefined, key: string, defaults: T): T => {
    const stored = container?.[key];
    if (!isPlainObject(stored)) return defaults;
    return { ...defaults, ...stored } as T;
};

/** A single stored value (theme) with its default. */
export const readValue = <T>(container: Record<string, any> | undefined, key: string, fallback: T): T => {
    const stored = container?.[key];
    return stored === undefined ? fallback : (stored as T);
};

export const fileScope = <T extends object>(doc: ViewStateFile, path: string, key: string, defaults: T): T =>
    readScope(doc.files[path] as Record<string, any> | undefined, key, defaults);

export const folderScope = <T extends object>(doc: ViewStateFile, path: string, key: string, defaults: T): T =>
    readScope(doc.folders[path], key, defaults);

// --- Writing -------------------------------------------------------------

/**
 * Whether `next` would actually change what is stored. Every write reaches a
 * git-tracked file, so a handler that fires without changing anything must
 * not produce a diff.
 */
export const isUnchanged = (current: unknown, next: unknown): boolean =>
    JSON.stringify(current) === JSON.stringify(next);

/** Replace one scope of one file entry, stamping the entry's access time. */
export const withFileScope = (
    doc: ViewStateFile,
    path: string,
    key: string,
    value: ViewStateScope | undefined,
    now: number,
): ViewStateFile => ({
    ...doc,
    files: { ...doc.files, [path]: { ...doc.files[path], at: now, [key]: value } },
});

export const withFolderScope = (
    doc: ViewStateFile,
    path: string,
    key: string,
    value: ViewStateScope | undefined,
): ViewStateFile => ({
    ...doc,
    folders: { ...doc.folders, [path]: { ...doc.folders[path], [key]: value } },
});

export const withGlobal = (doc: ViewStateFile, key: string, value: unknown): ViewStateFile => ({
    ...doc,
    global: { ...doc.global, [key]: value },
});

/**
 * Keep only the `max` most recently accessed file entries. Entries without an
 * `at` stamp (hand-written, or from a future version) sort oldest and go first.
 */
export const pruneFiles = (doc: ViewStateFile, max: number = MAX_FILE_ENTRIES): ViewStateFile => {
    const paths = Object.keys(doc.files);
    if (paths.length <= max) return doc;
    const kept = paths
        .sort((a, b) => (doc.files[b]?.at ?? 0) - (doc.files[a]?.at ?? 0))
        .slice(0, max);
    const files: Record<string, FileViewState> = {};
    for (const path of kept) files[path] = doc.files[path];
    return { ...doc, files };
};

// --- Merging across tabs -------------------------------------------------

/** Identifies one scope a tab has written, so only that scope is pushed back. */
export type DirtyKey =
    | { section: 'global'; key: string }
    | { section: 'folders'; path: string; key: string }
    | { section: 'files'; path: string; key: string };

export const dirtyKeyId = (k: DirtyKey): string =>
    k.section === 'global' ? `global:${k.key}` : `${k.section}:${k.path}:${k.key}`;

/**
 * Re-apply this tab's edits on top of the document currently on the server.
 *
 * Dashboard opens unit content in new *browser* tabs, so several tabs write this
 * file and worker has no ETags — a blind PUT of our whole copy would
 * discard whatever another tab saved meanwhile. Applying only the scopes we
 * touched keeps both tabs' work, the same reasoning as a re-read before
 * write.
 */
export const mergeDirtyInto = (
    remote: ViewStateFile,
    local: ViewStateFile,
    dirty: Iterable<DirtyKey>,
    now: number,
): ViewStateFile => {
    let merged: ViewStateFile = {
        version: VIEW_STATE_VERSION,
        global: { ...remote.global },
        folders: { ...remote.folders },
        files: { ...remote.files },
    };
    for (const k of dirty) {
        if (k.section === 'global') {
            merged = withGlobal(merged, k.key, local.global[k.key]);
        } else if (k.section === 'folders') {
            merged = withFolderScope(merged, k.path, k.key, local.folders[k.path]?.[k.key] as ViewStateScope | undefined);
        } else {
            const value = local.files[k.path]?.[k.key];
            merged = withFileScope(merged, k.path, k.key, value as ViewStateScope | undefined, now);
        }
    }
    return pruneFiles(merged);
};
