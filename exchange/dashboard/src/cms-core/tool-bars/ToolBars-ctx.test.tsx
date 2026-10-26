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
import { BarToggle } from '../top-banner/BarToggle';

const tab = (id: string, defaultBar?: string): ToolBarTab => ({
    id,
    title: id,
    defaultBar,
    render: bar => <div data-testid={`panel-${id}`}>{bar.side}</div>,
});

const NAV = tab('files', 'left');
const GIT = tab('git');
const CLAUDE = tab('claude');
/** The document as `LayoutContent` registers it: pinned to the centre, leading it. */
const DOCUMENT: ToolBarTab = { ...tab('document', 'center'), pinned: true };

const NAV_TREE = tab('nav-tree', 'left');

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
        onClick={() => bars.place(tabId, placement)}
    >place</button>;
};

const ActiveProbe: React.FC<{ bar: string }> = ({ bar }) => {
    const bars = useToolBars();
    return <div data-testid={`active-${bar}`}>{bars.activeIn(bar)}</div>;
};

const pointer = (type: string, target: Element, clientX: number, pointerId = 1) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    fireEvent(target, event);
};

const sized = (element: Element, width: number) => {
    element.getBoundingClientRect = () => ({
        width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
};

const CentralCountButton: React.FC<{ count: 1 | 2 | 3 }> = ({ count }) => {
    const bars = useToolBars();
    return <button data-testid={`central-count-${count}`} onClick={() => bars.setCentralCount(count)}>count</button>;
};

const Harness: React.FC<{ tabs?: ToolBarTab[] }> = ({ tabs = [NAV, GIT, CLAUDE] }) => (
    <ToolBarsProvider>
        {tabs.map(t => <ToolBarTabRegistration key={t.id} tab={t} />)}
        <ToolBarsSide side="left" />
        <ToolBarsSide side="center" />
        <ToolBarsSide side="right" />
        {tabs.map(t => <LayoutGridCmp key={t.id} tabId={t.id} />)}
        <ShowTabButton tabId="git" />
        <ShowTabButton tabId="nav-tree" />
        <ShowTabButton tabId="document" />
        <BarToggle bar="center" />
        <BarToggle bar="center-2" />
        <SideToggleButton side="left" />
        <SideToggleButton side="right" />
        <SideToggleButton side="center" />
        <PlaceProbe tabId="document" placement="left" />
        <ActiveProbe bar="center" />
        <CentralCountButton count={1} />
        <CentralCountButton count={2} />
        <CentralCountButton count={3} />
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

        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'left');
        expect(screen.queryByTestId('tool-bar-side-right')).toBeNull();
        expect(screen.queryByTestId('tool-bar-side-left')).toBeNull();

        fireEvent.click(screen.getByTestId('toggle-left'));

        expect(screen.getByTestId('tool-bar-side-left')).toContainElement(screen.getByTestId('panel-files'));
    });

    it('tells a tab which side it is drawn in', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('toggle-left'));
        expect(screen.getByTestId('panel-files')).toHaveTextContent('left');

        fireEvent.click(rectangle('files', 'right'));
        expect(screen.getByTestId('panel-files')).toHaveTextContent('right');
    });

    it('moves a tab to the rectangle that is clicked, and the bar it leaves goes with it', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('toggle-left'));

        fireEvent.click(rectangle('files', 'right'));

        expect(screen.getByTestId('tool-bar-side-right')).toContainElement(screen.getByTestId('panel-files'));
        expect(screen.queryByTestId('tool-bar-side-left')).toBeNull();
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
        expect(rectangle('files', 'left')).toHaveAttribute('aria-pressed', 'true');
        expect(rectangle('files', 'right')).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(rectangle('files', 'left'));

        expect(screen.queryByTestId('panel-files')).toBeNull();
        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'off');
        // Out of the layout, no rectangle claims it.
        expect(rectangle('files', 'left')).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers the tab strip only from two tabs on, so one tab costs no room', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('toggle-left'));
        expect(screen.getByTestId('tool-bar-left')).toHaveClass('cms-tool-bar-single');

        fireEvent.click(rectangle('git', 'left'));

        expect(screen.getByTestId('tool-bar-left')).not.toHaveClass('cms-tool-bar-single');
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

