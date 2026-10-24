import { describe, expect, it } from 'vitest';
import { FileDto } from '@cms-core';
import { plugin } from './index';

const { fileConfigFor } = plugin;

const createFile = (path: string): FileDto => ({
    path,
    name: path.split('/').pop() || '',
    isDirectory: false,
    size: 0,
    lastModified: 0,
} as unknown as FileDto);

describe('svg-edit plugin', () => {
    it('should handle .svg files', () => {
        const config = fileConfigFor(createFile('/docs/diagram.svg'));
        expect(config).not.toBeNull();
        expect(config?.mainView).toBeDefined();
        expect(config?.fileLabelCmp).toBeDefined();
    });

    it('should handle .SVG in upper case', () => {
        expect(fileConfigFor(createFile('/docs/DIAGRAM.SVG'))).not.toBeNull();
    });

    it('should ignore other extensions', () => {
        expect(fileConfigFor(createFile('/docs/photo.png'))).toBeNull();
        expect(fileConfigFor(createFile('/docs/data.xml'))).toBeNull();
    });

    it('should declare the extension it claims', () => {
        expect(plugin.fileExtensions).toEqual(['.svg']);
    });
});
