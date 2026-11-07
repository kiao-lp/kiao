import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { plugin } from './index';

const file = (path: string) => ({
    path,
    isDirectory: false,
    size: 0,
    lastModified: 0,
});

describe('TextEditor plugin', () => {
    it.each(['notes.txt', 'events.jsonl', 'article.cls', 'rows.csv', 'report.xlsx.index.csv', 'rows.tsv'])('handles %s files', (path) => {
        expect(plugin.fileConfigFor(file(path))).not.toBeNull();
    });

    // It sits at the root of every store and is the operator's to edit; nothing else claims it.
    it('opens the store declaration, whose name is entirely its extension', () => {
        expect(plugin.fileConfigFor(file('.kiao-files'))).not.toBeNull();
        expect(plugin.fileConfigFor(file('docs/repo-a/.kiao-files'))).not.toBeNull();
    });

    // The rename modal splits a name on these, and this one has no name apart from its extension.
    it('keeps the declaration out of the renameable extensions', () => {
        expect(plugin.fileExtensions).toEqual(['.txt', '.jsonl', '.cls', '.csv', '.tsv']);
    });

    it('ignores unsupported file extensions', () => {
        expect(plugin.fileConfigFor(file('notes.json'))).toBeNull();
    });

    // The extension is dropped from the title, as for `.txt`: a tabular file is one per name.
    it('titles a tabular file by its name', () => {
        const Label = plugin.fileConfigFor(file('data/rows.csv'))!.fileLabelCmp;
        expect(render(<Label file={file('data/rows.csv')} />).container.textContent).toBe('rows');
    });
});
