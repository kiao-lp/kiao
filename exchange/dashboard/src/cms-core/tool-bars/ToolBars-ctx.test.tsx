import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from 'src/test/render';

/**
 * A faithful stand-in for the view state: one scope bag per document, one app-wide. Real enough to
 * answer the question this file is about — what a document that has never been arranged shows —
 * without the files client the real store loads itself from.
 */
const state = vi.hoisted(() => ({
    path: 'first.md',
    files: {} as Record<string, Record<string, any>>,
    global: {} as Record<string, any>,
}));

vi.mock('src/cms-core/view-state', async () => {
    const React = await import('react');
    const scoped = (bag: () => Record<string, any>, key: string, defaults: any) => {
        const [, bump] = React.useState(0);
        const defaultsRef = React.useRef(defaults);
        const value = { ...defaultsRef.current, ...(bag()[key] ?? {}) };
        // Stable, like the real hooks': an effect depending on the setter must not re-run every
        // render, which is a loop rather than a slow test.
        const update = React.useCallback((updater: any) => {
            const previous = { ...defaultsRef.current, ...(bag()[key] ?? {}) };
            const patch = typeof updater === 'function' ? updater(previous) : updater;
            const next = { ...previous, ...patch };
            if (JSON.stringify(next) === JSON.stringify(bag()[key])) return;
            bag()[key] = next;
            bump((n: number) => n + 1);
        }, []);
        return [value, update];
    };
    return {
        useFileViewState: (key: string, defaults: any) =>
            scoped(() => (state.files[state.path] ??= {}), key, defaults),
        useGlobalViewState: (key: string, fallback: any) => scoped(() => state.global, key, fallback),
    };
});

import { ToolBarTab, ToolBarTabRegistration, ToolBarsProvider, useToolBars } from './ToolBars-ctx';
import { ToolBarsSide } from './ToolBar-cmp';
import { LayoutGridCmp } from './LayoutGrid-cmp';

const tab = (id: string, defaultBar?: string, orientation?: ToolBarTab['orientation']): ToolBarTab => ({
    id,
    title: id,
    defaultBar,
    orientation,
    render: bar => <div data-testid={`panel-${id}`}>{bar.orientation}</div>,
});

const NAV = tab('files', 'top');
const GIT = tab('git');
const CLAUDE = tab('claude');
/** The document as `LayoutContent` registers it: pinned to the centre, leading it. */
const DOCUMENT: ToolBarTab = { ...tab('document', 'center'), pinned: true };

/** The file navigation as it is really registered: two tabs, one for each way of browsing. */
const NAV_BAR = tab('nav-bar', 'top', 'horizontal');
const NAV_TREE = tab('nav-tree', 'left', 'vertical');

/** The Show menu's rectangle for one tab and one bar. */
const rectangle = (tabId: string, bar: string) => screen.getByTestId(`layout-cell-${tabId}-${bar}`);

const ShowTabButton: React.FC<{ tabId: string }> = ({ tabId }) => {
    const bars = useToolBars();
    return <button data-testid={`reveal-${tabId}`} onClick={() => bars.showTab(tabId)}>reveal</button>;
};

/** Stands in for the banner's column switch, which is how a column that ships off is opened. */
const SideToggleButton: React.FC<{ side: 'left' | 'right' | 'center' }> = ({ side }) => {
    const bars = useToolBars();
    return <button data-testid={`toggle-${side}`} onClick={() => bars.toggleSide(side)}>toggle</button>;
};

/** A move no menu offers: the pinned tab, placed by hand. */
const PlaceProbe: React.FC<{ tabId: string; placement: string }> = ({ tabId, placement }) => {
    const bars = useToolBars();
    return <button
        data-testid={`place-${tabId}-${placement}`}
        onClick={() => bars.place(tabId, placement as 'left')}
    >place</button>;
};

const ActiveProbe: React.FC<{ bar: string }> = ({ bar }) => {
    const bars = useToolBars();
    return <div data-testid={`active-${bar}`}>{bars.activeIn(bar)}</div>;
};

const Harness: React.FC<{ tabs?: ToolBarTab[] }> = ({ tabs = [NAV, GIT, CLAUDE] }) => (
    <ToolBarsProvider>
        {tabs.map(t => <ToolBarTabRegistration key={t.id} tab={t} />)}
        <ToolBarsSide side="top" />
        <ToolBarsSide side="left" />
        <ToolBarsSide side="center" />
        <ToolBarsSide side="right" />
        {tabs.map(t => <LayoutGridCmp key={t.id} tabId={t.id} />)}
        <ShowTabButton tabId="git" />
        <ShowTabButton tabId="nav-tree" />
        <SideToggleButton side="left" />
        <SideToggleButton side="right" />
        <SideToggleButton side="center" />
        <PlaceProbe tabId="document" placement="left" />
        <ActiveProbe bar="center" />
    </ToolBarsProvider>
);

