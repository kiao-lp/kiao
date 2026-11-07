import { describe, expect, it } from 'vitest';
import type { FileDto } from '@cms-core';
import { plugin } from './index';
import { SEGMENTS_TAB_ID } from './constants';

const file = (path: string): FileDto =>
    ({ path, name: path.split('/').pop() || '', isDirectory: false, size: 0, lastModified: 0 }) as FileDto;

describe('movie-edit', () => {
    it('opens videos and recordings, whatever the case of their extension', () => {
        for (const path of ['/v/clip.mp4', '/v/clip.webm', '/v/CLIP.MOV', '/v/clip.mkv', '/a/talk.mp3', '/a/talk.m4a', '/a/talk.wav', '/a/talk.ogg']) {
            expect(plugin.fileConfigFor(file(path)), path).not.toBeNull();
        }
    });

    // The segments sidecar means nothing without its video: code-edit shows it as the JSON it is.
    it('leaves the sidecar to code-edit, and every other file to its own plugin', () => {
        for (const path of ['/v/clip.mp4.config.json', '/v/notes.md', '/v/still.png']) {
            expect(plugin.fileConfigFor(file(path)), path).toBeNull();
        }
    });

    it('is the video player under the name of what it became, with a panel for the segments', () => {
        expect(plugin.id).toBe('movie-edit');
        expect(plugin.toolBars?.map(tab => tab.id)).toEqual([SEGMENTS_TAB_ID]);
    });
});
