import React, { useCallback, useRef } from 'react';
import { Tabs } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { useToolBarsOptional } from './ToolBars-ctx';
import { BarSide, BarSpec, barsOfSide, clampBarWidth } from './barsModel';
import '../ui/ResizeHandle.css';
import './ToolBars.css';

/**
 * One bar: the tabs the document has put in it, with a strip to switch between them.
 *
 * The strip only appears from two tabs on. One tab needs no chooser, and a bar holding the file
 * navigation alone is the whole width of the app — the row of icons would be a line of the screen
 * spent saying which of one panel is showing.
 */
const ToolBar: React.FC<{ spec: BarSpec }> = ({ spec }) => {
    const bars = useToolBarsOptional();
    if (!bars) return null;

    const held = bars.tabsIn(spec.id);
    if (held.length === 0) return null;

    const active = bars.activeIn(spec.id);

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
            className={`cms-tool-bar${held.length > 1 ? '' : ' cms-tool-bar-single'}`}
            data-testid={`tool-bar-${spec.id}`}
        >
            <Tabs
                activeKey={active ?? undefined}
                onChange={tabId => bars.activate(spec.id, tabId)}
                items={items}
                size="small"
            />
        </div>
    );
};

/**
 * A side of the layout: its bars, stacked, and — for a side column — the handle that widens them
 * and the width they share. The width belongs to the side rather than to a bar because a column
 * split in two is still one column. The centre takes whatever width the columns leave, so it has
 * neither width nor handle of its own.
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

    const specs = barsOfSide(side).filter(spec => bars.tabsIn(spec.id).length > 0);
    if (specs.length === 0) return null;

    const resizable = side === 'left' || side === 'right';
    const handle = resizable
        ? (
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
        )
        : null;

    return (
        <div
            className={`cms-tool-bar-side cms-tool-bar-side-${side}`}
            style={resizable ? { width: bars.widthOf(side), minWidth: bars.widthOf(side) } : undefined}
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