beforeEach(() => {
    state.path = 'first.md';
    state.files = {};
    state.global = {};
});

describe('the tool bars', () => {
    it('draws each tab where the document puts it, from the tab\'s own default', () => {
        render(<Harness />);

        // The navigation opens in the top bar, as it always did; the rest belong to the right
        // column, which starts switched off — so nothing of it is drawn.
        expect(screen.getByTestId('tool-bar-side-top')).toContainElement(screen.getByTestId('panel-files'));
        expect(screen.queryByTestId('tool-bar-side-right')).toBeNull();
        expect(screen.queryByTestId('tool-bar-side-left')).toBeNull();
    });

    it('tells a tab which way it is being laid out', () => {
        render(<Harness />);
        expect(screen.getByTestId('panel-files')).toHaveTextContent('horizontal');

        fireEvent.click(rectangle('files', 'left'));
        expect(screen.getByTestId('panel-files')).toHaveTextContent('vertical');
    });

    it('moves a tab to the rectangle that is clicked, and the bar it leaves goes with it', () => {
        render(<Harness />);

        fireEvent.click(rectangle('files', 'left'));

        expect(screen.getByTestId('tool-bar-side-left')).toContainElement(screen.getByTestId('panel-files'));
        expect(screen.queryByTestId('tool-bar-side-top')).toBeNull();
    });

    // Both columns ship switched off. Choosing a rectangle is asking to see the panel there, so
    // the move that would otherwise put it out of sight switches the column on with it.
    it('switches on the column a tab is moved into', () => {
        render(<Harness />);
        expect(screen.queryByTestId('tool-bar-side-right')).toBeNull();

        fireEvent.click(rectangle('files', 'right'));

        expect(screen.getByTestId('tool-bar-side-right')).toContainElement(screen.getByTestId('panel-files'));
    });

    it('greys the rectangle a tab is in, and that rectangle is what takes it away', () => {
        render(<Harness />);
        expect(rectangle('files', 'top')).toHaveAttribute('aria-pressed', 'true');
        expect(rectangle('files', 'left')).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(rectangle('files', 'top'));

        expect(screen.queryByTestId('panel-files')).toBeNull();
        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'off');
        // Out of the layout, no rectangle claims it.
        expect(rectangle('files', 'top')).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers the tab strip only from two tabs on, so one tab costs no room', () => {
        render(<Harness />);
        expect(screen.getByTestId('tool-bar-top')).toHaveClass('cms-tool-bar-single');

        fireEvent.click(rectangle('git', 'top'));

        expect(screen.getByTestId('tool-bar-top')).not.toHaveClass('cms-tool-bar-single');
    });

    it('brings a tab back and switches its column on when a plugin asks for it', () => {
        render(<Harness />);
        // Out of the layout, and in a column that is off — both have to be undone.
        fireEvent.click(rectangle('git', 'right'));
        expect(screen.getByTestId('layout-grid-git')).toHaveAttribute('data-placement', 'off');

        fireEvent.click(screen.getByTestId('reveal-git'));

        expect(screen.getByTestId('tool-bar-side-right')).toContainElement(screen.getByTestId('panel-git'));
    });
});

describe('a tab that draws itself only one way', () => {
    const both = <Harness tabs={[NAV_BAR, NAV_TREE]} />;

    // The whole point of the split: the line across the top and the tree down a column are two
    // tabs, so they are placed on their own and drawn at the same time.
    it('lets the file line and the file tree be shown together', () => {
        render(both);
        // The tree ships in the left column, which ships switched off, so the app opens as it
        // always did — the file line across the top and nothing down the sides.
        expect(screen.getByTestId('tool-bar-side-top')).toContainElement(screen.getByTestId('panel-nav-bar'));
        expect(screen.queryByTestId('panel-nav-tree')).toBeNull();

        // Which makes the banner's left switch the one that brings the tree up.
        fireEvent.click(screen.getByTestId('toggle-left'));

        expect(screen.getByTestId('tool-bar-side-top')).toContainElement(screen.getByTestId('panel-nav-bar'));
        expect(screen.getByTestId('tool-bar-side-left')).toContainElement(screen.getByTestId('panel-nav-tree'));
    });

    // The crosshair beside a link asks for the tree by name, from a document, with the column shut.
    it('opens the column the tree ships in when it is asked for by name', () => {
        render(both);

        fireEvent.click(screen.getByTestId('reveal-nav-tree'));

        expect(screen.getByTestId('tool-bar-side-left')).toContainElement(screen.getByTestId('panel-nav-tree'));
    });

    it('is offered only the rectangles it can be drawn in', () => {
        render(both);

        expect(rectangle('nav-bar', 'top')).toBeEnabled();
        expect(rectangle('nav-bar', 'left')).toBeDisabled();
        expect(rectangle('nav-bar', 'center')).toBeDisabled();
        expect(rectangle('nav-bar', 'right')).toBeDisabled();

        expect(rectangle('nav-tree', 'top')).toBeDisabled();
        expect(rectangle('nav-tree', 'left')).toBeEnabled();
        expect(rectangle('nav-tree', 'center')).toBeEnabled();
        expect(rectangle('nav-tree', 'right')).toBeEnabled();
    });

    it('moves between the two columns and stays a tree', () => {
        render(both);
        fireEvent.click(rectangle('nav-tree', 'right'));

        expect(screen.getByTestId('tool-bar-side-right')).toContainElement(screen.getByTestId('panel-nav-tree'));
        expect(screen.getByTestId('panel-nav-tree')).toHaveTextContent('vertical');
    });

    it('is taken out of the layout by its own rectangle, leaving the other alone', () => {
        render(both);
        fireEvent.click(screen.getByTestId('toggle-left'));

        fireEvent.click(rectangle('nav-tree', 'left'));

        expect(screen.queryByTestId('panel-nav-tree')).toBeNull();
        expect(screen.getByTestId('tool-bar-side-top')).toContainElement(screen.getByTestId('panel-nav-bar'));
    });
});

