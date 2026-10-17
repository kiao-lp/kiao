
import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { FileDto } from '@cms-core';

const { fileConfigFor } = plugin;

// Mock FileDto factory
const createFile = (path: string): FileDto => ({
    path,
    name: path.split('/').pop() || '',
    isDirectory: false,
    size: 0,
    lastModified: 0
} as any);

describe('SecuredImageViewer', () => {
    describe('fileConfigFor', () => {
        it('should return config for supported extensions', () => {
            const supported = [
                '/tmp/test.png',
                '/tmp/test.jpg',
                '/tmp/test.jpeg',
                '/tmp/test.gif',
                '/tmp/test.webp',
                '/tmp/TEST.PNG' // Case insensitivity check
            ];

            supported.forEach(path => {
                const config = fileConfigFor(createFile(path));
                expect(config).not.toBeNull();

            });
        });

        it('should return null for unsupported extensions', () => {
            const unsupported = [
                '/tmp/test.txt',
                '/tmp/test.pdf',
                '/tmp/test.mp4'
            ];

            unsupported.forEach(path => {
                const config = fileConfigFor(createFile(path));
                expect(config).toBeNull();
            });
        });
    });
});
