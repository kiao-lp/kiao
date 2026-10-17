import React from 'react';
import { useToolBars } from './ToolBars-ctx';
import { BarSide, BarSpec, acceptsPlacement, barsOfSide, placementAfterClick } from './barsModel';
import { Tooltip } from '../ui/Tooltip';
import './ToolBars.css';

const SIDE_TITLE: Record<BarSide, string> = {
    top: 'top bar',
    left: 'left column',
    center: 'central area',
    right: 'right column',
};

const titleOf = (spec: BarSpec, index: number, count: number): string =>
    count > 1 ? `${SIDE_TITLE[spec.side]} (${index + 1})` : SIDE_TITLE[spec.side];

/**
 * The picture of Dashboard a tab is moved around in: the top bar over three columns, the middle one
 * the central area, which holds the document and any tab put beside it.
 *
 * The rectangle the tab is in is greyed, and clicking *that* one is what takes the tab out of the
 * layout — a panel is dismissed where it is shown, so there is no fifth rectangle standing for
 * nowhere. Clicking any other moves it there, bringing it back into the layout if it had been
 * taken out. A side holding several bars draws one rectangle each, stacked in its column.
 *
 * A tab that draws itself only one way is offered only the bars laid out that way: the file line is
 * a top bar and the file tree is a column, and a rectangle that cannot be clicked is drawn faint and
 * disabled rather than left out, so the picture stays the picture of the app.
 */
export const LayoutGridCmp: React.FC<{ tabId: string }> = ({ tabId }) => {
    const bars = useToolBars();
    const current = bars.placementOf(tabId);
    const tab = bars.tabs.find(t => t.id === tabId);

    const cell = (spec: BarSpec, index: number, count: number) => {
        const here = current === spec.id;
        const where = titleOf(spec, index, count);
        const allowed = !tab || acceptsPlacement(tab, spec.id);
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
                    // The grid lives inside a menu item: a click on a rectangle is not a click on
                    // the entry, and must not close the menu the next rectangle is chosen from.
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
                {/* A disabled button fires no mouse events, so the tooltip explaining the
                    barring would never open on it directly. The span carries the hover — and
                    the flex, so the barred rectangle keeps its size in the row. */}
                {allowed ? rectangle : <span style={{ display: 'flex', flex: 1 }}>{rectangle}</span>}
            </Tooltip>
        );
    };

    const column = (side: BarSide) => {
        const specs = barsOfSide(side);
        return (
            <div className={`cms-layout-grid-column cms-layout-grid-column-${side}`}>
                {specs.map((spec, index) => cell(spec, index, specs.length))}
            </div>
        );
    };

    const top = barsOfSide('top');

    return (
        <div
            className="cms-layout-grid"
            data-testid={`layout-grid-${tabId}`}
            data-placement={current}
            onClick={event => event.stopPropagation()}
        >
            <div className="cms-layout-grid-top">
                {top.map((spec, index) => cell(spec, index, top.length))}
            </div>
            <div className="cms-layout-grid-row">
                {column('left')}
                {column('center')}
                {column('right')}
            </div>
        </div>
    );
};
