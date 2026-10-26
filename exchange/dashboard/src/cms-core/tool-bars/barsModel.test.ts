import { describe, expect, it } from 'vitest';
import {
    BARS,
    DEFAULT_BAR,
    MIN_BAR_WIDTH,
    OFF,
    acceptsPlacement,
    activeTabIn,
    barSpec,
    barToShowIn,
    barsFor,
    barsOfSide,
    clampBarWidth,
    maxBarWidth,
    placementAfterClick,
    placementOf,
    placementsAfterCentralCount,
    tabsIn,
} from './barsModel';

const NAV = { id: 'file-navigation', defaultBar: 'left' };
const GIT = { id: 'git' };
const CLAUDE = { id: 'claude' };
const TABS = [NAV, GIT, CLAUDE];

describe('bar layout', () => {
    it('lists all bars and the central areas active for the count', () => {
        expect(BARS.map(bar => bar.id)).toEqual(['left', 'center', 'center-2', 'center-3', 'right']);
        expect(barsOfSide('left').map(bar => bar.id)).toEqual(['left']);
        expect(barsOfSide('center').map(bar => bar.id)).toEqual(['center']);
        expect(barsOfSide('center', 2).map(bar => bar.id)).toEqual(['center', 'center-2']);
        expect(barsOfSide('center', 3).map(bar => bar.id)).toEqual(['center', 'center-2', 'center-3']);
        expect(barSpec('right')?.side).toBe('right');
        expect(barSpec('center-2')?.side).toBe('center');
        expect(barSpec('top')).toBeUndefined();
    });

    it('offers only active central areas', () => {
        expect(barsFor(GIT, 1).map(bar => bar.id)).toEqual(['left', 'center', 'right']);
        expect(barsFor(GIT, 2).map(bar => bar.id)).toEqual(['left', 'center', 'center-2', 'right']);
        expect(barsFor(GIT, 3).map(bar => bar.id)).toEqual(['left', 'center', 'center-2', 'center-3', 'right']);
        expect(acceptsPlacement(GIT, 'center-2', 1)).toBe(false);
        expect(acceptsPlacement(GIT, 'center-2', 2)).toBe(true);
        expect(placementOf({ git: 'center-3' }, GIT, 1)).toBe('center');
        expect(placementOf({ git: 'center-3' }, GIT, 3)).toBe('center-3');
    });

    it('moves panels from removed central areas to the first one', () => {
        expect(placementsAfterCentralCount({ git: 'center-2', claude: 'center-3', files: 'left' }, 1))
            .toEqual({ git: 'center', claude: 'center', files: 'left' });
        expect(placementsAfterCentralCount({ git: 'center-3' }, 2)).toEqual({ git: 'center' });
        expect(placementsAfterCentralCount({ git: 'center-2' }, 2)).toEqual({ git: 'center-2' });
        expect(placementsAfterCentralCount({ git: OFF }, 1)).toEqual({ git: OFF });
    });
});

describe('placementOf', () => {
    it('answers with the tab\'s own default for a document nobody has arranged', () => {
        expect(placementOf({}, NAV)).toBe('left');
        expect(placementOf({}, GIT)).toBe(DEFAULT_BAR);
    });

    it('answers with what the document says once it has been arranged', () => {
        expect(placementOf({ 'file-navigation': 'left' }, NAV)).toBe('left');
        expect(placementOf({ git: OFF }, GIT)).toBe(OFF);
    });

    it('falls back to the tab default for a saved placement in a removed bar', () => {
        expect(placementOf({ 'file-navigation': 'top' }, NAV)).toBe('left');
        expect(placementOf({ git: 'top' }, GIT)).toBe(DEFAULT_BAR);
    });
});

describe('where a tab may go', () => {
    it('offers every active bar to a panel', () => {
        expect(barsFor(GIT).map(bar => bar.id)).toEqual(['left', 'center', 'right']);
    });

    it('always accepts being taken out of the layout', () => {
        expect(acceptsPlacement(NAV, OFF)).toBe(true);
        expect(acceptsPlacement(NAV, 'left')).toBe(true);
        expect(acceptsPlacement(NAV, 'top')).toBe(false);
    });
});

