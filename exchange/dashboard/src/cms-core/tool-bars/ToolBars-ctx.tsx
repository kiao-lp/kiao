import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useFileViewState, useGlobalViewState } from 'src/cms-core/view-state';
import {
    BarId,
    BarSide,
    BarSpec,
    CentralCount,
    DEFAULT_BAR_WIDTH,
    OFF,
    Placement,
    TabPlacements,
    acceptsPlacement,
    activeTabIn,
    barToShowIn,
    clampBarWidth,
    normalizeCentralCount,
    placementOf,
    placementsAfterCentralCount,
    tabsIn,
} from './barsModel';

/** A panel offered by the app or by a plugin, drawn in whichever bar the document puts it in. */
export interface ToolBarTab {
    id: string;
    title: string;
    icon?: React.ReactNode;
    /**
     * Where the tab goes in a document nobody has arranged. Defaults to the right column; `OFF`
     * ships it out of the layout, listed by the Show menu until it is asked for.
     */
    defaultBar?: Placement;
    /** Handed the bar the tab is drawn in. */
    render: (bar: BarSpec) => React.ReactNode;
    /** Controls drawn on the right of the tab strip while this tab is active. */
    additionalPanels?: React.ReactNode;
    /** Panels are inset from the bar's edges. A tab drawing rows that are highlighted edge to
     *  edge — the navigation tree — opts out of the inset rather than of the rest. */
    flush?: boolean;
    /**
     * Render the pane even before its tab is first looked at. Set on the document: its content —
     * the editor, the stack followers — must be mounted whether the centre is showing it or not.
     * Any other tab mounts when it is first looked at, as in the columns.
     */
    forceRender?: boolean;
    /**
     * Set only on the tab that *is* the document: it stays in its default bar whatever the
     * arrangement says, leads the bar, and is never offered by the Show menu. See `barsModel`.
     */
    pinned?: boolean;
}

export interface ToolBarsValue {
    /** Every registered tab, in registration order. */
    tabs: ToolBarTab[];
    /** Where a tab is for the open document. */
    placementOf: (tabId: string) => Placement;
    /**
     * Move a tab to a bar, or take it out of the layout with `OFF`. Moving it to a hidden bar
     * reveals that bar.
     */
    place: (tabId: string, placement: Placement) => void;
    /**
     * Put a tab in front: back into the layout if it had been taken out, selected in its bar, and
     * its bar switched on. What a plugin calls when something it owns needs to be looked at.
     */
    showTab: (tabId: string) => void;
    tabsIn: (bar: BarId) => ToolBarTab[];
    /** The tab a bar is showing, or null when it holds none. */
    activeIn: (bar: BarId) => string | null;
    activate: (bar: BarId, tabId: string) => void;
    isSideOn: (side: BarSide) => boolean;
    toggleSide: (side: BarSide) => void;
    isBarOn: (bar: BarId) => boolean;
    toggleBar: (bar: BarId) => void;
    centralCount: CentralCount;
    setCentralCount: (count: CentralCount) => void;
    widthOf: (side: BarSide) => number;
    setWidth: (side: BarSide, width: number) => void;
    registerTab: (tab: ToolBarTab) => void;
    unregisterTab: (id: string) => void;
}

const ToolBarsContext = createContext<ToolBarsValue | null>(null);

export const useToolBars = (): ToolBarsValue => {
    const context = useContext(ToolBarsContext);
    if (!context) throw new Error('useToolBars must be used within a ToolBarsProvider');
    return context;
};

/** For a component that may or may not be rendered inside the layout — the top banner is one. */
export const useToolBarsOptional = (): ToolBarsValue | null => useContext(ToolBarsContext);

/** Registers a tab and keeps its definition current for as long as it is mounted. */
export const ToolBarTabRegistration: React.FC<{ tab: ToolBarTab }> = ({ tab }) => {
    const { registerTab, unregisterTab } = useToolBars();

    useEffect(() => {
        registerTab(tab);
    }, [registerTab, tab]);

    useEffect(() => () => unregisterTab(tab.id), [unregisterTab, tab.id]);

    return null;
};