describe('tab controls', () => {
    const controls = <button data-testid="tab-control">Control</button>;

    it.each(['left', 'center', 'right'])('puts controls in the %s strip after its tabs', side => {
        render(<Harness tabs={[{ ...GIT, defaultBar: 'off', additionalPanels: controls }]} />);
        fireEvent.click(rectangle('git', side));

        const bar = screen.getByTestId(`tool-bar-${side}`);
        const strip = bar.querySelector(':scope > .ant-tabs > .ant-tabs-nav')!;
        const extra = strip.querySelector('.ant-tabs-extra-content')!;
        expect(bar).not.toHaveClass('cms-tool-bar-single');
        expect(extra).toContainElement(screen.getByTestId('tab-control'));
        expect(strip.lastElementChild).toBe(extra);
    });

    it('shows only the active tab\'s controls when switching tabs', () => {
        render(<Harness tabs={[
            { ...DOCUMENT, forceRender: true, additionalPanels: controls },
            { ...GIT, additionalPanels: <button data-testid="git-control">Git control</button> },
        ]} />);
        fireEvent.click(rectangle('git', 'center'));
        const bar = screen.getByTestId('tool-bar-center');
        const labels = bar.querySelectorAll('.ant-tabs-tab');

        expect(bar).toContainElement(screen.getByTestId('tab-control'));
        expect(screen.queryByTestId('git-control')).toBeNull();

        fireEvent.click(labels[1]);

        expect(bar).toContainElement(screen.getByTestId('git-control'));
        expect(screen.queryByTestId('tab-control')).toBeNull();
        expect(bar).toContainElement(screen.getByTestId('panel-document'));

        fireEvent.click(labels[0]);

        expect(bar).toContainElement(screen.getByTestId('tab-control'));
        expect(screen.queryByTestId('git-control')).toBeNull();
    });

    it('keeps updated controls in their arranged bar without remounting its panel', () => {
        const renderPanel = () => <input aria-label="Panel draft" defaultValue="" />;
        const { rerender } = render(<Harness tabs={[
            { ...GIT, render: renderPanel, additionalPanels: controls },
        ]} />);
        fireEvent.click(rectangle('git', 'left'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Panel draft' }), { target: { value: 'draft' } });

        rerender(<Harness tabs={[
            { ...GIT, render: renderPanel, additionalPanels: <button>Updated control</button> },
        ]} />);

        const bar = screen.getByTestId('tool-bar-left');
        expect(bar).toContainElement(screen.getByText('Updated control'));
        expect(screen.getByRole('textbox', { name: 'Panel draft' })).toHaveValue('draft');
        expect(screen.queryByTestId('tab-control')).toBeNull();

        rerender(<Harness tabs={[{ ...GIT, render: renderPanel }]} />);

        expect(bar).toHaveClass('cms-tool-bar-single');
        expect(screen.queryByText('Updated control')).toBeNull();
    });
});

describe('revealing the tree', () => {
    it('opens the column the tree ships in when it is asked for by name', () => {
        render(<Harness tabs={[NAV_TREE]} />);

        fireEvent.click(screen.getByTestId('reveal-nav-tree'));

        expect(screen.getByTestId('tool-bar-side-left')).toContainElement(screen.getByTestId('panel-nav-tree'));
    });
});

describe('what a document remembers', () => {
    // Clicking a file in the navigation tree opens a document nobody has arranged. If that fell
    // back to the tab's shipped default, the tree would take itself away on every click.
    it('gives a document nobody has arranged the arrangement last chosen', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(rectangle('files', 'right'));

        state.path = 'never-seen.md';
        rerender(<Harness />);

        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'right');
    });

    it('gives a document that has been arranged its own, whatever is done elsewhere', () => {
        const { rerender } = render(<Harness />);
        fireEvent.click(rectangle('files', 'right'));

        state.path = 'own.md';
        rerender(<Harness />);
        fireEvent.click(rectangle('files', 'left'));

        state.path = 'first.md';
        rerender(<Harness />);
        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'right');

        state.path = 'own.md';
        rerender(<Harness />);
        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'left');
    });

    it.each(['global', 'document'])('falls back from saved top placements in %s state without rewriting them', scope => {
        const saved = { placement: { files: 'top', git: 'top' } };
        state.global.toolBars = { off: [], ...(scope === 'global' ? saved : {}) };
        if (scope === 'document') state.files[state.path] = { toolBars: saved };

        render(<Harness />);

        expect(screen.getByTestId('layout-grid-files')).toHaveAttribute('data-placement', 'left');
        expect(screen.getByTestId('layout-grid-git')).toHaveAttribute('data-placement', 'right');
        expect(screen.getByTestId('tool-bar-side-left')).toContainElement(screen.getByTestId('panel-files'));
        expect(screen.getByTestId('tool-bar-side-right')).toContainElement(screen.getByTestId('panel-git'));
        expect(saved.placement).toEqual({ files: 'top', git: 'top' });
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

describe('split central areas', () => {
    it('offers the second area switch only when that area is configured', () => {
        render(<Harness />);
        expect(screen.getByTestId('bar-toggle-center')).toBeEnabled();
        expect(screen.queryByTestId('bar-toggle-center-2')).toBeNull();

        fireEvent.click(screen.getByTestId('central-count-2'));
        expect(screen.getByTestId('bar-toggle-center-2')).toBeEnabled();

        fireEvent.click(screen.getByTestId('central-count-3'));
        expect(screen.getByTestId('bar-toggle-center-2')).toBeEnabled();

        fireEvent.click(screen.getByTestId('central-count-1'));
        expect(screen.queryByTestId('bar-toggle-center-2')).toBeNull();
    });

    it('hides each area without changing the count, placements, content or split proportions', () => {
        const editor: ToolBarTab = {
            ...DOCUMENT,
            render: () => <input aria-label="Draft" defaultValue="" />,
        };
        state.global.toolBars = { centralCount: 2 };
        state.global['split:centralAreas'] = { center: 1.2, 'center-2': 0.8 };
        const app = () => <Harness tabs={[editor, GIT]} />;
        const { container, rerender } = render(app());
        fireEvent.click(rectangle('git', 'center-2'));
        const draft = screen.getByRole('textbox', { name: 'Draft' });
        fireEvent.change(draft, { target: { value: 'Keep this draft' } });
        const first = container.querySelector('[data-split-part="center"]')!;
        const second = container.querySelector('[data-split-part="center-2"]')!;

        fireEvent.click(screen.getByTestId('bar-toggle-center'));
        expect(first).toHaveClass('cms-split-part-collapsed');
        expect(second).not.toHaveClass('cms-split-part-collapsed');
        expect(screen.queryByTestId('split-resize-center-2')).toBeNull();
        expect(screen.getByTestId('bar-toggle-center')).toHaveAccessibleName('Show the first central area');
        expect(screen.getByTestId('bar-toggle-center')).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(screen.getByTestId('bar-toggle-center-2'));
        expect(second).toHaveClass('cms-split-part-collapsed');
        expect(state.global.toolBars.centralCount).toBe(2);
        expect(screen.getByTestId('layout-grid-git')).toHaveAttribute('data-placement', 'center-2');
        expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
        expect(draft).toHaveValue('Keep this draft');

        state.path = 'another.md';
        rerender(app());
        expect(first).toHaveClass('cms-split-part-collapsed');
        expect(second).toHaveClass('cms-split-part-collapsed');

        fireEvent.click(screen.getByTestId('bar-toggle-center'));
        fireEvent.click(screen.getByTestId('bar-toggle-center-2'));
        expect(first).not.toHaveClass('cms-split-part-collapsed');
        expect(second).not.toHaveClass('cms-split-part-collapsed');
        expect(first).toHaveStyle({ flexGrow: 1.2 });
        expect(second).toHaveStyle({ flexGrow: 0.8 });
        expect(screen.getByTestId('split-resize-center-2')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
    });

    it('reveals a hidden central area when showing or placing a tab there', () => {
        const { container } = render(<Harness tabs={[DOCUMENT, GIT]} />);
        fireEvent.click(screen.getByTestId('central-count-2'));
        const first = container.querySelector('[data-split-part="center"]')!;
        const second = container.querySelector('[data-split-part="center-2"]')!;

        fireEvent.click(screen.getByTestId('bar-toggle-center'));
        fireEvent.click(screen.getByTestId('bar-toggle-center-2'));
        fireEvent.click(rectangle('git', 'center-2'));
        expect(first).toHaveClass('cms-split-part-collapsed');
        expect(second).not.toHaveClass('cms-split-part-collapsed');

        fireEvent.click(screen.getByTestId('reveal-document'));
        expect(first).not.toHaveClass('cms-split-part-collapsed');
    });

    it('shows one area by default and adds empty areas on split', () => {
        render(<Harness />);
        expect(screen.queryByTestId('tool-bar-center-2')).toBeNull();
        expect(screen.queryByTestId('layout-cell-git-center-2')).toBeNull();

        fireEvent.click(screen.getByTestId('central-count-2'));

        expect(screen.getByTestId('tool-bar-center-2')).toBeInTheDocument();
        expect(screen.getByTestId('layout-cell-git-center-2')).toBeEnabled();
        expect(screen.queryByTestId('tool-bar-center-3')).toBeNull();
    });

    it('places a panel in the second area with its own strip', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('central-count-2'));
        fireEvent.click(rectangle('git', 'center-2'));
        fireEvent.click(rectangle('claude', 'center-2'));

        expect(screen.getByTestId('tool-bar-center-2')).toContainElement(screen.getByTestId('panel-git'));
        expect(screen.getByTestId('tool-bar-center-2')).not.toHaveClass('cms-tool-bar-single');
        expect(screen.getByTestId('layout-grid-git')).toHaveAttribute('data-placement', 'center-2');
    });

    it('sizes the areas by dragging the separator between them', () => {
        const { container } = render(<Harness />);
        expect(screen.queryByTestId('split-resize-center-2')).toBeNull();

        fireEvent.click(screen.getByTestId('central-count-2'));

        const first = container.querySelector<HTMLElement>('[data-split-part="center"]')!;
        const second = container.querySelector<HTMLElement>('[data-split-part="center-2"]')!;
        expect(first.style.flexGrow).toBe('1');
        expect(second.style.flexGrow).toBe('1');

        sized(first, 500);
        sized(second, 500);
        const handle = screen.getByTestId('split-resize-center-2');
        pointer('pointerdown', handle, 0);
        pointer('pointermove', handle, 100);
        pointer('pointerup', handle, 100);

        expect(Number(first.style.flexGrow)).toBeCloseTo(1.2, 1);
        expect(Number(second.style.flexGrow)).toBeCloseTo(0.8, 1);
    });

    it('moves panels to the first area when the count is reduced', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('central-count-3'));
        fireEvent.click(rectangle('git', 'center-2'));
        fireEvent.click(rectangle('claude', 'center-3'));
        expect(screen.getByTestId('tool-bar-center-3')).toContainElement(screen.getByTestId('panel-claude'));

        fireEvent.click(screen.getByTestId('central-count-1'));

        expect(screen.queryByTestId('tool-bar-center-2')).toBeNull();
        expect(screen.getByTestId('layout-grid-git')).toHaveAttribute('data-placement', 'center');
        expect(screen.getByTestId('layout-grid-claude')).toHaveAttribute('data-placement', 'center');
        expect(screen.getByTestId('tool-bar-center')).toContainElement(screen.getByTestId('panel-git'));
    });
});
