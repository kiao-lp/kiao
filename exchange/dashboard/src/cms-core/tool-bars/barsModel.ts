/**
 * Tabs occupy bars or are hidden. Placement rules are shared by the layout and Show menu.
 * Placements name bars; pixel widths belong to sides, which may contain multiple bars.
 */

export type BarSide = 'top' | 'left' | 'center' | 'right';

export type BarId = string;

export type BarOrientation = 'horizontal' | 'vertical';

export interface BarSpec {
    id: BarId;
    side: BarSide;
    /** Controls rendering and tab compatibility. */
    orientation: BarOrientation;
}

/** The open document is pinned here. */
export const CENTER_BAR_ID = 'center';

/** Grid order. */
export const BARS: readonly BarSpec[] = [
    { id: 'top', side: 'top', orientation: 'horizontal' },
    { id: 'left', side: 'left', orientation: 'vertical' },
    { id: CENTER_BAR_ID, side: 'center', orientation: 'vertical' },
    { id: 'right', side: 'right', orientation: 'vertical' },
];

/** Reading order for grid rows and visibility switches. */
export const SIDES: readonly BarSide[] = ['top', 'left', 'center', 'right'];

export const barsOfSide = (side: BarSide): BarSpec[] => BARS.filter(bar => bar.side === side);

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
    /** Restricts compatible bars; omitted means any orientation. */
    orientation?: BarOrientation;
    /** Document tab: fixed to defaultBar, never hidden or offered in the Show menu. */
    pinned?: boolean;
}

export const barsFor = (tab: PlaceableTab): BarSpec[] => {
    if (tab.pinned) {
        const home = BARS.find(bar => bar.id === tab.defaultBar);
        return home ? [home] : [];
    }
    return BARS.filter(bar => tab.orientation === undefined || bar.orientation === tab.orientation);
};

export const acceptsPlacement = (tab: PlaceableTab, placement: Placement): boolean =>
    tab.pinned
        ? placement === tab.defaultBar
        : placement === OFF || barsFor(tab).some(bar => bar.id === placement);

/** Reveal a hidden tab in its default, the layout default, or its first compatible bar. */
export const barToShowIn = (tab: PlaceableTab): BarId | undefined =>
    [tab.defaultBar, DEFAULT_BAR].find(
        (bar): bar is BarId => bar !== undefined && bar !== OFF && acceptsPlacement(tab, bar),
    ) ?? barsFor(tab)[0]?.id;

/** Invalid persisted placements fall back to a compatible default; pinned tabs stay home. */
export const placementOf = (placements: TabPlacements, tab: PlaceableTab): Placement => {
    const arranged = placements[tab.id];
    if (arranged !== undefined && acceptsPlacement(tab, arranged)) return arranged;
    const shipped = tab.defaultBar ?? DEFAULT_BAR;
    return acceptsPlacement(tab, shipped) ? shipped : (barsFor(tab)[0]?.id ?? OFF);
};

/** Pinned tabs lead; remaining tabs retain registration order. */
export const tabsIn = <T extends PlaceableTab>(tabs: T[], placements: TabPlacements, bar: BarId): T[] =>
    tabs
        .filter(tab => placementOf(placements, tab) === bar)
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
): string | null => {
    const held = tabsIn(tabs, placements, bar);
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

/** Top spans the app and center takes remaining width; their entries are unused. */
export const DEFAULT_BAR_WIDTH: Record<BarSide, number> = { top: 0, left: 220, center: 0, right: 300 };
