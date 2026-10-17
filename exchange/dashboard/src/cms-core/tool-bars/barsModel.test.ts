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
    tabsIn,
} from './barsModel';

const NAV = { id: 'file-navigation', defaultBar: 'top' };
const GIT = { id: 'git' };
const CLAUDE = { id: 'claude' };
const TABS = [NAV, GIT, CLAUDE];

/** The two the file navigation is now: a line that is a top bar, a tree that is a column. */
const NAV_BAR = { id: 'nav-bar', defaultBar: 'top', orientation: 'horizontal' } as const;
const NAV_TREE = { id: 'nav-tree', defaultBar: 'left', orientation: 'vertical' } as const;

describe('bar layout', () => {
    it('gives every side exactly one bar today, and the grid a rectangle for each', () => {
        expect(BARS.map(bar => bar.id)).toEqual(['top', 'left', 'center', 'right']);
        expect(barsOfSide('left').map(bar => bar.id)).toEqual(['left']);
        expect(barsOfSide('center').map(bar => bar.id)).toEqual(['center']);
        expect(barSpec('right')?.orientation).toBe('vertical');
        expect(barSpec('center')?.orientation).toBe('vertical');
        expect(barSpec('top')?.orientation).toBe('horizontal');
    });
});

describe('placementOf', () => {
    it('answers with the tab\'s own default for a document nobody has arranged', () => {
        expect(placementOf({}, NAV)).toBe('top');
        expect(placementOf({}, GIT)).toBe(DEFAULT_BAR);
    });

    it('answers with what the document says once it has been arranged', () => {
        expect(placementOf({ 'file-navigation': 'left' }, NAV)).toBe('left');
        expect(placementOf({ git: OFF }, GIT)).toBe(OFF);
    });

    // A state file written before the file navigation was split, or edited by hand, can name a bar
    // the tab cannot draw itself in. It falls back rather than putting a tree across the top.
    it('refuses an arrangement the tab cannot hold, and ships it where it belongs', () => {
        expect(placementOf({ 'nav-bar': 'left' }, NAV_BAR)).toBe('top');
        expect(placementOf({ 'nav-tree': 'top' }, NAV_TREE)).toBe('left');
    });

    it('lets either of them be taken out of the layout, whichever way it draws', () => {
        expect(placementOf({ 'nav-bar': OFF }, NAV_BAR)).toBe(OFF);
        expect(placementOf({ 'nav-tree': OFF }, NAV_TREE)).toBe(OFF);
    });

    // The point of the split: the two are placed on their own and are drawn at the same time.
    it('places the file line and the file tree independently', () => {
        const placements = { 'nav-tree': 'right' };
        expect(placementOf(placements, NAV_BAR)).toBe('top');
        expect(placementOf(placements, NAV_TREE)).toBe('right');
    });
});

describe('where a tab may go', () => {
    it('offers a tab that draws itself one way only the bars laid out that way', () => {
        expect(barsFor(NAV_BAR).map(bar => bar.id)).toEqual(['top']);
        expect(barsFor(NAV_TREE).map(bar => bar.id)).toEqual(['left', 'center', 'right']);
    });

    it('offers every bar to a tab that draws itself either way', () => {
        expect(barsFor(GIT).map(bar => bar.id)).toEqual(['top', 'left', 'center', 'right']);
    });

    it('always accepts being taken out of the layout', () => {
        expect(acceptsPlacement(NAV_BAR, OFF)).toBe(true);
        expect(acceptsPlacement(NAV_BAR, 'right')).toBe(false);
        expect(acceptsPlacement(NAV_TREE, 'left')).toBe(true);
    });
});

describe('barToShowIn', () => {
    it('brings a tab back where it ships', () => {
        expect(barToShowIn(NAV_TREE)).toBe('left');
        expect(barToShowIn(NAV_BAR)).toBe('top');
    });

    it('falls back to the house default for a tab that names none', () => {
        expect(barToShowIn(GIT)).toBe(DEFAULT_BAR);
    });

    // "Show me this" has to answer with a bar, so a tab that ships out of the layout is brought
    // back somewhere it can actually be drawn.
    it('finds a bar for a tab that ships out of the layout', () => {
        expect(barToShowIn({ id: 'hidden', defaultBar: OFF, orientation: 'horizontal' })).toBe('top');
        expect(barToShowIn({ id: 'hidden', defaultBar: OFF })).toBe(DEFAULT_BAR);
    });
});

describe('tabsIn', () => {
    it('holds the tabs placed there, in registration order', () => {
        const placements = { git: 'left', claude: 'left' };
        expect(tabsIn(TABS, placements, 'left')).toEqual([GIT, CLAUDE]);
        expect(tabsIn(TABS, placements, 'right')).toEqual([]);
        expect(tabsIn(TABS, placements, 'top')).toEqual([NAV]);
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
        expect(activeTabIn(TABS, {}, {}, 'left')).toBeNull();
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
        expect(placementAfterClick('top', 'left')).toBe('left');
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
