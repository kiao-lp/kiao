export interface FileCompanion {
    name: string;
    suffix: string; // empty string for the main file
    exists: boolean;
}

export interface FileDto {
    path: string;
    isDirectory: boolean;
    size: number;
    lastModified: number;
    childrenCount?: number | null;
    /**
     * Sibling `.index.md`, `.index.csv` or `.index.txt` searched instead of the binary.
     * List endpoint only; file-info always returns false.
     */
    indexed?: boolean;
    /**
     * Main entry and supported subsidiary suffixes with disk existence.
     * File-info endpoint only; empty for directories.
     */
    companions?: FileCompanion[];
}

export interface DiskUsage {
    totalSpace: number;
    freeSpace: number;
    usableSpace: number;
}

/**
 * rootPath is the absolute host storage root, fixed for the service process lifetime.
 * Other API paths are relative to this root.
 */
export interface StoreInfo {
    rootPath: string;
}

export interface SearchMatch {
    line: number;
    content: string;
    /**
     * Query hit bounds [start, end) in UTF-16 code units, suitable for content.slice().
     * Absent when there are no hits to mark.
     */
    ranges?: [number, number][];
}

export interface SearchResult {
    file: string;
    /** Empty when the file was found by its name alone — a binary or an oversized document. */
    matches: SearchMatch[];
}

export interface SearchResponse {
    results: SearchResult[];
    /** The walk stopped at the server's result cap; the query needs narrowing. */
    truncated: boolean;
}

/**
 * Keep extension mappings in sync with worker/internal/files/fileindex.go extractors
 * and PROTOCOL.md; clients use these without a server round trip.
 */
export const INDEXABLE_EXTENSIONS: Record<string, '.index.md' | '.index.csv'> = {
    '.pdf': '.index.md',
    '.docx': '.index.md',
    '.pptx': '.index.md',
    '.odt': '.index.md',
    '.eml': '.index.md',
    '.msg': '.index.md',
    '.xlsx': '.index.csv',
    '.xlsm': '.index.csv',
    '.ods': '.index.csv',
};

export function isIndexable(path: string): boolean {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 && name.slice(dot) in INDEXABLE_EXTENSIONS;
}

export interface ReindexFailure {
    path: string;
    error: string;
}

/**
 * indexed contains index file paths, not source documents. upToDate counts documents
 * with current indexes, including manually written indexes the service never overwrites.
 */
export interface ReindexResult {
    indexed: string[];
    upToDate: number;
    failed: ReindexFailure[];
    /** The run stopped at the server's write cap; ask again to continue. */
    truncated: boolean;
}

/**
 * Hidden, initially empty store directory discarded after upload review.
 * Use its path with upload, reindex and moveBatch; imported files take their indexes along.
 */
export interface StagingArea {
    path: string;
}

/**
 * Deletion scope under the requested paths. When truncated, files is only a prefix.
 * Entries omit indexed and companions to avoid extra per-entry stats.
 */
export interface ScopeResponse {
    files: FileDto[];
    truncated: boolean;
}

export interface Document<T> {
    docType: string;
    docId: string;
    docTypeVersion: number;
    createdAt: string; // ISO Date
    updatedAt?: string; // ISO Date
    content: T;
}

export interface GitFile {
    path: string;
    /** Original path for renames/copies. */
    oldPath?: string | null;
    /** Index (staged) status char: M, A, D, R, C, ?, U or ' '. */
    index: string;
    /** Working-tree (unstaged) status char. */
    worktree: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
    conflicted: boolean;
}

export interface GitStatus {
    /** False when the folder asked about does not belong to a git working tree. */
    repo: boolean;
    /**
     * Repository root: "" for the store itself, otherwise a store-relative path.
     * Every {@link GitFile} path is relative to it.
     */
    root: string;
    branch?: string;
    upstream?: string;
    hasUpstream: boolean;
    ahead: number;
    behind: number;
    files: GitFile[];
}

export interface GitBranch {
    /**
     * Local branch name, or remote-tracking name ("origin/x") when no local counterpart
     * exists; checking out the latter creates the local branch.
     */
    name: string;
    remote: boolean;
    current: boolean;
}

export interface GitBranches {
    /** The branch HEAD is on, empty when HEAD is detached. */
    current: string;
    branches: GitBranch[];
}

export interface GitResult {
    ok: boolean;
    /** Combined git stdout/stderr, for display. */
    output: string;
}

export interface LinkFixSubstitution {
    lineNumber: number;
    oldValue: string;
    newValue: string;
}

export interface LinkFixFileChange {
    filePath: string;
    substitutions: LinkFixSubstitution[];
}

export interface LinkFixReport {
    operation: string;
    originalPath: string;
    newPath?: string | null;
    fileChanges: LinkFixFileChange[];
}

export interface DeleteBatchRequest {
    paths: string[];
}

/** Payload of the batch git endpoints (`/git/stageBatch`, `/git/unstageBatch`). */
export interface GitPathsRequest {
    paths: string[];
}

export interface MoveItem {
    from: string;
    to: string;
}

export interface MoveBatchRequest {
    paths?: string[];
    targetFolder?: string;
    items?: MoveItem[];
}

export interface CopyBatchRequest {
    paths?: string[];
    targetFolder?: string;
    items?: MoveItem[];
}

/** Copies never overwrite. to includes any resolved " (copy)" / " (copy N)" suffix. */
export interface CopyResult {
    from: string;
    to: string;
}
/**
 * Server action descriptors are discovered and invoked by id.
 * Keep ActionDto / ActionResultDto and PROTOCOL.md in sync, including appliesTo
 * rules evaluated by both client and server.
 */

/** Optional keys are AND-ed; {} matches anything. */
export interface ActionAppliesTo {
    /** Case-insensitive suffix match against the file name, e.g. ".ttst.md". */
    extensions?: string[];
    /** When set, requires the entry to be (or not to be) a directory. */
    directory?: boolean;
}

/** values is required for, and only used by, enums. */
export interface ActionParam {
    name: string;
    label?: string;
    type: "string" | "boolean" | "enum";
    values?: string[];
    default?: unknown;
}

export interface ActionDescriptor {
    id: string;
    label: string;
    /** Menu sort key using the file browser's numeric groups. */
    group?: string;
    order?: number;
    appliesTo: ActionAppliesTo;
    params?: ActionParam[];
}

/** ok:false means a refused operation, not a transport failure. */
export interface ActionResult {
    ok: boolean;
    message: string;
    /** Paths written by the action, for client refresh. */
    changedPaths: string[];
}

/** GET /fileOptimizations returns duplicates and largest files from one server walk. */

/**
 * Files verified byte-for-byte after grouping by size.
 * wasted = size × (files.length − 1); groups arrive ordered by wasted space.
 */
export interface DuplicateGroup {
    /** SHA-256 of the shared content, hex. */
    hash: string;
    size: number;
    wasted: number;
    files: FileDto[];
}

/**
 * scanned counts files considered. truncated means a cap or .kiao-files declaration
 * limited the walk; results may be incomplete.
 */
export interface FileOptimizations {
    duplicates: DuplicateGroup[];
    largest: FileDto[];
    scanned: number;
    truncated: boolean;
}

/** Consolidation moves every copy onto kept and repairs references to the survivor. */
export interface DeduplicateResult {
    kept: string;
    removed: string[];
    linkFixes: LinkFixReport[];
}
