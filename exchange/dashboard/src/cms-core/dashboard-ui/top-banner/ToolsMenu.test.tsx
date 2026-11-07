import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('src/cms-core/view-state', async () => {
    const React = await import('react');
    const useScope = (_key: string, defaults: any) => {
        const [value, setValue] = React.useState(defaults);
        const update = React.useCallback((patch: any) => setValue((previous: any) => ({
            ...previous, ...(typeof patch === 'function' ? patch(previous) : patch),
        })), []);
        return [value, update];
    };
    return { useFileViewState: useScope, useGlobalViewState: useScope };
});
vi.mock('../../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: { path: 'a.md', isDirectory: false }, currentPath: '' }),
}));
vi.mock('../../files/navigation/NavigationModel', () => ({ useNavigation: () => ({ open: vi.fn() }) }));
vi.mock('../../git/GitDiffStackPanel', () => ({ GitDiffStackPanel: () => null }));
vi.mock('../../files/browser/FileSearchResultsView', () => ({ FileSearchResultsStackPanel: () => null }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: () => ({}) }));
vi.mock('../../ui-foundation/theme/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('../../git/GitDiff-ctx', () => ({ useGitDiffOptional: () => null }));
vi.mock('../../config/DashboardConfig-ctx', () => ({ useDashboardConfig: () => ({ gitEnabled: false }) }));
vi.mock('./ShowMenu', () => ({ useShowMenuItems: () => [] }));

import { ToolsDropdown } from './ToolsDropdown';
import { ToolsMenuProvider } from './ToolsMenu-ctx';
import { LayoutContent } from '../layout/LayoutContent';
import { useCentralStack } from '../documents/CentralStack-ctx';
import type { ToolsMenuItemDeclaration } from '../../extensibility/FileBasedPlugin';
import { ToolBarsProvider, ToolBarTabRegistration, useToolBars } from '../toolbars/ToolBars-ctx';

const items: ToolsMenuItemDeclaration[] = [{
    id: 'report', label: 'Report…',
    panel: { label: 'Report', content: <input aria-label="Report draft" /> },
}];

const Board = () => {
    const { push } = useCentralStack();
    return <button onClick={() => push({
        id: 'form', host: 'board', label: 'Form', content: <input aria-label="Unfinished form" />,
    })}>Open form</button>;
};

const board = { id: 'board', title: 'Board', defaultBar: 'center', render: () => <Board /> };
const secondary = {
    id: 'secondary', title: 'Secondary', defaultBar: 'center-2',
    render: () => <input aria-label="Secondary draft" />,
};

const Controls = () => {
    const bars = useToolBars();
    return <>
        <button onClick={() => bars.setSecondCentralArea(true)}>Split</button>
        <button onClick={() => bars.setSecondCentralArea(false)}>Unsplit</button>
    </>;
};

const Harness = ({ enabled = true, layout = true, version = 0 }) => (
    <ToolsMenuProvider items={enabled ? items : []}>
        <ToolBarsProvider>
            <ToolBarTabRegistration tab={board} />
            <ToolBarTabRegistration tab={secondary} />
            {layout && <LayoutContent key={version}><input aria-label="Document draft" /></LayoutContent>}
            <ToolsDropdown />
            <Controls />
        </ToolBarsProvider>
    </ToolsMenuProvider>
);

const openMenu = () => userEvent.click(document.querySelector('.anticon-more')!.closest('button')!);
const openReport = async () => {
    await openMenu();
    await userEvent.click(await screen.findByText('Report…'));
};
const report = () => screen.getByRole('dialog', { name: 'Report' });
const bar = (id: string) => screen.getByTestId(`tool-bar-${id}`);

beforeEach(() => { vi.clearAllMocks(); });

describe('plugin tools menu panels', () => {
    it('omits contributions from plugins outside the loaded set', async () => {
        render(<Harness enabled={false} />);
        await openMenu();
        expect(screen.queryByText('Report…')).toBeNull();
    });

    it('opens on the document by default and preserves the draft when brought forward again', async () => {
        render(<Harness />);
        await openReport();
        expect(bar('center')).toContainElement(report());
        fireEvent.change(screen.getByLabelText('Report draft'), { target: { value: 'draft' } });
        await openReport();
        expect(screen.getAllByTestId('central-panel-report')).toHaveLength(1);
        expect(screen.getByLabelText('Report draft')).toHaveValue('draft');
    });

    it('stacks over the selected central panel and returns to its unfinished form', async () => {
        render(<Harness />);
        fireEvent.click(within(bar('center')).getByRole('tab', { name: 'Board' }));
        fireEvent.click(screen.getByText('Open form'));
        fireEvent.change(screen.getByLabelText('Unfinished form'), { target: { value: 'unfinished' } });

        await openReport();

        expect(within(bar('center')).getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('central-panel-form')).toHaveAttribute('hidden');
        fireEvent.click(within(report()).getByRole('button', { name: 'Close' }));
        expect(screen.getByTestId('central-panel-form')).not.toHaveAttribute('hidden');
        expect(screen.getByLabelText('Unfinished form')).toHaveValue('unfinished');
    });

    it('targets the last central area used by pointer or keyboard, and falls back after closing it', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByText('Split'));
        fireEvent.pointerDown(screen.getByLabelText('Secondary draft'));
        await openReport();
        expect(bar('center-2')).toContainElement(report());
        fireEvent.click(within(report()).getByRole('button', { name: 'Close' }));

        fireEvent.focus(screen.getByLabelText('Document draft'));
        await openReport();
        expect(bar('center')).toContainElement(report());
        fireEvent.click(within(report()).getByRole('button', { name: 'Close' }));

        fireEvent.focus(screen.getByLabelText('Secondary draft'));
        fireEvent.click(screen.getByText('Unsplit'));
        await openReport();
        expect(bar('center')).toContainElement(report());
    });

    it('connects to the replacement layout and disables entries while no layout is mounted', async () => {
        const { rerender } = render(<Harness />);
        await openReport();
        rerender(<Harness layout={false} />);
        await openMenu();
        expect(screen.getByText('Report…').closest('li')).toHaveAttribute('aria-disabled', 'true');
        await openMenu();

        rerender(<Harness version={1} />);
        await openReport();
        expect(bar('center')).toContainElement(report());
    });
});