describe('what a document remembers', () => {
    // Clicking a file in the navigation tree opens a document nobody has arranged. If that fell
    // back to the tab's shipped default, the tree would take itself away on every click.
    it('gives a document nobody has arranged the arrangement last chosen', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(rectangle('files', 'left'));

        state.path = 'never-seen.md';
        rerender(<Harness />);

        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'left');
    });

    it('gives a document that has been arranged its own, whatever is done elsewhere', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(rectangle('files', 'left'));

        state.path = 'own.md';
        rerender(<Harness />);
        fireEvent.click(rectangle('files', 'top'));

        state.path = 'first.md';
        rerender(<Harness />);
        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'left');

        state.path = 'own.md';
        rerender(<Harness />);
        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'top');
    });

    it('writes nothing for a document that was only opened', () => {
        render(<Harness />);
        expect(state.files['first.md']?.toolBars).toBeUndefined();
    });
});

describe('the centre', () => {
    // Registered last on purpose: the document leads the centre however late it registered. A new
    // element every time — rerendering the same one is a no-op React bails out of.
    const withDocument = () => <Harness tabs={[GIT, DOCUMENT]} />;

    it('draws the document alone with no tab strip, like every bar holding one tab', () => {
        render(withDocument());

        expect(screen.getByTestId('tool-bar-side-center'))
            .toContainElement(screen.getByTestId('panel-document'));
        expect(screen.getByTestId('tool-bar-center')).toHaveClass('cms-tool-bar-single');
    });

    it('takes any tab a column takes, and the document leads the strip', () => {
        render(withDocument());

        fireEvent.click(rectangle('git', 'center'));

        const bar = screen.getByTestId('tool-bar-center');
        expect(bar).not.toHaveClass('cms-tool-bar-single');
        const labels = [...bar.querySelectorAll('.ant-tabs-tab [aria-label]')]
            .map(el => el.getAttribute('aria-label'));
        expect(labels).toEqual(['document', 'git']);
        // A tab mounts when it is first looked at, as in the columns — the strip above is what
        // says it is there before that.
        expect(bar).toContainElement(screen.getByTestId('panel-document'));
        expect(screen.queryByTestId('panel-git')).toBeNull();

        fireEvent.click(bar.querySelectorAll('.ant-tabs-tab')[1]);

        expect(bar).toContainElement(screen.getByTestId('panel-git'));
    });

    it('refuses to move the pinned tab, even by hand', () => {
        render(withDocument());

        fireEvent.click(screen.getByTestId('place-document-left'));

        expect(screen.getByTestId('layout-grid-document')).toHaveAttribute('data-placement', 'center');
        expect(screen.getByTestId('tool-bar-side-center'))
            .toContainElement(screen.getByTestId('panel-document'));
        expect(screen.queryByTestId('tool-bar-side-left')).toBeNull();
    });

    it('is never switched off', () => {
        render(withDocument());

        fireEvent.click(screen.getByTestId('toggle-center'));

        expect(screen.getByTestId('tool-bar-side-center'))
            .toContainElement(screen.getByTestId('panel-document'));
    });

    // Inheriting the tab last looked at would open files behind a panel, so a document that never
    // chose in the centre opens on the document — while one that chose keeps its own.
    it('opens a document that never chose in the centre on the document', () => {
        const { rerender } = render(withDocument());
        fireEvent.click(rectangle('git', 'center'));
        fireEvent.click(screen.getByTestId('tool-bar-center').querySelectorAll('.ant-tabs-tab')[1]);
        expect(screen.getByTestId('active-center')).toHaveTextContent('git');

        state.path = 'never-seen.md';
        rerender(withDocument());
        expect(screen.getByTestId('active-center')).toHaveTextContent('document');

        state.path = 'first.md';
        rerender(withDocument());
        expect(screen.getByTestId('active-center')).toHaveTextContent('git');
    });
});
