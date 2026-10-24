import React from 'react';
import { useToolBars } from './ToolBars-ctx';
import { BarSide, BarSpec, acceptsPlacement, barsOfSide, placementAfterClick } from './barsModel';
import { Tooltip } from '../ui/Tooltip';
import './ToolBars.css';

const GRID_ITEM_STYLE: React.CSSProperties = {
    height: 'auto',
    lineHeight: 'normal',
    padding: 8,
    cursor: 'default',
    backgroundColor: 'transparent',
};

export const layoutGridMenuItem = (tabId: string, key = `layout-grid-${tabId}`) => ({
    key,
    label: <LayoutGridCmp tabId={tabId} />,
    style: GRID_ITEM_STYLE,
});

const SIDE_TITLE: Record<BarSide, string> = {
    left: 'left column',
    center: 'central area',
    right: 'right column',
};

const titleOf = (spec: BarSpec, index: number, count: number): string =>
    count > 1 ? `${SIDE_TITLE[spec.side]} (${index + 1})` : SIDE_TITLE[spec.side];

/** The panel areas; clicking the current placement hides the panel. */
export const LayoutGridCmp: React.FC<{ tabId: string }> = ({ tabId }) => {
    const bars = useToolBars();
    const current = bars.placementOf(tabId);
    const tab = bars.tabs.find(t => t.id === tabId);

    const cell = (spec: BarSpec, index: number, count: number) => {
        const here = current === spec.id;
        const where = titleOf(spec, index, count);
        const allowed = !tab || acceptsPlacement(tab, spec.id, bars.centralCount);
        const rectangle = (
            <button
                type="button"
                className={`cms-layout-grid-cell${allowed ? '' : ' cms-layout-grid-cell-barred'}`}
                aria-pressed={here}
                disabled={!allowed}
                aria-label={allowed
                    ? (here ? `Hide from the ${where}` : `Move to the ${where}`)
                    : `Cannot go in the ${where}`}
                data-testid={`layout-cell-${tabId}-${spec.id}`}
                onClick={event => {
                    // Keep the menu open while choosing a placement.
                    event.stopPropagation();
                    bars.place(tabId, placementAfterClick(current, spec.id));
                }}
            />
        );
        return (
            <Tooltip
                key={spec.id}
                title={allowed ? (here ? 'Hide' : where) : `Does not go in the ${where}`}
            >
                {/* Disabled buttons need a wrapper to receive tooltip events. */}
                {allowed ? rectangle : <span style={{ display: 'flex', flex: 1 }}>{rectangle}</span>}
            </Tooltip>
        );
    };

    const column = (side: BarSide) => {
        const specs = barsOfSide(side, bars.centralCount);
        return (
            <div className="cms-layout-grid-column">
                {specs.map((spec, index) => cell(spec, index, specs.length))}
            </div>
        );
    };

    const centers = barsOfSide('center', bars.centralCount);

    return (
        <div
            className="cms-layout-grid"
            data-testid={`layout-grid-${tabId}`}
            data-placement={current}
            onClick={event => event.stopPropagation()}
        >
            {column('left')}
            <div className="cms-layout-grid-centers">
                {centers.map((spec, index) => cell(spec, index, centers.length))}
            </div>
            {column('right')}
        </div>
    );
};
