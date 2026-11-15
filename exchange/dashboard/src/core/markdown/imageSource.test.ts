import { describe, it, expect } from 'vitest';
import { storePathOfImage } from './imageSource';

describe('storePathOfImage', () => {
    it('resolves a sibling against the folder of the document', () => {
        expect(storePathOfImage('Urb.svg', 'exchange/dashboard/src/kit/archdia/docs'))
            .toBe('exchange/dashboard/src/kit/archdia/docs/Urb.svg');
    });

    it('resolves the asset folder a static version writes', () => {
        expect(storePathOfImage('design.assets/01-mermaid.svg', 'docs'))
            .toBe('docs/design.assets/01-mermaid.svg');
    });

    it('reads an explicit "./" as the folder of the document', () => {
        expect(storePathOfImage('./img.png', 'units/abc')).toBe('units/abc/img.png');
    });

    it('climbs with ".."', () => {
        expect(storePathOfImage('../shared/img.png', 'units/abc')).toBe('units/shared/img.png');
    });

    it('leaves a src that names the store root where it points', () => {
        expect(storePathOfImage('/units/abc/img.png', 'units/xyz')).toBe('units/abc/img.png');
    });

    it('takes a document at the store root as the root', () => {
        expect(storePathOfImage('img.png', '')).toBe('img.png');
    });

    // Paths must not escape the store root.
    it('stops climbing at the store root', () => {
        expect(storePathOfImage('../../../img.png', 'units/abc')).toBe('img.png');
    });

    it('tolerates a folder given with a trailing slash', () => {
        expect(storePathOfImage('img.png', 'units/abc/')).toBe('units/abc/img.png');
    });
});
