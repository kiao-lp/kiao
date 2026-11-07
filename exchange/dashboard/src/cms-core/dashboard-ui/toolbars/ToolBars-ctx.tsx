import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFileViewState, useGlobalViewState } from 'src/cms-core/view-state';
import {
    BarId,
    BarSide,
    BarSpec,
    CENTER_BAR_ID,
    DEFAULT_BAR_WIDTH,
    OFF,
    Placement,
    TabPlacements,
    acceptsPlacement,
    activeTabIn,
    barToShowIn,
    clampBarWidth,
    isCenterBar,
    placementOf,
    placementsWithoutSecondCentralArea,
    tabsIn,
} from './barsModel';

/** A panel offered by the app or by a plugin, drawn in whichever bar the document puts it in. */
export interface ToolBarTab {
    id: string;
    title: string;
    icon?: React.ReactNode;
    /** Default placement; `OFF` lists the tab in the Show menu only. */
    defaultBar?: Placement;
    /** Handed the bar the tab is drawn in. */
    render: (bar: BarSpec) => React.ReactNode;
    /** Controls drawn on the right of the tab strip while this tab is active. */
    additionalPanels?: React.ReactNode;
    /** Opts out of the bar inset for edge-to-edge rows. */
    flush?: boolean;
    /** Mounts before first view; set on the document tab. */
    forceRender?: boolean;
    /** Document tab only: fixed to its bar, leads it, hidden from the Show menu. */
    pinned?: boolean;
}

export interface ToolBarsValue {
    /** Every registered tab, in registration order. */
    tabs: ToolBarTab[];
    /** Where a tab is for the open document. */
    placementOf: (tabId: string) => Placement;
    /** Moves a tab; moving to a hidden bar reveals it. */
    place: (tabId: string, placement: Placement) => void;
    /** Restores, selects, and reveals the tab's bar. */
    showTab: (tabId: string) => void;
    tabsIn: (bar: BarId) => ToolBarTab[];
    /** The tab a bar is showing, or null when it holds none. */
    activeIn: (bar: BarId) => string | null;
    /** Active tab in the last central area used, falling back to the first area. */
    activeCentralTab: () => string | null;
    focusBar: (bar: BarId) => void;
    activate: (bar: BarId, tabId: string) => void;
    isSideOn: (side: BarSide) => boolean;
    toggleSide: (side: BarSide) => void;
    /** The second central area exists, and is therefore visible. */
    secondCentralArea: boolean;
    /** Switching the second area off moves its panels to the first area. */
    setSecondCentralArea: (second: boolean) => void;
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

/** Placements persist per document; side visibility and widths persist app-wide. Opening writes nothing. */
export const ToolBarsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [tabs, setTabs] = useState<ToolBarTab[]>([]);
    const focusedCentralBar = useRef(CENTER_BAR_ID);
    const focusBar = useCallback((bar: BarId) => {
        if (isCenterBar(bar)) focusedCentralBar.current = bar;
    }, []);

    const [arrangement, setArrangement] = useFileViewState('toolBars', {
        placement: {} as TabPlacements,
        /** The tab chosen in each bar, when the user has chosen one. */
        selected: {} as Record<string, string | undefined>,
    });

    const [window_, setWindow] = useGlobalViewState('toolBars', {
        /** Both side columns start hidden. */
        off: ['left', 'right'] as BarId[],
        width: {} as Record<string, number>,
        secondCentralArea: false,
        /** The arrangement last chosen, which a document of its own inherits. */
        placement: {} as TabPlacements,
        selected: {} as Record<string, string | undefined>,
    });

    const secondCentralArea = window_.secondCentralArea === true;

    const registerTab = useCallback((tab: ToolBarTab) => {
        setTabs(prev => {
            const known = prev.some(t => t.id === tab.id);
            return known ? prev.map(t => (t.id === tab.id ? tab : t)) : [...prev, tab];
        });
    }, []);

    const unregisterTab = useCallback((id: string) => {
        setTabs(prev => prev.filter(t => t.id !== id));
    }, []);

