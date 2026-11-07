import { describe, it, expect } from 'vitest';
import { staticVersionTarget } from './staticVersion';

describe('staticVersionTarget', () => {
    it('drops .src and names an asset folder beside the output', () => {
        expect(staticVersionTarget('/docs/architecture/overview.src.md')).toEqual({
            source: '/docs/architecture/overview.src.md',
            output: '/docs/architecture/overview.md',
            assetFolder: 'overview.assets',
            assetFolderPath: '/docs/architecture/overview.assets',
        });
    });

    it('leaves an ordinary markdown file alone', () => {
        expect(staticVersionTarget('/docs/overview.md')).toBeNull();
        expect(staticVersionTarget('/docs/overview.src.markdown')).toBeNull();
        expect(staticVersionTarget('/docs/src.md')).toBeNull();
    });

    it('matches the suffix ignoring case but keeps the name as written', () => {
        expect(staticVersionTarget('/docs/Design.SRC.md')).toMatchObject({
            output: '/docs/Design.md',
            assetFolder: 'Design.assets',
        });
    });

    it('has nothing to generate from a file that is only the suffix', () => {
        expect(staticVersionTarget('/docs/.src.md')).toBeNull();
        expect(staticVersionTarget('.src.md')).toBeNull();
    });
});
