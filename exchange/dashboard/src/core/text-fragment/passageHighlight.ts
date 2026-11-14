/** CSS highlights keep React-owned text nodes intact. */

/** Highlight name; a second passage replaces the first. */
const PASSAGE_HIGHLIGHT = 'dashboard-passage';

const RESTING_RATIO = 0.3;

/** Tall passages sit nearer the top. */
const TALL_PASSAGE = 0.5;

const TALL_RATIO = 0.08;

const registry = (): HighlightRegistry | null =>
    typeof CSS !== 'undefined' && typeof Highlight !== 'undefined' && CSS.highlights ? CSS.highlights : null;

export const paintPassage = (range: Range): void => {
    registry()?.set(PASSAGE_HIGHLIGHT, new Highlight(range));
};

export const clearPassage = (): void => {
    registry()?.delete(PASSAGE_HIGHLIGHT);
};

/** False until layout supplies a box; retry next frame. */
export const revealPassage = (scroller: HTMLElement, range: Range): boolean => {
    const passage = range.getBoundingClientRect();
    const pane = scroller.getBoundingClientRect();
    if (passage.height === 0 || pane.height === 0) return false;

    const ratio = passage.height > pane.height * TALL_PASSAGE ? TALL_RATIO : RESTING_RATIO;
    const drift = passage.top - (pane.top + pane.height * ratio);
    // Ignore subpixel drift; scrollTop clamps at pane limits.
    if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
    return true;
};
