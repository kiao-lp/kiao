import { describe, it, expect } from 'vitest';
import { plugin } from './index';
import { langFromTtstPath, ttstConfigPath } from '@cms-kit/tts';

const { fileConfigFor } = plugin;

const file = (path: string) => ({ path, lastModified: 0, size: 0, isDirectory: false });

describe('ttst-edit plugin', () => {

    it('claims .ttst.md files', () => {
        const config = fileConfigFor(file('/units/abc.FR.ttst.md'));

        expect(config).not.toBeNull();
        expect(config?.mainView).toBeDefined();
        expect(config?.fileLabelCmp).toBeDefined();
    });

    it('ignores plain .md files', () => {
        expect(fileConfigFor(file('/units/abc.FR.md'))).toBeNull();
    });

    // The sidecar is left to code-edit; claiming it would open the JSON in a script editor.
    it('ignores the .config.json sidecar', () => {
        expect(fileConfigFor(file('/units/abc.FR.ttst.md.config.json'))).toBeNull();
    });
});

describe('ttst config sidecar', () => {

    it('derives the sidecar path from the script path', () => {
        expect(ttstConfigPath('units/abc.FR.ttst.md')).toBe('units/abc.FR.ttst.md.config.json');
    });

    it('reads the language from the filename', () => {
        expect(langFromTtstPath('units/abc.FR.ttst.md')).toBe('FR');
        expect(langFromTtstPath('units/abc.en.ttst.md')).toBe('EN');
    });

    // Inside a unit folder the file is named for its language alone — the folder is the docId.
    it('reads the language from a bare <LANG>.ttst.md in a unit folder', () => {
        expect(langFromTtstPath('units/abc/FR.ttst.md')).toBe('FR');
        expect(langFromTtstPath('FR.ttst.md')).toBe('FR');
    });

    it('returns no language when the filename carries none', () => {
        expect(langFromTtstPath('units/intro.ttst.md')).toBeUndefined();
    });
});
