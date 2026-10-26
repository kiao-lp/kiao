import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { FileDto } from '@cms-core';

const { fileConfigFor } = plugin;

const createFile = (path: string): FileDto => ({
    path,
    name: path.split('/').pop() || '',
    isDirectory: false,
    size: 0,
    lastModified: 0
} as any);

describe('three-d-model-view', () => {
    describe('fileConfigFor', () => {
        it('claims binary glTF, whatever its case', () => {
            ['/models/chair.glb', '/models/CHAIR.GLB', 'scene.v2.glb'].forEach(path => {
                expect(fileConfigFor(createFile(path))).not.toBeNull();
            });
        });

        it('leaves every other file alone', () => {
            const unsupported = [
                '/models/chair.gltf',   // a manifest pointing at sibling files — see index.tsx
                '/models/chair.bin',
                '/models/chair.glb.md',
                '/models/notes.md',
                '/models/render.png',
            ];

            unsupported.forEach(path => {
                expect(fileConfigFor(createFile(path))).toBeNull();
            });
        });
    });

    it('keeps its extension intact when a model is renamed', () => {
        expect(plugin.fileExtensions).toEqual(['.glb']);
    });
});
