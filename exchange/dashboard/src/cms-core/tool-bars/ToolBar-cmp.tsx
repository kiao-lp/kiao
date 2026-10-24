import React, { useCallback, useRef } from 'react';
import { Dropdown, Tabs } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { useToolBarsOptional } from './ToolBars-ctx';
import { layoutGridMenuItem } from './LayoutGrid-cmp';
import { BarSide, BarSpec, barsOfSide, clampBarWidth } from './barsModel';
import { SplitPart, SplitRow } from '../split';
import { DOCUMENT_TAB_ID, useDocumentContentOptional } from '../core/DocumentContent-ctx';
import { KEEP_MENU_IN_VIEWPORT } from '../files/context-menu/menuPlacement';
import '../ui/ResizeHandle.css';
import './ToolBars.css';

/**
 * One bar: the tabs the document has put in it, with a strip to switch between them.
 *
 * The strip appears for multiple tabs or controls belonging to the active tab.
 */
const ToolBar: React.FC<{ spec: BarSpec }> = ({ spec }) => {
    const bars = useToolBarsOptional();
    const documentContent = useDocumentContentOptional();
    if (!bars) return null;

    const held = bars.tabsIn(spec.id);
    if (held.length === 0) return null;

    const active = bars.activeIn(spec.id);
    const additionalPanels = active === DOCUMENT_TAB_ID && documentContent
        ? documentContent.additionalPanels
        : held.find(tab => tab.id === active)?.additionalPanels;
    const showStrip = held.length > 1 || !!additionalPanels;

    const items = held.map(tab => ({
        key: tab.id,
        className: tab.flush ? 'cms-tool-bar-pane-flush' : undefined,
        forceRender: tab.forceRender,
        label: (
            <Tooltip title={tab.title} placement="bottom">
                <span aria-label={tab.title}>{tab.icon ?? tab.title}</span>
            </Tooltip>
        ),
        children: tab.render(spec),
    }));

    return (
        <div
            className={`cms-tool-bar${showStrip ? '' : ' cms-tool-bar-single'}`}
            data-testid={`tool-bar-${spec.id}`}
        >
            <Tabs
                activeKey={active ?? undefined}
                onChange={tabId => bars.activate(spec.id, tabId)}
                items={items}
                size="small"
                renderTabBar={(props, DefaultTabBar) => (
                    <DefaultTabBar {...props}>
                        {node => {
                            const tab = held.find(tab => tab.id === node.key);
                            if (!tab || tab.pinned) return node;
                            return (
                                <Dropdown
                                    key={tab.id}
                                    trigger={['contextMenu']}
                                    menu={{ items: [layoutGridMenuItem(tab.id)] }}
                                    {...KEEP_MENU_IN_VIEWPORT}
                                >
                                    {node}
                                </Dropdown>
                            );
                        }}
                    </DefaultTabBar>
                )}
                tabBarExtraContent={additionalPanels && (
                    <div className="cms-tool-bar-controls">{additionalPanels}</div>
                )}
            />
        </div>
    );
};

/**
 * A side of the layout: its bars, stacked. Side columns share one width and one handle.
 * The centre takes the remaining width. Split centres share it by proportion.
 */
export const ToolBarsSide: React.FC<{ side: BarSide }> = ({ side }) => {
    const bars = useToolBarsOptional();

    // Where the drag started, held in a ref: the moves that read it set the width, they are not
    // themselves renders.
    const held = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

    const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!bars) return;
        e.preventDefault();
        // Captured on the strip, so the drag survives the pointer leaving it — which, on a column
        // edge a finger covers whole, it does immediately. Defensive: jsdom has no capture.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        held.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: bars.widthOf(side) };
    }, [bars, side]);

    const onDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const drag = held.current;
        // A second finger put down elsewhere on the screen is not this drag.
        if (!bars || !drag || drag.pointerId !== e.pointerId) return;
        // Both handles are on the edge facing the document, so dragging towards it widens.
        const direction = side === 'left' ? 1 : -1;
        const dragged = drag.startWidth + direction * (e.clientX - drag.startX);
        bars.setWidth(side, clampBarWidth(dragged, window.innerWidth));
    }, [bars, side]);

    const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (held.current?.pointerId !== e.pointerId) return;
        held.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }, []);

    if (!bars || !bars.isSideOn(side)) return null;

    if (side === 'center') {
        const parts: SplitPart[] = barsOfSide('center', bars.centralCount).map(spec => ({
            name: spec.id,
            className: 'cms-tool-bar-center-area',
            children: bars.tabsIn(spec.id).length > 0
                ? <ToolBar spec={spec} />
                : <div className="cms-tool-bar-empty" data-testid={`tool-bar-${spec.id}`} />,
        }));
        return (
            <div
                className="cms-tool-bar-side cms-tool-bar-side-center"
                data-testid="tool-bar-side-center"
            >
                <SplitRow id="centralAreas" className="cms-tool-bar-centers" parts={parts} />
            </div>
        );
    }

    const specs = barsOfSide(side, bars.centralCount).filter(spec => bars.tabsIn(spec.id).length > 0);
    if (specs.length === 0) return null;

    const handle = (
        <div
            className="cms-resize-handle cms-tool-bar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-testid={`tool-bar-resize-${side}`}
        />
    );

    return (
        <div
            className={`cms-tool-bar-side cms-tool-bar-side-${side}`}
            style={{ width: bars.widthOf(side), minWidth: bars.widthOf(side) }}
            data-testid={`tool-bar-side-${side}`}
        >
            {side === 'right' && handle}
            <div className="cms-tool-bar-stack">
                {specs.map(spec => <ToolBar key={spec.id} spec={spec} />)}
            </div>
            {side === 'left' && handle}
        </div>
    );
};
