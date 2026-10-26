import type { FrameTimeline } from '../timeline';
import type { ByteSource } from './byteSource';
import { readIsoBmffTimeline } from './isoBmff';
import { readMatroskaTimeline } from './matroska';

export { memorySource, openRangeSource } from './byteSource';
export type { ByteSource } from './byteSource';

/**
 * How much of a file is read first: enough to tell what it is, and — for a file written for the
 * web, or a Matroska file — everything about its images but the cues.
 */
export const HEAD_BYTES = 64 * 1024;

/** The first bytes of an EBML document, which is what a Matroska or WebM file is. */
const isMatroska = (head: Uint8Array): boolean =>
    head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;

/** The boxes an MP4 or a MOV opens on — `ftyp` since MP4, one of the others in an old QuickTime file. */
const ISO_OPENING_BOXES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot']);

const isIsoBmff = (head: Uint8Array): boolean =>
    head.length >= 8 && ISO_OPENING_BOXES.has(String.fromCharCode(head[4], head[5], head[6], head[7]));

/**
 * Where the images of a video file are, told by the file rather than by the extension it goes
 * under — null for a file with no video track, or of a kind not read here.
 */
export const readFrameTimeline = async (source: ByteSource, head: Uint8Array): Promise<FrameTimeline | null> => {
    if (isMatroska(head)) return readMatroskaTimeline(source, head);
    if (isIsoBmff(head)) return readIsoBmffTimeline(source, head);
    return null;
};
