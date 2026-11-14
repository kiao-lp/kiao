/** Placements name bars; pixel widths belong to sides. */

export type BarSide = 'left' | 'center' | 'right';

export type BarId = string;

export interface BarSpec {
    id: BarId;
    side: BarSide;
}

/** The open document is pinned here. */
export const CENTER_BAR_ID = 'center';

export const CENTER_2_BAR_ID = 'center-2';

export const CENTER_BAR_IDS: readonly BarId[] = [CENTER_BAR_ID, CENTER_2_BAR_ID];

export const isCenterBar = (id: BarId): boolean => CENTER_BAR_IDS.includes(id);

/** Grid order. */
export const BARS: readonly BarSpec[] = [
    { id: 'left', side: 'left' },
    { id: CENTER_BAR_ID, side: 'center' },
    { id: CENTER_2_BAR_ID, side: 'center' },
    { id: 'right', side: 'right' },
];

export const barsOfSide = (side: BarSide, secondCentralArea = false): BarSpec[] =>
    side === 'center'
        ? BARS.filter(bar => bar.side === 'center' && (secondCentralArea || bar.id === CENTER_BAR_ID))
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

export const barsFor = (tab: PlaceableTab, secondCentralArea = false): BarSpec[] => {
    if (tab.pinned) {
        const home = BARS.find(bar => bar.id === tab.defaultBar);
        return home ? [home] : [];
    }
    return barsOfSide('left', secondCentralArea).concat(
        barsOfSide('center', secondCentralArea),
        barsOfSide('right', secondCentralArea),
    );
};

export const acceptsPlacement = (
    tab: PlaceableTab,
    placement: Placement,
    secondCentralArea = false,
): boolean =>
    tab.pinned
        ? placement === tab.defaultBar
        : placement === OFF || barsFor(tab, secondCentralArea).some(bar => bar.id === placement);

/** Reveal a hidden tab in its default, the layout default, or its first compatible bar. */
export const barToShowIn = (tab: PlaceableTab, secondCentralArea = false): BarId | undefined =>
    [tab.defaultBar, DEFAULT_BAR].find(
        (bar): bar is BarId => bar !== undefined && bar !== OFF && acceptsPlacement(tab, bar, secondCentralArea),
    ) ?? barsFor(tab, secondCentralArea)[0]?.id;

/** Invalid persisted placements fall back to a compatible default; pinned tabs stay home. */
export const placementOf = (
    placements: TabPlacements,
    tab: PlaceableTab,
    secondCentralArea = false,
): Placement => {
    const arranged = placements[tab.id];
    if (arranged !== undefined && acceptsPlacement(tab, arranged, secondCentralArea)) return arranged;
    if (arranged !== undefined && isCenterBar(arranged) && acceptsPlacement(tab, CENTER_BAR_ID, secondCentralArea)) {
        return CENTER_BAR_ID;
    }
    const shipped = tab.defaultBar ?? DEFAULT_BAR;
    if (acceptsPlacement(tab, shipped, secondCentralArea)) return shipped;
    if (isCenterBar(shipped) && acceptsPlacement(tab, CENTER_BAR_ID, secondCentralArea)) return CENTER_BAR_ID;
    return barsFor(tab, secondCentralArea)[0]?.id ?? OFF;
};

/** Moves placements in the second central area to the first one. */
export const placementsWithoutSecondCentralArea = (placements: TabPlacements): TabPlacements => {
    const next: TabPlacements = {};
    for (const [tabId, placement] of Object.entries(placements)) {
        next[tabId] = placement === CENTER_2_BAR_ID ? CENTER_BAR_ID : placement;
    }
    return next;
};

/** Pinned tabs lead; remaining tabs retain registration order. */
export const tabsIn = <T extends PlaceableTab>(
    tabs: T[],
    placements: TabPlacements,
    bar: BarId,
    secondCentralArea = false,
): T[] =>
    tabs
        .filter(tab => placementOf(placements, tab, secondCentralArea) === bar)
        .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));

/** Fallback selection; opening a document writes no view state. */
export const activeTabIn = <T extends PlaceableTab>(
    tabs: T[],
    placements: TabPlacements,
    selected: Record<string, string | undefined>,
    bar: BarId,
    secondCentralArea = false,
): string | null => {
    const held = tabsIn(tabs, placements, bar, secondCentralArea);
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
