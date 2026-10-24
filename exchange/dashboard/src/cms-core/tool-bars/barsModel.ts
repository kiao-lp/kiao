/**
 * Tabs occupy bars or are hidden. Placement rules are shared by the layout and Show menu.
 * Placements name bars; pixel widths belong to sides, which may contain multiple bars.
 */

export type BarSide = 'left' | 'center' | 'right';

export type BarId = string;

export interface BarSpec {
    id: BarId;
    side: BarSide;
}

/** The open document is pinned here. */
export const CENTER_BAR_ID = 'center';

export const CENTER_2_BAR_ID = 'center-2';

export const CENTER_3_BAR_ID = 'center-3';

export type CentralCount = 1 | 2 | 3;

export const CENTER_BAR_IDS: readonly BarId[] = [CENTER_BAR_ID, CENTER_2_BAR_ID, CENTER_3_BAR_ID];

export const normalizeCentralCount = (value: unknown): CentralCount =>
    value === 2 || value === 3 ? value : 1;

export const centerBarIds = (count: CentralCount): BarId[] => CENTER_BAR_IDS.slice(0, count);

export const isCenterBar = (id: BarId): boolean => CENTER_BAR_IDS.includes(id);

/** Grid order. */
export const BARS: readonly BarSpec[] = [
    { id: 'left', side: 'left' },
    { id: CENTER_BAR_ID, side: 'center' },
    { id: CENTER_2_BAR_ID, side: 'center' },
    { id: CENTER_3_BAR_ID, side: 'center' },
    { id: 'right', side: 'right' },
];

export const barsOfSide = (side: BarSide, count: CentralCount = 1): BarSpec[] =>
    side === 'center'
        ? centerBarIds(count).map(id => BARS.find(bar => bar.id === id)!)
        : BARS.filter(bar => bar.side === side);

export const barSpec = (id: BarId): BarSpec | undefined => BARS.find(bar => bar.id === id);

export const DEFAULT_BAR: BarId = 'right';

/** Registered and available in the Show menu, but not rendered. */
export const OFF = 'off';

export type Placement = BarId | typeof OFF;

export type TabPlacements = Record<string, Placement>;

export interface PlaceableTab {
    id: string;
    /** Initial placement; OFF keeps the tab available in the Show menu. */
    defaultBar?: Placement;
    /** Document tab: fixed to defaultBar, never hidden or offered in the Show menu. */
    pinned?: boolean;
}

export const barsFor = (tab: PlaceableTab, count: CentralCount = 1): BarSpec[] => {
    if (tab.pinned) {
        const home = BARS.find(bar => bar.id === tab.defaultBar);
        return home ? [home] : [];
    }
    return barsOfSide('left', count).concat(barsOfSide('center', count), barsOfSide('right', count));
};

export const acceptsPlacement = (tab: PlaceableTab, placement: Placement, count: CentralCount = 1): boolean =>
    tab.pinned
        ? placement === tab.defaultBar
        : placement === OFF || barsFor(tab, count).some(bar => bar.id === placement);

/** Reveal a hidden tab in its default, the layout default, or its first compatible bar. */
export const barToShowIn = (tab: PlaceableTab, count: CentralCount = 1): BarId | undefined =>
    [tab.defaultBar, DEFAULT_BAR].find(
        (bar): bar is BarId => bar !== undefined && bar !== OFF && acceptsPlacement(tab, bar, count),
    ) ?? barsFor(tab, count)[0]?.id;

/** Invalid persisted placements fall back to a compatible default; pinned tabs stay home. */
export const placementOf = (placements: TabPlacements, tab: PlaceableTab, count: CentralCount = 1): Placement => {
    const arranged = placements[tab.id];
    if (arranged !== undefined && acceptsPlacement(tab, arranged, count)) return arranged;
    if (arranged !== undefined && isCenterBar(arranged) && acceptsPlacement(tab, CENTER_BAR_ID, count)) {
        return CENTER_BAR_ID;
    }
    const shipped = tab.defaultBar ?? DEFAULT_BAR;
    return acceptsPlacement(tab, shipped, count) ? shipped : (barsFor(tab, count)[0]?.id ?? OFF);
};

/** Moves placements in removed central areas to the first central area. */
export const placementsAfterCentralCount = (
    placements: TabPlacements,
    count: CentralCount,
): TabPlacements => {
    const kept = new Set(centerBarIds(count));
    const next: TabPlacements = {};
    for (const [tabId, placement] of Object.entries(placements)) {
        next[tabId] = placement !== OFF && isCenterBar(placement) && !kept.has(placement)
            ? CENTER_BAR_ID
            : placement;
    }
    return next;
};

/** Pinned tabs lead; remaining tabs retain registration order. */
export const tabsIn = <T extends PlaceableTab>(
    tabs: T[],
    placements: TabPlacements,
    bar: BarId,
    count: CentralCount = 1,
): T[] =>
    tabs
        .filter(tab => placementOf(placements, tab, count) === bar)
        .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

/**
 * Derive a fallback when selection is absent or no longer held by the bar, so opening a document
 * does not write its view state.
 */
export const activeTabIn = <T extends PlaceableTab>(
    tabs: T[],
    placements: TabPlacements,
    selected: Record<string, string | undefined>,
    bar: BarId,
    count: CentralCount = 1,
): string | null => {
    const held = tabsIn(tabs, placements, bar, count);
    const chosen = selected[bar];
    if (chosen && held.some(tab => tab.id === chosen)) return chosen;
    return held[0]?.id ?? null;
};

/** Clicking the current bar dismisses the tab; the grid has no separate OFF cell. */
export const placementAfterClick = (current: Placement, clicked: BarId): Placement =>
    current === clicked ? OFF : clicked;

export const MIN_BAR_WIDTH = 150;

/** Leave enough window width to keep the resize handle reachable. */
export const HANDLE_REACH = 80;

/** Limit to the current window, rather than imposing a fixed maximum column width. */
export const maxBarWidth = (windowWidth: number): number =>
    Math.max(MIN_BAR_WIDTH, windowWidth - HANDLE_REACH);

export const clampBarWidth = (width: number, windowWidth: number): number =>
    Math.max(MIN_BAR_WIDTH, Math.min(maxBarWidth(windowWidth), width));

/** Center takes remaining width; its entry is unused. */
export const DEFAULT_BAR_WIDTH: Record<BarSide, number> = { left: 220, center: 0, right: 300 };
