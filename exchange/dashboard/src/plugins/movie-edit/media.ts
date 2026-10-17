/**
 * What this plugin opens. A video is stepped through image by image; a recording is only played —
 * it has no images to step between — and both are cut into named segments the same way.
 */
export const videoExtensions = ['.mp4', '.webm', '.mov', '.mkv'];

/** Audio the CMS produces or holds — notably the MP3 a speech-synthesis action writes beside
 *  a script, which exists to be listened to right where it was generated. */
export const audioExtensions = ['.mp3', '.m4a', '.wav', '.ogg'];

export const supportedExtensions = [...videoExtensions, ...audioExtensions];

const endsWithOneOf = (path: string, extensions: string[]): boolean => {
    const lower = path.toLowerCase();
    return extensions.some(ext => lower.endsWith(ext));
};

export const isMediaPath = (path: string): boolean => endsWithOneOf(path, supportedExtensions);

export const isAudioPath = (path: string): boolean => endsWithOneOf(path, audioExtensions);
