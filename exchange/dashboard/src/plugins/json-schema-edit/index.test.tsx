import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { plugin } from './index';

const file = (path: string, isDirectory = false) => ({ path, isDirectory, lastModified: 0, size: 0 });

describe('JSON Schema plugin', () => {
    it.each(['/schemas/person.schema.json', '/schemas/PERSON.SCHEMA.JSON'])(
        'opens %s with its editor and icon', path => {
            const config = plugin.fileConfigFor(file(path));
            expect(config?.mainView).toBeDefined();
            const Label = config!.fileLabelCmp;
            const { getByAltText } = render(<Label file={file(path)} />);
            expect(getByAltText('JSON Schema')).toHaveClass('file-label-icon');
        },
    );

    it('leaves other JSON and directories to their plugins', () => {
        expect(plugin.fileConfigFor(file('/data.json'))).toBeNull();
        expect(plugin.fileConfigFor(file('/schema.json'))).toBeNull();
        expect(plugin.fileConfigFor(file('/folder.schema.json', true))).toBeNull();
    });

    it('declares its suffix and creation command', () => {
        expect(plugin.fileExtensions).toEqual(['.schema.json']);
        expect(plugin.fallback).not.toBe(true);
        expect(plugin.CreationProvider).toBeDefined();
    });
});
