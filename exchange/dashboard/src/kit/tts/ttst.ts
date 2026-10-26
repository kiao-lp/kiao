import { type WorkerClient } from 'kiao-worker';

/**
 * Server-generated MP3 offsets, valid only for the accompanying audio.
 * Playback repeats from startMs and stops at endMs, midway through trailing silence
 * to tolerate timing drift.
 */
export interface TtstQuestion {
    startMs: number;
    endMs: number;
    /** Optional name from the script's `<mark>`. */
    name?: string;
}

/**
 * Sidecar `<name>.ttst.md.config.json` for a monolingual `.ttst.md` script.
 * The server consumes `<break>` silences and paired `<mark>` question tags;
 * neither is sent to the speech provider. See the ttst-edit README.
 */
export interface TtstConfig {
    /** Script language, e.g. "FR"; selects the voice catalog. */
    lang?: string;
    /** Listener-facing episode title; overrides the unit chain item's label for this language. */
    title?: string;
    /** Provider-prefixed voice id, e.g. "google:fr-FR-Chirp3-HD-Puck". */
    ttsVoice?: string;
    /** Script- and voice-specific pronunciation overrides: term → spoken form. */
    ttsOverrides?: Record<string, string>;
    /** Server-owned digest of the current voice and script. */
    hash?: string;
    /** Server-owned digest used to build the MP3; equals hash when publish can reuse it. */
    audioHash?: string;
    /** Playback order; absent without marks. Generated with the audio, valid per audioHash. */
    questions?: TtstQuestion[];
}

export const TTST_EXTENSION = '.ttst.md';

export const ttstConfigPath = (ttstPath: string): string => `${ttstPath}.config.json`;

/** All synthesis and export paths share this MP3 beside the script. */
export const ttstAudioPath = (ttstPath: string): string =>
    `${ttstPath.slice(0, -TTST_EXTENSION.length)}.mp3`;

/**
 * Seeds missing configs from `<stem>.<LANG>.ttst.md`; stored lang takes precedence.
 * Unit scripts omit the language suffix; their editors seed lang from the unit.
 */
export const langFromTtstPath = (ttstPath: string): string | undefined => {
    const name = ttstPath.split('/').pop() ?? ttstPath;
    const match = name.slice(0, -TTST_EXTENSION.length).match(/(?:^|\.)([A-Za-z]{2})$/);
    return match ? match[1].toUpperCase() : undefined;
};

/** Missing or unreadable sidecars fall back to filename-derived config so editing still works. */
export const readTtstConfig = async (client: WorkerClient, ttstPath: string): Promise<TtstConfig> => {
    try {
        const config = await client.getFileJson<TtstConfig>(ttstConfigPath(ttstPath));
        if (config && typeof config === 'object') return config;
    } catch {
    }
    return { lang: langFromTtstPath(ttstPath) };
};

export const writeTtstConfig = async (client: WorkerClient, ttstPath: string, config: TtstConfig): Promise<void> => {
    await client.update(ttstConfigPath(ttstPath), JSON.stringify(config, null, 2));
};
