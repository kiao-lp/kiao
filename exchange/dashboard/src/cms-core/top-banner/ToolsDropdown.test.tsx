import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What "Copy path" puts on the clipboard. A path is copied to be pasted into a document, where
 * only the leading slash tells a reference to another document of the store apart from one read
 * against the document holding it — see `storeLinkOf`, kiao-worker/utils.ts.
 */

let currentFile: { path: string; isDirectory: boolean } | null = null;

vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile, currentPath: '' }),
}));
const navigate = vi.hoisted(() => vi.fn());
const bars = vi.hoisted(() => ({ showTab: vi.fn(), on: false as boolean }));

vi.mock('react-router-dom', () => ({
    useLocation: () => ({ pathname: '/units/abc/cadre.md', search: '', hash: '' }),
    // The menu offers the pages plugins claimed a URL prefix for — the boards — and navigating is
    // how it opens one, unless the menu names a lateral panel to open instead.
    useNavigate: () => navigate,
}));
vi.mock('src/cms-core/files/service/ui', () => ({ useWorkerClient: () => ({}) }));
vi.mock('../../ThemeContext', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('../toolbar/GitDiff-ctx', () => ({ useGitDiffOptional: () => null }));
vi.mock('../config/DashboardConfig-ctx', () => ({ useDashboardConfig: () => ({ gitEnabled: false }) }));
vi.mock('./ShowMenu', () => ({ useShowMenuItems: () => [] }));
vi.mock('../tool-bars/ToolBars-ctx', () => ({
    useToolBarsOptional: () => (bars.on ? { showTab: bars.showTab } : null),
}));

import { ToolsDropdown } from './ToolsDropdown';
import { AppRoutesProvider } from '../app-routes';

const writeText = vi.fn(() => Promise.resolve());

/** Opens the "..." menu and clicks the entry with that label. */
const clickTool = async (label: string) => {
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(await screen.findByText(label));
};

describe('ToolsDropdown', () => {

    beforeEach(() => {
        writeText.mockClear();
        navigate.mockClear();
        bars.showTab.mockClear();
        bars.on = false;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });

    it('copies the path of the open file as a link, from the store root', async () => {
        currentFile = { path: 'units/abc/cadre.md', isDirectory: false };
        render(<ToolsDropdown />);

        await clickTool('Copy path');

        expect(writeText).toHaveBeenCalledWith('/units/abc/cadre.md');
    });

    it('leaves a path already written as a link as it stands', async () => {
        currentFile = { path: '/units/abc/cadre.md', isDirectory: false };
        render(<ToolsDropdown />);

        await clickTool('Copy path');

        expect(writeText).toHaveBeenCalledWith('/units/abc/cadre.md');
    });

    // The pages plugins own that are not documents of the store — the boards. They are found here
    // because they are found nowhere else: a board is not in the file browser any more, so the
    // claim of a URL prefix carries the way in to it.
    it('offers the pages a plugin claimed a URL for, and goes to one', async () => {
        render(
            <AppRoutesProvider routes={[{ prefix: '/boards', render: () => null, menu: { label: 'Boards…' } }]}>
                <ToolsDropdown />
            </AppRoutesProvider>,
        );

        await clickTool('Boards…');

        expect(navigate).toHaveBeenCalledWith('/boards');
    });

    // A page whose menu names a lateral panel opens that panel instead of navigating: the list
    // lives in the panel, and the open document stays where it is.
    it('opens the lateral panel a page menu names, without navigating', async () => {
        bars.on = true;
        render(
            <AppRoutesProvider routes={[{
                prefix: '/boards',
                render: () => null,
                menu: { label: 'Boards…', showTab: 'hybridflow-ui-boards' },
            }]}>
                <ToolsDropdown />
            </AppRoutesProvider>,
        );

        await clickTool('Boards…');

        expect(bars.showTab).toHaveBeenCalledWith('hybridflow-ui-boards');
        expect(navigate).not.toHaveBeenCalled();
    });

    // A page that says nothing about how it is reached is one arrived at by link only.
    it('offers nothing for a page that declared no menu entry', async () => {
        render(
            <AppRoutesProvider routes={[{ prefix: '/hidden', render: () => null }]}>
                <ToolsDropdown />
            </AppRoutesProvider>,
        );
        await userEvent.click(screen.getByRole('button'));

        expect(screen.queryByText('/hidden')).toBeNull();
    });
});
