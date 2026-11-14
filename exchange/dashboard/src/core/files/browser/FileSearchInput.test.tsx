import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// jsdom has no speech recognition; microphone absent.
vi.mock('../../ui-foundation/voice-input/VoiceInputContext', () => ({
    useVoiceInput: () => ({ language: 'en-US', setLanguage: () => { } }),
}));

import { FileSearchInput } from './FileSearchInput';

const typeAndEnter = (text: string) => {
    const input = screen.getByPlaceholderText('Search');
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
    return input;
};

describe('FileSearchInput', () => {
    it('passes the raw query to onSearch — the grammar is the server’s to parse', () => {
        const onSearch = vi.fn();
        render(<FileSearchInput onSearch={onSearch} onClear={vi.fn()} />);

        typeAndEnter('plan "Plan B" /v\\d+/ -draft');

        expect(onSearch).toHaveBeenCalledTimes(1);
        expect(onSearch).toHaveBeenCalledWith('plan "Plan B" /v\\d+/ -draft');
        // Single argument only.
        expect(onSearch.mock.calls[0]).toHaveLength(1);
    });

    it('clears instead of searching when the field holds nothing but blanks', () => {
        const onSearch = vi.fn();
        const onClear = vi.fn();
        render(<FileSearchInput onSearch={onSearch} onClear={onClear} />);

        typeAndEnter('   ');

        expect(onSearch).not.toHaveBeenCalled();
        expect(onClear).toHaveBeenCalled();
    });

    it('clears as soon as the field is emptied, without waiting for Enter', () => {
        const onClear = vi.fn();
        render(<FileSearchInput onSearch={vi.fn()} onClear={onClear} />);

        const input = screen.getByPlaceholderText('Search');
        fireEvent.change(input, { target: { value: 'alpha' } });
        expect(onClear).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: '' } });
        expect(onClear).toHaveBeenCalled();
    });

    it('empties the box when the result list it queried goes away', () => {
        const { rerender } = render(<FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} showingResults={false} />);

        const input = screen.getByPlaceholderText('Search') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'alpha' } });
        rerender(<FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} showingResults />);
        expect(input.value).toBe('alpha');

        rerender(<FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} showingResults={false} />);
        expect(input.value).toBe('');
    });

    it('leaves a refused query in the box to be fixed', () => {
        const { rerender } = render(<FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} />);

        const input = screen.getByPlaceholderText('Search') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '/[/' } });
        // Refused query stays for fixing.
        rerender(<FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} error="invalid search pattern /[/" />);

        expect(input.value).toBe('/[/');
    });

    it('offers a help icon in place of the old mode toggles', () => {
        render(<FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} />);

        for (const label of ['Match Case', 'Match Whole Word', 'Use Regular Expression']) {
            expect(screen.queryByTitle(label)).toBeNull();
        }
        expect(screen.getByTestId('search-help-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('search-error-icon')).toBeNull();
    });

    it('marks the box and swaps the help icon for the server’s complaint', () => {
        const { container } = render(
            <FileSearchInput onSearch={vi.fn()} onClear={vi.fn()} error="invalid search pattern /[/" />,
        );

        expect(container.querySelector('.ant-input-status-error')).not.toBeNull();
        expect(screen.getByTestId('search-error-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('search-help-icon')).toBeNull();
    });
});
