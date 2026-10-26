import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { plugin } from './index';

const file = (path: string) => ({
    path,
    isDirectory: false,
    size: 0,
    lastModified: 0,
});

const labelOf = (path: string) => {
    const config = plugin.fileConfigFor(file(path));
    if (!config) throw new Error(`${path} is not claimed`);
    const Label = config.fileLabelCmp;
    return render(<Label file={file(path)} />).container.textContent;
};

describe('CodeEditor plugin', () => {
    it.each([
        'app.ts', 'App.tsx', 'server.mts', 'server.cts',
        'main.js', 'App.jsx', 'build.mjs', 'build.cjs',
        'Main.java', 'lib.rs', 'main.go', 'go.mod', 'go.sum', 'go.work',
        'Main.kt', 'build.gradle.kts', 'main.py',
        'query.sql',
        'package.json', 'deploy.sh', 'deploy.bash',
        'pom.xml', 'compose.yml', 'compose.yaml', 'application.properties', '.gitignore',
    ])('handles %s', (path) => {
        expect(plugin.fileConfigFor(file(path))).not.toBeNull();
    });

    it('leaves alone what other plugins own', () => {
        expect(plugin.fileConfigFor(file('notes.md'))).toBeNull();
        expect(plugin.fileConfigFor(file('notes.txt'))).toBeNull();
        expect(plugin.fileConfigFor(file('events.jsonl'))).toBeNull();
    });

    // index.ts, index.tsx and index.js sit side by side in one folder: dropping the extension
    // would show one name three times.
    it('keeps a source file extension in its label', () => {
        expect(labelOf('src/index.ts')).toBe('index.ts');
        expect(labelOf('src/index.tsx')).toBe('index.tsx');
        expect(labelOf('cmd/main.go')).toBe('main.go');
        expect(labelOf('go.mod')).toBe('go.mod');
        expect(labelOf('pkg/__init__.py')).toBe('__init__.py');
        expect(labelOf('db/query.sql')).toBe('query.sql');
    });

    it('drops the extension of the kinds a store holds one of per name', () => {
        expect(labelOf('config.json')).toBe('config');
        expect(labelOf('bin/deploy.sh')).toBe('deploy');
    });

    // `application.yml` and `application.properties` are one folder apart in a Spring project,
    // and `.gitignore` stripped of its extension is nothing at all.
    it('keeps a configuration file extension in its label', () => {
        expect(labelOf('src/main/resources/application.yml')).toBe('application.yml');
        expect(labelOf('src/main/resources/application.properties')).toBe('application.properties');
        expect(labelOf('.gitignore')).toBe('.gitignore');
    });
});
