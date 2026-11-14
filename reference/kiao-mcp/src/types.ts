// Vendored copies of the worker DTOs. Canonical source:
// reference/kiao-worker/src/types.ts — kept here so this MCP server has no
// runtime dependency on the React-bearing `kiao-worker` barrel. Keep in sync.

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
    companions?: FileCompanion[];
}

export interface SearchResult {
    file: string;
    /** Empty when the file was found by its name alone — a binary or an oversized document. */
    matches: {
        line: number;
        content: string;
        /** [start, end) bounds of the hits inside `content`, in UTF-16 code units. */
        ranges?: [number, number][];
    }[];
}

export interface SearchResponse {
    results: SearchResult[];
    /** The walk stopped at the server's result cap; the query needs narrowing. */
    truncated: boolean;
}

/** Envelope every Dashboard document is stored in. Mirrors `Document` from kiao-worker. */
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
    oldPath?: string | null;
    index: string;
    worktree: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
    conflicted: boolean;
}

export interface GitStatus {
    repo: boolean;
    branch?: string;
    upstream?: string;
    hasUpstream: boolean;
    ahead: number;
    behind: number;
    files: GitFile[];
}

export interface GitResult {
    ok: boolean;
    output: string;
}

/**
 * What a file action answers (POST /actions/run). `ok: false` is a *refused* operation carrying the
 * reason the author can act on — a broken reference, a document that is not what the action expects
 * — and arrives with HTTP 200; only a genuine fault is a non-2xx. `changedPaths` says what to
 * re-read afterwards.
 */
export interface ActionResult {
    ok: boolean;
    message: string;
    changedPaths: string[];
}
