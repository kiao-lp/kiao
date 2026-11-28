import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../files/core/FileSearch-ctx', () => ({
    useFileSearchContext: () => ({ search: vi.fn(), clearSearch: vi.fn(), searchError: null, searchResults: null }),
}));
vi.mock('../../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// The pieces the banner holds, stubbed: what is under test is which of them it draws.
vi.mock('./LanguageSwitch', () => ({ LanguageSwitch: () => <span /> }));
vi.mock('./CompanionSwitch', () => ({ CompanionSwitch: () => <span /> }));
vi.mock('./ToolsDropdown', () => ({ ToolsDropdown: () => <button data-testid="tools-menu" /> }));
vi.mock('./BarToggle', () => ({
    BarToggle: ({ bar }: { bar: string }) => <button data-testid={`toggle-${bar}`} />,
    SecondCentralAreaToggle: () => <button data-testid="toggle-center-2" />,
}));
vi.mock('../../files/browser/FileSearchInput', () => ({
    FileSearchInput: () => <input data-testid="search" />,
}));
vi.mock('../../ui-foundation/zoom', () => ({ ZoomSlider: () => <span data-testid="zoom-slider" /> }));

import { TopBanner } from './TopBanner';

const banner = () => document.querySelector('.cms-top-banner');

describe('TopBanner', () => {

    it('places the tools menu, search and layout controls in left-to-right order', () => {
        render(<TopBanner />);

        const switches = screen.getByRole('group', { name: 'Layout visibility' });
        expect(Array.from(banner()!.children)).toEqual([
            screen.getByTestId('tools-menu'),
            screen.getByTestId('search').parentElement,
            switches.parentElement,
        ]);
        expect([...switches.querySelectorAll('button')].map(button => button.dataset.testid))
            .toEqual(['toggle-left', 'toggle-center-2', 'toggle-right']);
        expect(switches.parentElement).toContainElement(screen.getByTestId('zoom-slider'));
    });

});
