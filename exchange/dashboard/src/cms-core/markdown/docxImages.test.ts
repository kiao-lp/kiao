import { describe, expect, it } from 'vitest';
import { fitWordImage, WORD_CONTENT_HEIGHT, WORD_CONTENT_WIDTH } from './docxImages';
import { prepareSvg } from './lib/clipboard';

describe('portable Word images', () => {
    it('fits a huge portrait or landscape into the page without distortion or upscaling', () => {
        for (const [width, height] of [[4000, 8000], [16000, 1000], [60, 40]]) {
            const fit = fitWordImage(width, height);
            expect(fit.width).toBeLessThanOrEqual(WORD_CONTENT_WIDTH);
            expect(fit.height).toBeLessThanOrEqual(WORD_CONTENT_HEIGHT);
            expect(fit.width / fit.height).toBeCloseTo(width / height, 8);
            expect(fit.width).toBeLessThanOrEqual(width);
        }
        expect(fitWordImage(600, 400, 200).height).toBeCloseTo(400 / 3);
        for (const width of [0, -1, NaN, Infinity]) expect(() => fitWordImage(width, 10)).toThrow('dimensions');
    });

    it('rejects invalid SVG and unreachable images rather than producing a partial export', async () => {
        await expect(prepareSvg('<svg><broken></svg>', { strict: true })).rejects.toThrow('Invalid SVG');
        await expect(prepareSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="missing.png"/></svg>', {
            strict: true, resolveResource: async () => { throw new Error('Missing resource'); },
        })).rejects.toThrow('Missing resource');
        await expect(prepareSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>@import "remote.css";</style></svg>', { strict: true })).rejects.toThrow('CSS imports');
    });
});
