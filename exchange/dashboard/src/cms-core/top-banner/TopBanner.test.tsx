import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The banner is chrome, reached with the mouse: nothing a plugin does with the *keyboard*
 * may take it away. The regression this pins down is a note of a mindmap being edited —
 * the plugin turns the command dispatcher off so its own textarea keeps the keys, and the
 * whole banner used to go with it, search box and column toggles included.
 */

let enabled = true;

/** Wide enough for everything the banner can hold — the command hints are a wide-screen row. */
const wideScreen = () => {
    window.matchMedia = ((query: string) => ({
        matches: true, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
};

vi.mock('../commands/CommandDispatcher-ctx', () => ({
    useCommandDispatcherContext: () => ({ enabled, sentence: '', candidates: [], setEnabled: vi.fn() }),
}));
vi.mock('../files/core/FileSearch-ctx', () => ({
    useFileSearchContext: () => ({ search: vi.fn(), clearSearch: vi.fn(), searchError: null, searchResults: null }),
}));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: null, currentPath: '' }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// The pieces the banner holds, stubbed: what is under test is which of them it draws.
vi.mock('./CommandSentence', () => ({ CommandSentence: () => <span data-testid="sentence" /> }));
vi.mock('./LanguageSwitch', () => ({ LanguageSwitch: () => <span /> }));
vi.mock('./CompanionSwitch', () => ({ CompanionSwitch: () => <span /> }));
vi.mock('./ToolsDropdown', () => ({ ToolsDropdown: () => <span /> }));
vi.mock('./BarToggle', () => ({
    BarToggle: ({ side }: { side: string }) => <button data-testid={`toggle-${side}`} />,
}));
vi.mock('../files/browser/FileSearchInput', () => ({
    FileSearchInput: () => <input data-testid="search" />,
}));
vi.mock('../zoom', () => ({ ZoomSlider: () => <span /> }));

import { TopBanner } from './TopBanner';

const banner = () => document.querySelector('.cms-top-banner');

describe('TopBanner', () => {

    beforeEach(() => { enabled = true; wideScreen(); });

    it('holds the search box and both column toggles', () => {
        render(<TopBanner />);

        expect(banner()).toBeInTheDocument();
        expect(screen.getByTestId('search')).toBeInTheDocument();
        expect(screen.getByTestId('toggle-left')).toBeInTheDocument();
        expect(screen.getByTestId('toggle-right')).toBeInTheDocument();
        expect(screen.getByTestId('sentence')).toBeInTheDocument();
    });

    it('stays put while a plugin holds the keyboard', () => {
        enabled = false;
        render(<TopBanner />);

        expect(banner()).toBeInTheDocument();
        expect(screen.getByTestId('search')).toBeInTheDocument();
        expect(screen.getByTestId('toggle-left')).toBeInTheDocument();
        expect(screen.getByTestId('toggle-right')).toBeInTheDocument();
    });

    it('drops the command hints, which would no longer answer', () => {
        enabled = false;
        render(<TopBanner />);

        expect(screen.queryByTestId('sentence')).toBeNull();
    });

});