    // Document arrangement overrides the app-wide last choice.
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
        (tabId: string) => placementOf(placements, tabs.find(t => t.id === tabId) ?? { id: tabId }, secondCentralArea),
        [placements, tabs, secondCentralArea],
    );

    const place = useCallback((tabId: string, placement: Placement) => {
        // Pinned tabs refuse moves.
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.pinned) return;
        if (placement !== OFF && tab && !acceptsPlacement(tab, placement, secondCentralArea)) return;
        setArrangement(prev => ({ placement: { ...prev.placement, [tabId]: placement } }));
        // Placing reveals the bar; removing reveals nothing.
        setWindow(prev => ({
            ...prev,
            off: placement === OFF ? prev.off : prev.off.filter(bar => bar !== placement),
            placement: { ...prev.placement, [tabId]: placement },
        }));
    }, [setArrangement, setWindow, tabs, secondCentralArea]);

    const setSecondCentralArea = useCallback((second: boolean) => {
        if (second) {
            setWindow(prev => ({ ...prev, secondCentralArea: true }));
            return;
        }
        setArrangement(prev => ({ placement: placementsWithoutSecondCentralArea(prev.placement) }));
        setWindow(prev => ({
            ...prev,
            secondCentralArea: false,
            placement: placementsWithoutSecondCentralArea(prev.placement),
        }));
    }, [setArrangement, setWindow]);

    const activate = useCallback((bar: BarId, tabId: string) => {
        focusBar(bar);
        setArrangement(prev => ({ selected: { ...prev.selected, [bar]: tabId } }));
        setWindow(prev => ({ ...prev, selected: { ...prev.selected, [bar]: tabId } }));
    }, [setArrangement, setWindow, focusBar]);

    const toggleSide = useCallback((side: BarSide) => {
        if (side === 'center') return;
        setWindow(prev => ({
            ...prev,
            off: prev.off.includes(side) ? prev.off.filter(id => id !== side) : [...prev.off, side],
        }));
    }, [setWindow]);

    const showTab = useCallback((tabId: string) => {
        const tab = tabs.find(t => t.id === tabId) ?? { id: tabId };
        const current = placementOf(placements, tab, secondCentralArea);
        const bar = current === OFF ? barToShowIn(tab, secondCentralArea) : current;
        if (!bar) return;
        focusBar(bar);
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
    }, [tabs, placements, setArrangement, setWindow, secondCentralArea, focusBar]);

    const widthOf = useCallback(
        (side: BarSide) => window_.width[side] ?? DEFAULT_BAR_WIDTH[side],
        [window_.width],
    );

    const setWidth = useCallback((side: BarSide, width: number) => {
        setWindow(prev => ({ ...prev, width: { ...prev.width, [side]: width } }));
    }, [setWindow]);

    // Clamp stored widths so the resize handle stays reachable.
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
        // Pinned tab wins unless the document chose another tab in this bar.
        const held = tabsIn(tabs, placements, bar, secondCentralArea);
        const pinned = held.find(tab => tab.pinned);
        if (pinned && arrangement.selected[bar] === undefined) return pinned.id;
        return activeTabIn(tabs, placements, selected, bar, secondCentralArea);
    }, [tabs, placements, selected, arrangement.selected, secondCentralArea]);

    const activeCentralTab = useCallback(() => {
        const bar = secondCentralArea ? focusedCentralBar.current : CENTER_BAR_ID;
        return activeIn(bar) ?? activeIn(CENTER_BAR_ID);
    }, [activeIn, secondCentralArea]);

    const value = useMemo<ToolBarsValue>(() => ({
        tabs,
        placementOf: placementFor,
        place,
        showTab,
        tabsIn: (bar: BarId) => tabsIn(tabs, placements, bar, secondCentralArea),
        activeIn,
        activeCentralTab,
        focusBar,
        activate,
        isSideOn: (side: BarSide) => side === 'center' || !window_.off.includes(side),
        toggleSide,
        secondCentralArea,
        setSecondCentralArea,
        widthOf,
        setWidth,
        registerTab,
        unregisterTab,
    }), [
        tabs, placements, placementFor, place, showTab, activeIn, activeCentralTab, focusBar, activate,
        window_.off, toggleSide, secondCentralArea, setSecondCentralArea, widthOf, setWidth,
        registerTab, unregisterTab,
    ]);

    return <ToolBarsContext.Provider value={value}>{children}</ToolBarsContext.Provider>;
};
