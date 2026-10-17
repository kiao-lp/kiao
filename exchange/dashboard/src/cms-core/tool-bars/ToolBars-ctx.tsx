import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFileViewState, useGlobalViewState } from 'src/cms-core/view-state';
import {
    BarId,
    BarOrientation,
    BarSide,
    BarSpec,
    DEFAULT_BAR_WIDTH,
    OFF,
    Placement,
    TabPlacements,
    activeTabIn,
    barSpec,
    barToShowIn,
    clampBarWidth,
    placementOf,
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
    /**
     * The one way this tab draws itself, when it only draws itself one way — and so the only kind
     * of bar it may be put in. The file navigation is two tabs for exactly this reason: the line
     * of entries is horizontal and the tree is vertical, and neither is the other laid sideways.
     * A tab that names none goes in any bar.
     */
    orientation?: BarOrientation;
    /** Handed the bar it is being drawn in, so a tab that goes in either can lay itself out
     *  along it. */
    render: (bar: BarSpec) => React.ReactNode;
    /** Panels are inset from the bar's edges. A tab drawing rows that are highlighted edge to
     *  edge — the navigation tree — opts out of the inset rather than of the rest. */
    flush?: boolean;
    /**
     * Render the pane even before its tab is first looked at. Set on the document: its content —
     * the editor, the scroll memory, the stack followers — must be mounted whether the centre is
     * showing it or not. Any other tab mounts when it is first looked at, as in the columns.
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
     * Move a tab to a bar, or take it out of the layout with `OFF`. A bar in a column that is
     * switched off switches it on: the move was made to see the panel there.
     */
    place: (tabId: string, placement: Placement) => void;
    /**
     * Put a tab in front: back into the layout if it had been taken out, selected in its bar, and
     * its side switched on. What a plugin calls when something it owns needs to be looked at.
     */
    showTab: (tabId: string) => void;
    tabsIn: (bar: BarId) => ToolBarTab[];
    /** The tab a bar is showing, or null when it holds none. */
    activeIn: (bar: BarId) => string | null;
    activate: (bar: BarId, tabId: string) => void;
    isSideOn: (side: BarSide) => boolean;
    toggleSide: (side: BarSide) => void;
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

/** Registers one declarative tab for as long as it is mounted. */
export const ToolBarTabRegistration: React.FC<{ tab: ToolBarTab }> = ({ tab }) => {
    const bars = useToolBars();
    const barsRef = useRef(bars);
    barsRef.current = bars;
    const tabRef = useRef(tab);
    tabRef.current = tab;

    useEffect(() => {
        const registered = tabRef.current;
        barsRef.current.registerTab(registered);
        return () => barsRef.current.unregisterTab(registered.id);
    }, [tab.id]);

    return null;
};

/**
 * The tab registry and the arrangement of the bars.
 *
 * **Where a tab sits is remembered per document**, like every other thing the view state keeps: a
 * board wants its flow node panel, a unit wants the navigation tree, and neither should have to be
 * arranged again on the way back.
 *
 * **A document that has never been arranged inherits the arrangement last chosen**, which is
 * written app-wide alongside the document's own. Without that, clicking a file in the navigation
 * tree would take the tree away — the document opened has no arrangement of its own, and the tab
 * would fall back to the top bar it ships in. So moving a tab both pins it for the open document
 * and becomes what every document nobody has arranged shows; a document that *has* been arranged
 * keeps its own whatever is done elsewhere. The tab's declared default is the last word, for the
 * first arrangement of a fresh install.
 *
 * **Whether a side is switched on, and how wide a column is, is remembered app-wide only.** Those
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
         * The sides switched off. The right column starts away, as the side panel always did, and
         * so does the left — the navigation tree ships in it, and the app has always opened on the
         * document with the file line across the top and nothing down the sides. The left toggle
         * of the banner is therefore what brings the tree up.
         */
        off: ['left', 'right'] as BarSide[],
        width: {} as Record<string, number>,
        /** The arrangement last chosen, which a document of its own inherits. */
        placement: {} as TabPlacements,
        selected: {} as Record<string, string | undefined>,
    });

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

    // The registered tab itself, so `placementOf` reads its orientation as well as its default —
    // an unregistered id is a tab with no say, which is what the bare id stands for.
    const placementFor = useCallback(
        (tabId: string) => placementOf(placements, tabs.find(t => t.id === tabId) ?? { id: tabId }),
        [placements, tabs],
    );

    const place = useCallback((tabId: string, placement: Placement) => {
        // A pinned tab is never moved — the Show menu does not offer it, and a call made by hand
        // is refused rather than written and ignored.
        if (tabs.find(t => t.id === tabId)?.pinned) return;
        setArrangement(prev => ({ placement: { ...prev.placement, [tabId]: placement } }));
        // Putting a panel somewhere is asking to see it there, so the side it lands on comes on.
        // Taking it out of the layout is the opposite move and switches nothing on.
        const side = placement === OFF ? undefined : barSpec(placement)?.side;
        setWindow(prev => ({
            ...prev,
            off: side ? prev.off.filter(s => s !== side) : prev.off,
            placement: { ...prev.placement, [tabId]: placement },
        }));
    }, [setArrangement, setWindow, tabs]);

    const activate = useCallback((bar: BarId, tabId: string) => {
        setArrangement(prev => ({ selected: { ...prev.selected, [bar]: tabId } }));
        setWindow(prev => ({ ...prev, selected: { ...prev.selected, [bar]: tabId } }));
    }, [setArrangement, setWindow]);

    const toggleSide = useCallback((side: BarSide) => {
        // The centre is never switched off: it holds the document, which is always displayed.
        if (side === 'center') return;
        setWindow(prev => ({
            ...prev,
            off: prev.off.includes(side) ? prev.off.filter(s => s !== side) : [...prev.off, side],
        }));
    }, [setWindow]);

    const showTab = useCallback((tabId: string) => {
        const tab = tabs.find(t => t.id === tabId) ?? { id: tabId };
        const current = placementOf(placements, tab);
        const bar = current === OFF ? barToShowIn(tab) : current;
        if (!bar) return;
        setArrangement(prev => ({
            placement: current === OFF ? { ...prev.placement, [tabId]: bar } : prev.placement,
            selected: { ...prev.selected, [bar]: tabId },
        }));
        const side = barSpec(bar)?.side;
        setWindow(prev => ({
            ...prev,
            off: side ? prev.off.filter(s => s !== side) : prev.off,
            placement: current === OFF ? { ...prev.placement, [tabId]: bar } : prev.placement,
            selected: { ...prev.selected, [bar]: tabId },
        }));
    }, [tabs, placements, setArrangement, setWindow]);

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
        const held = tabsIn(tabs, placements, bar);
        const pinned = held.find(tab => tab.pinned);
        if (pinned && arrangement.selected[bar] === undefined) return pinned.id;
        return activeTabIn(tabs, placements, selected, bar);
    }, [tabs, placements, selected, arrangement.selected]);

    const value = useMemo<ToolBarsValue>(() => ({
        tabs,
        placementOf: placementFor,
        place,
        showTab,
        tabsIn: (bar: BarId) => tabsIn(tabs, placements, bar),
        activeIn,
        activate,
        isSideOn: (side: BarSide) => side === 'center' || !window_.off.includes(side),
        toggleSide,
        widthOf,
        setWidth,
        registerTab,
        unregisterTab,
    }), [
        tabs, placements, placementFor, place, showTab, activeIn, activate,
        window_.off, toggleSide, widthOf, setWidth, registerTab, unregisterTab,
    ]);

    return <ToolBarsContext.Provider value={value}>{children}</ToolBarsContext.Provider>;
};
