import { describe, it, expect } from 'vitest';
import { storePathOfImage } from './imageSource';

// The path arithmetic behind a picture appearing or not appearing. What is pinned here is the two
// readings a src can have — relative to the document, or naming the store root — and that the
// leading slash is what tells them apart.

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

    // The store root is as far up as there is: the alternative is a path worker answers with
    // a 400, which is a broken image either way and a scarier one in the log.
    it('stops climbing at the store root', () => {
        expect(storePathOfImage('../../../img.png', 'units/abc')).toBe('img.png');
    });

    it('tolerates a folder given with a trailing slash', () => {
        expect(storePathOfImage('img.png', 'units/abc/')).toBe('units/abc/img.png');
    });
});
