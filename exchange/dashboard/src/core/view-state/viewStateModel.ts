/** View-state document shape and pure operations. Separate from `dashboard.json`; one document per screen size. */

/** Document for wide viewports. */
export const VIEW_STATE_DOC = 'dashboard-view-state.json';

/** Document for narrow viewports; layout state is kept per screen size. */
export const SMALL_SCREEN_VIEW_STATE_DOC = 'dashboard-view-state-small.json';

/** Width at or below this is small-screen; matches the stylesheet breakpoint. */
export const SMALL_SCREEN_MAX_WIDTH = 768;

/** Document for a viewport width; width only, no device detection. */
export const viewStateDocFor = (width: number): string =>
    width <= SMALL_SCREEN_MAX_WIDTH ? SMALL_SCREEN_VIEW_STATE_DOC : VIEW_STATE_DOC;

/** Bump only when `normalizeViewState` cannot read the old shape. */
export const VIEW_STATE_VERSION = 1;

/** Per-file entry cap; oldest-accessed entries fall back to defaults. */
export const MAX_FILE_ENTRIES = 300;

/** One plugin's state slice. Opaque here. */
export type ViewStateScope = Record<string, unknown>;

/** File entry: `at` is last-access time; other keys are scopes. */
export type FileViewState = { at?: number } & Record<string, ViewStateScope | number | undefined>;

export interface ViewStateFile {
    version: number;
    /** App-wide preferences — theme, toolbar layout and selection, voice language. */
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

/** Coerce disk data to a document; invalid input yields empty, never throws. */
export const normalizeViewState = (raw: unknown): ViewStateFile => {
    if (!isPlainObject(raw)) return { ...EMPTY_VIEW_STATE };
    const section = (v: unknown): Record<string, any> => (isPlainObject(v) ? { ...v } : {});
    const files = section(raw.files);
    for (const [path, entry] of Object.entries(files)) {
        if (!isPlainObject(entry) || (!('toolBars' in entry) && !('scroll' in entry))) continue;
        const scopes = { ...entry };
        delete scopes.toolBars;
        delete scopes.scroll;
        if (Object.keys(scopes).some(key => key !== 'at')) files[path] = scopes;
        else delete files[path];
    }
    return {
        version: typeof raw.version === 'number' ? raw.version : VIEW_STATE_VERSION,
        global: section(raw.global),
        folders: section(raw.folders),
        files,
    };
};

/** Scope merged over defaults; missing keys keep defaults. */
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

/** True when `next` equals stored value; avoids diffs in the git-tracked file. */
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

/** Keep the `max` most recent entries; missing `at` sorts oldest. */
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

/** One scope written by a tab; only dirty scopes are merged back. */
export type DirtyKey =
    | { section: 'global'; key: string }
    | { section: 'folders'; path: string; key: string }
    | { section: 'files'; path: string; key: string };

export const dirtyKeyId = (k: DirtyKey): string =>
    k.section === 'global' ? `global:${k.key}` : `${k.section}:${k.path}:${k.key}`;

/** Re-apply this tab's dirty scopes onto the server document. Prevents cross-tab overwrite; no ETags available. */
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
