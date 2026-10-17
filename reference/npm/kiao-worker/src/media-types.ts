// Media wire types; field names must match internal/files/dto.go. saveSegments writes AV1/Opus Matroska files beside the source; missing ffmpeg returns 424.

/** Extensionless output name; bounds span the first image start to the last image end, in fractional milliseconds. */
export interface MediaSegment {
    name: string;
    fromMs: number;
    toMs: number;
}

/** stopped is user cancellation, not failure. */
export type MediaJobState = 'running' | 'done' | 'failed' | 'stopped';

/** POST /media/saveSegments returns 202; poll GET /media/jobs/{id} while running. */
export interface MediaJob {
    id: string;
    /** Source video or recording. */
    path: string;
    state: MediaJobState;
    /** Output store paths in write order. */
    files: string[];
    /** Number of completed files. */
    done: number;
    /** Output currently being written. */
    current?: string;
    /** Overall progress, 0–1, weighted by encoded duration. */
    progress: number;
    error?: string;
    startedAt: string;
    endedAt?: string;
}