/**
 * The tab registry and the arrangement of the bars.
 *
 * **Where a tab sits is remembered per document**, like every other thing the view state keeps: a
 * board wants its flow node panel, a unit wants the navigation tree, and neither should have to be
 * arranged again on the way back.
 *
 * Documents without an arrangement inherit the last arrangement chosen app-wide. Arranged
 * documents retain their own placements. Fresh installs use each tab's declared default.
 *
 * **Bar visibility, the central-area count and column widths are remembered app-wide only.** Those
 * describe the window rather than the document: a narrow screen wants the columns away whatever is
 * open in it.
 *
 * Nothing here is written by merely opening a document: the selected tab of a bar is derived (see
 * `activeTabIn`), and every write is a move the user made.
 */
export const ToolBarsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tabs, setTabs] = useState<ToolBarTab[]>([]);

    const [arrangement, setArrangement] = useFileViewState('toolBars', {
        placement: {} as TabPlacements,
        /** The tab chosen in each bar, when the user has chosen one. */
        selected: {} as Record<string, string | undefined>,
    });

    const [window_, setWindow] = useGlobalViewState('toolBars', {
        /**
         * Both side columns start hidden. The banner's left toggle reveals the file tree.
         */
        off: ['left', 'right'] as BarId[],
        width: {} as Record<string, number>,
        centralCount: 1 as CentralCount,
        /** The arrangement last chosen, which a document of its own inherits. */
        placement: {} as TabPlacements,
        selected: {} as Record<string, string | undefined>,
    });

    const centralCount = normalizeCentralCount(window_.centralCount);

    const registerTab = useCallback((tab: ToolBarTab) => {
        setTabs(prev => {
            const known = prev.some(t => t.id === tab.id);
            return known ? prev.map(t => (t.id === tab.id ? tab : t)) : [...prev, tab];
        });
    }, []);

    const unregisterTab = useCallback((id: string) => {
        setTabs(prev => prev.filter(t => t.id !== id));
    }, []);

    // The document's own arrangement over the one last chosen — see the note above.
    const placements = useMemo(
        () => ({ ...window_.placement, ...arrangement.placement }),
        [window_.placement, arrangement.placement],
    );
    const selected = useMemo(
        () => ({ ...window_.selected, ...arrangement.selected }),
        [window_.selected, arrangement.selected],
    );

    // Unregistered tabs use the layout's default placement.
    const placementFor = useCallback(
        (tabId: string) => placementOf(placements, tabs.find(t => t.id === tabId) ?? { id: tabId }, centralCount),
        [placements, tabs, centralCount],
    );

    const place = useCallback((tabId: string, placement: Placement) => {
        // A pinned tab is never moved — the Show menu does not offer it, and a call made by hand
        // is refused rather than written and ignored.
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.pinned) return;
        if (placement !== OFF && tab && !acceptsPlacement(tab, placement, centralCount)) return;
        setArrangement(prev => ({ placement: { ...prev.placement, [tabId]: placement } }));
        // Putting a panel somewhere is asking to see it there, so its bar comes on.
        // Taking it out of the layout is the opposite move and switches nothing on.
        setWindow(prev => ({
            ...prev,
            off: placement === OFF ? prev.off : prev.off.filter(bar => bar !== placement),
            placement: { ...prev.placement, [tabId]: placement },
        }));
    }, [setArrangement, setWindow, tabs, centralCount]);

    const setCentralCount = useCallback((count: CentralCount) => {
        const next = normalizeCentralCount(count);
        setArrangement(prev => ({ placement: placementsAfterCentralCount(prev.placement, next) }));
        setWindow(prev => ({
            ...prev,
            centralCount: next,
            placement: placementsAfterCentralCount(prev.placement, next),
        }));
    }, [setArrangement, setWindow]);

    const activate = useCallback((bar: BarId, tabId: string) => {
        setArrangement(prev => ({ selected: { ...prev.selected, [bar]: tabId } }));
        setWindow(prev => ({ ...prev, selected: { ...prev.selected, [bar]: tabId } }));
    }, [setArrangement, setWindow]);

    const toggleBar = useCallback((bar: BarId) => {
        setWindow(prev => ({
            ...prev,
            off: prev.off.includes(bar) ? prev.off.filter(id => id !== bar) : [...prev.off, bar],
        }));
    }, [setWindow]);

    const toggleSide = useCallback((side: BarSide) => {
        if (side !== 'center') toggleBar(side);
    }, [toggleBar]);

    const showTab = useCallback((tabId: string) => {
        const tab = tabs.find(t => t.id === tabId) ?? { id: tabId };
        const current = placementOf(placements, tab, centralCount);
        const bar = current === OFF ? barToShowIn(tab, centralCount) : current;
        if (!bar) return;
        setArrangement(prev => ({
            placement: current === OFF ? { ...prev.placement, [tabId]: bar } : prev.placement,
            selected: { ...prev.selected, [bar]: tabId },
        }));
        setWindow(prev => ({
            ...prev,
            off: prev.off.filter(id => id !== bar),
            placement: current === OFF ? { ...prev.placement, [tabId]: bar } : prev.placement,
            selected: { ...prev.selected, [bar]: tabId },
        }));
    }, [tabs, placements, setArrangement, setWindow, centralCount]);

    const widthOf = useCallback(
        (side: BarSide) => window_.width[side] ?? DEFAULT_BAR_WIDTH[side],
        [window_.width],
    );

    const setWidth = useCallback((side: BarSide, width: number) => {
        setWindow(prev => ({ ...prev, width: { ...prev.width, [side]: width } }));
    }, [setWindow]);

    // A width outlives the window it was chosen in — a browser moved to a smaller screen, or
    // squeezed narrower, would otherwise put the resize handle off the edge with nothing left to
    // grab to bring the column back.
    useEffect(() => {
        const clamp = () => {
            setWindow(prev => {
                const width = { ...prev.width };
                let changed = false;
                for (const side of ['left', 'right'] as BarSide[]) {
                    const stored = width[side];
                    if (stored === undefined) continue;
                    const clamped = clampBarWidth(stored, window.innerWidth);
                    if (clamped !== stored) { width[side] = clamped; changed = true; }
                }
                return changed ? { ...prev, width } : prev;
            });
        };
        clamp();
        window.addEventListener('resize', clamp);
        return () => window.removeEventListener('resize', clamp);
    }, [setWindow]);

    const activeIn = useCallback((bar: BarId) => {
        // A bar holding a pinned tab opens on it, unless the document chose another of its tabs:
        // a document that never chose in the centre opens on the document, not on whatever tab
        // was last looked at elsewhere — inheriting that would open files behind a panel.
        const held = tabsIn(tabs, placements, bar, centralCount);
        const pinned = held.find(tab => tab.pinned);
        if (pinned && arrangement.selected[bar] === undefined) return pinned.id;
        return activeTabIn(tabs, placements, selected, bar, centralCount);
    }, [tabs, placements, selected, arrangement.selected, centralCount]);

    const value = useMemo<ToolBarsValue>(() => ({
        tabs,
        placementOf: placementFor,
        place,
        showTab,
        tabsIn: (bar: BarId) => tabsIn(tabs, placements, bar, centralCount),
        activeIn,
        activate,
        isSideOn: (side: BarSide) => side === 'center' || !window_.off.includes(side),
        toggleSide,
        isBarOn: (bar: BarId) => !window_.off.includes(bar),
        toggleBar,
        centralCount,
        setCentralCount,
        widthOf,
        setWidth,
        registerTab,
        unregisterTab,
    }), [
        tabs, placements, placementFor, place, showTab, activeIn, activate,
        window_.off, toggleSide, toggleBar, centralCount, setCentralCount, widthOf, setWidth,
        registerTab, unregisterTab,
    ]);

    return <ToolBarsContext.Provider value={value}>{children}</ToolBarsContext.Provider>;
};
