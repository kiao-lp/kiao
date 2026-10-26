import { describe, it, expect } from 'vitest';
import { plugin } from './index';

const { fileConfigFor } = plugin;

describe('archdia-edit plugin', () => {

    it('should handle .arch.md files', () => {
        const config = fileConfigFor({
            path: '/test/system-architecture.arch.md',
            lastModified: 0,
            size: 0,
            isDirectory: false,
        });

        expect(config).not.toBeNull();
        expect(config?.mainView).toBeDefined();
        expect(config?.fileLabelCmp).toBeDefined();
    });

    it('should ignore plain .md files', () => {
        const config = fileConfigFor({
            path: '/test/readme.md',
            lastModified: 0,
            size: 0,
            isDirectory: false,
        });

        expect(config).toBeNull();
    });

    it('should ignore other extensions', () => {
        const config = fileConfigFor({
            path: '/test/example.json',
            lastModified: 0,
            size: 0,
            isDirectory: false,
        });

        expect(config).toBeNull();
    });
});
