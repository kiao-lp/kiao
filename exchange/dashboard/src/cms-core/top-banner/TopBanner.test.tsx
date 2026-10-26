import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../files/core/FileSearch-ctx', () => ({
    useFileSearchContext: () => ({ search: vi.fn(), clearSearch: vi.fn(), searchError: null, searchResults: null }),
}));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// The pieces the banner holds, stubbed: what is under test is which of them it draws.
vi.mock('./LanguageSwitch', () => ({ LanguageSwitch: () => <span /> }));
vi.mock('./CompanionSwitch', () => ({ CompanionSwitch: () => <span /> }));
vi.mock('./ToolsDropdown', () => ({ ToolsDropdown: () => <button data-testid="tools-menu" /> }));
vi.mock('./BarToggle', () => ({
    BarToggle: ({ bar }: { bar: string }) => <button data-testid={`toggle-${bar}`} />,
}));
vi.mock('../files/browser/FileSearchInput', () => ({
    FileSearchInput: () => <input data-testid="search" />,
}));
vi.mock('../zoom', () => ({ ZoomSlider: () => <span data-testid="zoom-slider" /> }));

import { TopBanner } from './TopBanner';

const banner = () => document.querySelector('.cms-top-banner');

describe('TopBanner', () => {

    it('groups the visibility switches on the right, immediately before the tools menu', () => {
        render(<TopBanner />);

        expect(banner()).toBeInTheDocument();
        expect(screen.getByTestId('search')).toBeInTheDocument();
        expect(banner()).toContainElement(screen.getByTestId('zoom-slider'));
        const switches = screen.getByRole('group', { name: 'Layout visibility' });
        expect([...switches.querySelectorAll('button')].map(button => button.dataset.testid))
            .toEqual(['toggle-left', 'toggle-center', 'toggle-center-2', 'toggle-right']);
        expect(switches.nextElementSibling).toBe(screen.getByTestId('tools-menu'));
        expect(switches.parentElement).toContainElement(screen.getByTestId('zoom-slider'));
    });

});