describe('barToShowIn', () => {
    it('brings a tab back where it ships', () => {
        expect(barToShowIn(NAV)).toBe('left');
    });

    it('falls back to the house default for a tab that names none', () => {
        expect(barToShowIn(GIT)).toBe(DEFAULT_BAR);
    });

    // "Show me this" has to answer with a bar, so a tab that ships out of the layout is brought
    // back somewhere it can actually be drawn.
    it('finds a bar for a tab that ships out of the layout', () => {
        expect(barToShowIn({ id: 'hidden', defaultBar: OFF })).toBe(DEFAULT_BAR);
    });
});

describe('tabsIn', () => {
    it('holds the tabs placed there, in registration order', () => {
        const placements = { git: 'center', claude: 'center' };
        expect(tabsIn(TABS, placements, 'center')).toEqual([GIT, CLAUDE]);
        expect(tabsIn(TABS, placements, 'right')).toEqual([]);
        expect(tabsIn(TABS, placements, 'left')).toEqual([NAV]);
    });

    it('leaves out a tab taken out of the layout', () => {
        expect(tabsIn(TABS, { git: OFF }, 'right')).toEqual([CLAUDE]);
    });
});

describe('activeTabIn', () => {
    it('shows the first tab of a bar nobody has chosen in', () => {
        expect(activeTabIn(TABS, {}, {}, 'right')).toBe('git');
    });

    it('shows the chosen one', () => {
        expect(activeTabIn(TABS, {}, { right: 'claude' }, 'right')).toBe('claude');
    });

    // Choosing a tab and then moving it elsewhere must not leave the bar showing nothing.
    it('falls back when the chosen tab has left the bar', () => {
        expect(activeTabIn(TABS, { claude: 'left' }, { right: 'claude' }, 'right')).toBe('git');
    });

    it('has nothing to show in an empty bar', () => {
        expect(activeTabIn(TABS, {}, {}, 'center')).toBeNull();
    });
});

describe('a pinned tab', () => {
    const DOCUMENT = { id: 'document', defaultBar: 'center', pinned: true } as const;

    it('is offered only the bar it is pinned to', () => {
        expect(barsFor(DOCUMENT).map(bar => bar.id)).toEqual(['center']);
    });

    it('holds its own bar and nothing else — out of the layout refused', () => {
        expect(acceptsPlacement(DOCUMENT, 'center')).toBe(true);
        expect(acceptsPlacement(DOCUMENT, 'left')).toBe(false);
        expect(acceptsPlacement(DOCUMENT, OFF)).toBe(false);
    });

    it('stays where it is pinned whatever was arranged for it', () => {
        expect(placementOf({ document: 'left' }, DOCUMENT)).toBe('center');
        expect(placementOf({ document: OFF }, DOCUMENT)).toBe('center');
        expect(placementOf({}, DOCUMENT)).toBe('center');
    });

    it('leads the bar however late it registered', () => {
        expect(tabsIn([GIT, DOCUMENT], {}, 'center').map(tab => tab.id)).toEqual(['document']);
        expect(tabsIn([GIT, DOCUMENT], { git: 'center' }, 'center').map(tab => tab.id))
            .toEqual(['document', 'git']);
    });

    it('is brought back to its own bar when asked for', () => {
        expect(barToShowIn(DOCUMENT)).toBe('center');
    });
});

describe('placementAfterClick', () => {
    it('moves a tab to the rectangle that was clicked', () => {
        expect(placementAfterClick('right', 'left')).toBe('left');
        expect(placementAfterClick(OFF, 'right')).toBe('right');
    });

    // The rectangle a tab is in is the one that dismisses it: there is no fourth one for "nowhere".
    it('takes a tab out of the layout when its own rectangle is clicked', () => {
        expect(placementAfterClick('left', 'left')).toBe(OFF);
    });
});

describe('bar widths', () => {
    it('never narrows a column past a strip of icons', () => {
        expect(clampBarWidth(10, 1600)).toBe(MIN_BAR_WIDTH);
    });

    it('keeps the resize handle inside a window the column outgrew', () => {
        // A width remembered from a wide screen, reopened on a narrow one.
        expect(clampBarWidth(1400, 600)).toBe(maxBarWidth(600));
        expect(maxBarWidth(600)).toBeLessThan(600);
    });

    it('leaves a width the window can show alone', () => {
        expect(clampBarWidth(300, 1600)).toBe(300);
    });
});
